//! Lossless references from canonical decoded JSON hex strings into raw block bytes.
//! Optional encoding only: noncanonical/oversized inputs keep their original bytes.
use crate::{Error, Result};
use prep_proto::prep::FullBlock;
use prost::Message;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{borrow::Cow, ops::Range};

const MAGIC: &[u8; 5] = b"ZREF1";
const MAX_PATCHES: usize = 4096;
const MAX_METADATA: usize = 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Patch {
    path: String,
    offset: u32,
    length: u32,
}

pub(crate) fn encode(payload: &[u8]) -> Option<Vec<u8>> {
    let mut block = FullBlock::decode(payload).ok()?;
    if block.raw_block.len() > 2_000_000
        || block.decoded_json.len() > 32 * 1024 * 1024
        || block.encode_to_vec() != payload
    {
        return None;
    }
    let mut json: Value = serde_json::from_str(&block.decoded_json).ok()?;
    if serde_json::to_string(&json).ok()? != block.decoded_json {
        return None;
    }
    let mut patches = Vec::new();
    walk(&mut json, "", &block.raw_block, &mut patches);
    if patches.is_empty() {
        return None;
    }
    let metadata = serde_json::to_vec(&patches).ok()?;
    if metadata.len() > MAX_METADATA {
        return None;
    }
    block.decoded_json = serde_json::to_string(&json).ok()?;
    let encoded = block.encode_to_vec();
    let mut output = Vec::with_capacity(9 + metadata.len() + encoded.len());
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
    output.extend_from_slice(&metadata);
    output.extend_from_slice(&encoded);
    (output.len() < payload.len()).then_some(output)
}

fn walk(value: &mut Value, path: &str, raw: &[u8], patches: &mut Vec<Patch>) {
    if patches.len() >= MAX_PATCHES || path.len() > 1024 {
        return;
    }
    match value {
        Value::String(text)
            if text.len() >= 128
                && text.len().is_multiple_of(2)
                && text.len() <= raw.len() * 2
                && path.len() + 80 < text.len()
                && text
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) =>
        {
            if let Ok(bytes) = hex::decode(text.as_bytes()) {
                if let Some(offset) = memchr::memmem::find(raw, &bytes) {
                    patches.push(Patch {
                        path: path.to_owned(),
                        offset: offset as u32,
                        length: bytes.len() as u32,
                    });
                    *value = Value::Null;
                }
            }
        }
        Value::Array(values) => {
            for (index, child) in values.iter_mut().enumerate() {
                walk(child, &format!("{path}/{index}"), raw, patches);
            }
        }
        Value::Object(values) => {
            for (key, child) in values.iter_mut() {
                walk(
                    child,
                    &format!("{path}/{}", key.replace('~', "~0").replace('/', "~1")),
                    raw,
                    patches,
                );
            }
        }
        _ => {}
    }
}

pub(crate) fn decode(payload: &[u8], max: usize) -> Result<Vec<u8>> {
    if let Some(output) = decode_canonical(payload, max) {
        #[cfg(feature = "admission-profile")]
        crate::profiling::counter("raw_reference_fast_path");
        return Ok(output);
    }
    #[cfg(feature = "admission-profile")]
    crate::profiling::counter("raw_reference_legacy_path");
    decode_legacy(payload, max)
}

// Fast path only when the stored JSON is already the exact canonical encoding
// that the legacy Value roundtrip would produce. Every other input keeps the
// original decoder, including escaped strings, duplicate/unsorted keys and bounds.
fn decode_canonical(payload: &[u8], max: usize) -> Option<Vec<u8>> {
    if payload.len() < 9 || &payload[..5] != MAGIC {
        return None;
    }
    let length = u32::from_le_bytes(payload[5..9].try_into().ok()?) as usize;
    if length > MAX_METADATA || length > payload.len() - 9 {
        return None;
    }
    let patches: Vec<Patch> = serde_json::from_slice(&payload[9..9 + length]).ok()?;
    if patches.is_empty() || patches.len() > 16 {
        return None;
    }
    let mut block = FullBlock::decode(&payload[9 + length..]).ok()?;
    if block.raw_block.len() > 2_000_000 || block.decoded_json.len() > max {
        return None;
    }
    // Delegate syntax validation to serde; the scanner below only establishes
    // canonical order/representation and locates the null replacement spans.
    let _: serde::de::IgnoredAny = serde_json::from_str(&block.decoded_json).ok()?;
    let mut expanded = block.decoded_json.len();
    let mut targets = Vec::with_capacity(patches.len());
    for patch in &patches {
        if patch.path.len() > 1024 || patch.length == 0 {
            return None;
        }
        expanded = expanded
            .checked_add(patch.length as usize * 2)?
            .checked_sub(2)?;
        if expanded > max {
            return None;
        }
        let end = (patch.offset as usize).checked_add(patch.length as usize)?;
        block.raw_block.get(patch.offset as usize..end)?;
        let tokens = if patch.path.is_empty() {
            vec![]
        } else {
            patch
                .path
                .strip_prefix('/')?
                .split('/')
                .map(|v| v.replace("~1", "/").replace("~0", "~"))
                .collect::<Vec<_>>()
        };
        if targets
            .iter()
            .any(|target: &Target| target.tokens == tokens)
        {
            return None;
        }
        targets.push(Target { tokens, span: None });
    }
    let mut scanner = Canonical {
        text: &block.decoded_json,
        position: 0,
        path: vec![],
        targets: &mut targets,
    };
    scanner.value(0)?;
    if scanner.position != block.decoded_json.len() {
        return None;
    }
    let mut replacements = targets
        .into_iter()
        .zip(patches.iter())
        .map(|(target, patch)| Some((target.span?, patch)))
        .collect::<Option<Vec<_>>>()?;
    replacements.sort_by_key(|(span, _)| span.start);
    let mut output = Vec::with_capacity(expanded);
    let mut previous = 0;
    for (span, patch) in replacements {
        if span.start < previous {
            return None;
        }
        output.extend_from_slice(block.decoded_json.as_bytes().get(previous..span.start)?);
        output.push(b'"');
        let end = patch.offset as usize + patch.length as usize;
        output.extend_from_slice(
            hex::encode(&block.raw_block[patch.offset as usize..end]).as_bytes(),
        );
        output.push(b'"');
        previous = span.end;
    }
    output.extend_from_slice(&block.decoded_json.as_bytes()[previous..]);
    if output.len() != expanded {
        return None;
    }
    block.decoded_json = String::from_utf8(output).ok()?;
    let output = block.encode_to_vec();
    (output.len() <= max).then_some(output)
}

struct Target {
    tokens: Vec<String>,
    span: Option<Range<usize>>,
}
struct Canonical<'a, 'b> {
    text: &'a str,
    position: usize,
    path: Vec<Cow<'a, str>>,
    targets: &'b mut [Target],
}
impl<'a> Canonical<'a, '_> {
    fn byte(&self) -> Option<u8> {
        self.text.as_bytes().get(self.position).copied()
    }
    fn string(&mut self) -> Option<&'a str> {
        if self.byte()? != b'"' {
            return None;
        }
        self.position += 1;
        let start = self.position;
        loop {
            match self.byte()? {
                b'"' => {
                    let result = self.text.get(start..self.position)?;
                    self.position += 1;
                    return Some(result);
                }
                b'\\' | 0..=31 => return None,
                _ => self.position += 1,
            }
        }
    }
    fn value(&mut self, depth: usize) -> Option<()> {
        // Conservative fast-path bound; deeper inputs retain legacy handling.
        if depth >= 128 {
            return None;
        }
        match self.byte()? {
            b'{' => {
                self.position += 1;
                if self.byte()? == b'}' {
                    self.position += 1;
                    return Some(());
                }
                let mut previous: Option<&str> = None;
                loop {
                    let key = self.string()?;
                    // serde's Value visitor reserves internal number/raw-value
                    // map markers. Preserve its exact handling via the fallback.
                    if key.starts_with("$serde_json::private::") {
                        return None;
                    }
                    if previous.is_some_and(|old| old >= key) {
                        return None;
                    }
                    previous = Some(key);
                    if self.byte()? != b':' {
                        return None;
                    }
                    self.position += 1;
                    self.path.push(Cow::Borrowed(key));
                    self.value(depth + 1)?;
                    self.path.pop();
                    match self.byte()? {
                        b'}' => {
                            self.position += 1;
                            break;
                        }
                        b',' => self.position += 1,
                        _ => return None,
                    }
                }
            }
            b'[' => {
                self.position += 1;
                if self.byte()? == b']' {
                    self.position += 1;
                    return Some(());
                }
                let mut index = 0usize;
                loop {
                    self.path.push(Cow::Owned(index.to_string()));
                    self.value(depth + 1)?;
                    self.path.pop();
                    index = index.checked_add(1)?;
                    match self.byte()? {
                        b']' => {
                            self.position += 1;
                            break;
                        }
                        b',' => self.position += 1,
                        _ => return None,
                    }
                }
            }
            b'"' => {
                self.string()?;
            }
            b'n' => {
                let start = self.position;
                if self.text.get(start..start + 4)? != "null" {
                    return None;
                }
                self.position += 4;
                for target in self.targets.iter_mut() {
                    if target.tokens.len() == self.path.len()
                        && target
                            .tokens
                            .iter()
                            .zip(&self.path)
                            .all(|(a, b)| a == b.as_ref())
                    {
                        if target.span.is_some() {
                            return None;
                        }
                        target.span = Some(start..self.position);
                    }
                }
            }
            b't' => {
                if self.text.get(self.position..self.position + 4)? != "true" {
                    return None;
                }
                self.position += 4;
            }
            b'f' => {
                if self.text.get(self.position..self.position + 5)? != "false" {
                    return None;
                }
                self.position += 5;
            }
            _ => {
                let start = self.position;
                while self.byte().is_some_and(|b| {
                    b.is_ascii_digit() || matches!(b, b'-' | b'+' | b'.' | b'e' | b'E')
                }) {
                    self.position += 1;
                }
                let text = self.text.get(start..self.position)?;
                let number: serde_json::Number = serde_json::from_str(text).ok()?;
                if number.to_string() != text {
                    return None;
                }
            }
        }
        Some(())
    }
}

fn decode_legacy(payload: &[u8], max: usize) -> Result<Vec<u8>> {
    if payload.len() < 9 || &payload[..5] != MAGIC {
        return Err(Error::Invalid("raw reference header"));
    }
    let length = u32::from_le_bytes(payload[5..9].try_into().unwrap()) as usize;
    if length > MAX_METADATA || length > payload.len() - 9 {
        return Err(Error::Limit("raw reference metadata"));
    }
    let patches: Vec<Patch> = serde_json::from_slice(&payload[9..9 + length])?;
    if patches.is_empty() || patches.len() > MAX_PATCHES {
        return Err(Error::Limit("raw reference count"));
    }
    let mut block = FullBlock::decode(&payload[9 + length..])?;
    if block.raw_block.len() > 2_000_000 || block.decoded_json.len() > max {
        return Err(Error::Limit("raw reference block"));
    }
    let mut expanded = block.decoded_json.len();
    let mut json: Value = serde_json::from_str(&block.decoded_json)?;
    for patch in patches {
        if patch.path.len() > 1024 || patch.length == 0 {
            return Err(Error::Limit("raw reference path or length"));
        }
        expanded = expanded
            .checked_add(patch.length as usize * 2)
            .and_then(|n| n.checked_sub(2))
            .ok_or(Error::Limit("raw reference expansion"))?;
        if expanded > max {
            return Err(Error::Limit("raw reference expansion"));
        }
        let end = (patch.offset as usize)
            .checked_add(patch.length as usize)
            .ok_or(Error::Limit("raw reference offset"))?;
        let bytes = block
            .raw_block
            .get(patch.offset as usize..end)
            .ok_or(Error::Invalid("raw reference outside block"))?;
        let target = json
            .pointer_mut(&patch.path)
            .ok_or(Error::Invalid("raw reference path missing"))?;
        if !target.is_null() {
            return Err(Error::Invalid("raw reference target not empty"));
        }
        *target = Value::String(hex::encode(bytes));
    }
    block.decoded_json = serde_json::to_string(&json)?;
    let output = block.encode_to_vec();
    if output.len() > max {
        return Err(Error::Limit("raw reference expansion"));
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame(json: &str, paths: &[&str]) -> Vec<u8> {
        let raw: Vec<u8> = (0..=255).cycle().take(4096).collect();
        let metadata = serde_json::to_vec(
            &paths
                .iter()
                .enumerate()
                .map(|(i, path)| Patch {
                    path: (*path).into(),
                    offset: (i * 64) as u32,
                    length: 64,
                })
                .collect::<Vec<_>>(),
        )
        .unwrap();
        let block = FullBlock {
            height: 1,
            hash: vec![1; 32],
            prev_hash: vec![2; 32],
            time: 1,
            raw_block: raw,
            decoded_json: json.into(),
        };
        let mut output = MAGIC.to_vec();
        output.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        output.extend_from_slice(&metadata);
        output.extend_from_slice(&block.encode_to_vec());
        output
    }
    #[test]
    fn canonical_splicing_matches_legacy_for_numbers_arrays_and_pointer_paths() {
        for json in [
            r#"{"a":[null,{"b":true}],"n":0,"x":null}"#,
            r#"{"a":[null,{"b":true}],"n":-1,"x":null}"#,
            r#"{"a":[null,{"b":true}],"n":1.23e-42,"x":null}"#,
            r#"{"a":[null,{"b":true}],"n":18446744073709551616,"x":null}"#,
            r#"{"a":[null,{"b":true}],"n":-0,"x":null}"#,
            r#"{"a":[null,{"b":true}],"n":0.0,"x":null}"#,
            r#"{"a":[null,{"b":true}],"n":null,"x":null}"#,
            r#"{"a":[null,{"b":true}],"n":"café","x":null}"#,
        ] {
            let encoded = frame(json, &["/a/0", "/x"]);
            assert_eq!(
                decode(&encoded, 100_000).unwrap(),
                decode_legacy(&encoded, 100_000).unwrap()
            );
        }
        let encoded = frame(
            r#"{"":null,"a/b":{"~key":null},"x":1}"#,
            &["/", "/a~1b/~0key"],
        );
        assert!(decode_canonical(&encoded, 100_000).is_some());
        assert_eq!(
            decode(&encoded, 100_000).unwrap(),
            decode_legacy(&encoded, 100_000).unwrap()
        );
    }
    #[test]
    fn noncanonical_and_reserved_objects_keep_legacy_acceptance_and_rejection() {
        for json in [
            r#" {"x":null} "#,
            r#"{"z":1,"x":null}"#,
            r#"{"x":1,"x":null}"#,
            r#"{"escaped":"\u0061","x":null}"#,
            r#"{"escaped":"a\nb","x":null}"#,
            r#"{"$serde_json::private::Number":"123","x":null}"#,
            r#"{"$serde_json::private::Number":"bad","x":null}"#,
            r#"{"$serde_json::private::RawValue":"123","x":null}"#,
        ] {
            let encoded = frame(json, &["/x"]);
            assert!(decode_canonical(&encoded, 100_000).is_none());
            let legacy = decode_legacy(&encoded, 100_000);
            match legacy {
                Ok(expected) => assert_eq!(decode(&encoded, 100_000).unwrap(), expected),
                Err(_) => assert!(decode(&encoded, 100_000).is_err()),
            }
        }
        for depth in 120..132 {
            let json = format!(
                r#"{{"a":{}0{},"x":null}}"#,
                "[".repeat(depth),
                "]".repeat(depth)
            );
            let encoded = frame(&json, &["/x"]);
            let legacy = decode_legacy(&encoded, 100_000);
            match legacy {
                Ok(expected) => assert_eq!(decode(&encoded, 100_000).unwrap(), expected),
                Err(_) => assert!(decode(&encoded, 100_000).is_err()),
            }
        }
        for paths in [
            vec!["/x", "/x"],
            vec!["/missing"],
            vec!["/a/01"],
            vec!["/a/-"],
            vec!["not/a/pointer"],
        ] {
            let encoded = frame(r#"{"a":[null],"x":null}"#, &paths);
            assert_eq!(
                decode(&encoded, 100_000).is_ok(),
                decode_legacy(&encoded, 100_000).is_ok()
            );
        }
    }
    #[test]
    fn exact_roundtrip_including_escaped_paths_and_nulls() {
        let raw: Vec<u8> = (0..=255).cycle().take(4096).collect();
        let json = serde_json::json!({"solution":hex::encode(&raw[140..1484]),"a/b":{"~key":[hex::encode(&raw[2000..2400]),null]},"null":null,"upper":hex::encode_upper(&raw[0..256])});
        let block = FullBlock {
            height: 0,
            hash: vec![1; 32],
            prev_hash: vec![0; 32],
            time: 1,
            raw_block: raw,
            decoded_json: serde_json::to_string(&json).unwrap(),
        };
        let original = block.encode_to_vec();
        let encoded = encode(&original).unwrap();
        assert!(decode_canonical(&encoded, original.len()).is_some());
        assert!(encoded.len() < original.len());
        assert_eq!(decode(&encoded, original.len()).unwrap(), original);
        assert!(decode(&encoded, 32).is_err());
        let mut noncanonical = block;
        noncanonical.decoded_json = format!(" {} ", noncanonical.decoded_json);
        assert!(encode(&noncanonical.encode_to_vec()).is_none());
        let mut unknown = original;
        unknown.extend_from_slice(&[0xa0, 0x06, 0x01]);
        assert!(encode(&unknown).is_none());
    }
    #[test]
    fn malformed_metadata_never_decodes() {
        assert!(decode(b"ZREF1\xff\xff\xff\xff", 1024).is_err());
        assert!(decode(b"not a frame", 1024).is_err());
        let block = FullBlock {
            height: 0,
            hash: vec![1; 32],
            prev_hash: vec![0; 32],
            time: 1,
            raw_block: vec![0; 64],
            decoded_json: "{\"x\":null}".into(),
        };
        for patches in [
            vec![Patch {
                path: "/x".into(),
                offset: 65,
                length: 64,
            }],
            vec![
                Patch {
                    path: "/x".into(),
                    offset: 0,
                    length: 64,
                },
                Patch {
                    path: "/x".into(),
                    offset: 0,
                    length: 64,
                },
            ],
        ] {
            let meta = serde_json::to_vec(&patches).unwrap();
            let mut payload = MAGIC.to_vec();
            payload.extend_from_slice(&(meta.len() as u32).to_le_bytes());
            payload.extend_from_slice(&meta);
            payload.extend_from_slice(&block.encode_to_vec());
            assert!(decode(&payload, 1024).is_err());
        }
    }
}
