//! Lossless catalog reduction under the archive's existing exclusive writer lock.
use super::*;

/// Physical layout changes invalidate source cursors, not the canonical chain.
/// Source directories are retained: snapshots open their payloads lazily by path.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ConsolidationReport {
    pub start_height: u64,
    pub end_height: u64,
    pub blocks: u64,
    pub previous_segments: usize,
    pub current_segments: usize,
    pub output_directory: String,
    pub retired_directories: Vec<String>,
    pub output_bytes: u64,
    pub logical_sha256: String,
    pub epoch: u64,
    pub revision: u64,
}

impl Archive {
    /// Stored payload bytes only. This neither reads files nor includes manifests.
    pub fn segment_stored_bytes(&self, index: usize) -> Option<u64> {
        self.stores
            .get(index)
            .map(|store| store.manifest.segment_bytes)
    }
}

impl ArchiveWriter {
    /// Open an already published archive without creating or claiming any path.
    /// The exclusive writer lock is acquired before its single full admission.
    pub fn open_existing(root: impl AsRef<Path>) -> Result<Self> {
        if !cfg!(unix) {
            return Err(Error::UnsupportedWritePlatform);
        }
        let root = root.as_ref();
        check_directory(root)?;
        check_directory(&root.join("segments"))?;
        let lock = regular_file(&root.join(LOCK_NAME))?;
        lock.try_lock()
            .map_err(|_| Error::Invalid("archive writer lock is held or unavailable"))?;
        Ok(Self {
            archive: Archive::open(root)?,
            _lock: lock,
            poisoned: false,
        })
    }

    /// A cooperative writer can reject a new segment before fetching/finalizing it.
    /// Publication still validates the full prospective catalog and byte ceiling.
    pub fn remaining_segment_slots(&self) -> usize {
        MAX_SEGMENTS.saturating_sub(self.catalog().segments.len())
    }

    pub fn catalog_serialized_bytes(&self) -> Result<u64> {
        Ok(serde_json::to_vec_pretty(self.catalog())?.len() as u64)
    }

    /// Coalesce contiguous full-data references into one newly owned immutable
    /// segment. Every decoded payload/header is compared before atomic catalog
    /// publication. No old/pending/orphan directory is overwritten or removed.
    ///
    /// The caller must reserve `limits.max_segment_bytes + max_manifest_bytes`
    /// of extra disk before calling. Their sum is itself bounded to 256 MiB.
    /// A failure can leave a newly created unpublished directory for inspection;
    /// the catalog remains unchanged except after an ambiguous publication error,
    /// which poisons this writer just like append. Retry only after reopening.
    pub fn consolidate_segments(
        &mut self,
        first_segment: usize,
        segment_count: usize,
        output_directory: &str,
        limits: StoreLimits,
    ) -> Result<ConsolidationReport> {
        self.ensure_current()?;
        let limits = limits.validate()?;
        if limits
            .max_segment_bytes
            .checked_add(limits.max_manifest_bytes)
            .is_none_or(|bytes| bytes > MAX_SEGMENT_BYTES)
        {
            return Err(Error::Limit("consolidation output byte reserve"));
        }
        let (last_segment, start, end) = self.consolidation_bounds(first_segment, segment_count)?;
        count(start, end, limits.max_blocks)?;
        let path = new_segment_path(&self.archive.root, output_directory)?;
        let selected = &self.catalog().segments[first_segment..last_segment];
        let mut output = StoreWriter::create_full_with_limits(
            &path,
            &self.catalog().network,
            start,
            end,
            &selected[0].predecessor_hash,
            &selected.last().unwrap().end_hash,
            limits,
        )?
        .with_compression()?;
        for from in (start..=end).step_by(1000) {
            for record in self.archive.read_range(from, end.min(from + 999))? {
                output.push(record?)?;
            }
        }
        output.finish()?;
        self.publish_consolidation(first_segment, segment_count, output_directory)
    }

    fn consolidation_bounds(
        &self,
        first_segment: usize,
        segment_count: usize,
    ) -> Result<(usize, u64, u64)> {
        if self.catalog().payload_kind != FULL_KIND {
            return Err(Error::Invalid("consolidation requires full archive"));
        }
        let last = first_segment
            .checked_add(segment_count)
            .ok_or(Error::Invalid("consolidation segment range overflow"))?;
        if segment_count < 2 || last > self.catalog().segments.len() {
            return Err(Error::Invalid("invalid consolidation segment range"));
        }
        let selected = &self.catalog().segments[first_segment..last];
        Ok((
            last,
            selected[0].start_height,
            selected.last().unwrap().end_height,
        ))
    }

    fn publish_consolidation(
        &mut self,
        first_segment: usize,
        segment_count: usize,
        output_directory: &str,
    ) -> Result<ConsolidationReport> {
        self.ensure_current()?;
        let (last_segment, start, end) = self.consolidation_bounds(first_segment, segment_count)?;
        if self
            .catalog()
            .segments
            .iter()
            .any(|r| r.directory == output_directory)
        {
            return Err(Error::Invalid("consolidation output is already referenced"));
        }
        let retained_bytes: usize = self.archive.stores[..first_segment]
            .iter()
            .chain(self.archive.stores[last_segment..].iter())
            .map(Store::transaction_index_bytes)
            .sum();
        let budget = ARCHIVE_INDEX_BYTES
            .checked_sub(retained_bytes)
            .ok_or(Error::Limit("archive transaction index bytes"))?;
        let (reference, output) =
            reference_for_with_budget(&self.archive.root, output_directory, budget)?;
        check_segment_kind(self.catalog(), &output)?;
        let selected = &self.catalog().segments[first_segment..last_segment];
        if reference.start_height != start
            || reference.end_height != end
            || reference.predecessor_hash != selected[0].predecessor_hash
            || reference.end_hash != selected.last().unwrap().end_hash
        {
            return Err(Error::Invalid("consolidation bounds or anchors changed"));
        }
        let mut logical = Sha256::new();
        let mut blocks = 0u64;
        for from in (start..=end).step_by(1000) {
            let through = end.min(from + 999);
            let mut source = self.archive.read_range(from, through)?;
            let mut destination = output.read_range(from, through)?;
            loop {
                match (source.next(), destination.next()) {
                    (None, None) => break,
                    (Some(source), Some(destination)) => {
                        let source = source?;
                        if source != destination? {
                            return Err(Error::Invalid("consolidation logical record changed"));
                        }
                        logical.update(source.height.to_le_bytes());
                        logical.update((source.payload.len() as u64).to_le_bytes());
                        logical.update(&source.payload);
                        blocks += 1;
                    }
                    _ => return Err(Error::Invalid("consolidation record count changed")),
                }
            }
        }
        if blocks != end - start + 1 {
            return Err(Error::Invalid("consolidation record count changed"));
        }
        let output_path = segment_path(&self.archive.root, output_directory)?;
        let output_bytes = regular_file(&output_path.join(SEGMENT_NAME))?
            .metadata()?
            .len()
            + regular_file(&output_path.join(MANIFEST_NAME))?
                .metadata()?
                .len();
        let retired_directories = selected.iter().map(|r| r.directory.clone()).collect();
        let previous_segments = self.catalog().segments.len();
        let mut catalog = self.catalog().clone();
        catalog
            .segments
            .splice(first_segment..last_segment, [reference]);
        // Refresh's same-epoch prefix invariant must not mistake regrouping for
        // append. Do not roll back/remove any block or fabricate source status.
        advance_epoch(&mut catalog)?;
        catalog.catalog_sha256 = catalog_hash(&catalog)?;
        let mut stores = (*self.archive.stores).clone();
        stores.splice(first_segment..last_segment, [output.compact_manifest()?]);
        self.publish(catalog, stores)?;
        Ok(ConsolidationReport {
            start_height: start,
            end_height: end,
            blocks,
            previous_segments,
            current_segments: self.catalog().segments.len(),
            output_directory: output_directory.to_owned(),
            retired_directories,
            output_bytes,
            logical_sha256: hex::encode(logical.finalize()),
            epoch: self.catalog().epoch,
            revision: self.catalog().revision,
        })
    }
}

fn new_segment_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let name = relative
        .strip_prefix("segments/")
        .ok_or(Error::Invalid("segment directory must be under segments/"))?;
    if name.is_empty()
        || name.len() > 128
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(Error::Invalid("unsafe segment directory name"));
    }
    check_directory(root)?;
    check_directory(&root.join("segments"))?;
    let path = root.join(relative);
    // No-clobber creation in StoreWriter remains authoritative for races.
    match fs::symlink_metadata(&path) {
        Ok(_) => Err(Error::Invalid("consolidation output already exists")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(path),
        Err(e) => Err(e.into()),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn limits() -> StoreLimits {
        StoreLimits {
            max_block_bytes: MAX_FULL_BLOCK_BYTES,
            max_segment_bytes: 1024 * 1024,
            max_manifest_bytes: 1024 * 1024,
            max_blocks: 1000,
            ..StoreLimits::default()
        }
    }

    fn record(height: u64, value: &str) -> BlockRecord {
        let hash = vec![height as u8 + 1; 32];
        let prev_hash = vec![height as u8; 32];
        BlockRecord {
            height,
            hash: hash.clone(),
            prev_hash: prev_hash.clone(),
            payload: prep_proto::prep::FullBlock {
                height,
                hash,
                prev_hash,
                time: 123 + height,
                raw_block: vec![1, 2, 3],
                decoded_json: format!(
                    r#"{{"value":"{value}","tx":[{{"txid":"{}","hex":"0102","version":1,"locktime":0,"vin":[{{}}],"vout":[{{}}]}}]}}"#,
                    hex::encode([height as u8 + 1; 32])
                ),
            }
            .encode_to_vec(),
        }
    }

    fn part(root: &Path, name: &str, start: u64, end: u64, value: &str) -> String {
        let relative = format!("segments/{name}");
        let mut writer = StoreWriter::create_full(
            root.join(&relative),
            "regtest",
            start,
            end,
            &display_hash(&[start as u8; 32]).unwrap(),
            &display_hash(&[end as u8 + 1; 32]).unwrap(),
        )
        .unwrap();
        for height in start..=end {
            writer.push(record(height, value)).unwrap();
        }
        writer.finish().unwrap();
        relative
    }

    fn populate(root: &Path) -> ArchiveWriter {
        let mut archive =
            ArchiveWriter::create_or_open_with_kind(root, "regtest", 0, FULL_KIND).unwrap();
        for height in 0..=4 {
            let name = part(
                root,
                &format!("source-{height}"),
                height,
                height,
                "original",
            );
            archive.append_segment(&name).unwrap();
        }
        archive
    }

    #[test]
    fn consolidation_preserves_every_record_old_readers_and_restart() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer = populate(&root);
        let old = writer.snapshot();
        let old_catalog = old.catalog().clone();
        let report = writer
            .consolidate_segments(1, 3, "segments/merged", limits())
            .unwrap();
        assert_eq!((report.previous_segments, report.current_segments), (5, 3));
        assert_eq!(
            (report.start_height, report.end_height, report.blocks),
            (1, 3, 3)
        );
        assert_eq!(
            report.retired_directories,
            [
                "segments/source-1",
                "segments/source-2",
                "segments/source-3"
            ]
        );
        assert_eq!(report.epoch, old_catalog.epoch + 1);
        assert_eq!(report.revision, old_catalog.revision + 1);
        assert!(report.output_bytes <= limits().max_segment_bytes + limits().max_manifest_bytes);
        let mut digest = Sha256::new();
        for height in 1..=3 {
            let record = record(height, "original");
            digest.update(height.to_le_bytes());
            digest.update((record.payload.len() as u64).to_le_bytes());
            digest.update(record.payload);
        }
        assert_eq!(report.logical_sha256, hex::encode(digest.finalize()));
        let refreshed = old.refresh().unwrap();
        assert_eq!(old.catalog(), &old_catalog);
        for height in 0..=4 {
            // Fresh lazy reads from the retired source paths still work.
            assert_eq!(old.read_block(height).unwrap(), record(height, "original"));
            assert_eq!(
                refreshed.read_block(height).unwrap(),
                record(height, "original")
            );
            assert_eq!(
                old.read_header(height).unwrap(),
                refreshed.read_header(height).unwrap()
            );
            assert_eq!(
                old.block_hash(height).unwrap(),
                refreshed.block_hash(height).unwrap()
            );
            let original_metadata = old.transaction_metadata(height).unwrap().unwrap();
            assert_eq!(original_metadata.len(), 1);
            assert_eq!(
                Some(original_metadata),
                refreshed.transaction_metadata(height).unwrap()
            );
        }
        assert_eq!(
            old.transaction_locations(&[[3; 32]], 0, 4).unwrap(),
            Some(vec![2])
        );
        assert_eq!(
            refreshed.transaction_locations(&[[3; 32]], 0, 4).unwrap(),
            Some(vec![2])
        );
        assert_eq!(refreshed.head(), old.head());
        assert_eq!(refreshed.head_hash(), old.head_hash());
        assert_eq!(writer.remaining_segment_slots(), MAX_SEGMENTS - 3);
        assert_eq!(
            writer.catalog_serialized_bytes().unwrap(),
            fs::metadata(root.join(CATALOG_NAME)).unwrap().len()
        );
        assert!(ArchiveWriter::open_existing(&root).is_err());
        drop(writer);
        let mut restarted = ArchiveWriter::open_existing(&root).unwrap();
        let next = part(&root, "next", 5, 5, "next");
        restarted.append_segment(&next).unwrap();
        assert_eq!(restarted.head(), Some(5));
        assert_eq!(
            restarted.snapshot().read_block(5).unwrap(),
            record(5, "next")
        );
    }

    #[test]
    fn opening_existing_never_claims_missing_or_unpublished_directories() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing");
        assert!(ArchiveWriter::open_existing(&missing).is_err());
        assert!(!missing.exists());
        fs::create_dir(&missing).unwrap();
        assert!(ArchiveWriter::open_existing(&missing).is_err());
        assert_eq!(fs::read_dir(missing).unwrap().count(), 0);
    }

    #[test]
    fn symlink_outputs_and_manifest_budget_failure_preserve_catalog() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer = populate(&root);
        let before = fs::read(root.join(CATALOG_NAME)).unwrap();
        let unrelated = temp.path().join("unrelated");
        fs::create_dir(&unrelated).unwrap();
        fs::write(unrelated.join("marker"), b"untouched").unwrap();
        std::os::unix::fs::symlink(&unrelated, root.join("segments/link")).unwrap();
        assert!(writer
            .consolidate_segments(1, 3, "segments/link", limits())
            .is_err());
        assert_eq!(fs::read(unrelated.join("marker")).unwrap(), b"untouched");
        assert_eq!(fs::read_dir(&unrelated).unwrap().count(), 1);
        let tiny_manifest = StoreLimits {
            max_manifest_bytes: 1,
            ..limits()
        };
        assert!(writer
            .consolidate_segments(1, 3, "segments/unfinished", tiny_manifest)
            .is_err());
        assert_eq!(fs::read(root.join(CATALOG_NAME)).unwrap(), before);
        assert!(root.join("segments/unfinished/segment.bin").is_file());
        assert!(!root.join("segments/unfinished/manifest.json").exists());
    }

    #[test]
    fn consolidation_rejects_changed_payload_before_publication() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer = populate(&root);
        let before = fs::read(root.join(CATALOG_NAME)).unwrap();
        let output = part(&root, "changed", 1, 3, "different");
        assert!(matches!(
            writer.publish_consolidation(1, 3, &output),
            Err(Error::Invalid("consolidation logical record changed"))
        ));
        assert_eq!(fs::read(root.join(CATALOG_NAME)).unwrap(), before);
        // A complete but unreferenced output remains inspectable, not deleted.
        assert!(Store::open(root.join(output)).is_ok());
    }

    #[test]
    fn consolidation_rejects_corrupt_input_and_output_without_mutating_catalog() {
        for corrupt_output in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("archive");
            let mut writer = populate(&root);
            let before = fs::read(root.join(CATALOG_NAME)).unwrap();
            let output = part(&root, "merged", 1, 3, "original");
            let segment = root
                .join(if corrupt_output {
                    &output
                } else {
                    "segments/source-2"
                })
                .join(SEGMENT_NAME);
            let mut permissions = fs::metadata(&segment).unwrap().permissions();
            use std::os::unix::fs::PermissionsExt;
            permissions.set_mode(0o600);
            fs::set_permissions(&segment, permissions).unwrap();
            let mut bytes = fs::read(&segment).unwrap();
            bytes[4] ^= 0xff;
            fs::write(&segment, bytes).unwrap();
            assert!(writer.publish_consolidation(1, 3, &output).is_err());
            assert_eq!(fs::read(root.join(CATALOG_NAME)).unwrap(), before);
        }
    }

    #[test]
    fn failed_publication_keeps_catalog_and_owned_output_for_inspection() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer = populate(&root);
        let old = writer.snapshot();
        let before = fs::read(root.join(CATALOG_NAME)).unwrap();
        fs::create_dir(root.join(CATALOG_PENDING)).unwrap();
        assert!(writer
            .consolidate_segments(1, 3, "segments/merged", limits())
            .is_err());
        assert_eq!(fs::read(root.join(CATALOG_NAME)).unwrap(), before);
        assert!(Store::open(root.join("segments/merged")).is_ok());
        assert_eq!(old.read_block(2).unwrap(), record(2, "original"));
        assert!(matches!(
            writer.append_segment("segments/source-1"),
            Err(Error::Poisoned)
        ));
    }

    #[test]
    fn consolidation_bounds_and_existing_paths_fail_without_clobber() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer = populate(&root);
        let before = fs::read(root.join(CATALOG_NAME)).unwrap();
        for (first, count, path, options) in [
            (0, 1, "segments/unused", limits()),
            (usize::MAX, 2, "segments/unused", limits()),
            (4, 2, "segments/unused", limits()),
            (0, 2, "../outside", limits()),
            (0, 2, "segments/source-0", limits()),
            (
                0,
                3,
                "segments/unused",
                StoreLimits {
                    max_blocks: 2,
                    ..limits()
                },
            ),
            (
                0,
                3,
                "segments/unused",
                StoreLimits {
                    max_segment_bytes: MAX_SEGMENT_BYTES,
                    ..limits()
                },
            ),
        ] {
            assert!(writer
                .consolidate_segments(first, count, path, options)
                .is_err());
            assert_eq!(fs::read(root.join(CATALOG_NAME)).unwrap(), before);
        }
        assert!(!root.join("segments/unused").exists());
        let mut too_small = limits();
        too_small.max_segment_bytes = 1;
        assert!(writer
            .consolidate_segments(0, 3, "segments/incomplete", too_small)
            .is_err());
        assert_eq!(fs::read(root.join(CATALOG_NAME)).unwrap(), before);
        assert!(root.join("segments/incomplete/segment.bin").exists());
        assert!(!root.join("segments/incomplete/manifest.json").exists());
        assert_eq!(
            writer.snapshot().read_block(0).unwrap(),
            record(0, "original")
        );
    }
}
