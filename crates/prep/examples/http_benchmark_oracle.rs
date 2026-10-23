//! Untimed oracle extraction from checked stored envelopes, outside HTTP queries.
use prep_proto::prep::FullBlock;
use prep_store::Archive;
use prost::Message;
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs::File, io::BufWriter};

fn main() -> anyhow::Result<()> {
    let args: Vec<_> = std::env::args().collect();
    anyhow::ensure!(
        args.len() == 3,
        "usage: http_benchmark_oracle ARCHIVE NEW_OUTPUT"
    );
    let archive = Archive::open(&args[1])?;
    let start = archive.catalog().start_height;
    let end = archive
        .head()
        .ok_or_else(|| anyhow::anyhow!("empty archive"))?;
    let mut headers = Vec::new();
    let mut samples: BTreeMap<&str, Vec<Value>> = BTreeMap::new();
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for lo in (start..=end).step_by(1000) {
        for record in archive.read_range(lo, (lo + 999).min(end))? {
            let b = FullBlock::decode(record?.payload.as_slice())?;
            let decoded: Value = serde_json::from_str(&b.decoded_json)?;
            headers.push(json!({"height":b.height,"hash":hex::encode(b.hash.iter().rev().copied().collect::<Vec<_>>()),"previous_hash":hex::encode(b.prev_hash.iter().rev().copied().collect::<Vec<_>>()),"time":b.time}));
            for (index, tx) in decoded["tx"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("missing decoded transactions"))?
                .iter()
                .enumerate()
            {
                let has = |v: &Value| v.as_array().is_some_and(|a| !a.is_empty());
                for (pool, present) in [
                    ("transparent", has(&tx["vin"]) || has(&tx["vout"])),
                    (
                        "sapling",
                        has(&tx["vShieldedSpend"]) || has(&tx["vShieldedOutput"]),
                    ),
                    ("orchard", has(&tx["orchard"]["actions"])),
                    ("ironwood", has(&tx["ironwood"]["actions"])),
                ] {
                    if present {
                        *counts.entry(pool).or_default() += 1;
                        let list = samples.entry(pool).or_default();
                        if list.len() < 8 {
                            list.push(json!({"txid":tx["txid"],"block_height":b.height,"index":index,"version":tx["version"],"locktime":tx["locktime"],"raw":tx["hex"]}));
                        }
                    }
                }
            }
        }
    }
    let mut out = BufWriter::new(File::create_new(&args[2])?);
    serde_json::to_writer(
        &mut out,
        &json!({"network":"testnet","start":start,"end":end,"headers":headers,"transactions":samples,"poolTransactionCounts":counts,"provenance":"Checked stored FullBlock envelopes; no HTTP query code used. Selected records additionally require source-RPC cross-check."}),
    )?;
    std::io::Write::flush(&mut out)?;
    Ok(())
}
