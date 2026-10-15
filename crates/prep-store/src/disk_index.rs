//! Optional disk projection. Trust comes from source comparison, never a file checksum.
use super::*;
use crate::transaction_index::stream_metadata;
use std::mem::size_of;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
#[cfg(test)]
use std::sync::Mutex;

const MAGIC: &[u8; 8] = b"PREPMD01";
const HEADER: u64 = 40;
const ROW: usize = 66;
const MAX_OPEN_FILES: usize = 128;
#[cfg(test)]
pub(crate) static TEST_LOCK: Mutex<()> = Mutex::new(());
static OPEN_FILES: AtomicUsize = AtomicUsize::new(0);
struct FilePermit;
impl FilePermit {
    fn acquire() -> Option<Self> {
        OPEN_FILES
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                (value < MAX_OPEN_FILES).then_some(value + 1)
            })
            .ok()?;
        Some(Self)
    }
}
impl Drop for FilePermit {
    fn drop(&mut self) {
        OPEN_FILES.fetch_sub(1, Ordering::AcqRel);
    }
}
pub(crate) const NAME: &str = "transactions-v1.bin";
pub(crate) const PENDING: &str = "transactions-v1.pending";
pub const MAX_DISK_INDEX_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_SEGMENT_INDEX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ROWS: u64 = (MAX_SEGMENT_INDEX_BYTES - HEADER) / ROW as u64;

fn encoded(row: &TransactionMetadata) -> [u8; ROW] {
    let mut out = [0; ROW];
    out[..32].copy_from_slice(&row.txid);
    out[32..40].copy_from_slice(&row.block_height.to_le_bytes());
    for (i, value) in [
        row.index,
        row.version,
        row.locktime,
        row.size_bytes,
        row.transparent_input_count,
        row.transparent_output_count,
    ]
    .iter()
    .enumerate()
    {
        out[40 + i * 4..44 + i * 4].copy_from_slice(&value.to_le_bytes());
    }
    out[64] = u8::from(row.has_sapling);
    out[65] = u8::from(row.has_orchard);
    out
}
fn decoded(bytes: &[u8; ROW]) -> TransactionMetadata {
    let u32_at = |i| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap());
    TransactionMetadata {
        txid: bytes[..32].try_into().unwrap(),
        block_height: u64::from_le_bytes(bytes[32..40].try_into().unwrap()),
        index: u32_at(40),
        version: u32_at(44),
        locktime: u32_at(48),
        size_bytes: u32_at(52),
        transparent_input_count: u32_at(56),
        transparent_output_count: u32_at(60),
        has_sapling: bytes[64] != 0,
        has_orchard: bytes[65] != 0,
    }
}
struct Block {
    offset: u64,
    rows: u64,
    digest: [u8; 32],
}
pub(crate) struct DiskIndex {
    file: Option<File>,
    permit: Option<FilePermit>,
    path: PathBuf,
    header: [u8; HEADER as usize],
    disabled: AtomicBool,
    blocks: Vec<Block>,
    start: u64,
    length: u64,
}
impl DiskIndex {
    pub(crate) fn candidate(
        path: &Path,
        manifest: &[u8],
        start: u64,
        blocks: usize,
        budget: usize,
    ) -> Option<Self> {
        let mut descriptors = Vec::new();
        let sidecar_path = path.join(NAME);
        let base = size_of::<Self>() + 2 * size_of::<usize>() + sidecar_path.capacity();
        if blocks.checked_mul(size_of::<Block>())?.checked_add(base)? > budget {
            return None;
        }
        descriptors.try_reserve_exact(blocks).ok()?;
        if descriptors
            .capacity()
            .checked_mul(size_of::<Block>())?
            .checked_add(base)?
            > budget
        {
            return None;
        }
        let permit = FilePermit::acquire()?;
        let mut file = regular_file(&sidecar_path).ok()?;
        let length = file.metadata().ok()?.len();
        if !(HEADER..=MAX_SEGMENT_INDEX_BYTES).contains(&length) {
            return None;
        }
        let mut header = [0; HEADER as usize];
        file.read_exact(&mut header).ok()?;
        if &header[..8] != MAGIC || header[8..] != Sha256::digest(manifest)[..] {
            return None;
        }
        Some(Self {
            file: Some(file),
            permit: Some(permit),
            path: sidecar_path,
            header,
            disabled: AtomicBool::new(false),
            blocks: descriptors,
            start,
            length,
        })
    }
    pub(crate) fn admit_block(&mut self, height: u64, json: &str) -> Option<()> {
        let file = self.file.as_mut()?;
        let offset = file.stream_position().ok()?;
        let mut rows = 0u64;
        let mut digest = Sha256::new();
        stream_metadata(height, json, &mut |row| {
            let expected = encoded(&row);
            let mut actual = [0; ROW];
            file.read_exact(&mut actual).ok()?;
            if actual != expected {
                return None;
            }
            digest.update(expected);
            rows = rows.checked_add(1)?;
            if rows > MAX_ROWS {
                return None;
            }
            Some(())
        })?;
        self.blocks.push(Block {
            offset,
            rows,
            digest: digest.finalize().into(),
        });
        Some(())
    }
    pub(crate) fn finish(mut self, expected_blocks: usize) -> Option<Self> {
        let file = self.file.as_mut()?;
        if self.blocks.len() != expected_blocks
            || file.stream_position().ok()? != self.length
            || file.metadata().ok()?.len() != self.length
        {
            return None;
        }
        self.file = None;
        self.permit = None;
        Some(self)
    }
    pub(crate) fn bytes(&self) -> usize {
        size_of::<Self>()
            + 2 * size_of::<usize>()
            + self.path.capacity()
            + self.blocks.capacity() * size_of::<Block>()
    }
    pub(crate) fn block(&self, height: u64) -> Option<Vec<TransactionMetadata>> {
        if self.disabled.load(Ordering::Acquire) {
            return None;
        }
        // Admission and queries share a process-wide bound on transient handles.
        // Permit exhaustion is temporary and must not poison a valid cache.
        let _permit = FilePermit::acquire()?;
        let result = (|| {
            let mut file = regular_file(&self.path).ok()?;
            let block = self
                .blocks
                .get(usize::try_from(height.checked_sub(self.start)?).ok()?)?;
            if file.metadata().ok()?.len() != self.length {
                return None;
            }
            let mut header = [0; HEADER as usize];
            file.read_exact(&mut header).ok()?;
            if header != self.header {
                return None;
            }
            file.seek(SeekFrom::Start(block.offset)).ok()?;
            let mut rows = Vec::new();
            rows.try_reserve_exact(usize::try_from(block.rows).ok()?)
                .ok()?;
            let mut digest = Sha256::new();
            for _ in 0..block.rows {
                let mut bytes = [0; ROW];
                file.read_exact(&mut bytes).ok()?;
                digest.update(bytes);
                rows.push(decoded(&bytes));
            }
            if digest.finalize()[..] != block.digest[..] {
                return None;
            }
            Some(rows)
        })();
        if result.is_none() {
            self.disabled.store(true, Ordering::Release);
        }
        result
    }
}

fn checked_manifest_bytes(store: &Store) -> Result<Vec<u8>> {
    let mut manifest_file = regular_file(&store.path.join(MANIFEST_NAME))?;
    if manifest_file.metadata()?.len() > MAX_MANIFEST_BYTES {
        return Err(Error::Limit("manifest bytes"));
    }
    let mut manifest = Vec::new();
    (&mut manifest_file)
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut manifest)?;
    if manifest.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(Error::Limit("manifest grew while building"));
    }
    if serde_json::from_slice::<Manifest>(&manifest)? != *store.manifest() {
        return Err(Error::Invalid("manifest changed while building metadata"));
    }
    Ok(manifest)
}

/// Existing published files are source-checked too; a corrupt file must be
/// explicitly removed by the operator before this no-clobber builder can repair it.
pub(crate) fn validate_existing(store: &Store) -> Result<u64> {
    let manifest = checked_manifest_bytes(store)?;
    let mut index = DiskIndex::candidate(
        &store.path,
        &manifest,
        store.manifest.start_height,
        store.manifest.blocks.len(),
        SEGMENT_INDEX_BYTES,
    )
    .ok_or(Error::Invalid("existing disk metadata index is invalid"))?;
    for block in &store.manifest.blocks {
        let record = store.read_block(block.height)?;
        let full = prep_proto::prep::FullBlock::decode(record.payload.as_slice())?;
        index
            .admit_block(block.height, &full.decoded_json)
            .ok_or(Error::Invalid("existing disk metadata differs from source"))?;
    }
    let index = index
        .finish(store.manifest.blocks.len())
        .ok_or(Error::Invalid(
            "existing disk metadata has trailing or missing rows",
        ))?;
    Ok(index.length)
}

/// Build one sidecar with bounded streaming memory and an exclusive pending file.
/// A failed build leaves its pending file for explicit operator inspection.
pub(crate) fn build(store: &Store, remaining: u64) -> Result<u64> {
    if store.manifest().payload_kind != FULL_KIND {
        return Err(Error::Invalid("disk metadata requires full archive"));
    }
    let manifest = checked_manifest_bytes(store)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(store.path.join(PENDING))?;
    let cap = remaining.min(MAX_SEGMENT_INDEX_BYTES);
    if cap < HEADER {
        return Err(Error::Limit("disk metadata bytes"));
    }
    file.write_all(MAGIC)?;
    file.write_all(&Sha256::digest(&manifest))?;
    let mut bytes = HEADER;
    let mut failed_io = None;
    for index in &store.manifest.blocks {
        let record = store.read_block(index.height)?;
        let full = prep_proto::prep::FullBlock::decode(record.payload.as_slice())?;
        let result = stream_metadata(index.height, &full.decoded_json, &mut |row| {
            if bytes.checked_add(ROW as u64)? > cap {
                return None;
            }
            if let Err(error) = file.write_all(&encoded(&row)) {
                failed_io = Some(error);
                return None;
            }
            bytes += ROW as u64;
            Some(())
        });
        if let Some(error) = failed_io.take() {
            return Err(error.into());
        }
        if result.is_none() {
            return Err(Error::Invalid(
                "unsupported metadata or disk metadata bound exceeded",
            ));
        }
    }
    file.sync_all()?;
    // No-clobber publication: readers see either the complete file or no sidecar.
    fs::hard_link(store.path.join(PENDING), store.path.join(NAME))?;
    sync_directory(&store.path)?;
    fs::remove_file(store.path.join(PENDING))?;
    sync_directory(&store.path)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> String {
        format!(
            r#"{{"tx":[{{"txid":"{}","hex":"0102","version":1,"locktime":0,"vin":[],"vout":[]}}]}}"#,
            "ab".repeat(32)
        )
    }
    fn fixture() -> (tempfile::TempDir, String) {
        let root = tempfile::tempdir().unwrap();
        let json = source();
        let mut file = File::create(root.path().join(NAME)).unwrap();
        file.write_all(MAGIC).unwrap();
        file.write_all(&Sha256::digest(b"manifest")).unwrap();
        stream_metadata(1, &json, &mut |row| file.write_all(&encoded(&row)).ok()).unwrap();
        (root, json)
    }
    #[test]
    fn compares_source_then_rehashes_query_bytes_and_disables_on_corruption() {
        let _guard = TEST_LOCK.lock().unwrap();
        let (root, json) = fixture();
        let mut index =
            DiskIndex::candidate(root.path(), b"manifest", 1, 1, SEGMENT_INDEX_BYTES).unwrap();
        index.admit_block(1, &json).unwrap();
        let index = index.finish(1).unwrap();
        assert_eq!(index.block(1).unwrap()[0].version, 1);
        assert!(index.bytes() < SEGMENT_INDEX_BYTES);
        let mut file = OpenOptions::new()
            .write(true)
            .open(root.path().join(NAME))
            .unwrap();
        file.seek(SeekFrom::Start(HEADER + 44)).unwrap();
        file.write_all(&999u32.to_le_bytes()).unwrap();
        assert!(index.block(1).is_none());
        file.seek(SeekFrom::Start(HEADER + 44)).unwrap();
        file.write_all(&1u32.to_le_bytes()).unwrap();
        assert!(index.block(1).is_none());
    }
    #[test]
    fn rejects_wrong_identity_version_trailing_rows_and_source_mismatch() {
        let _guard = TEST_LOCK.lock().unwrap();
        let (root, json) = fixture();
        assert!(
            DiskIndex::candidate(root.path(), b"wrong manifest", 1, 1, SEGMENT_INDEX_BYTES)
                .is_none()
        );
        assert!(DiskIndex::candidate(root.path(), b"manifest", 1, 1, 1).is_none());
        let mut index =
            DiskIndex::candidate(root.path(), b"manifest", 1, 1, SEGMENT_INDEX_BYTES).unwrap();
        assert!(index
            .admit_block(1, &json.replace("\"version\":1", "\"version\":2"))
            .is_none());
        let mut file = OpenOptions::new()
            .append(true)
            .open(root.path().join(NAME))
            .unwrap();
        file.write_all(&[0; ROW]).unwrap();
        let mut index =
            DiskIndex::candidate(root.path(), b"manifest", 1, 1, SEGMENT_INDEX_BYTES).unwrap();
        index.admit_block(1, &json).unwrap();
        assert!(index.finish(1).is_none());
        let mut file = OpenOptions::new()
            .write(true)
            .open(root.path().join(NAME))
            .unwrap();
        file.write_all(b"PREPMD02").unwrap();
        assert!(
            DiskIndex::candidate(root.path(), b"manifest", 1, 1, SEGMENT_INDEX_BYTES).is_none()
        );
    }
    #[test]
    fn replaced_path_cannot_substitute_valid_rows_from_another_source() {
        let _guard = TEST_LOCK.lock().unwrap();
        let (root, json) = fixture();
        let mut index =
            DiskIndex::candidate(root.path(), b"manifest", 1, 1, SEGMENT_INDEX_BYTES).unwrap();
        index.admit_block(1, &json).unwrap();
        let index = index.finish(1).unwrap();
        let saved = root.path().join("saved.bin");
        fs::rename(root.path().join(NAME), &saved).unwrap();
        let mut file = File::create(root.path().join(NAME)).unwrap();
        file.write_all(MAGIC).unwrap();
        file.write_all(&Sha256::digest(b"manifest")).unwrap();
        stream_metadata(
            1,
            &json.replace(&"ab".repeat(32), &"cd".repeat(32)),
            &mut |row| file.write_all(&encoded(&row)).ok(),
        )
        .unwrap();
        drop(file);
        assert!(index.block(1).is_none());
        fs::remove_file(root.path().join(NAME)).unwrap();
        fs::rename(saved, root.path().join(NAME)).unwrap();
        assert!(index.block(1).is_none()); // Disabled across every shared snapshot.
    }

    #[test]
    fn transient_handles_are_bounded_but_many_admitted_segments_keep_coverage() {
        let _guard = TEST_LOCK.lock().unwrap();
        let (root, json) = fixture();
        let mut candidates = Vec::new();
        while let Some(index) =
            DiskIndex::candidate(root.path(), b"manifest", 1, 1, SEGMENT_INDEX_BYTES)
        {
            candidates.push(index);
        }
        assert_eq!(candidates.len(), MAX_OPEN_FILES);
        drop(candidates);
        let mut indexes = Vec::new();
        for _ in 0..MAX_OPEN_FILES * 2 {
            let mut index =
                DiskIndex::candidate(root.path(), b"manifest", 1, 1, SEGMENT_INDEX_BYTES).unwrap();
            index.admit_block(1, &json).unwrap();
            indexes.push(index.finish(1).unwrap());
        }
        assert_eq!(OPEN_FILES.load(Ordering::Acquire), 0);
        for index in &indexes {
            assert_eq!(index.block(1).unwrap()[0].version, 1);
        }
        assert_eq!(OPEN_FILES.load(Ordering::Acquire), 0);
        let mut permits = Vec::new();
        for _ in 0..MAX_OPEN_FILES {
            permits.push(FilePermit::acquire().unwrap());
        }
        assert!(indexes[0].block(1).is_none());
        drop(permits);
        assert!(indexes[0].block(1).is_some());
    }
}
