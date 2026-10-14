//! Read-only admission diagnostic; does not bypass checks or change archive state.
use prep_store::Archive;
use serde_json::json;
use std::{env, fs, time::Instant};

fn memory() -> serde_json::Value {
    let status = fs::read_to_string("/proc/self/status").unwrap_or_default();
    let bytes = |key: &str| {
        status.lines().find_map(|line| {
            line.strip_prefix(key)?
                .split_whitespace()
                .next()?
                .parse::<u64>()
                .ok()?
                .checked_mul(1024)
        })
    };
    json!({"rss_bytes": bytes("VmRSS:"), "process_peak_rss_bytes": bytes("VmHWM:")})
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let path = args.next().ok_or("Usage: archive_profile ARCHIVE")?;
    if args.next().is_some() {
        return Err("Usage: archive_profile ARCHIVE".into());
    }
    let started = Instant::now();
    let archive = Archive::open(&path)?;
    let admission_ns = started.elapsed().as_nanos();
    let admission_memory = memory();
    let scan_started = Instant::now();
    let mut indexed_blocks = 0u64;
    let mut fallback_blocks = 0u64;
    let mut indexed_transactions = 0u64;
    if let Some(head) = archive.head() {
        for height in archive.catalog().start_height..=head {
            match archive.transaction_metadata(height)? {
                Some(rows) => {
                    indexed_blocks += 1;
                    indexed_transactions += rows.len() as u64;
                }
                None => fallback_blocks += 1,
            }
        }
    }
    let metadata_count_ns = scan_started.elapsed().as_nanos();
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "format": "prep-archive-profile-v1", "network": archive.catalog().network,
            "payload_kind": archive.catalog().payload_kind,
            "start_height": archive.catalog().start_height, "head": archive.head(),
            "head_hash": archive.head_hash(), "epoch": archive.catalog().epoch,
            "revision": archive.catalog().revision, "segments": archive.catalog().segments.len(),
            "admission_ns": admission_ns, "memory_after_admission": admission_memory,
            "transaction_index_allocated_bytes": archive.transaction_index_bytes(),
            "transaction_index_budget_bytes": 64 * 1024 * 1024,
            "segment_index_budget_bytes": 16 * 1024 * 1024,
            "indexed_blocks": indexed_blocks, "fallback_blocks": fallback_blocks,
            "indexed_transactions": indexed_transactions,
            "metadata_count_ns": metadata_count_ns,
            "memory_after_metadata_count": memory(),
            "limits": "Archive::open includes mandatory integrity checks and optional index construction. RSS includes more than index allocations. Fallback metadata is not decoded here; its transaction count is unknown. Filesystem cache state is externally controlled."
        }))?
    );
    Ok(())
}
