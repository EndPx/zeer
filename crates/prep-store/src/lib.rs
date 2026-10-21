//! Bounded, immutable historical CompactBlock snapshots.
//!
//! Writers require Unix directory fsync and publish through a no-clobber hard
//! link only after segment and manifest contents have been synced. An unfinished
//! directory cannot be opened as a store and cannot silently be resumed. The
//! snapshot validates byte integrity and chain linkage, not Zcash consensus or
//! the honesty of an upstream source. Network/anchor provenance belongs to the
//! importer. Transport, wallet scanning, and key handling are outside this crate.

use prep_proto::zcash::CompactBlock;
use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use thiserror::Error;

// Timing expands to the original expression in ordinary builds.
#[cfg(feature = "admission-profile")]
macro_rules! profile_phase {
    ($name:expr, $body:expr) => {{
        let _phase = crate::profiling::Phase::new($name);
        $body
    }};
}
#[cfg(not(feature = "admission-profile"))]
macro_rules! profile_phase {
    ($name:expr, $body:expr) => {
        $body
    };
}
mod archive;
mod disk_index;
#[cfg(feature = "admission-profile")]
pub mod profiling;
mod raw_refs;
mod transaction_index;
pub use archive::{Archive, ArchiveRangeReader, ArchiveWriter, Catalog, SegmentReference};
pub use disk_index::MAX_DISK_INDEX_BYTES;
pub use transaction_index::TransactionMetadata;
use transaction_index::{IndexBuilder, TransactionIndex, SEGMENT_INDEX_BYTES};

pub const MAX_BLOCK_BYTES: u64 = 4 * 1024 * 1024;
pub const MAX_FULL_BLOCK_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_SEGMENT_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_BLOCKS: u64 = 100_000;
pub const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;
const SEGMENT_NAME: &str = "segment.bin";
const MANIFEST_NAME: &str = "manifest.json";
const PENDING_NAME: &str = "manifest.pending";
pub const COMPACT_KIND: &str = "compact-v1";
pub const FULL_KIND: &str = "full-v1";

fn default_payload_kind() -> String {
    COMPACT_KIND.to_owned()
}

fn is_compact_kind(kind: &str) -> bool {
    kind == COMPACT_KIND
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn check_payload_kind(kind: &str) -> Result<()> {
    if !matches!(kind, COMPACT_KIND | FULL_KIND) {
        return Err(Error::Invalid("unsupported payload kind"));
    }
    Ok(())
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("store I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid JSON manifest: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid compact-block protobuf: {0}")]
    Protobuf(#[from] prost::DecodeError),
    #[error("invalid snapshot: {0}")]
    Invalid(&'static str),
    #[error("snapshot bound exceeded: {0}")]
    Limit(&'static str),
    #[error("writer was aborted after an earlier failure")]
    Poisoned,
    #[error("durable snapshot creation currently requires Unix")]
    UnsupportedWritePlatform,
}

/// Wire payload is bounded independently of the number of records. These are
/// application limits, not a claim that decoded protobuf RSS equals wire size.
#[derive(Clone, Copy, Debug)]
pub struct StoreLimits {
    pub max_block_bytes: u64,
    pub max_segment_bytes: u64,
    pub max_blocks: u64,
    pub max_manifest_bytes: u64,
    pub max_range_blocks: u64,
}

impl Default for StoreLimits {
    fn default() -> Self {
        Self {
            max_block_bytes: MAX_BLOCK_BYTES,
            max_segment_bytes: MAX_SEGMENT_BYTES,
            max_blocks: MAX_BLOCKS,
            max_manifest_bytes: MAX_MANIFEST_BYTES,
            max_range_blocks: 10_000,
        }
    }
}

impl StoreLimits {
    fn validate(self) -> Result<Self> {
        for (value, ceiling) in [
            (self.max_block_bytes, MAX_FULL_BLOCK_BYTES),
            (self.max_segment_bytes, MAX_SEGMENT_BYTES),
            (self.max_blocks, MAX_BLOCKS),
            (self.max_manifest_bytes, MAX_MANIFEST_BYTES),
            (self.max_range_blocks, MAX_BLOCKS),
        ] {
            if value == 0 || value > ceiling {
                return Err(Error::Invalid(
                    "configured limits must be positive and within hard ceilings",
                ));
            }
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockRecord {
    pub height: u64,
    /// Raw protocol byte order, as encoded by CompactBlock.hash.
    pub hash: Vec<u8>,
    /// Raw protocol byte order, as encoded by CompactBlock.prev_hash.
    pub prev_hash: Vec<u8>,
    pub payload: Vec<u8>,
}

/// Header metadata validated against the immutable encoded payload on admission.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockHeader {
    pub height: u64,
    pub hash: Vec<u8>,
    pub prev_hash: Vec<u8>,
    pub time: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BlockIndex {
    pub height: u64,
    /// Byte offset of the four-byte little-endian payload-length prefix.
    pub offset: u64,
    pub length: u32,
    pub payload_sha256: String,
    /// Conventional RPC display order, reversed from protocol bytes.
    pub hash: String,
    pub prev_hash: String,
    /// Present on newly written full-v1 segments. Legacy and compact metadata
    /// omit it so their manifest serialization remains unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time: Option<u64>,
    /// Present only for a zstd-compressed record in a version-2/3 full snapshot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uncompressed_length: Option<u32>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub raw_refs: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u32,
    #[serde(
        default = "default_payload_kind",
        skip_serializing_if = "is_compact_kind"
    )]
    pub payload_kind: String,
    pub dataset_id: String,
    pub network: String,
    pub start_height: u64,
    pub end_height: u64,
    pub predecessor_hash: String,
    pub end_hash: String,
    pub block_count: u64,
    pub segment_bytes: u64,
    pub segment_sha256: String,
    pub blocks: Vec<BlockIndex>,
}

/// Derive identity from the network, frozen bounds/anchors and exact segment.
/// The serialized tuple is a versioned JSON array, not map-order-dependent JSON.
pub fn dataset_id(manifest: &Manifest) -> Result<String> {
    check_payload_kind(&manifest.payload_kind)?;
    let marker = if manifest.schema_version == 3 {
        "zeer-prep-full-zstd-rawrefs-v3"
    } else if manifest.schema_version == 2 {
        "zeer-prep-full-zstd-snapshot-v2"
    } else if manifest.payload_kind == FULL_KIND {
        "zeer-prep-full-snapshot-v1"
    } else {
        "zeer-prep-snapshot-v1"
    };
    let bytes = serde_json::to_vec(&(
        marker,
        &manifest.network,
        manifest.start_height,
        manifest.end_height,
        &manifest.predecessor_hash,
        &manifest.end_hash,
        &manifest.segment_sha256,
    ))?;
    Ok(sha256(&bytes))
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn parse_hex_hash(value: &str) -> Result<Vec<u8>> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(Error::Invalid("hash must be 64 lowercase hex characters"));
    }
    let mut bytes = hex::decode(value).map_err(|_| Error::Invalid("invalid hash encoding"))?;
    bytes.reverse();
    Ok(bytes)
}

fn display_hash(protocol: &[u8]) -> Result<String> {
    if protocol.len() != 32 {
        return Err(Error::Invalid("protocol hash must contain 32 bytes"));
    }
    let bytes: Vec<u8> = protocol.iter().rev().copied().collect();
    Ok(hex::encode(bytes))
}

fn count(start: u64, end: u64, limit: u64) -> Result<u64> {
    if start > u64::from(u32::MAX) || end > u64::from(u32::MAX) {
        return Err(Error::Invalid("height exceeds Zcash u32 range"));
    }
    let count = end
        .checked_sub(start)
        .and_then(|v| v.checked_add(1))
        .ok_or(Error::Invalid("invalid inclusive height range"))?;
    if count > limit {
        return Err(Error::Limit("block count"));
    }
    Ok(count)
}

fn check_network(network: &str) -> Result<()> {
    if !matches!(network, "mainnet" | "testnet" | "regtest") {
        return Err(Error::Invalid(
            "network must be mainnet, testnet or regtest",
        ));
    }
    Ok(())
}

fn check_record(record: &BlockRecord, max_bytes: u64, kind: &str) -> Result<Option<u64>> {
    let max_bytes = max_bytes.min(if kind == FULL_KIND {
        MAX_FULL_BLOCK_BYTES
    } else {
        MAX_BLOCK_BYTES
    });
    if record.payload.is_empty() || record.payload.len() as u64 > max_bytes {
        return Err(Error::Limit("block payload bytes"));
    }
    if record.hash.len() != 32 || record.prev_hash.len() != 32 {
        return Err(Error::Invalid("record hashes must contain 32 bytes"));
    }
    if record.height == 0 && record.prev_hash.iter().any(|byte| *byte != 0) {
        return Err(Error::Invalid("genesis predecessor must be zero"));
    }
    let indexed_time = match kind {
        COMPACT_KIND => {
            let block = CompactBlock::decode(record.payload.as_slice())?;
            if block.height != record.height
                || block.hash != record.hash
                || block.prev_hash != record.prev_hash
            {
                return Err(Error::Invalid(
                    "record metadata differs from decoded payload",
                ));
            }
            None
        }
        FULL_KIND => {
            let block = prep_proto::prep::FullBlock::decode(record.payload.as_slice())?;
            if block.height != record.height
                || block.hash != record.hash
                || block.prev_hash != record.prev_hash
            {
                return Err(Error::Invalid(
                    "full record metadata differs from decoded payload",
                ));
            }
            if block.raw_block.is_empty() || block.decoded_json.is_empty() {
                return Err(Error::Invalid(
                    "full record requires raw block and decoded JSON",
                ));
            }
            if !block.decoded_json.trim_start().starts_with('{') {
                return Err(Error::Invalid("full decoded JSON must be an object"));
            }
            // Validate JSON without allocating a second complete JSON value tree.
            let _: serde::de::IgnoredAny = serde_json::from_str(&block.decoded_json)?;
            if block.time > u64::from(u32::MAX) {
                return Err(Error::Invalid(
                    "full block time exceeds serialized header u32 range",
                ));
            }
            Some(block.time)
        }
        _ => return Err(Error::Invalid("unsupported payload kind")),
    };
    Ok(indexed_time)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<()> {
    Err(Error::UnsupportedWritePlatform)
}

fn regular_file(path: &Path) -> Result<File> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(Error::Invalid(
            "snapshot file must be a regular file, not a symlink",
        ));
    }
    let file = File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(Error::Invalid("snapshot file changed type"));
    }
    Ok(file)
}

/// Owns a newly created directory and a single append-only segment.
/// Parent directory must already exist. Existing output directories are rejected
/// even if empty or left by an interrupted run; no implicit resume/overwrite.
pub struct StoreWriter {
    path: PathBuf,
    segment: File,
    manifest: Manifest,
    limits: StoreLimits,
    next_parent: Vec<u8>,
    digest: Sha256,
    poisoned: bool,
    compress: bool,
}

impl StoreWriter {
    pub fn create(
        path: impl AsRef<Path>,
        network: &str,
        start: u64,
        end: u64,
        predecessor_hex: &str,
        end_hash_hex: &str,
    ) -> Result<Self> {
        Self::create_with_limits(
            path,
            network,
            start,
            end,
            predecessor_hex,
            end_hash_hex,
            StoreLimits::default(),
        )
    }

    pub fn create_with_limits(
        path: impl AsRef<Path>,
        network: &str,
        start: u64,
        end: u64,
        predecessor_hex: &str,
        end_hash_hex: &str,
        limits: StoreLimits,
    ) -> Result<Self> {
        Self::create_for_kind(
            path,
            network,
            start,
            end,
            predecessor_hex,
            end_hash_hex,
            limits,
            COMPACT_KIND,
        )
    }

    pub fn create_full(
        path: impl AsRef<Path>,
        network: &str,
        start: u64,
        end: u64,
        predecessor_hex: &str,
        end_hash_hex: &str,
    ) -> Result<Self> {
        Self::create_full_with_limits(
            path,
            network,
            start,
            end,
            predecessor_hex,
            end_hash_hex,
            StoreLimits {
                max_block_bytes: MAX_FULL_BLOCK_BYTES,
                ..StoreLimits::default()
            },
        )
    }

    pub fn create_full_with_limits(
        path: impl AsRef<Path>,
        network: &str,
        start: u64,
        end: u64,
        predecessor_hex: &str,
        end_hash_hex: &str,
        limits: StoreLimits,
    ) -> Result<Self> {
        Self::create_for_kind(
            path,
            network,
            start,
            end,
            predecessor_hex,
            end_hash_hex,
            limits,
            FULL_KIND,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn create_for_kind(
        path: impl AsRef<Path>,
        network: &str,
        start: u64,
        end: u64,
        predecessor_hex: &str,
        end_hash_hex: &str,
        limits: StoreLimits,
        kind: &str,
    ) -> Result<Self> {
        if !cfg!(unix) {
            return Err(Error::UnsupportedWritePlatform);
        }
        let limits = limits.validate()?;
        check_network(network)?;
        let block_count = count(start, end, limits.max_blocks)?;
        let next_parent = parse_hex_hash(predecessor_hex)?;
        parse_hex_hash(end_hash_hex)?;
        let path = path.as_ref().to_path_buf();
        fs::create_dir(&path)?; // Exclusive creation establishes writer ownership.
        sync_directory(
            path.parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )?;
        let segment = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path.join(SEGMENT_NAME))?;
        Ok(Self {
            path,
            segment,
            limits,
            next_parent,
            digest: Sha256::new(),
            poisoned: false,
            compress: false,
            manifest: Manifest {
                schema_version: 1,
                payload_kind: kind.to_owned(),
                dataset_id: String::new(),
                network: network.to_owned(),
                start_height: start,
                end_height: end,
                predecessor_hash: predecessor_hex.to_owned(),
                end_hash: end_hash_hex.to_owned(),
                block_count,
                segment_bytes: 0,
                segment_sha256: String::new(),
                blocks: Vec::new(),
            },
        })
    }

    pub fn push(&mut self, record: BlockRecord) -> Result<()> {
        if self.poisoned {
            return Err(Error::Poisoned);
        }
        let result = self.push_checked(record);
        if result.is_err() {
            self.poisoned = true;
        }
        result
    }

    /// Opt-in storage encoding; decoded records and public API values are unchanged.
    pub fn with_compression(mut self) -> Result<Self> {
        if self.manifest.payload_kind != FULL_KIND || !self.manifest.blocks.is_empty() {
            return Err(Error::Invalid("compression requires a new full snapshot"));
        }
        self.compress = true;
        self.manifest.schema_version = 3;
        Ok(self)
    }

    fn push_checked(&mut self, record: BlockRecord) -> Result<()> {
        let indexed_time = check_record(
            &record,
            self.limits.max_block_bytes,
            &self.manifest.payload_kind,
        )?;
        let index = self.manifest.blocks.len() as u64;
        if index >= self.manifest.block_count {
            return Err(Error::Invalid("more records than frozen range"));
        }
        let expected_height = self
            .manifest
            .start_height
            .checked_add(index)
            .ok_or(Error::Invalid("height overflow"))?;
        if record.height != expected_height {
            return Err(Error::Invalid("noncontiguous block height"));
        }
        if record.prev_hash != self.next_parent {
            return Err(Error::Invalid("block parent mismatch"));
        }
        let referenced = if self.compress {
            raw_refs::encode(&record.payload)
        } else {
            None
        };
        let compressed = if self.compress {
            let bytes = zstd::bulk::compress(referenced.as_deref().unwrap_or(&record.payload), 3)?;
            (bytes.len() < record.payload.len()).then_some(bytes)
        } else {
            None
        };
        let stored = compressed.as_deref().unwrap_or(&record.payload);
        let length = u32::try_from(stored.len()).map_err(|_| Error::Limit("block length"))?;
        let next_offset = self
            .manifest
            .segment_bytes
            .checked_add(4 + u64::from(length))
            .ok_or(Error::Limit("segment offset overflow"))?;
        if next_offset > self.limits.max_segment_bytes {
            return Err(Error::Limit("total segment bytes"));
        }
        let prefix = length.to_le_bytes();
        self.segment.write_all(&prefix)?;
        self.segment.write_all(stored)?;
        self.digest.update(prefix);
        self.digest.update(stored);
        self.manifest.blocks.push(BlockIndex {
            raw_refs: referenced.is_some() && compressed.is_some(),
            uncompressed_length: compressed.as_ref().map(|_| record.payload.len() as u32),
            height: record.height,
            offset: self.manifest.segment_bytes,
            length,
            payload_sha256: sha256(&record.payload),
            hash: display_hash(&record.hash)?,
            prev_hash: display_hash(&record.prev_hash)?,
            time: indexed_time,
        });
        self.next_parent = record.hash;
        self.manifest.segment_bytes = next_offset;
        Ok(())
    }

    /// Sync contents before atomically publishing the manifest without clobber.
    pub fn finish(mut self) -> Result<Manifest> {
        if self.poisoned {
            return Err(Error::Poisoned);
        }
        if self.manifest.blocks.len() as u64 != self.manifest.block_count {
            return Err(Error::Invalid("incomplete frozen range"));
        }
        if display_hash(&self.next_parent)? != self.manifest.end_hash {
            return Err(Error::Invalid("frozen end hash mismatch"));
        }
        self.manifest.segment_sha256 = hex::encode(self.digest.finalize());
        self.manifest.dataset_id = dataset_id(&self.manifest)?;
        let encoded = serde_json::to_vec_pretty(&self.manifest)?;
        if encoded.len() as u64 > self.limits.max_manifest_bytes {
            return Err(Error::Limit("manifest bytes"));
        }
        self.segment.sync_all()?;
        let mut segment_permissions = self.segment.metadata()?.permissions();
        segment_permissions.set_readonly(true);
        self.segment.set_permissions(segment_permissions)?;
        self.segment.sync_all()?;
        let pending = self.path.join(PENDING_NAME);
        let published = self.path.join(MANIFEST_NAME);
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&pending)?;
        file.write_all(&encoded)?;
        let mut manifest_permissions = file.metadata()?.permissions();
        manifest_permissions.set_readonly(true);
        file.set_permissions(manifest_permissions)?;
        file.sync_all()?;
        // Hard-link creation is atomic and fails if published already exists.
        // rename() alone can overwrite a target on Unix, so it is not used.
        fs::hard_link(&pending, &published)?;
        sync_directory(&self.path)?;
        fs::remove_file(&pending)?;
        sync_directory(&self.path)?;
        Ok(self.manifest)
    }
}

#[derive(Clone)]
pub struct Store {
    path: PathBuf,
    manifest: Arc<Manifest>,
    limits: StoreLimits,
    transaction_index: Option<Arc<TransactionIndex>>,
    disk_index: Option<Arc<disk_index::DiskIndex>>,
    packed: Option<Arc<Vec<PackedIndex>>>,
}

/// Archives keep binary hashes instead of three heap-allocated hex strings per block.
#[derive(Clone)]
struct PackedIndex {
    raw_refs: bool,
    offset: u64,
    length: u32,
    uncompressed_length: Option<u32>,
    hash: [u8; 32],
    prev_hash: [u8; 32],
    payload_hash: [u8; 32],
    time: Option<u64>,
}

impl PackedIndex {
    fn from_entry(entry: &BlockIndex) -> Result<Self> {
        let bytes = |text: &str| -> Result<[u8; 32]> {
            parse_hex_hash(text)?
                .try_into()
                .map_err(|_| Error::Invalid("index hash length"))
        };
        Ok(Self {
            raw_refs: entry.raw_refs,
            offset: entry.offset,
            length: entry.length,
            uncompressed_length: entry.uncompressed_length,
            hash: bytes(&entry.hash)?,
            prev_hash: bytes(&entry.prev_hash)?,
            payload_hash: bytes(&entry.payload_sha256)?,
            time: entry.time,
        })
    }
    fn entry(&self, height: u64) -> Result<BlockIndex> {
        Ok(BlockIndex {
            raw_refs: self.raw_refs,
            height,
            offset: self.offset,
            length: self.length,
            uncompressed_length: self.uncompressed_length,
            hash: display_hash(&self.hash)?,
            prev_hash: display_hash(&self.prev_hash)?,
            payload_sha256: display_hash(&self.payload_hash)?,
            time: self.time,
        })
    }
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_internal(path, StoreLimits::default(), true, SEGMENT_INDEX_BYTES)
    }

    pub fn open_with_limits(path: impl AsRef<Path>, limits: StoreLimits) -> Result<Self> {
        Self::open_internal(path, limits, false, SEGMENT_INDEX_BYTES)
    }

    pub(crate) fn open_with_index_budget(path: impl AsRef<Path>, budget: usize) -> Result<Self> {
        Self::open_internal(
            path,
            StoreLimits::default(),
            true,
            budget.min(SEGMENT_INDEX_BYTES),
        )
    }

    fn open_internal(
        path: impl AsRef<Path>,
        limits: StoreLimits,
        auto_kind: bool,
        index_budget: usize,
    ) -> Result<Self> {
        #[cfg(feature = "admission-profile")]
        let manifest_phase = profiling::Phase::new("store_manifest");
        let mut limits = limits.validate()?;
        let path = path.as_ref().to_path_buf();
        if !fs::symlink_metadata(&path)?.file_type().is_dir() {
            return Err(Error::Invalid(
                "snapshot path must be a directory, not a symlink",
            ));
        }
        let mut manifest_file = regular_file(&path.join(MANIFEST_NAME))?;
        if manifest_file.metadata()?.len() > limits.max_manifest_bytes {
            return Err(Error::Limit("manifest bytes"));
        }
        let mut json = Vec::new();
        (&mut manifest_file)
            .take(limits.max_manifest_bytes + 1)
            .read_to_end(&mut json)?;
        if json.len() as u64 > limits.max_manifest_bytes {
            return Err(Error::Limit("manifest grew while reading"));
        }
        let manifest: Manifest = serde_json::from_slice(&json)?;
        if auto_kind && manifest.payload_kind == FULL_KIND {
            limits.max_block_bytes = MAX_FULL_BLOCK_BYTES;
        }
        validate_manifest_structure(&manifest, limits)?;
        #[cfg(feature = "admission-profile")]
        drop(manifest_phase);
        let mut segment = regular_file(&path.join(SEGMENT_NAME))?;
        if segment.metadata()?.len() != manifest.segment_bytes {
            return Err(Error::Invalid("segment length differs from manifest"));
        }
        profile_phase!("segment_hash", {
            let mut digest = Sha256::new();
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let n = segment.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                digest.update(&buffer[..n]);
            }
            if hex::encode(digest.finalize()) != manifest.segment_sha256 {
                return Err(Error::Invalid("segment checksum mismatch"));
            }
        });
        let mut disk_index = (manifest.payload_kind == FULL_KIND)
            .then(|| {
                disk_index::DiskIndex::candidate(
                    &path,
                    &json,
                    manifest.start_height,
                    manifest.blocks.len(),
                    index_budget,
                )
            })
            .flatten();
        let disk_candidate = disk_index.is_some();
        let mut transaction_builder = (manifest.payload_kind == FULL_KIND && !disk_candidate)
            .then(|| IndexBuilder::new(manifest.start_height, manifest.blocks.len(), index_budget))
            .flatten();
        for index in &manifest.blocks {
            let record = read_record(
                &mut segment,
                index,
                limits.max_block_bytes,
                &manifest.payload_kind,
            )?;
            if let Some(index) = disk_index.as_mut() {
                let full = profile_phase!(
                    "optional_protobuf_decode",
                    prep_proto::prep::FullBlock::decode(record.payload.as_slice())
                )?;
                if profile_phase!(
                    "optional_disk_verify",
                    index.admit_block(record.height, &full.decoded_json)
                )
                .is_none()
                {
                    disk_index = None;
                }
            }
            if let Some(builder) = transaction_builder.as_mut() {
                let full = profile_phase!(
                    "optional_protobuf_decode",
                    prep_proto::prep::FullBlock::decode(record.payload.as_slice())
                )?;
                if profile_phase!(
                    "optional_metadata_build",
                    builder.block(record.height, &full.decoded_json)
                )
                .is_none()
                {
                    transaction_builder = None;
                }
            }
        }
        // Detect appended/truncated data during validation; block hashes and
        // payload hashes are checked again on every later range read.
        if segment.metadata()?.len() != manifest.segment_bytes {
            return Err(Error::Invalid("segment changed while opening"));
        }
        Ok(Self {
            path,
            manifest: Arc::new(manifest.clone()),
            limits,
            packed: None,
            disk_index: disk_index
                .and_then(|index| index.finish(manifest.blocks.len()))
                .map(Arc::new),
            transaction_index: transaction_builder
                .and_then(|builder| profile_phase!("optional_index_finish", builder.finish()))
                .map(Arc::new),
        })
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    pub(crate) fn compact_manifest(mut self) -> Result<Self> {
        if self.packed.is_none() {
            let packed = self
                .manifest
                .blocks
                .iter()
                .map(PackedIndex::from_entry)
                .collect::<Result<Vec<_>>>()?;
            let mut summary = (*self.manifest).clone();
            summary.blocks = Vec::new();
            self.manifest = Arc::new(summary);
            self.packed = Some(Arc::new(packed));
        }
        Ok(self)
    }

    pub fn transaction_index_bytes(&self) -> usize {
        self.transaction_index
            .as_ref()
            .map_or(0, |index| index.bytes())
            + self.disk_index.as_ref().map_or(0, |index| index.bytes())
    }

    pub fn transaction_metadata(&self, height: u64) -> Result<Option<Vec<TransactionMetadata>>> {
        self.block_index(height)?;
        if let Some(index) = &self.disk_index {
            return Ok(index.block(height));
        }
        Ok(self
            .transaction_index
            .as_ref()
            .map(|index| index.block(height)))
    }

    pub fn transaction_locations(
        &self,
        txids: &[[u8; 32]],
        start: u64,
        end: u64,
    ) -> Result<Option<Vec<u64>>> {
        count(start, end, 1000)?;
        if txids.len() > 128 {
            return Err(Error::Limit("transaction lookup ID count"));
        }
        self.block_index(start)?;
        self.block_index(end)?;
        // Disk lookup belongs in the caller's per-block metadata loop, where
        // cancellation/deadline controls run between bounded block reads.
        if self.disk_index.is_some() {
            return Ok(None);
        }
        Ok(self
            .transaction_index
            .as_ref()
            .map(|index| index.locations(txids, start, end)))
    }

    pub fn read_range(&self, start: u64, end: u64) -> Result<RangeReader> {
        count(start, end, self.limits.max_range_blocks)?;
        if start < self.manifest.start_height || end > self.manifest.end_height {
            return Err(Error::Invalid("requested range is outside snapshot"));
        }
        let next = usize::try_from(start - self.manifest.start_height)
            .map_err(|_| Error::Limit("range index"))?;
        let end_index = usize::try_from(end - self.manifest.start_height)
            .map_err(|_| Error::Limit("range index"))?;
        let file = regular_file(&self.path.join(SEGMENT_NAME))?;
        if file.metadata()?.len() != self.manifest.segment_bytes {
            return Err(Error::Invalid("segment length changed after open"));
        }
        Ok(RangeReader {
            file,
            manifest: self.manifest.clone(),
            packed: self.packed.clone(),
            next,
            end_index,
            max_block_bytes: self.limits.max_block_bytes,
            done: false,
        })
    }

    pub fn read_block(&self, height: u64) -> Result<BlockRecord> {
        self.read_range(height, height)?
            .next()
            .ok_or(Error::Invalid("missing block"))?
    }

    fn block_index(&self, height: u64) -> Result<BlockIndex> {
        if height < self.manifest.start_height || height > self.manifest.end_height {
            return Err(Error::Invalid("requested height is outside snapshot"));
        }
        if let Some(packed) = &self.packed {
            return packed
                .get((height - self.manifest.start_height) as usize)
                .ok_or(Error::Invalid("missing packed index"))?
                .entry(height);
        }
        self.manifest
            .blocks
            .get((height - self.manifest.start_height) as usize)
            .cloned()
            .ok_or(Error::Invalid("missing block index"))
    }

    /// Uses the verified immutable index without reading the encoded payload.
    pub fn block_hash(&self, height: u64) -> Result<String> {
        Ok(self.block_index(height)?.hash.clone())
    }

    /// Newly indexed full-v1 headers avoid disk reads and payload decoding.
    /// Old full/compact segments without indexed time use the checked slow path.
    pub fn read_header(&self, height: u64) -> Result<BlockHeader> {
        let entry = self.block_index(height)?;
        let time = if let Some(time) = entry.time {
            time
        } else {
            let record = self.read_block(height)?;
            if self.manifest.payload_kind == FULL_KIND {
                prep_proto::prep::FullBlock::decode(record.payload.as_slice())?.time
            } else {
                u64::from(CompactBlock::decode(record.payload.as_slice())?.time)
            }
        };
        Ok(BlockHeader {
            height,
            hash: parse_hex_hash(&entry.hash)?,
            prev_hash: parse_hex_hash(&entry.prev_hash)?,
            time,
        })
    }
}

fn validate_manifest_structure(manifest: &Manifest, limits: StoreLimits) -> Result<()> {
    if !matches!(manifest.schema_version, 1..=3)
        || (manifest.schema_version >= 2 && manifest.payload_kind != FULL_KIND)
    {
        return Err(Error::Invalid("unsupported manifest version"));
    }
    check_network(&manifest.network)?;
    check_payload_kind(&manifest.payload_kind)?;
    let expected_count = count(
        manifest.start_height,
        manifest.end_height,
        limits.max_blocks,
    )?;
    if manifest.block_count != expected_count || manifest.blocks.len() as u64 != expected_count {
        return Err(Error::Invalid("manifest count or range mismatch"));
    }
    if manifest.segment_bytes == 0 || manifest.segment_bytes > limits.max_segment_bytes {
        return Err(Error::Limit("total segment bytes"));
    }
    parse_hex_hash(&manifest.predecessor_hash)?;
    parse_hex_hash(&manifest.end_hash)?;
    parse_hex_hash(&manifest.segment_sha256)?;
    if manifest.dataset_id != dataset_id(manifest)? {
        return Err(Error::Invalid("dataset identity mismatch"));
    }
    let mut offset = 0_u64;
    let mut parent = manifest.predecessor_hash.as_str();
    for (position, entry) in manifest.blocks.iter().enumerate() {
        if entry.height != manifest.start_height + position as u64 || entry.offset != offset {
            return Err(Error::Invalid("noncontiguous manifest height or offset"));
        }
        let kind_ceiling = if manifest.payload_kind == FULL_KIND {
            MAX_FULL_BLOCK_BYTES
        } else {
            MAX_BLOCK_BYTES
        };
        if entry.length == 0 || u64::from(entry.length) > limits.max_block_bytes.min(kind_ceiling) {
            return Err(Error::Limit("manifest block length"));
        }
        if let Some(length) = entry.uncompressed_length {
            if manifest.schema_version < 2
                || length == 0
                || u64::from(length) > limits.max_block_bytes.min(kind_ceiling)
            {
                return Err(Error::Limit("invalid uncompressed record length"));
            }
        }
        if entry.raw_refs && (manifest.schema_version != 3 || entry.uncompressed_length.is_none()) {
            return Err(Error::Invalid("invalid raw reference encoding"));
        }
        parse_hex_hash(&entry.hash)?;
        parse_hex_hash(&entry.prev_hash)?;
        parse_hex_hash(&entry.payload_sha256)?;
        if entry.time.is_some_and(|time| time > u64::from(u32::MAX))
            || (entry.time.is_some() && manifest.payload_kind != FULL_KIND)
        {
            return Err(Error::Invalid("invalid indexed header time"));
        }
        if entry.prev_hash != parent {
            return Err(Error::Invalid("manifest parent mismatch"));
        }
        parent = &entry.hash;
        offset = offset
            .checked_add(4 + u64::from(entry.length))
            .ok_or(Error::Limit("manifest segment offset overflow"))?;
    }
    if offset != manifest.segment_bytes || parent != manifest.end_hash {
        return Err(Error::Invalid("manifest size or end anchor mismatch"));
    }
    Ok(())
}

fn read_record(
    file: &mut File,
    entry: &BlockIndex,
    max_bytes: u64,
    kind: &str,
) -> Result<BlockRecord> {
    #[cfg(feature = "admission-profile")]
    let io_phase = profiling::Phase::new("record_io");
    file.seek(SeekFrom::Start(entry.offset))?;
    let mut prefix = [0_u8; 4];
    file.read_exact(&mut prefix)?;
    let length = u32::from_le_bytes(prefix);
    if length != entry.length || u64::from(length) > max_bytes {
        return Err(Error::Invalid("segment record length mismatch"));
    }
    let mut payload = vec![0_u8; length as usize];
    file.read_exact(&mut payload)?;
    #[cfg(feature = "admission-profile")]
    drop(io_phase);
    if let Some(length) = entry.uncompressed_length {
        if length == 0 || u64::from(length) > max_bytes {
            return Err(Error::Limit("uncompressed record length"));
        }
        payload = profile_phase!(
            "decompression",
            zstd::bulk::decompress(&payload, length as usize)
        )?;
        if entry.raw_refs {
            payload = profile_phase!(
                "raw_reference_expansion",
                raw_refs::decode(&payload, length as usize)
            )?;
        }
        if payload.len() != length as usize {
            return Err(Error::Invalid("decompressed record length mismatch"));
        }
    }
    if profile_phase!("payload_hash", sha256(&payload)) != entry.payload_sha256 {
        return Err(Error::Invalid("block payload checksum mismatch"));
    }
    let record = BlockRecord {
        height: entry.height,
        hash: parse_hex_hash(&entry.hash)?,
        prev_hash: parse_hex_hash(&entry.prev_hash)?,
        payload,
    };
    let decoded_time = profile_phase!("integrity_decode", check_record(&record, max_bytes, kind))?;
    if entry.time.is_some() && entry.time != decoded_time {
        return Err(Error::Invalid(
            "indexed header time differs from decoded payload",
        ));
    }
    Ok(record)
}

/// One request owns one independently opened file descriptor; concurrent range
/// readers never share a seek offset. At most one payload is returned per next().
pub struct RangeReader {
    file: File,
    manifest: Arc<Manifest>,
    packed: Option<Arc<Vec<PackedIndex>>>,
    next: usize,
    end_index: usize,
    max_block_bytes: u64,
    done: bool,
}

impl Iterator for RangeReader {
    type Item = Result<BlockRecord>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done || self.next > self.end_index {
            return None;
        }
        let entry = if let Some(packed) = &self.packed {
            packed[self.next].entry(self.manifest.start_height + self.next as u64)
        } else {
            Ok(self.manifest.blocks[self.next].clone())
        };
        let record = entry.and_then(|entry| {
            read_record(
                &mut self.file,
                &entry,
                self.max_block_bytes,
                &self.manifest.payload_kind,
            )
        });
        self.next += 1;
        if record.is_err() {
            self.done = true;
        }
        Some(record)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        if self.done || self.next > self.end_index {
            (0, Some(0))
        } else {
            (0, Some(self.end_index - self.next + 1))
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    fn hash(height: u64) -> Vec<u8> {
        let mut bytes = vec![0_u8; 32];
        bytes[..8].copy_from_slice(&height.to_le_bytes());
        bytes
    }

    fn record(height: u64) -> BlockRecord {
        let block = CompactBlock {
            height,
            hash: hash(height),
            prev_hash: hash(height - 1),
            ..Default::default()
        };
        BlockRecord {
            height,
            hash: block.hash.clone(),
            prev_hash: block.prev_hash.clone(),
            payload: block.encode_to_vec(),
        }
    }

    fn test_writer(path: &Path, start: u64, end: u64) -> StoreWriter {
        StoreWriter::create(
            path,
            "regtest",
            start,
            end,
            &display_hash(&hash(start - 1)).unwrap(),
            &display_hash(&hash(end)).unwrap(),
        )
        .unwrap()
    }

    fn snapshot() -> (TempDir, PathBuf, Manifest) {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("snapshot");
        let mut writer = test_writer(&path, 1, 3);
        for height in 1..=3 {
            writer.push(record(height)).unwrap();
        }
        let manifest = writer.finish().unwrap();
        (root, path, manifest)
    }

    fn modify(path: &Path, bytes: &[u8]) {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn complete_snapshot_reopens_and_preserves_exact_bytes() {
        let (_root, path, manifest) = snapshot();
        let store = Store::open(path).unwrap();
        assert_eq!(store.manifest(), &manifest);
        assert_eq!(
            store
                .read_range(1, 3)
                .unwrap()
                .collect::<Result<Vec<_>>>()
                .unwrap(),
            vec![record(1), record(2), record(3)]
        );
        assert_eq!(manifest.dataset_id, dataset_id(&manifest).unwrap());
    }

    #[test]
    fn subranges_have_independent_seek_positions() {
        let (_root, path, _) = snapshot();
        let store = Store::open(path).unwrap();
        let mut left = store.read_range(1, 3).unwrap();
        let mut right = store.read_range(2, 3).unwrap();
        assert_eq!(left.next().unwrap().unwrap(), record(1));
        assert_eq!(right.next().unwrap().unwrap(), record(2));
        assert_eq!(left.next().unwrap().unwrap(), record(2));
        assert_eq!(right.next().unwrap().unwrap(), record(3));
        assert_eq!(left.next().unwrap().unwrap(), record(3));
    }

    #[test]
    fn range_is_contained_and_bounded() {
        let (_root, path, _) = snapshot();
        let limits = StoreLimits {
            max_range_blocks: 2,
            ..Default::default()
        };
        let store = Store::open_with_limits(path, limits).unwrap();
        for (start, end) in [(0, 1), (1, 4), (3, 2), (1, 3)] {
            assert!(store.read_range(start, end).is_err());
        }
        assert_eq!(store.read_block(2).unwrap(), record(2));
    }

    #[test]
    fn construction_rejects_heights_beyond_zcash_u32_range() {
        let root = tempfile::tempdir().unwrap();
        for height in [u64::from(u32::MAX) + 1, u64::MAX] {
            let path = root.path().join(format!("height-{height}"));
            let result = StoreWriter::create(
                &path,
                "regtest",
                height,
                height,
                &display_hash(&hash(0)).unwrap(),
                &display_hash(&hash(1)).unwrap(),
            );
            assert!(matches!(
                result,
                Err(Error::Invalid("height exceeds Zcash u32 range"))
            ));
            assert!(!path.exists());
        }
        assert_eq!(
            count(u64::from(u32::MAX), u64::from(u32::MAX), 1).unwrap(),
            1
        );
    }

    #[test]
    fn manifest_rejects_heights_beyond_zcash_u32_range() {
        for height in [u64::from(u32::MAX) + 1, u64::MAX] {
            let (_root, path, mut manifest) = snapshot();
            manifest.start_height = height;
            manifest.end_height = height;
            modify(
                &path.join(MANIFEST_NAME),
                &serde_json::to_vec(&manifest).unwrap(),
            );
            assert!(matches!(
                Store::open(&path),
                Err(Error::Invalid("height exceeds Zcash u32 range"))
            ));
        }
    }

    #[test]
    fn incomplete_or_dropped_writer_never_publishes() {
        let root = tempfile::tempdir().unwrap();
        for finish in [false, true] {
            let path = root.path().join(format!("incomplete-{finish}"));
            let mut writer = test_writer(&path, 1, 3);
            writer.push(record(1)).unwrap();
            if finish {
                assert!(writer.finish().is_err());
            } else {
                drop(writer);
            }
            assert!(!path.join(MANIFEST_NAME).exists());
            assert!(Store::open(path).is_err());
        }
    }

    #[test]
    fn existing_output_even_empty_is_never_overwritten() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("existing");
        fs::create_dir(&path).unwrap();
        fs::write(path.join("keep"), b"original").unwrap();
        assert!(StoreWriter::create(
            &path,
            "regtest",
            1,
            1,
            &display_hash(&hash(0)).unwrap(),
            &display_hash(&hash(1)).unwrap()
        )
        .is_err());
        assert_eq!(fs::read(path.join("keep")).unwrap(), b"original");
    }

    #[test]
    fn publication_does_not_clobber_an_existing_manifest() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("snapshot");
        let mut writer = test_writer(&path, 1, 1);
        writer.push(record(1)).unwrap();
        fs::write(path.join(MANIFEST_NAME), b"keep").unwrap();
        assert!(writer.finish().is_err());
        assert_eq!(fs::read(path.join(MANIFEST_NAME)).unwrap(), b"keep");
    }

    #[test]
    fn gaps_duplicates_and_wrong_parents_poison_writer() {
        let root = tempfile::tempdir().unwrap();
        for (case, bad) in [record(3), record(1), {
            let mut block = CompactBlock::decode(record(2).payload.as_slice()).unwrap();
            block.prev_hash = hash(999);
            BlockRecord {
                height: 2,
                hash: block.hash.clone(),
                prev_hash: block.prev_hash.clone(),
                payload: block.encode_to_vec(),
            }
        }]
        .into_iter()
        .enumerate()
        {
            let path = root.path().join(format!("bad-{case}"));
            let mut writer = test_writer(&path, 1, 3);
            writer.push(record(1)).unwrap();
            assert!(writer.push(bad).is_err());
            assert!(matches!(writer.push(record(2)), Err(Error::Poisoned)));
            assert!(writer.finish().is_err());
            assert!(!path.join(MANIFEST_NAME).exists());
        }
    }

    #[test]
    fn wrong_tip_never_publishes() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("bad-tip");
        let mut writer = StoreWriter::create(
            &path,
            "regtest",
            1,
            1,
            &display_hash(&hash(0)).unwrap(),
            &display_hash(&hash(999)).unwrap(),
        )
        .unwrap();
        writer.push(record(1)).unwrap();
        assert!(writer.finish().is_err());
        assert!(!path.join(MANIFEST_NAME).exists());
    }

    #[test]
    fn metadata_must_match_protobuf() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("metadata");
        let mut writer = test_writer(&path, 1, 1);
        let mut block = record(1);
        block.hash = hash(20);
        assert!(writer.push(block).is_err());
    }

    #[test]
    fn total_and_per_block_limits_are_enforced_before_publish() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("small");
        let first_size = record(1).payload.len() as u64 + 4;
        let limits = StoreLimits {
            max_segment_bytes: first_size,
            ..Default::default()
        };
        let mut writer = StoreWriter::create_with_limits(
            &path,
            "regtest",
            1,
            2,
            &display_hash(&hash(0)).unwrap(),
            &display_hash(&hash(2)).unwrap(),
            limits,
        )
        .unwrap();
        writer.push(record(1)).unwrap();
        assert!(writer.push(record(2)).is_err());
        assert!(writer.finish().is_err());
        let mut writer = test_writer(&root.path().join("oversized"), 1, 1);
        let mut bad = record(1);
        bad.payload.resize(MAX_BLOCK_BYTES as usize + 1, 0);
        assert!(writer.push(bad).is_err());
    }

    #[test]
    fn corruption_truncation_and_extra_bytes_are_rejected() {
        for case in 0..3 {
            let (_root, path, _) = snapshot();
            let segment = path.join(SEGMENT_NAME);
            let mut bytes = fs::read(&segment).unwrap();
            match case {
                0 => bytes[8] ^= 0xff,
                1 => {
                    bytes.pop();
                }
                _ => bytes.push(0),
            }
            modify(&segment, &bytes);
            assert!(Store::open(path).is_err());
        }
    }

    #[test]
    fn corrupt_length_prefix_is_rejected_without_large_allocation() {
        let (_root, path, _) = snapshot();
        let segment = path.join(SEGMENT_NAME);
        let mut bytes = fs::read(&segment).unwrap();
        bytes[..4].copy_from_slice(&u32::MAX.to_le_bytes());
        modify(&segment, &bytes);
        assert!(Store::open(path).is_err());
    }

    #[test]
    fn manifest_offset_and_dataset_identity_are_checked() {
        for identity in [false, true] {
            let (_root, path, mut manifest) = snapshot();
            if identity {
                manifest.network = "mainnet".into();
            } else {
                manifest.blocks[1].offset += 1;
            }
            modify(
                &path.join(MANIFEST_NAME),
                &serde_json::to_vec(&manifest).unwrap(),
            );
            assert!(Store::open(path).is_err());
        }
    }

    #[test]
    fn corruption_after_open_is_checked_on_each_read() {
        let (_root, path, _) = snapshot();
        let store = Store::open(&path).unwrap();
        let segment = path.join(SEGMENT_NAME);
        let mut bytes = fs::read(&segment).unwrap();
        bytes[8] ^= 0xff;
        modify(&segment, &bytes);
        let mut range = store.read_range(1, 3).unwrap();
        assert!(range.next().unwrap().is_err());
        assert!(range.next().is_none());
    }

    #[test]
    fn snapshot_identity_changes_with_network_and_anchors() {
        let (_root, _, manifest) = snapshot();
        let mut changed = manifest.clone();
        changed.network = "testnet".into();
        assert_ne!(dataset_id(&changed).unwrap(), manifest.dataset_id);
        let mut changed = manifest.clone();
        changed.predecessor_hash = display_hash(&hash(1000)).unwrap();
        assert_ne!(dataset_id(&changed).unwrap(), manifest.dataset_id);
    }

    #[test]
    fn compact_manifest_defaults_preserve_legacy_identity_and_serialization() {
        let (_root, _, manifest) = snapshot();
        let json = serde_json::to_value(&manifest).unwrap();
        assert!(json.get("payload_kind").is_none());
        assert!(json["blocks"][0].get("time").is_none());
        let restored: Manifest = serde_json::from_value(json).unwrap();
        assert_eq!(restored.payload_kind, COMPACT_KIND);
        let legacy_bytes = serde_json::to_vec(&(
            "zeer-prep-snapshot-v1",
            &manifest.network,
            manifest.start_height,
            manifest.end_height,
            &manifest.predecessor_hash,
            &manifest.end_hash,
            &manifest.segment_sha256,
        ))
        .unwrap();
        assert_eq!(manifest.dataset_id, sha256(&legacy_bytes));
        let mut changed = manifest.clone();
        changed.payload_kind = FULL_KIND.into();
        assert_ne!(dataset_id(&changed).unwrap(), manifest.dataset_id);
    }

    fn full_record(decoded_json: String, raw_block: Vec<u8>) -> BlockRecord {
        let block = prep_proto::prep::FullBlock {
            height: 1,
            hash: hash(1),
            prev_hash: hash(0),
            time: 1,
            raw_block,
            decoded_json,
        };
        BlockRecord {
            height: 1,
            hash: hash(1),
            prev_hash: hash(0),
            payload: block.encode_to_vec(),
        }
    }

    #[test]
    fn optional_transaction_index_admits_legacy_and_malformed_fallback_safely() {
        let root = tempfile::tempdir().unwrap();
        for (name, json, indexed) in [
            (
                "metadata",
                format!(
                    r#"{{"tx":[{{"txid":"{}","hex":"0102","version":1,"locktime":0,"vin":[{{}}],"vout":[{{}}]}}]}}"#,
                    "ab".repeat(32)
                ),
                true,
            ),
            ("malformed", "{\"tx\":[{\"txid\":\"bad\"}]}".into(), false),
            ("legacy", "{\"synthetic\":true}".into(), false),
        ] {
            let path = root.path().join(name);
            let mut writer = StoreWriter::create_full(
                &path,
                "regtest",
                1,
                1,
                &display_hash(&hash(0)).unwrap(),
                &display_hash(&hash(1)).unwrap(),
            )
            .unwrap();
            writer.push(full_record(json, vec![1, 2, 3])).unwrap();
            writer.finish().unwrap();
            let store = Store::open(&path).unwrap();
            assert_eq!(store.transaction_metadata(1).unwrap().is_some(), indexed);
            assert_eq!(
                store.transaction_locations(&[[0xab; 32]], 1, 1).unwrap(),
                indexed.then_some(vec![1])
            );
            assert!(store.transaction_metadata(0).is_err());
            assert!(store.transaction_locations(&[[0; 32]; 129], 1, 1).is_err());
            assert!(store.transaction_locations(&[], 1, 1001).is_err());
            assert!(Store::open_with_index_budget(&path, 0)
                .unwrap()
                .transaction_metadata(1)
                .unwrap()
                .is_none());
            assert!(store.read_block(1).is_ok());
        }
    }

    #[test]
    fn disk_metadata_build_publish_reopen_fallback_and_bounds() {
        let _guard = disk_index::TEST_LOCK.lock().unwrap();
        let root = tempfile::tempdir().unwrap();
        let json = format!(
            r#"{{"tx":[{{"txid":"{}","hex":"0102","version":1,"locktime":0,"vin":[],"vout":[]}}]}}"#,
            "ab".repeat(32)
        );
        let create = |name: &str| {
            let path = root.path().join(name);
            let mut writer = StoreWriter::create_full(
                &path,
                "regtest",
                1,
                1,
                &display_hash(&hash(0)).unwrap(),
                &display_hash(&hash(1)).unwrap(),
            )
            .unwrap();
            writer
                .push(full_record(json.clone(), vec![1, 2, 3]))
                .unwrap();
            writer.finish().unwrap();
            path
        };
        let path = create("good");
        let before = Store::open_with_index_budget(&path, 0).unwrap();
        assert_eq!(disk_index::build(&before, 106).unwrap(), 106);
        assert!(!path.join("transactions-v1.pending").exists());
        assert!(before.transaction_metadata(1).unwrap().is_none());
        let reopened = Store::open(&path).unwrap();
        assert!(reopened.disk_index.is_some());
        assert!(reopened.transaction_index.is_none());
        assert_eq!(
            reopened.transaction_metadata(1).unwrap().unwrap()[0].txid,
            [0xab; 32]
        );
        assert_eq!(
            reopened.transaction_locations(&[[0xab; 32]], 1, 1).unwrap(),
            None
        );
        assert!(disk_index::build(&before, 106).is_err()); // Never clobbers published data.
        let mut file = OpenOptions::new()
            .write(true)
            .open(path.join(disk_index::NAME))
            .unwrap();
        file.seek(SeekFrom::Start(84)).unwrap();
        file.write_all(&2u32.to_le_bytes()).unwrap();
        // Location selection performs no disk scan, leaving cancellation-aware
        // callers to inspect one block at a time. It must not disable the cache.
        assert!(reopened
            .transaction_locations(&[[0xab; 32]], 1, 1)
            .unwrap()
            .is_none());
        file.seek(SeekFrom::Start(84)).unwrap();
        file.write_all(&1u32.to_le_bytes()).unwrap();
        assert!(reopened.transaction_metadata(1).unwrap().is_some());
        file.seek(SeekFrom::Start(84)).unwrap();
        file.write_all(&2u32.to_le_bytes()).unwrap();
        assert!(reopened.transaction_metadata(1).unwrap().is_none());
        assert!(reopened.read_block(1).is_ok());
        let fresh = Store::open(&path).unwrap();
        assert!(fresh.disk_index.is_none()); // Poisoned rows never enter a cache.
        assert!(fresh.transaction_metadata(1).unwrap().is_none());
        let partial = create("partial");
        let store = Store::open_with_index_budget(&partial, 0).unwrap();
        assert!(disk_index::build(&store, 105).is_err());
        assert!(!partial.join(disk_index::NAME).exists());
        assert!(partial.join("transactions-v1.pending").exists());
        assert!(Store::open(&partial).unwrap().disk_index.is_none());
    }

    #[test]
    fn disk_projection_covers_rows_beyond_ram_budget_without_row_cache() {
        let _guard = disk_index::TEST_LOCK.lock().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("large");
        let tx = format!(
            r#"{{"txid":"{}","hex":"0102","version":1,"locktime":0,"vin":[],"vout":[]}}"#,
            "ab".repeat(32)
        );
        let json = format!(
            "{{\"tx\":[{}]}}",
            std::iter::repeat_n(tx, 2000).collect::<Vec<_>>().join(",")
        );
        let mut writer = StoreWriter::create_full(
            &path,
            "regtest",
            1,
            1,
            &display_hash(&hash(0)).unwrap(),
            &display_hash(&hash(1)).unwrap(),
        )
        .unwrap();
        writer.push(full_record(json, vec![1, 2, 3])).unwrap();
        writer.finish().unwrap();
        let budget = 2048;
        let fallback = Store::open_with_index_budget(&path, budget).unwrap();
        assert!(fallback.transaction_metadata(1).unwrap().is_none());
        assert_eq!(disk_index::build(&fallback, 132040).unwrap(), 132040);
        let indexed = Store::open_with_index_budget(&path, budget).unwrap();
        assert!(indexed.transaction_index.is_none());
        assert!(indexed.disk_index.is_some());
        assert!(indexed.transaction_index_bytes() <= budget);
        assert_eq!(
            indexed.transaction_metadata(1).unwrap().unwrap().len(),
            2000
        );
        assert_eq!(
            indexed.transaction_locations(&[[0xab; 32]], 1, 1).unwrap(),
            None
        );
    }

    #[test]
    fn full_payload_larger_than_compact_limit_reopens_with_full_profile() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("full");
        let json = format!(
            "{{\"padding\":\"{}\"}}",
            "x".repeat(MAX_BLOCK_BYTES as usize)
        );
        let record = full_record(json, vec![1, 2, 3]);
        assert!(record.payload.len() as u64 > MAX_BLOCK_BYTES);
        let mut writer = StoreWriter::create_full(
            &path,
            "regtest",
            1,
            1,
            &display_hash(&hash(0)).unwrap(),
            &display_hash(&hash(1)).unwrap(),
        )
        .unwrap();
        writer.push(record.clone()).unwrap();
        let manifest = writer.finish().unwrap();
        assert_eq!(manifest.payload_kind, FULL_KIND);
        assert_eq!(Store::open(&path).unwrap().read_block(1).unwrap(), record);
        assert!(Store::open_with_limits(&path, StoreLimits::default()).is_err());
    }

    #[test]
    fn compressed_records_reopen_and_packed_headers_preserve_exact_payloads() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("compressed");
        let record = full_record(
            format!(r#"{{"pad":"{}"}}"#, "abc".repeat(10000)),
            vec![1, 2, 3],
        );
        let mut writer = StoreWriter::create_full(
            &path,
            "regtest",
            1,
            1,
            &display_hash(&hash(0)).unwrap(),
            &display_hash(&hash(1)).unwrap(),
        )
        .unwrap()
        .with_compression()
        .unwrap();
        writer.push(record.clone()).unwrap();
        let manifest = writer.finish().unwrap();
        assert_eq!(manifest.schema_version, 3);
        assert!(manifest.blocks[0].uncompressed_length.is_some());
        assert!(manifest.segment_bytes < record.payload.len() as u64);
        let full = Store::open(&path).unwrap();
        let header = full.read_header(1).unwrap();
        let packed = full.compact_manifest().unwrap();
        assert!(packed.manifest.blocks.is_empty());
        assert_eq!(packed.read_header(1).unwrap(), header);
        assert_eq!(packed.read_block(1).unwrap(), record);
        assert_eq!(
            packed.read_range(1, 1).unwrap().next().unwrap().unwrap(),
            record
        );
        assert!(std::mem::size_of::<PackedIndex>() <= 144);
        let mut corrupt = fs::read(path.join(SEGMENT_NAME)).unwrap();
        *corrupt.last_mut().unwrap() ^= 1;
        fs::write(path.join(SEGMENT_NAME), corrupt).unwrap();
        assert!(packed.read_block(1).is_err());
        assert!(Store::open(&path).is_err());
    }

    #[test]
    fn raw_referenced_storage_reads_identically_with_packed_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("refs");
        let raw: Vec<u8> = (0..=255).cycle().take(4096).collect();
        let json = serde_json::json!({"solution":hex::encode(&raw[140..1484]),"tx":[{"hex":hex::encode(&raw[1500..2000])}]});
        let record = full_record(serde_json::to_string(&json).unwrap(), raw);
        let mut writer = StoreWriter::create_full(
            &path,
            "regtest",
            1,
            1,
            &display_hash(&hash(0)).unwrap(),
            &display_hash(&hash(1)).unwrap(),
        )
        .unwrap()
        .with_compression()
        .unwrap();
        writer.push(record.clone()).unwrap();
        let manifest = writer.finish().unwrap();
        assert!(manifest.blocks[0].raw_refs);
        let store = Store::open(&path).unwrap().compact_manifest().unwrap();
        assert_eq!(store.read_block(1).unwrap(), record);
    }

    #[test]
    fn compressed_declared_length_is_bounded_before_decode() {
        let (_root, path, mut manifest) = full_snapshot();
        manifest.schema_version = 2;
        manifest.dataset_id = dataset_id(&manifest).unwrap();
        manifest.blocks[0].uncompressed_length = Some(u32::MAX);
        fs::write(
            path.join(MANIFEST_NAME),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert!(Store::open(&path).is_err());
    }

    #[test]
    fn full_payload_requires_raw_bytes_and_valid_object_json() {
        let root = tempfile::tempdir().unwrap();
        for (index, (json, raw)) in [
            ("{}", vec![]),
            ("", vec![1]),
            ("[]", vec![1]),
            ("{invalid", vec![1]),
        ]
        .into_iter()
        .enumerate()
        {
            let path = root.path().join(format!("full-{index}"));
            let mut writer = StoreWriter::create_full(
                &path,
                "regtest",
                1,
                1,
                &display_hash(&hash(0)).unwrap(),
                &display_hash(&hash(1)).unwrap(),
            )
            .unwrap();
            assert!(writer.push(full_record(json.into(), raw)).is_err());
            assert!(writer.finish().is_err());
            assert!(!path.join(MANIFEST_NAME).exists());
        }
    }

    fn full_snapshot() -> (TempDir, PathBuf, Manifest) {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("full");
        let mut writer = StoreWriter::create_full(
            &path,
            "regtest",
            1,
            1,
            &display_hash(&hash(0)).unwrap(),
            &display_hash(&hash(1)).unwrap(),
        )
        .unwrap();
        writer
            .push(full_record("{\"synthetic\":true}".into(), vec![1, 2, 3]))
            .unwrap();
        let manifest = writer.finish().unwrap();
        (root, path, manifest)
    }

    #[test]
    fn indexed_full_header_matches_payload_without_payload_io() {
        let (_root, path, manifest) = full_snapshot();
        assert_eq!(manifest.blocks[0].time, Some(1));
        let store = Store::open(&path).unwrap();
        let record = store.read_block(1).unwrap();
        let decoded = prep_proto::prep::FullBlock::decode(record.payload.as_slice()).unwrap();
        let expected = BlockHeader {
            height: decoded.height,
            hash: decoded.hash,
            prev_hash: decoded.prev_hash,
            time: decoded.time,
        };
        // Synthetic test only: remove access to the payload after its complete
        // admission check to prove this header path uses cached metadata.
        fs::rename(path.join(SEGMENT_NAME), path.join("segment.saved")).unwrap();
        assert_eq!(store.read_header(1).unwrap(), expected);
        assert_eq!(
            store.block_hash(1).unwrap(),
            display_hash(&hash(1)).unwrap()
        );
        assert!(store.read_block(1).is_err());
        assert!(store.read_header(2).is_err());
    }

    #[test]
    fn corrupt_indexed_time_is_rejected_during_open() {
        let (_root, path, mut manifest) = full_snapshot();
        manifest.blocks[0].time = Some(2);
        modify(
            &path.join(MANIFEST_NAME),
            &serde_json::to_vec(&manifest).unwrap(),
        );
        assert!(matches!(
            Store::open(path),
            Err(Error::Invalid(
                "indexed header time differs from decoded payload"
            ))
        ));
    }

    #[test]
    fn legacy_full_header_without_time_uses_checked_payload_fallback() {
        let (_root, path, mut manifest) = full_snapshot();
        manifest.blocks[0].time = None;
        let serialized = serde_json::to_value(&manifest).unwrap();
        assert!(serialized["blocks"][0].get("time").is_none());
        modify(
            &path.join(MANIFEST_NAME),
            &serde_json::to_vec(&manifest).unwrap(),
        );
        let store = Store::open(&path).unwrap();
        assert_eq!(store.read_header(1).unwrap().time, 1);
        let mut segment = fs::read(path.join(SEGMENT_NAME)).unwrap();
        segment[8] ^= 1;
        modify(&path.join(SEGMENT_NAME), &segment);
        assert!(store.read_header(1).is_err());
    }
}
