//! Instrumented fresh open; verification reads happen after the admission timer.
use prep_store::{profiling, TransactionMetadata};
use prost::Message;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{env, fs, time::Instant};

fn projection(row: &TransactionMetadata) -> Value {
    json!([
        hex::encode(row.txid),
        row.block_height,
        row.index,
        row.version,
        row.locktime,
        row.size_bytes,
        row.transparent_input_count,
        row.transparent_output_count,
        row.has_sapling,
        row.has_orchard
    ])
}
fn fallback(
    tx: &Value,
    height: u64,
    position: usize,
) -> Result<TransactionMetadata, Box<dyn std::error::Error>> {
    let mut txid = [0; 32];
    hex::decode_to_slice(tx["txid"].as_str().ok_or("missing txid")?, &mut txid)?;
    let integer = |key: &str| -> Result<u32, Box<dyn std::error::Error>> {
        Ok(u32::try_from(tx[key].as_u64().ok_or("missing integer")?)?)
    };
    let count = |key: &str| -> Result<u32, Box<dyn std::error::Error>> {
        Ok(u32::try_from(
            tx[key].as_array().ok_or("missing array")?.len(),
        )?)
    };
    let nonempty = |v: &Value| v.as_array().is_some_and(|v| !v.is_empty());
    Ok(TransactionMetadata {
        txid,
        block_height: height,
        index: u32::try_from(position)?,
        version: integer("version")?,
        locktime: integer("locktime")?,
        size_bytes: u32::try_from(hex::decode(tx["hex"].as_str().ok_or("missing hex")?)?.len())?,
        transparent_input_count: count("vin")?,
        transparent_output_count: count("vout")?,
        has_sapling: nonempty(&tx["vShieldedSpend"]) || nonempty(&tx["vShieldedOutput"]),
        has_orchard: nonempty(&tx["orchard"]["actions"]),
    })
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let path = args
        .next()
        .ok_or("Usage: admission_phases ARCHIVE [ARCHIVE_BUDGET_BYTES]")?;
    let budget = args.next().map(|v| v.parse::<usize>()).transpose()?;
    if args.next().is_some() {
        return Err("unexpected argument".into());
    }
    let (archive, profile) = profiling::open(&path, budget)?;
    let admission_status = fs::read_to_string("/proc/self/status").ok();
    let started = Instant::now();
    let mut digest = Sha256::new();
    let mut payload_digest = Sha256::new();
    let mut transactions = 0u64;
    let mut indexed_blocks = 0u64;
    let mut fallback_blocks = 0u64;
    let mut segment_transactions = vec![0u64; profile.segments.len()];
    let mut segment_position = 0;
    if let Some(head) = archive.head() {
        for height in archive.catalog().start_height..=head {
            while height > profile.segments[segment_position].end_height {
                segment_position += 1;
            }
            let record = archive.read_block(height)?;
            payload_digest.update(height.to_le_bytes());
            payload_digest.update((record.payload.len() as u64).to_le_bytes());
            payload_digest.update(&record.payload);
            let full = prep_proto::prep::FullBlock::decode(record.payload.as_slice())?;
            let decoded: Value = serde_json::from_str(&full.decoded_json)?;
            let txs = decoded["tx"]
                .as_array()
                .ok_or("no full transaction array")?;
            segment_transactions[segment_position] += txs.len() as u64;
            let expected = txs
                .iter()
                .enumerate()
                .map(|(i, tx)| fallback(tx, height, i))
                .collect::<Result<Vec<_>, _>>()?;
            let actual = match archive.transaction_metadata(height)? {
                Some(rows) => {
                    indexed_blocks += 1;
                    rows
                }
                None => {
                    fallback_blocks += 1;
                    expected.clone()
                }
            };
            if actual != expected {
                return Err(format!("metadata mismatch at {height}").into());
            }
            digest.update(height.to_le_bytes());
            digest.update((actual.len() as u64).to_le_bytes());
            for row in actual {
                digest.update(serde_json::to_vec(&projection(&row))?);
                transactions += 1;
            }
        }
    }
    let verification_ns = started.elapsed().as_nanos();
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "format":"prep-admission-phases-v1", "profile":profile,
            "catalog_sha256":archive.catalog().catalog_sha256,
            "head":archive.head(), "head_hash":archive.head_hash(),
            "transaction_index_allocated_bytes":archive.transaction_index_bytes(),
            "indexed_blocks":indexed_blocks, "fallback_blocks":fallback_blocks,
            "transactions":transactions, "metadata_sha256":hex::encode(digest.finalize()),
            "segment_transaction_counts":segment_transactions,
            "native_metadata_row_bytes":std::mem::size_of::<TransactionMetadata>(),
            "payload_sha256":hex::encode(payload_digest.finalize()),
            "verification_ns":verification_ns, "proc_status_after_admission":admission_status,
            "counterfactual":budget.is_some(),
            "limitations":"Timers add per-record overhead; phases are disjoint and exclude unassigned allocation/drop/path work. Verification reads and independently projects every transaction after admission. Synthetic data proves admission mechanics only. No cold-cache or consensus claim."
        }))?
    );
    Ok(())
}
