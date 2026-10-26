//! Bounded lossless consolidation. Published source files are retained so an
//! already admitted reader can finish through its old immutable snapshot.
use std::{path::Path, time::Instant};

use anyhow::{ensure, Result};
use prep_store::{ArchiveWriter, ConsolidationReport, StoreLimits, FULL_KIND};
use serde_json::json;

use crate::follower::{archive_disk_bytes, nonce};

pub(crate) const CATALOG_SEGMENT_HIGH_WATER: usize = 16_384;
const CATALOG_BYTE_HIGH_WATER: u64 = 8 * 1024 * 1024;
const PRE_APPEND_CATALOG_GUARD_BYTES: u64 = 15 * 1024 * 1024;
const GROUP_SEGMENTS: usize = 256;
const GROUP_BLOCKS: u64 = 1000;
const OUTPUT_SEGMENT_BYTES: u64 = 64 * 1024 * 1024;
const OUTPUT_MANIFEST_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct ConsolidateOptions {
    pub target_segments: usize,
    pub max_groups: usize,
    pub protected_tail_blocks: u64,
    pub max_archive_bytes: u64,
    pub max_segment_bytes: u64,
    pub expected_catalog_sha256: Option<String>,
}

fn limits(max_segment_bytes: u64) -> Result<StoreLimits> {
    ensure!(
        (1024 * 1024..=OUTPUT_SEGMENT_BYTES).contains(&max_segment_bytes),
        "consolidation_segment_bytes_must_be_1_to_64_mib"
    );
    Ok(StoreLimits {
        max_block_bytes: prep_store::MAX_FULL_BLOCK_BYTES,
        max_segment_bytes,
        max_blocks: GROUP_BLOCKS,
        max_manifest_bytes: OUTPUT_MANIFEST_BYTES,
        ..StoreLimits::default()
    })
}

/// Choose the first useful contiguous historical group. The recent recovery
/// tail is deliberately left as fine-grained segments. Input byte selection is
/// conservative, but the store independently enforces actual output bounds.
fn select_group(
    writer: &ArchiveWriter,
    protected_tail_blocks: u64,
    limits: StoreLimits,
) -> Option<(usize, usize)> {
    let head = writer.head()?;
    let cutoff = head.checked_sub(protected_tail_blocks)?;
    let snapshot = writer.snapshot();
    let segments = &writer.catalog().segments;
    let input_budget = limits.max_segment_bytes / 2;
    for first in 0..segments.len().saturating_sub(1) {
        if segments[first].end_height > cutoff {
            break;
        }
        let mut blocks = 0_u64;
        let mut bytes = 0_u64;
        let mut count = 0;
        for (index, segment) in segments.iter().enumerate().skip(first).take(GROUP_SEGMENTS) {
            if segment.end_height > cutoff {
                break;
            }
            let next_blocks = blocks.checked_add(segment.end_height - segment.start_height + 1)?;
            let next_bytes = bytes.checked_add(snapshot.segment_stored_bytes(index)?)?;
            if next_blocks > limits.max_blocks || next_bytes > input_budget {
                break;
            }
            blocks = next_blocks;
            bytes = next_bytes;
            count += 1;
        }
        if count >= 2 {
            return Some((first, count));
        }
    }
    None
}

fn reserve_available(root: &Path, max_archive_bytes: u64, limits: StoreLimits) -> Result<bool> {
    let reserve = limits
        .max_segment_bytes
        .checked_add(limits.max_manifest_bytes)
        .ok_or_else(|| anyhow::anyhow!("consolidation_reserve_overflow"))?;
    Ok(archive_disk_bytes(root)?
        .checked_add(reserve)
        .is_some_and(|bytes| bytes <= max_archive_bytes))
}

fn consolidate_group(
    writer: &mut ArchiveWriter,
    first: usize,
    count: usize,
    limits: StoreLimits,
) -> Result<ConsolidationReport> {
    let first_height = writer.catalog().segments[first].start_height;
    let last_height = writer.catalog().segments[first + count - 1].end_height;
    let output = format!(
        "segments/consolidated-{first_height}-{last_height}-{}",
        nonce()
    );
    Ok(writer.consolidate_segments(first, count, &output, limits)?)
}

/// At most one bounded group per live step. New blocks do not wait for a batch
/// to fill. Retired bytes remain counted against the same archive disk budget.
pub(crate) fn needed(writer: &ArchiveWriter) -> Result<bool> {
    Ok(
        writer.catalog().segments.len() >= CATALOG_SEGMENT_HIGH_WATER
            || writer.catalog_serialized_bytes()? >= CATALOG_BYTE_HIGH_WATER,
    )
}

pub(crate) fn required_before_append(writer: &ArchiveWriter) -> Result<bool> {
    Ok(writer.remaining_segment_slots() == 0
        || writer.catalog_serialized_bytes()? >= PRE_APPEND_CATALOG_GUARD_BYTES)
}

pub(crate) fn maintain_once(
    root: &Path,
    writer: &mut ArchiveWriter,
    protected_tail_blocks: u64,
    max_archive_bytes: u64,
) -> Result<Option<ConsolidationReport>> {
    if !needed(writer)? {
        return Ok(None);
    }
    let limits = limits(OUTPUT_SEGMENT_BYTES)?;
    let Some((first, count)) = select_group(writer, protected_tail_blocks, limits) else {
        return Ok(None);
    };
    ensure!(
        reserve_available(root, max_archive_bytes, limits)?,
        "archive_disk_budget_exhausted"
    );
    Ok(Some(consolidate_group(writer, first, count, limits)?))
}

/// Offline operator command: holds one writer lock/admission across bounded
/// groups, never deletes old payloads and never writes source freshness.
pub fn consolidate_archive(root: &Path, options: ConsolidateOptions) -> Result<serde_json::Value> {
    ensure!(
        options.target_segments >= 1 && options.target_segments <= 30_000,
        "invalid_consolidation_target"
    );
    ensure!(
        (1..=256).contains(&options.max_groups),
        "consolidation_groups_must_be_1_to_256"
    );
    ensure!(
        (1..=10_000).contains(&options.protected_tail_blocks),
        "consolidation_protected_tail_must_be_1_to_10000"
    );
    let limits = limits(options.max_segment_bytes)?;
    let started = Instant::now();
    let mut writer = ArchiveWriter::open_existing(root)?;
    let admission_seconds = started.elapsed().as_secs_f64();
    ensure!(
        writer.catalog().payload_kind == FULL_KIND,
        "consolidation_requires_full_archive"
    );
    if let Some(expected) = &options.expected_catalog_sha256 {
        ensure!(
            expected.len() == 64
                && expected
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                && &writer.catalog().catalog_sha256 == expected,
            "consolidation_catalog_precondition_failed"
        );
    }
    let before = writer.catalog().clone();
    let mut groups = Vec::new();
    let mut group_seconds = Vec::new();
    let mut stop_reason = "max_groups";
    for _ in 0..options.max_groups {
        if writer.catalog().segments.len() <= options.target_segments {
            stop_reason = "target_reached";
            break;
        }
        let Some((first, count)) = select_group(&writer, options.protected_tail_blocks, limits)
        else {
            stop_reason = "no_eligible_group";
            break;
        };
        if !reserve_available(root, options.max_archive_bytes, limits)? {
            stop_reason = "disk_budget";
            break;
        }
        let group_started = Instant::now();
        let report = consolidate_group(&mut writer, first, count, limits)?;
        let seconds = group_started.elapsed().as_secs_f64();
        eprintln!(
            "{}",
            serde_json::to_string(&json!({
                "event": "archive_consolidation_group", "group": groups.len() + 1,
                "elapsed_seconds": seconds, "report": &report
            }))?
        );
        group_seconds.push(seconds);
        groups.push(report);
    }
    let after = writer.catalog();
    let target_reached = after.segments.len() <= options.target_segments;
    if target_reached {
        stop_reason = "target_reached";
    }
    Ok(json!({
        "network": after.network, "start_height": after.start_height,
        "head": writer.head(), "head_hash": writer.head_hash(),
        "previous_segments": before.segments.len(), "current_segments": after.segments.len(),
        "previous_catalog_sha256": before.catalog_sha256, "catalog_sha256": after.catalog_sha256,
        "catalog_bytes": writer.catalog_serialized_bytes()?,
        "epoch": after.epoch, "revision": after.revision,
        "groups": groups, "target_reached": target_reached, "stop_reason": stop_reason,
        "group_elapsed_seconds": group_seconds,
        "elapsed_seconds": started.elapsed().as_secs_f64(),
        "admission_seconds": admission_seconds,
        "archive_bytes": archive_disk_bytes(root)?, "files_deleted": false,
        "source_observation_refreshed": false,
        "source_observation_note": "No RPC performed; resume the follower for a new genuine source observation."
    }))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use prep_proto::prep::FullBlock;
    use prep_store::{Archive, BlockRecord, StoreWriter};
    use prost::Message;

    fn archive(root: &Path, count: u64) -> ArchiveWriter {
        let mut archive =
            ArchiveWriter::create_or_open_with_kind(root, "regtest", 0, FULL_KIND).unwrap();
        for height in 0..count {
            let hash = vec![height as u8 + 1; 32];
            let prev_hash = vec![height as u8; 32];
            let relative = format!("segments/source-{height}");
            let mut writer = StoreWriter::create_full(
                root.join(&relative),
                "regtest",
                height,
                height,
                &hex::encode(&prev_hash),
                &hex::encode(&hash),
            )
            .unwrap();
            writer
                .push(BlockRecord {
                    height,
                    hash: hash.clone(),
                    prev_hash: prev_hash.clone(),
                    payload: FullBlock {
                        height,
                        hash,
                        prev_hash,
                        time: 123 + height,
                        raw_block: vec![1, 2, 3],
                        decoded_json: format!(r#"{{"fixture":{height}}}"#),
                    }
                    .encode_to_vec(),
                })
                .unwrap();
            writer.finish().unwrap();
            archive.append_segment(&relative).unwrap();
        }
        archive
    }

    fn options() -> ConsolidateOptions {
        ConsolidateOptions {
            target_segments: 3,
            max_groups: 2,
            protected_tail_blocks: 2,
            max_archive_bytes: 256 * 1024 * 1024,
            max_segment_bytes: OUTPUT_SEGMENT_BYTES,
            expected_catalog_sha256: None,
        }
    }

    #[test]
    fn manual_consolidation_preserves_payloads_tail_and_status_without_rpc() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let writer = archive(&root, 8);
        let old = writer.snapshot();
        let old_head = writer.head_hash().unwrap().to_owned();
        std::fs::write(root.join("status.json"), b"retained old source observation").unwrap();
        drop(writer);
        let report = consolidate_archive(&root, options()).unwrap();
        assert_eq!(report["target_reached"], true);
        assert_eq!(report["previous_segments"], 8);
        assert_eq!(report["current_segments"], 3);
        assert_eq!(report["head"], 7);
        assert_eq!(report["head_hash"], old_head);
        assert_eq!(report["files_deleted"], false);
        assert_eq!(report["source_observation_refreshed"], false);
        let current = Archive::open(&root).unwrap();
        assert_eq!(current.catalog().segments[1].directory, "segments/source-6");
        assert_eq!(current.catalog().segments[2].directory, "segments/source-7");
        for height in 0..8 {
            assert_eq!(
                old.read_block(height).unwrap(),
                current.read_block(height).unwrap()
            );
            assert!(root
                .join(format!("segments/source-{height}/manifest.json"))
                .is_file());
        }
        assert_eq!(
            std::fs::read(root.join("status.json")).unwrap(),
            b"retained old source observation"
        );
    }

    #[test]
    fn failed_preconditions_and_tight_budget_leave_catalog_unchanged() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        drop(archive(&root, 8));
        let before = std::fs::read(root.join("catalog.json")).unwrap();
        let mut stale = options();
        stale.expected_catalog_sha256 = Some("ff".repeat(32));
        assert!(consolidate_archive(&root, stale)
            .unwrap_err()
            .to_string()
            .contains("precondition_failed"));
        let mut tight = options();
        tight.max_archive_bytes = archive_disk_bytes(&root).unwrap();
        let result = consolidate_archive(&root, tight).unwrap();
        assert_eq!(result["target_reached"], false);
        assert_eq!(result["stop_reason"], "disk_budget");
        assert_eq!(result["groups"].as_array().unwrap().len(), 0);
        assert_eq!(std::fs::read(root.join("catalog.json")).unwrap(), before);
    }

    #[test]
    fn normal_small_follow_catalog_does_not_create_maintenance_output() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("archive");
        let mut writer = archive(&root, 8);
        let before = writer.catalog().clone();
        assert!(!needed(&writer).unwrap());
        assert!(!required_before_append(&writer).unwrap());
        assert!(maintain_once(&root, &mut writer, 2, 256 * 1024 * 1024)
            .unwrap()
            .is_none());
        assert_eq!(writer.catalog(), &before);
        assert_eq!(
            select_group(&writer, 2, limits(OUTPUT_SEGMENT_BYTES).unwrap()),
            Some((0, 6))
        );
        assert_eq!(
            select_group(&writer, 100, limits(OUTPUT_SEGMENT_BYTES).unwrap()),
            None
        );
    }
}
