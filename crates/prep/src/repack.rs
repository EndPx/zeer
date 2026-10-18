//! Offline lossless storage conversion. Source is locked and never modified.
use anyhow::{ensure, Result};
use prep_store::{Archive, ArchiveWriter, StoreWriter, FULL_KIND};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path};

pub fn repack(source: &Path, output: &Path, max_bytes: u64) -> Result<serde_json::Value> {
    repack_with_resume(source, output, max_bytes, false)
}

pub fn repack_with_resume(
    source: &Path,
    output: &Path,
    max_bytes: u64,
    resume: bool,
) -> Result<serde_json::Value> {
    ensure!(!output.exists() || resume, "repack_output_already_exists");
    ensure!(!resume || output.exists(), "repack_resume_output_missing");
    ensure!(
        !output.join("repack-proof.json").exists(),
        "repack_already_complete"
    );
    let source = source.canonicalize()?;
    let parent = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
        .canonicalize()?;
    ensure!(!parent.starts_with(&source), "repack_output_inside_source");
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(source.join("archive.lock"))?;
    lock.try_lock()
        .map_err(|_| anyhow::anyhow!("repack_source_writer_active"))?;
    let source_catalog = fs::read(source.join("catalog.json"))?;
    if resume {
        ensure!(
            fs::read(output.join("legacy-catalog.json"))? == source_catalog,
            "repack_resume_source_changed"
        );
    }
    let archive = Archive::open(&source)?;
    ensure!(
        archive.catalog().payload_kind == FULL_KIND,
        "repack_requires_full_archive"
    );
    ensure!(archive.head().is_some(), "repack_requires_nonempty_archive");
    ensure!(max_bytes >= 256 * 1024 * 1024, "repack_budget_too_small");
    let mut writer = ArchiveWriter::create_or_open_with_kind(
        output,
        &archive.catalog().network,
        archive.catalog().start_height,
        FULL_KIND,
    )?;
    if !resume {
        writer.invalidate_epoch()?;
        fs::create_dir(output.join("legacy-manifests"))?;
        fs::write(output.join("legacy-catalog.json"), &source_catalog)?;
    }
    let existing = writer.catalog().segments.clone();
    ensure!(
        existing.len() <= archive.catalog().segments.len(),
        "repack_resume_prefix_invalid"
    );
    let mut input_digest = Sha256::new();
    let mut blocks = 0u64;
    for (ordinal, segment) in archive.catalog().segments.iter().enumerate() {
        let directory = format!("segments/repacked-{ordinal}");
        let path = output.join(&directory);
        let mut part = if let Some(prior) = existing.get(ordinal) {
            ensure!(
                prior.directory == directory
                    && prior.start_height == segment.start_height
                    && prior.end_height == segment.end_height
                    && prior.end_hash == segment.end_hash
                    && prior.predecessor_hash == segment.predecessor_hash,
                "repack_resume_prefix_invalid"
            );
            None
        } else {
            // Replace only this job's unpublished generated segment. Source is locked.
            if let Ok(metadata) = fs::symlink_metadata(&path) {
                ensure!(
                    metadata.file_type().is_dir()
                        && path.canonicalize()?.parent()
                            == Some(output.join("segments").canonicalize()?.as_path()),
                    "repack_unsafe_orphan_path"
                );
                fs::remove_dir_all(&path)?;
            }
            let used = crate::follower::archive_disk_bytes(output)?;
            ensure!(
                used.saturating_add(256 * 1024 * 1024) <= max_bytes,
                "repack_disk_budget_exhausted"
            );
            Some(
                StoreWriter::create_full(
                    &path,
                    &archive.catalog().network,
                    segment.start_height,
                    segment.end_height,
                    &segment.predecessor_hash,
                    &segment.end_hash,
                )?
                .with_compression()?,
            )
        };
        for start in (segment.start_height..=segment.end_height).step_by(1000) {
            for record in archive.read_range(start, segment.end_height.min(start + 999))? {
                let record = record?;
                input_digest.update(record.height.to_le_bytes());
                input_digest.update((record.payload.len() as u64).to_le_bytes());
                input_digest.update(&record.payload);
                blocks += 1;
                if let Some(part) = part.as_mut() {
                    part.push(record)?;
                }
            }
        }
        let Some(part) = part else {
            continue;
        };
        part.finish()?;
        let manifest = fs::read(source.join(&segment.directory).join("manifest.json"))?;
        fs::write(
            output
                .join("legacy-manifests")
                .join(format!("{ordinal}.json.zst")),
            zstd::bulk::compress(&manifest, 3)?,
        )?;
        let provenance = source.join(&segment.directory).join("source.json");
        if provenance.is_file() {
            fs::copy(provenance, path.join("source.json"))?;
        }
        writer.append_segment(&directory)?;
        ensure!(
            crate::follower::archive_disk_bytes(output)? <= max_bytes,
            "repack_disk_budget_exhausted"
        );
        if ordinal % 100 == 0 {
            eprintln!("repack_segments={} blocks={}", ordinal + 1, blocks);
        }
    }
    ensure!(
        fs::read(source.join("catalog.json"))? == source_catalog,
        "repack_source_catalog_changed"
    );
    let destination = Archive::open(output)?;
    let mut output_digest = Sha256::new();
    for segment in &destination.catalog().segments {
        for start in (segment.start_height..=segment.end_height).step_by(1000) {
            for record in destination.read_range(start, segment.end_height.min(start + 999))? {
                let record = record?;
                output_digest.update(record.height.to_le_bytes());
                output_digest.update((record.payload.len() as u64).to_le_bytes());
                output_digest.update(&record.payload);
            }
        }
    }
    let logical_digest = hex::encode(input_digest.finalize());
    ensure!(
        hex::encode(output_digest.finalize()) == logical_digest,
        "repack_logical_bytes_mismatch"
    );
    ensure!(
        destination.head_hash() == archive.head_hash(),
        "repack_end_hash_mismatch"
    );
    let output_bytes = crate::follower::archive_disk_bytes(output)?;
    ensure!(
        output_bytes.saturating_add(65536) <= max_bytes,
        "repack_disk_budget_exhausted"
    );
    let proof = serde_json::json!({"network": archive.catalog().network, "start": archive.catalog().start_height,
        "end": archive.head(), "blocks": blocks, "logical_sha256": logical_digest,
        "every_decoded_payload_verified": true, "source_unchanged": true, "output_bytes": output_bytes});
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output.join("repack-proof.json"))?;
    file.write_all(serde_json::to_string_pretty(&proof)?.as_bytes())?;
    file.sync_all()?;
    fs::File::open(output)?.sync_all()?;
    Ok(proof)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use prep_proto::prep::FullBlock;
    use prep_store::BlockRecord;
    use prost::Message;

    #[test]
    fn conversion_preserves_genesis_records_and_refuses_active_or_existing_targets() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let output = temp.path().join("compressed");
        let mut archive =
            ArchiveWriter::create_or_open_with_kind(&source, "regtest", 0, FULL_KIND).unwrap();
        for height in 0..=2u64 {
            let hash = vec![height as u8 + 1; 32];
            let prev_hash = vec![height as u8; 32];
            let name = format!("segments/source-{height}");
            let mut segment = StoreWriter::create_full(
                source.join(&name),
                "regtest",
                height,
                height,
                &hex::encode(&prev_hash),
                &hex::encode(&hash),
            )
            .unwrap();
            let payload = FullBlock {
                height,
                hash: hash.clone(),
                prev_hash: prev_hash.clone(),
                time: 1,
                raw_block: vec![1, 2, 3],
                decoded_json: format!(r#"{{"pad":"{}"}}"#, "abc".repeat(10000)),
            }
            .encode_to_vec();
            segment
                .push(BlockRecord {
                    height,
                    hash,
                    prev_hash,
                    payload,
                })
                .unwrap();
            segment.finish().unwrap();
            archive.append_segment(&name).unwrap();
        }
        assert!(repack(&source, &output, 1024 * 1024 * 1024)
            .unwrap_err()
            .to_string()
            .contains("writer_active"));
        assert!(!output.exists());
        drop(archive);
        let catalog = fs::read(source.join("catalog.json")).unwrap();
        let proof = repack(&source, &output, 1024 * 1024 * 1024).unwrap();
        assert_eq!(proof["blocks"], 3);
        assert_eq!(proof["start"], 0);
        assert_eq!(fs::read(source.join("catalog.json")).unwrap(), catalog);
        let before = Archive::open(&source).unwrap();
        let after = Archive::open(&output).unwrap();
        for h in 0..=2 {
            assert_eq!(before.read_block(h).unwrap(), after.read_block(h).unwrap());
        }
        assert!(
            repack_with_resume(&source, &output, 1024 * 1024 * 1024, true)
                .unwrap_err()
                .to_string()
                .contains("already_complete")
        );
        fs::remove_file(output.join("repack-proof.json")).unwrap();
        let mut interrupted =
            ArchiveWriter::create_or_open_with_kind(&output, "regtest", 0, FULL_KIND).unwrap();
        interrupted.rollback_to(0).unwrap();
        drop(interrupted);
        let first = output.join("segments/repacked-0/segment.bin");
        let first_modified = fs::metadata(&first).unwrap().modified().unwrap();
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("preserve"), b"keep").unwrap();
        let orphan = output.join("segments/repacked-1");
        fs::remove_dir_all(&orphan).unwrap();
        std::os::unix::fs::symlink(&outside, &orphan).unwrap();
        assert!(
            repack_with_resume(&source, &output, 1024 * 1024 * 1024, true)
                .unwrap_err()
                .to_string()
                .contains("unsafe_orphan")
        );
        assert_eq!(fs::read(outside.join("preserve")).unwrap(), b"keep");
        fs::remove_file(orphan).unwrap();
        let resumed = repack_with_resume(&source, &output, 1024 * 1024 * 1024, true).unwrap();
        assert_eq!(resumed["blocks"], 3);
        assert_eq!(
            fs::metadata(&first).unwrap().modified().unwrap(),
            first_modified
        );
        let after = Archive::open(&output).unwrap();
        for h in 0..=2 {
            assert_eq!(before.read_block(h).unwrap(), after.read_block(h).unwrap());
        }
        assert!(repack(&source, &output, 1024 * 1024 * 1024)
            .unwrap_err()
            .to_string()
            .contains("already_exists"));
        assert!(repack(&source, &source.join("nested"), 1024 * 1024 * 1024)
            .unwrap_err()
            .to_string()
            .contains("inside_source"));
    }
}
