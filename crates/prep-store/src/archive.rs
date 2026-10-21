//! Atomically published catalogs over immutable, independently checked segments.

use super::transaction_index::ARCHIVE_INDEX_BYTES;
use super::*;
use std::collections::{HashMap, HashSet};

const CATALOG_NAME: &str = "catalog.json";
const CATALOG_PENDING: &str = "catalog.pending";
const LOCK_NAME: &str = "archive.lock";
const MAX_CATALOG_BYTES: u64 = 16 * 1024 * 1024;
// A live follower can publish one immutable segment per new block. Keep room
// beyond the historical import; catalog bytes and header metadata stay bounded
// independently, including for unusually long segment directory names.
const MAX_SEGMENTS: usize = 30_000;
const MAX_RANGE_BLOCKS: u64 = 10_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SegmentReference {
    /// Strictly `segments/<ASCII alphanumeric, dash or underscore name>`.
    pub directory: String,
    pub dataset_id: String,
    pub start_height: u64,
    pub end_height: u64,
    pub predecessor_hash: String,
    pub end_hash: String,
    pub manifest_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub schema_version: u32,
    pub network: String,
    pub payload_kind: String,
    pub start_height: u64,
    /// Advances only when published history is removed/invalidated.
    pub epoch: u64,
    /// Advances on each append, rollback or explicit epoch invalidation.
    pub revision: u64,
    pub segments: Vec<SegmentReference>,
    pub catalog_sha256: String,
}

impl Catalog {
    pub fn head(&self) -> Option<u64> {
        self.segments.last().map(|segment| segment.end_height)
    }

    pub fn head_hash(&self) -> Option<&str> {
        self.segments
            .last()
            .map(|segment| segment.end_hash.as_str())
    }
}

fn catalog_hash(catalog: &Catalog) -> Result<String> {
    Ok(sha256(&serde_json::to_vec(&(
        "zeer-prep-catalog-v1",
        catalog.schema_version,
        &catalog.network,
        &catalog.payload_kind,
        catalog.start_height,
        catalog.epoch,
        catalog.revision,
        &catalog.segments,
    ))?))
}

fn check_directory(path: &Path) -> Result<()> {
    if !fs::symlink_metadata(path)?.file_type().is_dir() {
        return Err(Error::Invalid(
            "archive component must be a directory, not a symlink",
        ));
    }
    Ok(())
}

fn segment_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let name = relative
        .strip_prefix("segments/")
        .ok_or(Error::Invalid("segment directory must be under segments/"))?;
    if name.is_empty()
        || name.len() > 128
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(Error::Invalid("unsafe segment directory name"));
    }
    check_directory(root)?;
    check_directory(&root.join("segments"))?;
    let path = root.join("segments").join(name);
    check_directory(&path)?;
    Ok(path)
}

fn validate_catalog(catalog: &Catalog) -> Result<()> {
    // Bound resident binary header metadata before opening any segment.
    let blocks = catalog
        .segments
        .last()
        .map(|segment| {
            segment
                .end_height
                .saturating_sub(catalog.start_height)
                .saturating_add(1)
        })
        .unwrap_or(0);
    if blocks.saturating_mul(std::mem::size_of::<crate::PackedIndex>() as u64) > 640 * 1024 * 1024 {
        return Err(Error::Limit("archive header metadata bytes"));
    }
    if catalog.schema_version != 1 {
        return Err(Error::Invalid("unsupported catalog schema"));
    }
    check_network(&catalog.network)?;
    check_payload_kind(&catalog.payload_kind)?;
    if catalog.start_height > u64::from(u32::MAX) {
        return Err(Error::Invalid("archive start must be in 0..=u32::MAX"));
    }
    if catalog.epoch > catalog.revision || catalog.segments.len() as u64 > catalog.revision {
        return Err(Error::Invalid("invalid catalog revision counters"));
    }
    if catalog.segments.len() > MAX_SEGMENTS {
        return Err(Error::Limit("catalog segment count"));
    }
    let mut directories = HashSet::new();
    let mut expected_start = catalog.start_height;
    let mut parent: Option<&str> = None;
    for segment in &catalog.segments {
        if !directories.insert(&segment.directory) {
            return Err(Error::Invalid("duplicate catalog segment directory"));
        }
        count(segment.start_height, segment.end_height, MAX_BLOCKS)?;
        if segment.start_height != expected_start {
            return Err(Error::Invalid("catalog segments are not contiguous"));
        }
        parse_hex_hash(&segment.dataset_id)?;
        parse_hex_hash(&segment.manifest_sha256)?;
        parse_hex_hash(&segment.predecessor_hash)?;
        parse_hex_hash(&segment.end_hash)?;
        if parent.is_some_and(|hash| hash != segment.predecessor_hash) {
            return Err(Error::Invalid("catalog segment parent mismatch"));
        }
        parent = Some(&segment.end_hash);
        expected_start = segment.end_height + 1; // validated <= u32::MAX
    }
    if catalog.catalog_sha256 != catalog_hash(catalog)? {
        return Err(Error::Invalid("catalog checksum mismatch"));
    }
    Ok(())
}

fn read_catalog(root: &Path) -> Result<Catalog> {
    check_directory(root)?;
    let mut file = regular_file(&root.join(CATALOG_NAME))?;
    if file.metadata()?.len() > MAX_CATALOG_BYTES {
        return Err(Error::Limit("catalog bytes"));
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_CATALOG_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_CATALOG_BYTES {
        return Err(Error::Limit("catalog grew while reading"));
    }
    let catalog: Catalog = serde_json::from_slice(&bytes)?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

#[cfg(all(test, unix))]
fn reference_for(root: &Path, directory: &str) -> Result<(SegmentReference, Store)> {
    reference_for_with_budget(root, directory, SEGMENT_INDEX_BYTES)
}

fn reference_for_with_budget(
    root: &Path,
    directory: &str,
    budget: usize,
) -> Result<(SegmentReference, Store)> {
    #[cfg(feature = "admission-profile")]
    let manifest_phase = crate::profiling::Phase::new("reference_manifest");
    let path = segment_path(root, directory)?;
    let mut file = regular_file(&path.join(MANIFEST_NAME))?;
    if file.metadata()?.len() > MAX_MANIFEST_BYTES {
        return Err(Error::Limit("segment manifest bytes"));
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(Error::Limit("segment manifest grew while reading"));
    }
    let observed: Manifest = serde_json::from_slice(&bytes)?;
    #[cfg(feature = "admission-profile")]
    drop(manifest_phase);
    let store = Store::open_with_index_budget(&path, budget)?; // Full integrity pass even when index budget is zero.
    let manifest = store.manifest();
    if *manifest != observed {
        return Err(Error::Invalid("segment manifest changed during admission"));
    }
    let reference = SegmentReference {
        directory: directory.to_owned(),
        dataset_id: manifest.dataset_id.clone(),
        start_height: manifest.start_height,
        end_height: manifest.end_height,
        predecessor_hash: manifest.predecessor_hash.clone(),
        end_hash: manifest.end_hash.clone(),
        manifest_sha256: profile_phase!("manifest_hash", sha256(&bytes)),
    };
    Ok((reference, store))
}

fn check_segment_kind(catalog: &Catalog, store: &Store) -> Result<()> {
    if store.manifest().network != catalog.network
        || store.manifest().payload_kind != catalog.payload_kind
    {
        return Err(Error::Invalid(
            "segment network or payload kind differs from archive",
        ));
    }
    Ok(())
}

/// One consistent immutable catalog revision. Refreshing produces another value
/// and does not mutate readers holding the old revision.
#[derive(Clone)]
pub struct Archive {
    root: PathBuf,
    catalog: Arc<Catalog>,
    stores: Arc<Vec<Store>>,
}

impl Archive {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        Self::load(root.as_ref(), None)
    }

    fn load(root: &Path, previous: Option<&Self>) -> Result<Self> {
        let catalog = profile_phase!("catalog", read_catalog(root))?;
        if let Some(previous) = previous {
            if catalog == *previous.catalog {
                return Ok(previous.clone());
            }
            if catalog.network != previous.catalog.network
                || catalog.payload_kind != previous.catalog.payload_kind
                || catalog.start_height != previous.catalog.start_height
                || catalog.revision < previous.catalog.revision
                || catalog.epoch < previous.catalog.epoch
                || (catalog.revision == previous.catalog.revision && catalog != *previous.catalog)
            {
                return Err(Error::Invalid(
                    "archive identity or counters changed inconsistently",
                ));
            }
            if catalog.epoch == previous.catalog.epoch
                && !catalog.segments.starts_with(&previous.catalog.segments)
            {
                return Err(Error::Invalid(
                    "same-epoch catalog must preserve the prior segment prefix",
                ));
            }
        }
        let cached: HashMap<&str, (&SegmentReference, &Store)> = previous
            .map(|archive| {
                archive
                    .catalog
                    .segments
                    .iter()
                    .zip(archive.stores.iter())
                    .map(|(reference, store)| (reference.directory.as_str(), (reference, store)))
                    .collect()
            })
            .unwrap_or_default();
        let mut stores = Vec::with_capacity(catalog.segments.len());
        // Reserve reused Arc caches first, including those later in catalog order.
        let reused_bytes: usize = catalog
            .segments
            .iter()
            .filter_map(|reference| {
                cached
                    .get(reference.directory.as_str())
                    .filter(|(old, _)| *old == reference)
                    .map(|(_, store)| store.transaction_index_bytes())
            })
            .sum();
        #[cfg(feature = "admission-profile")]
        let archive_budget = crate::profiling::archive_budget(ARCHIVE_INDEX_BYTES);
        #[cfg(not(feature = "admission-profile"))]
        let archive_budget = ARCHIVE_INDEX_BYTES;
        let mut remaining = archive_budget
            .checked_sub(reused_bytes)
            .ok_or(Error::Limit("archive transaction index bytes"))?;
        for reference in &catalog.segments {
            // Admission checks path safety even when immutable contents are cached.
            segment_path(root, &reference.directory)?;
            if let Some((old_reference, store)) = cached.get(reference.directory.as_str()) {
                if *old_reference == reference {
                    check_segment_kind(&catalog, store)?;
                    stores.push((*store).clone());
                    continue;
                }
            }
            let (observed, store) =
                reference_for_with_budget(root, &reference.directory, remaining)?;
            if observed != *reference {
                return Err(Error::Invalid(
                    "catalog reference differs from checked segment",
                ));
            }
            check_segment_kind(&catalog, &store)?;
            #[cfg(feature = "admission-profile")]
            crate::profiling::segment(&reference.directory, remaining, &store);
            remaining = remaining
                .checked_sub(store.transaction_index_bytes())
                .ok_or(Error::Limit("archive transaction index bytes"))?;
            stores.push(profile_phase!(
                "compact_manifest",
                store.compact_manifest()
            )?);
        }
        Ok(Self {
            root: root.to_path_buf(),
            catalog: Arc::new(catalog),
            stores: Arc::new(stores),
        })
    }

    /// Reuse already verified immutable segments; verify newly referenced ones.
    /// Unchanged catalog returns a cheap clone. A fresh open forces full checking.
    pub fn refresh(&self) -> Result<Self> {
        Self::load(&self.root, Some(self))
    }

    /// Offline sidecar build, excluding a concurrent archive writer. Existing files
    /// are never overwritten. Restart readers to discover newly built sidecars.
    pub fn build_transaction_disk_indexes(root: impl AsRef<Path>, max_bytes: u64) -> Result<u64> {
        if !cfg!(unix) {
            return Err(Error::UnsupportedWritePlatform);
        }
        if max_bytes == 0 || max_bytes > crate::MAX_DISK_INDEX_BYTES {
            return Err(Error::Limit("disk metadata build budget"));
        }
        let root = root.as_ref();
        check_directory(root)?;
        let lock_path = root.join(LOCK_NAME);
        let lock = regular_file(&lock_path)?;
        lock.try_lock()
            .map_err(|_| Error::Invalid("archive writer lock is held or unavailable"))?;
        let catalog = read_catalog(root)?;
        if catalog.payload_kind != FULL_KIND {
            return Err(Error::Invalid("disk metadata requires full archive"));
        }
        // Include retired/orphan directories retained by rollback. Stream the
        // inventory rather than allocating it, and reject unsafe entries.
        // Unresolved prior pending files require explicit operator inspection.
        let mut bytes = 0u64;
        check_directory(&root.join("segments"))?;
        for (ordinal, entry) in fs::read_dir(root.join("segments"))?.enumerate() {
            if ordinal >= 100_000 {
                return Err(Error::Limit("retained segment inventory count"));
            }
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| Error::Invalid("unsafe retained segment directory name"))?;
            let path = segment_path(root, &format!("segments/{name}"))?;
            match fs::symlink_metadata(path.join(crate::disk_index::PENDING)) {
                Ok(_) => {
                    return Err(Error::Invalid(
                        "pending disk metadata build requires operator inspection",
                    ))
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
            let sidecar = path.join(crate::disk_index::NAME);
            match fs::symlink_metadata(&sidecar) {
                Ok(_) => {
                    bytes = bytes
                        .checked_add(regular_file(&sidecar)?.metadata()?.len())
                        .ok_or(Error::Limit("disk metadata bytes"))?;
                    if bytes > max_bytes {
                        return Err(Error::Limit("disk metadata bytes"));
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        for reference in &catalog.segments {
            let (observed, store) = reference_for_with_budget(root, &reference.directory, 0)?;
            if observed != *reference {
                return Err(Error::Invalid(
                    "catalog reference differs from checked segment",
                ));
            }
            check_segment_kind(&catalog, &store)?;
            let sidecar = store.path.join(crate::disk_index::NAME);
            // Never replace a corrupt published index automatically.
            if fs::symlink_metadata(&sidecar).is_ok() {
                crate::disk_index::validate_existing(&store)?;
            } else {
                let size = crate::disk_index::build(&store, max_bytes - bytes)?;
                bytes = bytes
                    .checked_add(size)
                    .ok_or(Error::Limit("disk metadata bytes"))?;
                if bytes > max_bytes {
                    return Err(Error::Limit("disk metadata bytes"));
                }
            }
        }
        if read_catalog(root)? != catalog {
            return Err(Error::Invalid("catalog changed during offline index build"));
        }
        Ok(bytes)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn path(&self) -> &Path {
        &self.root
    }
    pub fn catalog(&self) -> &Catalog {
        &self.catalog
    }
    pub fn head(&self) -> Option<u64> {
        self.catalog.head()
    }
    pub fn head_hash(&self) -> Option<&str> {
        self.catalog.head_hash()
    }

    pub fn read_block(&self, height: u64) -> Result<BlockRecord> {
        self.read_range(height, height)?
            .next()
            .ok_or(Error::Invalid("missing archive block"))?
    }

    pub fn transaction_index_bytes(&self) -> usize {
        self.stores.iter().map(Store::transaction_index_bytes).sum()
    }

    pub fn transaction_metadata(&self, height: u64) -> Result<Option<Vec<TransactionMetadata>>> {
        self.store_for_height(height)?.transaction_metadata(height)
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
        self.store_for_height(start)?;
        self.store_for_height(end)?;
        let mut heights = Vec::new();
        for store in self.stores.iter().filter(|store| {
            store.manifest().end_height >= start && store.manifest().start_height <= end
        }) {
            let Some(found) = store.transaction_locations(
                txids,
                start.max(store.manifest().start_height),
                end.min(store.manifest().end_height),
            )?
            else {
                return Ok(None);
            };
            heights.extend(found);
        }
        heights.sort_unstable();
        heights.dedup();
        Ok(Some(heights))
    }

    fn store_for_height(&self, height: u64) -> Result<&Store> {
        if height < self.catalog.start_height || self.head().is_none_or(|head| height > head) {
            return Err(Error::Invalid(
                "requested height is outside archive snapshot",
            ));
        }
        let segment = self
            .catalog
            .segments
            .partition_point(|entry| entry.end_height < height);
        self.stores
            .get(segment)
            .ok_or(Error::Invalid("missing archive segment"))
    }

    /// RPC-display-order hash from the verified immutable index, with no disk I/O.
    pub fn block_hash(&self, height: u64) -> Result<String> {
        self.store_for_height(height)?.block_hash(height)
    }

    pub fn read_header(&self, height: u64) -> Result<BlockHeader> {
        self.store_for_height(height)?.read_header(height)
    }

    pub fn read_range(&self, start: u64, end: u64) -> Result<ArchiveRangeReader> {
        count(start, end, MAX_RANGE_BLOCKS)?;
        let head = self.head().ok_or(Error::Invalid("archive is empty"))?;
        if start < self.catalog.start_height || end > head {
            return Err(Error::Invalid(
                "requested range is outside archive snapshot",
            ));
        }
        let segment = self
            .catalog
            .segments
            .partition_point(|entry| entry.end_height < start);
        Ok(ArchiveRangeReader {
            archive: self.clone(),
            segment,
            cursor: start,
            end,
            current: None,
            done: false,
        })
    }
}

pub struct ArchiveRangeReader {
    archive: Archive,
    segment: usize,
    cursor: u64,
    end: u64,
    current: Option<RangeReader>,
    done: bool,
}

impl Iterator for ArchiveRangeReader {
    type Item = Result<BlockRecord>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done || self.cursor > self.end {
            return None;
        }
        loop {
            if let Some(current) = self.current.as_mut() {
                if let Some(result) = current.next() {
                    match &result {
                        Ok(record) => self.cursor = record.height + 1,
                        Err(_) => self.done = true,
                    }
                    return Some(result);
                }
                self.current = None;
                self.segment += 1;
            }
            let entry = match self.archive.catalog.segments.get(self.segment) {
                Some(entry) => entry,
                None => {
                    self.done = true;
                    return Some(Err(Error::Invalid("archive range lost a segment")));
                }
            };
            match self.archive.stores[self.segment]
                .read_range(self.cursor, self.end.min(entry.end_height))
            {
                Ok(reader) => self.current = Some(reader),
                Err(error) => {
                    self.done = true;
                    return Some(Err(error));
                }
            }
        }
    }
}

/// A cooperative exclusive writer lock is held for this value's entire lifetime.
/// Segment directories are never deleted by catalog changes or rollback.
pub struct ArchiveWriter {
    archive: Archive,
    _lock: File,
    poisoned: bool,
}

impl ArchiveWriter {
    pub fn create_or_open(root: impl AsRef<Path>, network: &str, start: u64) -> Result<Self> {
        Self::create_or_open_with_kind(root, network, start, COMPACT_KIND)
    }

    pub fn create_or_open_with_kind(
        root: impl AsRef<Path>,
        network: &str,
        start: u64,
        kind: &str,
    ) -> Result<Self> {
        if !cfg!(unix) {
            return Err(Error::UnsupportedWritePlatform);
        }
        check_network(network)?;
        check_payload_kind(kind)?;
        if start > u64::from(u32::MAX) {
            return Err(Error::Invalid("archive start must be in 0..=u32::MAX"));
        }
        let root = root.as_ref();
        match fs::create_dir(root) {
            Ok(()) => sync_directory(
                root.parent()
                    .filter(|p| !p.as_os_str().is_empty())
                    .unwrap_or(Path::new(".")),
            )?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                check_directory(root)?
            }
            Err(error) => return Err(error.into()),
        }
        let lock_path = root.join(LOCK_NAME);
        if let Ok(metadata) = fs::symlink_metadata(&lock_path) {
            if !metadata.file_type().is_file() {
                return Err(Error::Invalid("archive lock must be a regular file"));
            }
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)?;
        lock.try_lock()
            .map_err(|_| Error::Invalid("archive writer lock is held or unavailable"))?;
        let segments_path = root.join("segments");
        match fs::create_dir(&segments_path) {
            Ok(()) => sync_directory(root)?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                check_directory(&segments_path)?
            }
            Err(error) => return Err(error.into()),
        }
        let archive = if root.join(CATALOG_NAME).try_exists()? {
            let archive = Archive::open(root)?;
            if archive.catalog.network != network
                || archive.catalog.start_height != start
                || archive.catalog.payload_kind != kind
            {
                return Err(Error::Invalid(
                    "existing archive identity differs from requested configuration",
                ));
            }
            archive
        } else {
            // Do not claim an unrelated directory as a new archive.
            for item in fs::read_dir(root)? {
                let item = item?;
                let name = item.file_name();
                if name != LOCK_NAME
                    && name != "segments"
                    && name != CATALOG_PENDING
                    && name != "status.json"
                    && name != "status.pending"
                {
                    return Err(Error::Invalid(
                        "unrecognized files in unpublished archive root",
                    ));
                }
            }
            let mut catalog = Catalog {
                schema_version: 1,
                network: network.to_owned(),
                payload_kind: kind.to_owned(),
                start_height: start,
                epoch: 0,
                revision: 0,
                segments: Vec::new(),
                catalog_sha256: String::new(),
            };
            catalog.catalog_sha256 = catalog_hash(&catalog)?;
            publish_catalog(root, &catalog)?;
            Archive {
                root: root.to_path_buf(),
                catalog: Arc::new(catalog),
                stores: Arc::new(Vec::new()),
            }
        };
        Ok(Self {
            archive,
            _lock: lock,
            poisoned: false,
        })
    }

    pub fn catalog(&self) -> &Catalog {
        self.archive.catalog()
    }
    pub fn head(&self) -> Option<u64> {
        self.archive.head()
    }
    pub fn head_hash(&self) -> Option<&str> {
        self.archive.head_hash()
    }
    pub fn snapshot(&self) -> Archive {
        self.archive.clone()
    }

    pub fn append_segment(&mut self, relative_directory: &str) -> Result<Catalog> {
        self.ensure_current()?;
        let budget = ARCHIVE_INDEX_BYTES
            .checked_sub(self.archive.transaction_index_bytes())
            .ok_or(Error::Limit("archive transaction index bytes"))?;
        let (reference, store) =
            reference_for_with_budget(&self.archive.root, relative_directory, budget)?;
        check_segment_kind(&self.archive.catalog, &store)?;
        let mut catalog = (*self.archive.catalog).clone();
        catalog.revision = catalog
            .revision
            .checked_add(1)
            .ok_or(Error::Limit("catalog revision overflow"))?;
        catalog.segments.push(reference);
        catalog.catalog_sha256 = catalog_hash(&catalog)?;
        validate_catalog(&catalog)?;
        let mut stores = (*self.archive.stores).clone();
        stores.push(store.compact_manifest()?);
        self.publish(catalog.clone(), stores)?;
        Ok(catalog)
    }

    /// Drop every catalog reference whose end is beyond `height`, including a
    /// segment overlapping it. Returns the actual remaining head, not the target.
    /// `start_height - 1` explicitly empties the archive. No-op keeps counters.
    pub fn rollback_to(&mut self, height: u64) -> Result<Option<u64>> {
        self.ensure_current()?;
        if height > u64::from(u32::MAX) {
            return Err(Error::Invalid("rollback height exceeds u32"));
        }
        let retained = self
            .archive
            .catalog
            .segments
            .partition_point(|segment| segment.end_height <= height);
        if retained == self.archive.catalog.segments.len() {
            return Ok(self.head());
        }
        let mut catalog = (*self.archive.catalog).clone();
        catalog.segments.truncate(retained);
        advance_epoch(&mut catalog)?;
        catalog.catalog_sha256 = catalog_hash(&catalog)?;
        let stores = self.archive.stores[..retained].to_vec();
        self.publish(catalog, stores)?;
        Ok(self.head())
    }

    /// Explicitly invalidate reader cursors after an external reorg decision,
    /// without changing segment references. Upstream health policy is external.
    pub fn invalidate_epoch(&mut self) -> Result<Catalog> {
        self.ensure_current()?;
        let mut catalog = (*self.archive.catalog).clone();
        advance_epoch(&mut catalog)?;
        catalog.catalog_sha256 = catalog_hash(&catalog)?;
        self.publish(catalog.clone(), (*self.archive.stores).clone())?;
        Ok(catalog)
    }

    fn ensure_current(&self) -> Result<()> {
        if self.poisoned {
            return Err(Error::Poisoned);
        }
        if read_catalog(&self.archive.root)? != *self.archive.catalog {
            return Err(Error::Invalid("catalog changed outside the writer lock"));
        }
        Ok(())
    }

    fn publish(&mut self, catalog: Catalog, stores: Vec<Store>) -> Result<()> {
        validate_catalog(&catalog)?;
        if let Err(error) = publish_catalog(&self.archive.root, &catalog) {
            // Rename may already have occurred. Reopen/inspect; never retry from
            // a potentially stale in-memory revision after an ambiguous error.
            self.poisoned = true;
            return Err(error);
        }
        self.archive = Archive {
            root: self.archive.root.clone(),
            catalog: Arc::new(catalog),
            stores: Arc::new(stores),
        };
        Ok(())
    }
}

fn advance_epoch(catalog: &mut Catalog) -> Result<()> {
    catalog.epoch = catalog
        .epoch
        .checked_add(1)
        .ok_or(Error::Limit("catalog epoch overflow"))?;
    catalog.revision = catalog
        .revision
        .checked_add(1)
        .ok_or(Error::Limit("catalog revision overflow"))?;
    Ok(())
}

fn publish_catalog(root: &Path, catalog: &Catalog) -> Result<()> {
    validate_catalog(catalog)?;
    let bytes = serde_json::to_vec_pretty(catalog)?;
    if bytes.len() as u64 > MAX_CATALOG_BYTES {
        return Err(Error::Limit("catalog bytes"));
    }
    let pending = root.join(CATALOG_PENDING);
    match fs::symlink_metadata(&pending) {
        Ok(metadata) if metadata.file_type().is_file() => fs::remove_file(&pending)?,
        Ok(_) => return Err(Error::Invalid("catalog staging path is not a regular file")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    // The lifetime writer lock serializes intended replacement of catalog.json.
    fs::rename(&pending, root.join(CATALOG_NAME))?;
    sync_directory(root)?;
    Ok(())
}

#[cfg(test)]
mod catalog_limit_tests {
    use super::*;

    fn catalog_with_segments(count: usize) -> Catalog {
        let hash = "00".repeat(32);
        let mut catalog = Catalog {
            schema_version: 1,
            network: "testnet".into(),
            payload_kind: FULL_KIND.into(),
            start_height: 0,
            epoch: 0,
            revision: count as u64,
            segments: (0..count)
                .map(|height| SegmentReference {
                    directory: format!("segments/full-{height}"),
                    dataset_id: hash.clone(),
                    start_height: height as u64,
                    end_height: height as u64,
                    predecessor_hash: hash.clone(),
                    end_hash: hash.clone(),
                    manifest_sha256: hash.clone(),
                })
                .collect(),
            catalog_sha256: String::new(),
        };
        catalog.catalog_sha256 = catalog_hash(&catalog).unwrap();
        catalog
    }

    #[test]
    fn live_catalog_can_cross_old_ten_thousand_segment_boundary() {
        let catalog = catalog_with_segments(10_001);
        validate_catalog(&catalog).unwrap();
    }

    #[test]
    fn extended_catalog_still_has_explicit_count_and_byte_bounds() {
        let catalog = catalog_with_segments(MAX_SEGMENTS);
        validate_catalog(&catalog).unwrap();
        assert!(serde_json::to_vec_pretty(&catalog).unwrap().len() as u64 <= MAX_CATALOG_BYTES);
        assert!(matches!(
            validate_catalog(&catalog_with_segments(MAX_SEGMENTS + 1)),
            Err(Error::Limit("catalog segment count"))
        ));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn hash(height: u64) -> Vec<u8> {
        let mut hash = vec![0; 32];
        hash[..8].copy_from_slice(&height.to_le_bytes());
        hash
    }

    fn make_segment(
        root: &Path,
        name: &str,
        start: u64,
        end: u64,
        bad_parent: bool,
        full: bool,
    ) -> String {
        let relative = format!("segments/{name}");
        let predecessor = if bad_parent {
            hash(999)
        } else {
            hash(start - 1)
        };
        let mut writer = if full {
            StoreWriter::create_full(
                root.join(&relative),
                "regtest",
                start,
                end,
                &display_hash(&predecessor).unwrap(),
                &display_hash(&hash(end)).unwrap(),
            )
            .unwrap()
        } else {
            StoreWriter::create(
                root.join(&relative),
                "regtest",
                start,
                end,
                &display_hash(&predecessor).unwrap(),
                &display_hash(&hash(end)).unwrap(),
            )
            .unwrap()
        };
        for height in start..=end {
            let previous = if height == start {
                predecessor.clone()
            } else {
                hash(height - 1)
            };
            let payload = if full {
                prep_proto::prep::FullBlock {
                    height,
                    hash: hash(height),
                    prev_hash: previous.clone(),
                    time: 1,
                    raw_block: vec![1, 2, 3],
                    decoded_json: "{\"synthetic\":true}".into(),
                }
                .encode_to_vec()
            } else {
                CompactBlock {
                    height,
                    hash: hash(height),
                    prev_hash: previous.clone(),
                    ..Default::default()
                }
                .encode_to_vec()
            };
            writer
                .push(BlockRecord {
                    height,
                    hash: hash(height),
                    prev_hash: previous,
                    payload,
                })
                .unwrap();
        }
        writer.finish().unwrap();
        relative
    }

    #[test]
    fn empty_archive_is_explicit_and_reopens() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let writer = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
        assert_eq!(writer.head(), None);
        assert_eq!(writer.catalog().revision, 0);
        assert!(writer.snapshot().read_block(1).is_err());
        drop(writer);
        assert_eq!(Archive::open(root).unwrap().head(), None);
    }

    #[test]
    fn append_cross_segment_reads_and_restart() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
        for (name, start, end) in [("first", 1, 2), ("second", 3, 4)] {
            let segment = make_segment(&root, name, start, end, false, false);
            writer.append_segment(&segment).unwrap();
        }
        assert_eq!(writer.catalog().revision, 2);
        assert_eq!(writer.catalog().epoch, 0);
        let snapshot = writer.snapshot();
        drop(writer);
        assert_eq!(
            snapshot
                .read_range(2, 4)
                .unwrap()
                .map(|item| item.unwrap().height)
                .collect::<Vec<_>>(),
            [2, 3, 4]
        );
        let reopened = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
        assert_eq!(reopened.head(), Some(4));
        assert_eq!(reopened.catalog().revision, 2);
    }

    #[test]
    fn exclusive_writer_lock_released_on_drop() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let writer = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
        assert!(ArchiveWriter::create_or_open(&root, "regtest", 1).is_err());
        drop(writer);
        assert!(ArchiveWriter::create_or_open(root, "regtest", 1).is_ok());
    }

    #[test]
    fn rollback_removes_overlap_invalidates_epoch_and_retains_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
        for (name, start, end) in [("a", 1, 2), ("b", 3, 4)] {
            writer
                .append_segment(&make_segment(&root, name, start, end, false, false))
                .unwrap();
        }
        let old = writer.snapshot();
        assert_eq!(writer.rollback_to(3).unwrap(), Some(2));
        assert_eq!((writer.catalog().epoch, writer.catalog().revision), (1, 3));
        assert!(root.join("segments/b/segment.bin").exists());
        assert_eq!(old.read_block(4).unwrap().height, 4);
        assert!(old.refresh().unwrap().read_block(4).is_err());
        assert_eq!(writer.rollback_to(0).unwrap(), None);
        assert_eq!((writer.catalog().epoch, writer.catalog().revision), (2, 4));
        assert_eq!(writer.rollback_to(0).unwrap(), None);
        assert_eq!(writer.catalog().revision, 4);
    }

    #[test]
    fn invalid_link_or_gap_cannot_publish() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
        writer
            .append_segment(&make_segment(&root, "first", 1, 2, false, false))
            .unwrap();
        for (name, start, end, bad) in [("wrong-parent", 3, 4, true), ("gap", 4, 5, false)] {
            let segment = make_segment(&root, name, start, end, bad, false);
            assert!(writer.append_segment(&segment).is_err());
            assert_eq!(Archive::open(&root).unwrap().head(), Some(2));
        }
    }

    #[test]
    fn partial_unreferenced_directories_are_ignored() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let writer = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
        fs::create_dir(root.join("segments/partial")).unwrap();
        fs::write(root.join("segments/partial/segment.bin"), b"partial").unwrap();
        drop(writer);
        assert_eq!(Archive::open(&root).unwrap().head(), None);
    }

    #[test]
    fn corrupt_catalog_checksum_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let writer = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
        let mut catalog = writer.catalog().clone();
        drop(writer);
        catalog.revision = 1;
        fs::write(
            root.join(CATALOG_NAME),
            serde_json::to_vec(&catalog).unwrap(),
        )
        .unwrap();
        assert!(Archive::open(root).is_err());
    }

    #[test]
    fn unsafe_paths_and_symlinks_are_rejected() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
        for name in [
            "../other",
            "segments/../other",
            "segments/a/b",
            "segments/a.b",
            "segments/",
            "/absolute",
        ] {
            assert!(writer.append_segment(name).is_err());
        }
        let other = temp.path().join("other");
        fs::create_dir(&other).unwrap();
        symlink(other, root.join("segments/link")).unwrap();
        assert!(writer.append_segment("segments/link").is_err());
    }

    #[test]
    fn refresh_preserves_old_snapshot_and_reuses_immutable_cache() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
        writer
            .append_segment(&make_segment(&root, "a", 1, 2, false, false))
            .unwrap();
        let old = writer.snapshot();
        writer
            .append_segment(&make_segment(&root, "b", 3, 4, false, false))
            .unwrap();
        let fresh = old.refresh().unwrap();
        assert_eq!(old.head(), Some(2));
        assert_eq!(fresh.head(), Some(4));
        assert!(Arc::ptr_eq(
            &old.stores[0].manifest,
            &fresh.stores[0].manifest
        ));
    }

    #[test]
    fn same_epoch_refresh_rejects_truncated_or_replaced_history() {
        for replace in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("archive");
            let mut writer = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
            for (name, start, end) in [("a", 1, 2), ("b", 3, 4)] {
                writer
                    .append_segment(&make_segment(&root, name, start, end, false, false))
                    .unwrap();
            }
            let pinned = writer.snapshot();
            let mut changed = writer.catalog().clone();
            if replace {
                let alternate = make_segment(&root, "replacement", 3, 4, false, false);
                changed.segments[1] = reference_for(&root, &alternate).unwrap().0;
            } else {
                changed.segments.pop();
            }
            changed.revision += 1;
            changed.catalog_sha256 = catalog_hash(&changed).unwrap();
            fs::write(
                root.join(CATALOG_NAME),
                serde_json::to_vec(&changed).unwrap(),
            )
            .unwrap();
            // The replacement has valid content checksums; its transition is
            // still invalid because existing cursors depend on the same epoch.
            assert!(matches!(
                pinned.refresh(),
                Err(Error::Invalid(
                    "same-epoch catalog must preserve the prior segment prefix"
                ))
            ));
        }
    }

    #[test]
    fn payload_kinds_cannot_be_mixed() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 1, FULL_KIND).unwrap();
        let compact = make_segment(&root, "compact", 1, 2, false, false);
        assert!(writer.append_segment(&compact).is_err());
        let full = make_segment(&root, "full", 1, 2, false, true);
        writer.append_segment(&full).unwrap();
        assert_eq!(writer.catalog().payload_kind, FULL_KIND);
        let decoded = prep_proto::prep::FullBlock::decode(
            writer.snapshot().read_block(1).unwrap().payload.as_slice(),
        )
        .unwrap();
        assert_eq!(decoded.raw_block, [1, 2, 3]);
        drop(writer);
        assert!(ArchiveWriter::create_or_open(&root, "regtest", 1).is_err());
    }

    #[test]
    fn header_and_hash_lookup_route_across_segment_boundaries() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 1, FULL_KIND).unwrap();
        for (name, start, end) in [("a", 1, 2), ("b", 3, 4)] {
            writer
                .append_segment(&make_segment(&root, name, start, end, false, true))
                .unwrap();
        }
        let archive = writer.snapshot();
        for height in 1..=4 {
            assert_eq!(
                archive.read_header(height).unwrap(),
                BlockHeader {
                    height,
                    hash: hash(height),
                    prev_hash: hash(height - 1),
                    time: 1
                }
            );
            assert_eq!(
                archive.block_hash(height).unwrap(),
                display_hash(&hash(height)).unwrap()
            );
        }
        assert!(archive.read_header(0).is_err());
        assert!(archive.read_header(5).is_err());
        assert!(archive.block_hash(5).is_err());
    }

    #[test]
    fn offline_disk_builder_reserves_existing_files_and_excludes_writer() {
        let _guard = crate::disk_index::TEST_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 1, FULL_KIND).unwrap();
        for (name, height) in [("a", 1), ("b", 2)] {
            writer
                .append_segment(&indexed_segment(
                    &root,
                    name,
                    height,
                    height,
                    &"ab".repeat(32),
                ))
                .unwrap();
        }
        assert!(Archive::build_transaction_disk_indexes(&root, 212).is_err());
        drop(writer);
        let second = Store::open_with_index_budget(root.join("segments/b"), 0).unwrap();
        assert_eq!(crate::disk_index::build(&second, 106).unwrap(), 106);
        // Reserve b before writing a even though b is later in catalog order.
        assert!(Archive::build_transaction_disk_indexes(&root, 105).is_err());
        assert!(!root.join("segments/a/transactions-v1.pending").exists());
        assert_eq!(
            Archive::build_transaction_disk_indexes(&root, 212).unwrap(),
            212
        );
        assert_eq!(
            Archive::build_transaction_disk_indexes(&root, 212).unwrap(),
            212
        );
        let fresh = Archive::open(&root).unwrap();
        assert!(fresh.stores.iter().all(|store| store.disk_index.is_some()));
        assert_eq!(
            fresh.transaction_locations(&[[0xab; 32]], 1, 2).unwrap(),
            None
        );
        fs::write(
            root.join("segments/b/transactions-v1.pending"),
            b"interrupted",
        )
        .unwrap();
        assert!(Archive::build_transaction_disk_indexes(&root, 212).is_err());
        assert!(Archive::build_transaction_disk_indexes(&root, 0).is_err());
        assert!(
            Archive::build_transaction_disk_indexes(&root, crate::MAX_DISK_INDEX_BYTES + 1)
                .is_err()
        );
    }

    #[test]
    fn offline_disk_budget_includes_retired_sidecars_and_orphan_pending_files() {
        let _guard = crate::disk_index::TEST_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 1, FULL_KIND).unwrap();
        for (name, height) in [("a", 1), ("b", 2)] {
            writer
                .append_segment(&indexed_segment(
                    &root,
                    name,
                    height,
                    height,
                    &"ab".repeat(32),
                ))
                .unwrap();
        }
        drop(writer);
        assert_eq!(
            Archive::build_transaction_disk_indexes(&root, 212).unwrap(),
            212
        );
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 1, FULL_KIND).unwrap();
        writer.rollback_to(1).unwrap();
        writer
            .append_segment(&indexed_segment(&root, "c", 2, 2, &"cd".repeat(32)))
            .unwrap();
        drop(writer);
        // Retired b consumes 106 bytes; only 40 remain for c under this cap.
        assert!(Archive::build_transaction_disk_indexes(&root, 252).is_err());
        assert!(!root.join("segments/c/transactions-v1.bin").exists());
        // Build interruption is retained, so the next build rejects it before writing.
        assert!(root.join("segments/c/transactions-v1.pending").exists());
        fs::remove_file(root.join("segments/c/transactions-v1.pending")).unwrap();
        assert_eq!(
            Archive::build_transaction_disk_indexes(&root, 318).unwrap(),
            318
        );
        fs::create_dir(root.join("segments/orphan")).unwrap();
        fs::write(
            root.join("segments/orphan/transactions-v1.pending"),
            b"partial",
        )
        .unwrap();
        assert!(Archive::build_transaction_disk_indexes(&root, 318).is_err());
    }

    #[test]
    fn disk_snapshots_survive_rollback_replacement_and_reuse_unchanged_segments() {
        let _guard = crate::disk_index::TEST_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 1, FULL_KIND).unwrap();
        for (name, height) in [("a", 1), ("b", 2)] {
            writer
                .append_segment(&indexed_segment(
                    &root,
                    name,
                    height,
                    height,
                    &"ab".repeat(32),
                ))
                .unwrap();
        }
        drop(writer);
        Archive::build_transaction_disk_indexes(&root, 212).unwrap();
        let old = Archive::open(&root).unwrap();
        assert!(old.stores.iter().all(|store| store.disk_index.is_some()));
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 1, FULL_KIND).unwrap();
        writer.rollback_to(1).unwrap();
        writer
            .append_segment(&indexed_segment(&root, "c", 2, 2, &"cd".repeat(32)))
            .unwrap();
        writer
            .append_segment(&indexed_segment(&root, "d", 3, 3, &"ef".repeat(32)))
            .unwrap();
        drop(writer);
        Archive::build_transaction_disk_indexes(&root, 424).unwrap();
        let current = old.refresh().unwrap();
        assert_eq!(old.head(), Some(2));
        assert_eq!(current.head(), Some(3));
        assert!(current.catalog().epoch > old.catalog().epoch);
        assert_eq!(
            old.transaction_metadata(2).unwrap().unwrap()[0].txid,
            [0xab; 32]
        );
        assert_eq!(
            current.transaction_metadata(2).unwrap().unwrap()[0].txid,
            [0xcd; 32]
        );
        assert_eq!(
            current.transaction_metadata(3).unwrap().unwrap()[0].txid,
            [0xef; 32]
        );
        assert!(old.transaction_metadata(3).is_err());
        assert!(current
            .stores
            .iter()
            .all(|store| store.disk_index.is_some()));
        assert!(Arc::ptr_eq(
            old.stores[0].disk_index.as_ref().unwrap(),
            current.stores[0].disk_index.as_ref().unwrap(),
        ));
        assert!(old.transaction_index_bytes() <= ARCHIVE_INDEX_BYTES);
        assert!(current.transaction_index_bytes() <= ARCHIVE_INDEX_BYTES);
    }

    fn indexed_segment(root: &Path, name: &str, start: u64, end: u64, txid: &str) -> String {
        let relative = format!("segments/{name}");
        let mut writer = StoreWriter::create_full(
            root.join(&relative),
            "regtest",
            start,
            end,
            &display_hash(&hash(start - 1)).unwrap(),
            &display_hash(&hash(end)).unwrap(),
        )
        .unwrap();
        for height in start..=end {
            let payload = prep_proto::prep::FullBlock { height, hash: hash(height), prev_hash: hash(height - 1), time: 1,
                raw_block: vec![1, 2, 3], decoded_json: format!(r#"{{"tx":[{{"txid":"{txid}","hex":"0102","version":1,"locktime":0,"vin":[{{}}],"vout":[{{}}]}}]}}"#) }.encode_to_vec();
            writer
                .push(BlockRecord {
                    height,
                    hash: hash(height),
                    prev_hash: hash(height - 1),
                    payload,
                })
                .unwrap();
        }
        writer.finish().unwrap();
        relative
    }

    #[cfg(feature = "admission-profile")]
    #[test]
    fn profiling_budget_preserves_integrity_and_payloads() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 1, FULL_KIND).unwrap();
        writer
            .append_segment(&indexed_segment(&root, "a", 1, 2, &"ab".repeat(32)))
            .unwrap();
        drop(writer);
        let (normal, profile) = crate::profiling::open(&root, None).unwrap();
        let (zero, disabled) = crate::profiling::open(&root, Some(0)).unwrap();
        assert!(normal.transaction_index_bytes() > 0);
        assert_eq!(zero.transaction_index_bytes(), 0);
        assert_eq!(disabled.archive_budget_bytes, 0);
        assert_eq!(profile.phases["integrity_decode"].calls, 2);
        assert_eq!(profile.phases["optional_metadata_build"].calls, 2);
        assert!(!disabled.phases.contains_key("optional_metadata_build"));
        assert!(profile.phases.values().map(|p| p.ns).sum::<u128>() <= profile.admission_ns);
        for height in 1..=2 {
            assert_eq!(
                normal.read_block(height).unwrap(),
                zero.read_block(height).unwrap()
            );
            assert_eq!(zero.transaction_metadata(height).unwrap(), None);
        }
        // The override ends with the profiling scope; the ordinary open retains its cap.
        assert!(Archive::open(&root).unwrap().transaction_index_bytes() > 0);
        assert!(crate::profiling::open(&root, Some(ARCHIVE_INDEX_BYTES + 1)).is_err());
        let path = root.join("segments/a/segment.bin");
        let original_mode = fs::metadata(&path).unwrap().permissions().mode();
        fs::set_permissions(&path, fs::Permissions::from_mode(original_mode | 0o200)).unwrap();
        let mut bytes = fs::read(&path).unwrap();
        *bytes.last_mut().unwrap() ^= 1;
        fs::write(path, bytes).unwrap();
        assert!(crate::profiling::open(&root, Some(0)).is_err());
        // Error cleanup must not leak a thread-local profiling override either.
        assert!(crate::profiling::open(&root, None).is_err());
    }

    #[test]
    fn metadata_cache_is_shared_across_append_refresh_and_replaced_after_rollback() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 1, FULL_KIND).unwrap();
        writer
            .append_segment(&indexed_segment(&root, "a", 1, 2, &"ab".repeat(32)))
            .unwrap();
        let old = writer.snapshot();
        writer
            .append_segment(&indexed_segment(&root, "b", 3, 4, &"ab".repeat(32)))
            .unwrap();
        let fresh = old.refresh().unwrap();
        assert!(Arc::ptr_eq(
            old.stores[0].transaction_index.as_ref().unwrap(),
            fresh.stores[0].transaction_index.as_ref().unwrap()
        ));
        assert_eq!(
            fresh.transaction_locations(&[[0xab; 32]], 1, 4).unwrap(),
            Some(vec![1, 2, 3, 4])
        );
        assert!(fresh.transaction_index_bytes() <= ARCHIVE_INDEX_BYTES);
        writer.rollback_to(2).unwrap();
        writer
            .append_segment(&indexed_segment(
                &root,
                "replacement",
                3,
                4,
                &"cd".repeat(32),
            ))
            .unwrap();
        let replaced = fresh.refresh().unwrap();
        assert_eq!(
            replaced.transaction_locations(&[[0xab; 32]], 1, 4).unwrap(),
            Some(vec![1, 2])
        );
        assert_eq!(
            replaced.transaction_locations(&[[0xcd; 32]], 1, 4).unwrap(),
            Some(vec![3, 4])
        );
        assert_eq!(
            fresh.transaction_locations(&[[0xab; 32]], 1, 4).unwrap(),
            Some(vec![1, 2, 3, 4])
        );
        assert_eq!(
            replaced.transaction_metadata(3).unwrap().unwrap()[0].txid,
            [0xcd; 32]
        );
        assert!(replaced
            .transaction_locations(&[[0; 32]; 129], 1, 4)
            .is_err());
        assert!(replaced.transaction_locations(&[], 1, 1001).is_err());
    }

    #[test]
    fn one_unindexed_overlap_requires_fallback_even_for_absent_or_empty_ids() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(&root, "regtest", 1, FULL_KIND).unwrap();
        writer
            .append_segment(&indexed_segment(&root, "a", 1, 2, &"ab".repeat(32)))
            .unwrap();
        writer
            .append_segment(&make_segment(&root, "legacy", 3, 4, false, true))
            .unwrap();
        let archive = writer.snapshot();
        assert_eq!(
            archive.transaction_locations(&[[0; 32]], 1, 2).unwrap(),
            Some(vec![])
        );
        assert_eq!(
            archive.transaction_locations(&[[0; 32]], 1, 4).unwrap(),
            None
        );
        assert_eq!(archive.transaction_locations(&[], 1, 4).unwrap(), None);
        assert_eq!(archive.transaction_metadata(3).unwrap(), None);
        assert!(archive.read_block(3).is_ok());
    }
}
