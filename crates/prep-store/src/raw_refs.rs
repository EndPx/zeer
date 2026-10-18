//! Lossless references from canonical decoded JSON hex strings into raw block bytes.
//! Optional encoding only: noncanonical/oversized inputs keep their original bytes.
use crate::{Error, Result};
use prep_proto::prep::FullBlock;
use prost::Message;
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
