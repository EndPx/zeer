//! Bounded synthetic cap fixtures; never describe these as real chain blocks.
use prep_store::{ArchiveWriter, BlockRecord, StoreWriter, FULL_KIND};
use prost::Message;
use std::{env, path::PathBuf};
fn hash(height: u64) -> Vec<u8> {
    let mut v = vec![0; 32];
    v[..8].copy_from_slice(&height.to_le_bytes());
    v
}
fn display(height: u64) -> String {
    let mut h = hash(height);
    h.reverse();
    hex::encode(h)
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let root = PathBuf::from(
        args.next()
            .ok_or("Usage: admission_fixture NEW_PATH archive-cap|segment-cap|small")?,
    );
    let mode = args.next().ok_or("missing mode")?;
    if args.next().is_some() || root.exists() {
        return Err("new output directory required".into());
    }
    let rows: Vec<usize> = match mode.as_str() {
        "archive-cap" => vec![220_000; 5],
        "segment-cap" => vec![220_000, 221_000],
        "small" => vec![3, 4, 5],
        _ => return Err("unknown fixture mode".into()),
    };
    let mut archive = ArchiveWriter::create_or_open_with_kind(&root, "regtest", 1, FULL_KIND)?;
    for (i, count) in rows.iter().enumerate() {
        let height = i as u64 + 1;
        let relative = format!("segments/synthetic-{height}");
        let mut store = StoreWriter::create_full(
            root.join(&relative),
            "regtest",
            height,
            height,
            &display(height - 1),
            &display(height),
        )?;
        let tx = format!(
            r#"{{"txid":"{}","hex":"00","version":1,"locktime":0,"vin":[],"vout":[]}}"#,
            "ab".repeat(32)
        );
        let mut decoded = String::with_capacity((tx.len() + 1) * count + 32);
        decoded.push_str(r#"{"synthetic":true,"tx":["#);
        for position in 0..*count {
            if position > 0 {
                decoded.push(',');
            }
            decoded.push_str(&tx);
        }
        decoded.push_str("]}");
        let payload = prep_proto::prep::FullBlock {
            height,
            hash: hash(height),
            prev_hash: hash(height - 1),
            time: 1,
            raw_block: vec![1],
            decoded_json: decoded,
        }
        .encode_to_vec();
        store.push(BlockRecord {
            height,
            hash: hash(height),
            prev_hash: hash(height - 1),
            payload,
        })?;
        store.finish()?;
        archive.append_segment(&relative)?;
    }
    println!(
        "{}",
        serde_json::json!({"synthetic":true,"mode":mode,"rows_per_segment":rows,"catalog_sha256":archive.catalog().catalog_sha256})
    );
    Ok(())
}
