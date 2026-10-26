//! Read-only incident acceptance over a pinned retained catalog prefix.
//!
//! Unchanged segments are authenticated as opaque encoded bytes against their
//! original manifests. Only replaced ranges are decoded and compared record by
//! record. This avoids a second full Archive admission while the writer runs.
use prep_store::{
    BlockRecord, Catalog, Manifest, RangeReader, SegmentReference, Store, FULL_KIND,
    MAX_FULL_BLOCK_BYTES, MAX_MANIFEST_BYTES, MAX_SEGMENT_BYTES,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    error::Error,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    time::Instant,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const MAX_CATALOG_BYTES: u64 = 16 * 1024 * 1024;
const MAX_SEGMENTS: usize = 30_000;

fn check(condition: bool, message: &'static str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn hash_text(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn directory(path: &Path) -> Result<()> {
    check(
        fs::symlink_metadata(path)?.file_type().is_dir(),
        "DIRECTORY_OR_SYMLINK_INVALID",
    )
}

fn regular(path: &Path) -> Result<File> {
    let expected = fs::symlink_metadata(path)?;
    check(expected.file_type().is_file(), "REGULAR_FILE_REQUIRED")?;
    let file = File::open(path)?;
    let observed = file.metadata()?;
    check(observed.is_file(), "REGULAR_FILE_REQUIRED")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        check(
            expected.dev() == observed.dev() && expected.ino() == observed.ino(),
            "FILE_IDENTITY_CHANGED_DURING_OPEN",
        )?;
    }
    Ok(file)
}

fn bounded_bytes(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let file = regular(path)?;
    check(file.metadata()?.len() <= limit, "FILE_SIZE_BOUND_EXCEEDED")?;
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    check(bytes.len() as u64 <= limit, "FILE_GREW_BEYOND_BOUND")?;
    Ok(bytes)
}

fn catalog(path: &Path) -> Result<(Catalog, u64, String)> {
    let bytes = bounded_bytes(path, MAX_CATALOG_BYTES)?;
    let identity = hash(&bytes);
    let value: Catalog = serde_json::from_slice(&bytes)?;
    check(value.schema_version == 1, "CATALOG_SCHEMA_INVALID")?;
    check(
        matches!(value.network.as_str(), "mainnet" | "testnet" | "regtest")
            && value.payload_kind == FULL_KIND,
        "CATALOG_NETWORK_OR_KIND_INVALID",
    )?;
    check(
        !value.segments.is_empty() && value.segments.len() <= MAX_SEGMENTS,
        "CATALOG_SEGMENT_BOUND_INVALID",
    )?;
    check(
        value.start_height <= u64::from(u32::MAX)
            && value.epoch <= value.revision
            && value.segments.len() as u64 <= value.revision,
        "CATALOG_COUNTER_OR_HEIGHT_INVALID",
    )?;
    let mut names = HashSet::new();
    let mut next = value.start_height;
    let mut parent: Option<&str> = None;
    for reference in &value.segments {
        check(
            reference.start_height == next
                && reference.end_height >= reference.start_height
                && reference.end_height <= u64::from(u32::MAX)
                && reference.end_height - reference.start_height < 100_000,
            "CATALOG_SEGMENT_RANGE_INVALID",
        )?;
        check(
            names.insert(reference.directory.as_str())
                && hash_text(&reference.dataset_id)
                && hash_text(&reference.manifest_sha256)
                && hash_text(&reference.predecessor_hash)
                && hash_text(&reference.end_hash),
            "CATALOG_REFERENCE_INVALID",
        )?;
        check(
            parent.is_none_or(|expected| expected == reference.predecessor_hash),
            "CATALOG_CHAIN_ANCHOR_MISMATCH",
        )?;
        parent = Some(&reference.end_hash);
        next = reference.end_height + 1;
    }
    // Independent reconstruction of the published catalog's versioned tuple.
    let logical = hash(&serde_json::to_vec(&(
        "zeer-prep-catalog-v1",
        value.schema_version,
        &value.network,
        &value.payload_kind,
        value.start_height,
        value.epoch,
        value.revision,
        &value.segments,
    ))?);
    check(logical == value.catalog_sha256, "CATALOG_CHECKSUM_MISMATCH")?;
    Ok((value, bytes.len() as u64, identity))
}

fn segment_path(root: &Path, reference: &SegmentReference) -> Result<PathBuf> {
    let name = reference
        .directory
        .strip_prefix("segments/")
        .ok_or("SEGMENT_PATH_INVALID")?;
    check(
        !name.is_empty()
            && name.len() <= 128
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
        "SEGMENT_PATH_INVALID",
    )?;
    let path = root.join("segments").join(name);
    directory(&path)?;
    Ok(path)
}

fn manifest(root: &Path, reference: &SegmentReference, network: &str) -> Result<(Manifest, u64)> {
    let path = segment_path(root, reference)?;
    let bytes = bounded_bytes(&path.join("manifest.json"), MAX_MANIFEST_BYTES)?;
    check(
        hash(&bytes) == reference.manifest_sha256,
        "PINNED_MANIFEST_BYTES_CHANGED",
    )?;
    let value: Manifest = serde_json::from_slice(&bytes)?;
    check(
        (1..=3).contains(&value.schema_version)
            && value.network == network
            && value.payload_kind == FULL_KIND
            && value.dataset_id == reference.dataset_id
            && value.start_height == reference.start_height
            && value.end_height == reference.end_height
            && value.predecessor_hash == reference.predecessor_hash
            && value.end_hash == reference.end_hash
            && value.block_count == reference.end_height - reference.start_height + 1
            && value.blocks.len() as u64 == value.block_count
            && value.segment_bytes <= MAX_SEGMENT_BYTES
            && hash_text(&value.segment_sha256),
        "MANIFEST_REFERENCE_MISMATCH",
    )?;
    let marker = match value.schema_version {
        3 => "zeer-prep-full-zstd-rawrefs-v3",
        2 => "zeer-prep-full-zstd-snapshot-v2",
        _ => "zeer-prep-full-snapshot-v1",
    };
    check(
        hash(&serde_json::to_vec(&(
            marker,
            &value.network,
            value.start_height,
            value.end_height,
            &value.predecessor_hash,
            &value.end_hash,
            &value.segment_sha256,
        ))?) == value.dataset_id,
        "MANIFEST_DATASET_ID_MISMATCH",
    )?;
    let mut offset = 0u64;
    let mut parent = value.predecessor_hash.as_str();
    for (index, block) in value.blocks.iter().enumerate() {
        check(
            block.height == value.start_height + index as u64
                && block.offset == offset
                && block.prev_hash == parent
                && hash_text(&block.hash)
                && hash_text(&block.payload_sha256)
                && u64::from(block.length) <= MAX_FULL_BLOCK_BYTES,
            "MANIFEST_BLOCK_INDEX_INVALID",
        )?;
        if let Some(length) = block.uncompressed_length {
            check(
                u64::from(length) <= MAX_FULL_BLOCK_BYTES,
                "MANIFEST_DECODED_LENGTH_INVALID",
            )?;
        }
        offset += 4 + u64::from(block.length);
        parent = &block.hash;
    }
    check(
        offset == value.segment_bytes && parent == value.end_hash,
        "MANIFEST_END_ANCHOR_OR_LENGTH_INVALID",
    )?;
    Ok((value, bytes.len() as u64))
}

fn encoded_hash(path: &Path, expected_bytes: u64, expected_hash: &str) -> Result<()> {
    let mut file = regular(path)?;
    check(
        file.metadata()?.len() == expected_bytes,
        "OLD_SEGMENT_ENCODED_LENGTH_CHANGED",
    )?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let used = file.read(&mut buffer)?;
        if used == 0 {
            break;
        }
        total += used as u64;
        check(total <= expected_bytes, "OLD_SEGMENT_GREW_WHILE_HASHING")?;
        digest.update(&buffer[..used]);
    }
    check(
        total == expected_bytes && hex::encode(digest.finalize()) == expected_hash,
        "OLD_SEGMENT_ENCODED_BYTES_CHANGED",
    )
}

struct OldRecords<'a> {
    root: &'a Path,
    catalog: &'a Catalog,
    store: Option<(usize, Store)>,
    reader: Option<RangeReader>,
    through: u64,
    next: Option<u64>,
}

impl OldRecords<'_> {
    fn read(&mut self, height: u64) -> Result<BlockRecord> {
        let index = self
            .catalog
            .segments
            .partition_point(|reference| reference.end_height < height);
        let reference = self
            .catalog
            .segments
            .get(index)
            .ok_or("OLD_RANGE_MISSING")?;
        if self.store.as_ref().is_none_or(|(old, _)| *old != index) {
            self.reader = None;
            self.store = None;
            self.store = Some((index, Store::open(segment_path(self.root, reference)?)?));
        }
        if self.reader.is_none() || self.next != Some(height) || height > self.through {
            self.through = reference.end_height.min(height + 999);
            self.reader = Some(
                self.store
                    .as_ref()
                    .unwrap()
                    .1
                    .read_range(height, self.through)?,
            );
        }
        let record = self
            .reader
            .as_mut()
            .unwrap()
            .next()
            .ok_or("OLD_RECORD_MISSING")??;
        check(record.height == height, "OLD_RECORD_ORDER_MISMATCH")?;
        self.next = Some(height + 1);
        Ok(record)
    }
}

#[derive(Debug, Serialize)]
struct Proof {
    status: &'static str,
    scope: &'static str,
    initial_catalog_file_sha256: String,
    initial_catalog_logical_sha256: String,
    captured_catalog_file_sha256: String,
    captured_catalog_logical_sha256: String,
    initial_segments: usize,
    captured_segments: usize,
    initial_epoch: u64,
    captured_epoch: u64,
    captured_revision: u64,
    old_total_blocks: u64,
    unchanged_blocks: u64,
    changed_blocks: u64,
    replacement_groups: u64,
    changed_logical_sha256: String,
    old_head: u64,
    old_head_hash: String,
    captured_head: u64,
    old_manifest_bytes_hashed: u64,
    old_encoded_segment_bytes_hashed: u64,
    replacement_manifest_bytes_hashed: u64,
    bytes_hashed: u64,
    bytes_hashed_scope: &'static str,
    elapsed_seconds: f64,
    process_lifetime_max_rss_kib: Option<u64>,
}

fn verify(root: &Path, initial_copy: &Path, expected_initial_hash: &str) -> Result<Proof> {
    let began = Instant::now();
    check(
        hash_text(expected_initial_hash),
        "INITIAL_CATALOG_PIN_INVALID",
    )?;
    directory(root)?;
    directory(&root.join("segments"))?;
    let (initial, initial_bytes, initial_hash) = catalog(initial_copy)?;
    check(
        initial_hash == expected_initial_hash,
        "INITIAL_CATALOG_PIN_MISMATCH",
    )?;
    // Capture a single independently checked revision. It may be superseded while
    // this verifier runs; immutable current/retired files remain valid inputs.
    let (current, current_bytes, current_hash) = catalog(&root.join("catalog.json"))?;
    let old_head = initial.head().ok_or("EMPTY_INITIAL_PREFIX")?;
    let current_head = current.head().ok_or("EMPTY_CURRENT_ARCHIVE")?;
    check(
        initial.network == current.network
            && initial.payload_kind == current.payload_kind
            && initial.start_height == current.start_height
            && current_head >= old_head
            && current.epoch >= initial.epoch
            && current.revision >= initial.revision,
        "ARCHIVE_IDENTITY_OR_PREFIX_COVERAGE_CHANGED",
    )?;
    let mut old_manifest_bytes = 0;
    let mut old_encoded_bytes = 0;
    for reference in &initial.segments {
        let (manifest, bytes) = manifest(root, reference, &initial.network)?;
        old_manifest_bytes += bytes;
        encoded_hash(
            &segment_path(root, reference)?.join("segment.bin"),
            manifest.segment_bytes,
            &manifest.segment_sha256,
        )?;
        old_encoded_bytes += manifest.segment_bytes;
    }
    let originals: HashMap<_, _> = initial
        .segments
        .iter()
        .map(|reference| (reference.directory.as_str(), reference))
        .collect();
    let mut old = OldRecords {
        root,
        catalog: &initial,
        store: None,
        reader: None,
        through: 0,
        next: None,
    };
    let mut unchanged_blocks = 0u64;
    let mut changed_blocks = 0u64;
    let mut groups = 0u64;
    let mut changed_digest = Sha256::new();
    let mut replacement_manifest_bytes = 0u64;
    for reference in current
        .segments
        .iter()
        .take_while(|r| r.start_height <= old_head)
    {
        if originals
            .get(reference.directory.as_str())
            .is_some_and(|old| **old == *reference)
        {
            unchanged_blocks += reference.end_height - reference.start_height + 1;
            continue;
        }
        let (_, bytes) = manifest(root, reference, &current.network)?;
        replacement_manifest_bytes += bytes;
        let replacement = Store::open(segment_path(root, reference)?)?;
        groups += 1;
        let end = reference.end_height.min(old_head);
        for start in (reference.start_height..=end).step_by(1000) {
            for record in replacement.read_range(start, end.min(start + 999))? {
                let record = record?;
                let original = old.read(record.height)?;
                check(record == original, "OLD_PREFIX_LOGICAL_RECORD_CHANGED")?;
                changed_digest.update(record.height.to_le_bytes());
                changed_digest.update((record.payload.len() as u64).to_le_bytes());
                changed_digest.update(&record.payload);
                changed_blocks += 1;
            }
        }
    }
    let total = old_head - initial.start_height + 1;
    check(
        unchanged_blocks + changed_blocks == total,
        "OLD_PREFIX_NOT_FULLY_COVERED",
    )?;
    let max_rss = fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|text| {
            text.lines()
                .find(|line| line.starts_with("VmHWM:"))?
                .split_whitespace()
                .nth(1)?
                .parse()
                .ok()
        });
    Ok(Proof {
        status: "PASS",
        scope: "Pinned old encoded segments authenticated; every replaced old-prefix record decoded and byte-compared. No consensus, source freshness or current-head guarantee.",
        initial_catalog_file_sha256: initial_hash,
        initial_catalog_logical_sha256: initial.catalog_sha256.clone(),
        captured_catalog_file_sha256: current_hash,
        captured_catalog_logical_sha256: current.catalog_sha256.clone(),
        initial_segments: initial.segments.len(),
        captured_segments: current.segments.len(),
        initial_epoch: initial.epoch,
        captured_epoch: current.epoch,
        captured_revision: current.revision,
        old_total_blocks: total,
        unchanged_blocks,
        changed_blocks,
        replacement_groups: groups,
        changed_logical_sha256: hex::encode(changed_digest.finalize()),
        old_head,
        old_head_hash: initial.head_hash().unwrap().to_owned(),
        captured_head: current_head,
        old_manifest_bytes_hashed: old_manifest_bytes,
        old_encoded_segment_bytes_hashed: old_encoded_bytes,
        replacement_manifest_bytes_hashed: replacement_manifest_bytes,
        bytes_hashed: initial_bytes
            + current_bytes
            + old_manifest_bytes
            + old_encoded_bytes
            + replacement_manifest_bytes,
        bytes_hashed_scope: "Input file digests only; logical tuple and decoded comparison digests excluded.",
        elapsed_seconds: began.elapsed().as_secs_f64(),
        process_lifetime_max_rss_kib: max_rss,
    })
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().collect();
    check(
        args.len() == 4,
        "Usage: verify_catalog_prefix ARCHIVE INITIAL_CATALOG_COPY EXPECTED_INITIAL_FILE_SHA256",
    )?;
    let pin = args[3].to_str().ok_or("INITIAL_CATALOG_PIN_INVALID")?;
    let proof = verify(Path::new(&args[1]), Path::new(&args[2]), pin)?;
    println!("{}", serde_json::to_string(&proof)?);
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use prep_store::{ArchiveWriter, StoreLimits, StoreWriter};
    use prost::Message;

    fn part(root: &Path, height: u64, label: &str) -> String {
        let directory = format!("segments/source-{height}");
        let hash = vec![height as u8 + 1; 32];
        let previous = vec![height as u8; 32];
        let mut writer = StoreWriter::create_full(
            root.join(&directory),
            "regtest",
            height,
            height,
            &hex::encode(&previous),
            &hex::encode(&hash),
        )
        .unwrap();
        writer
            .push(BlockRecord {
                height,
                hash: hash.clone(),
                prev_hash: previous.clone(),
                payload: prep_proto::prep::FullBlock {
                    height,
                    hash,
                    prev_hash: previous,
                    time: height,
                    raw_block: vec![1, 2, 3],
                    decoded_json: format!(r#"{{"label":"{label}"}}"#),
                }
                .encode_to_vec(),
            })
            .unwrap();
        writer.finish().unwrap();
        directory
    }

    fn limits() -> StoreLimits {
        StoreLimits {
            max_block_bytes: MAX_FULL_BLOCK_BYTES,
            max_segment_bytes: 1024 * 1024,
            max_manifest_bytes: 1024 * 1024,
            ..StoreLimits::default()
        }
    }

    #[test]
    fn verifies_replacement_and_unchanged_prefix_without_writes() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 0, FULL_KIND).unwrap();
        for height in 0..=4 {
            let name = part(&root, height, "old");
            writer.append_segment(&name).unwrap();
        }
        let initial = temp.path().join("initial.json");
        let bytes = fs::read(root.join("catalog.json")).unwrap();
        fs::write(&initial, &bytes).unwrap();
        writer
            .consolidate_segments(1, 3, "segments/merged", limits())
            .unwrap();
        let name = part(&root, 5, "new");
        writer.append_segment(&name).unwrap();
        let before = fs::read(root.join("catalog.json")).unwrap();
        let proof = verify(&root, &initial, &hash(&bytes)).unwrap();
        assert_eq!(
            (
                proof.old_total_blocks,
                proof.unchanged_blocks,
                proof.changed_blocks,
                proof.replacement_groups
            ),
            (5, 2, 3, 1)
        );
        assert_eq!(proof.captured_head, 5);
        assert_eq!(fs::read(root.join("catalog.json")).unwrap(), before);
        assert!(verify(&root, &initial, &"00".repeat(32)).is_err());
    }

    #[test]
    fn verifies_replacement_crossing_old_head_and_rejects_old_corruption() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 0, FULL_KIND).unwrap();
        for height in 0..=2 {
            let name = part(&root, height, "old");
            writer.append_segment(&name).unwrap();
        }
        let initial = temp.path().join("initial.json");
        let bytes = fs::read(root.join("catalog.json")).unwrap();
        fs::write(&initial, &bytes).unwrap();
        for height in 3..=4 {
            let name = part(&root, height, "new");
            writer.append_segment(&name).unwrap();
        }
        writer
            .consolidate_segments(1, 4, "segments/cross", limits())
            .unwrap();
        let proof = verify(&root, &initial, &hash(&bytes)).unwrap();
        assert_eq!(
            (
                proof.old_total_blocks,
                proof.unchanged_blocks,
                proof.changed_blocks
            ),
            (3, 1, 2)
        );
        let path = root.join("segments/source-0/segment.bin");
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let mut old = fs::read(&path).unwrap();
        old[4] ^= 1;
        fs::write(&path, old).unwrap();
        assert!(verify(&root, &initial, &hash(&bytes)).is_err());
    }
}
