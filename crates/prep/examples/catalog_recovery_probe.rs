//! Ordinary read-only core-query and held-snapshot verification for catalog recovery.
//! Does not change source readiness, acquire a writer, or expose private receipts.
use anyhow::{ensure, Result};
use prep::query::{execute_query, QueryControl, QueryRequest};
use prep_store::Archive;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::Path,
    time::{Duration, Instant},
};

fn memory() -> Value {
    let status = fs::read_to_string("/proc/self/status").unwrap_or_default();
    let read = |key: &str| {
        status.lines().find_map(|line| {
            line.strip_prefix(key)?
                .split_whitespace()
                .next()?
                .parse::<u64>()
                .ok()?
                .checked_mul(1024)
        })
    };
    json!({"rss_bytes":read("VmRSS:"),"peak_rss_bytes":read("VmHWM:")})
}
fn digest(value: &Value) -> Result<String> {
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(value)?)))
}
fn emit(value: Value) -> Result<()> {
    println!("{}", serde_json::to_string(&value)?);
    std::io::stdout().flush()?;
    Ok(())
}
fn requests(head: u64) -> Result<Vec<(String, QueryRequest)>> {
    ensure!(head >= 4_544_783, "probe_requires_incident_history");
    let metadata = json!([
        "txid",
        "block_height",
        "index",
        "version",
        "size_bytes",
        "transparent_input_count",
        "transparent_output_count"
    ]);
    let cases = [
        (
            "genesis_headers",
            json!({"from_block":0,"to_block":3,"limit":128,"field_selection":{"block":["height","hash","previous_hash","time"],"transaction":[]}}),
        ),
        (
            "historical_metadata",
            json!({"from_block":4_515_166,"to_block":4_515_170,"limit":128,"field_selection":{"block":[],"transaction":metadata}}),
        ),
        (
            "modern_metadata",
            json!({"from_block":4_522_544,"to_block":4_522_560,"limit":128,"field_selection":{"block":[],"transaction":metadata}}),
        ),
        (
            "selected_tx_raw",
            json!({"from_block":4_523_289,"to_block":4_523_292,"limit":128,"field_selection":{"block":[],"transaction":["txid","block_height","index","raw"]},"transaction_filter":{"txids":["b9444bea5e092925ddfa52dbfbd8d1075c62b8b234260df3d9b9179f0a8d2d6e"]}}),
        ),
        (
            "recent_metadata",
            json!({"from_block":head-64,"to_block":head+1,"limit":128,"field_selection":{"block":["height","hash"],"transaction":metadata}}),
        ),
        (
            "sparse_recent_txid",
            json!({"from_block":head-127,"to_block":head+1,"limit":128,"field_selection":{"block":[],"transaction":metadata},"transaction_filter":{"txids":["ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"]}}),
        ),
    ];
    cases
        .into_iter()
        .map(|(name, value)| Ok((name.into(), serde_json::from_value(value)?)))
        .collect()
}
fn run(archive: &Archive, cases: &[(String, QueryRequest)]) -> Result<Vec<Value>> {
    let mut result = Vec::new();
    for (name, request) in cases {
        let warm =
            serde_json::to_value(execute_query(archive, request, &QueryControl::default())?)?;
        let expected = digest(&warm["data"])?;
        let mut samples = Vec::new();
        for _ in 0..5 {
            let now = Instant::now();
            let value =
                serde_json::to_value(execute_query(archive, request, &QueryControl::default())?)?;
            samples.push(now.elapsed().as_secs_f64());
            ensure!(
                digest(&value["data"])? == expected,
                "query_changed_during_probe"
            );
        }
        result.push(json!({"name":name,"data_sha256":expected,"seconds":samples,"blocks":warm["data"]["blocks"].as_array().map(Vec::len),"transactions":warm["data"]["transactions"].as_array().map(Vec::len)}));
    }
    Ok(result)
}
fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    ensure!(
        args.len() == 2 || args.len() == 3,
        "usage: catalog_recovery_probe ARCHIVE [EXISTING_PARENT_SIGNAL_FILE]"
    );
    let now = Instant::now();
    let old = Archive::open(&args[1])?;
    let admission = now.elapsed().as_secs_f64();
    let cases = requests(old.head().unwrap_or(0))?;
    let baseline = run(&old, &cases)?;
    emit(
        json!({"phase":"before","admission_seconds":admission,"memory":memory(),"segments":old.catalog().segments.len(),"catalog_bytes":fs::metadata(Path::new(&args[1]).join("catalog.json"))?.len(),"head":old.head(),"head_hash":old.head_hash(),"epoch":old.catalog().epoch,"revision":old.catalog().revision,"cases":baseline,"scope":"ordinary core execute_query plus JSON serialization; no HTTP or source-readiness override; warm caches"}),
    )?;
    if args.len() == 2 {
        return Ok(());
    }
    let signal = Path::new(&args[2]);
    ensure!(
        signal.parent().is_some_and(Path::is_dir),
        "signal_parent_missing"
    );
    let wait = Instant::now();
    while !signal.try_exists()? {
        ensure!(
            wait.elapsed() < Duration::from_secs(1800),
            "probe_signal_timeout"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    let retained = run(&old, &cases)?;
    for (a, b) in baseline.iter().zip(&retained) {
        ensure!(a["data_sha256"] == b["data_sha256"], "old_snapshot_changed");
    }
    let now = Instant::now();
    let refreshed = old.refresh()?;
    let refresh = now.elapsed().as_secs_f64();
    let after = run(&refreshed, &cases)?;
    for (a, b) in baseline.iter().zip(&after) {
        ensure!(
            a["data_sha256"] == b["data_sha256"],
            "refreshed_projection_changed"
        );
    }
    let mut cursor_request = cases[4].1.clone();
    cursor_request.limit = 1;
    let cursor = execute_query(&old, &cursor_request, &QueryControl::default())?.cursor;
    ensure!(cursor.is_some(), "missing_probe_cursor");
    cursor_request.cursor = cursor;
    let rejection = execute_query(&refreshed, &cursor_request, &QueryControl::default()).err();
    ensure!(
        rejection.as_ref().is_some_and(|e| e.status == 409),
        "old_cursor_not_invalidated"
    );
    emit(
        json!({"phase":"after","old_snapshot_identical":true,"refreshed_projection_identical":true,"stale_cursor_status":rejection.unwrap().status,"refresh_seconds":refresh,"memory":memory(),"segments":refreshed.catalog().segments.len(),"head":refreshed.head(),"epoch":refreshed.catalog().epoch,"revision":refreshed.catalog().revision,"cases":after}),
    )
}
