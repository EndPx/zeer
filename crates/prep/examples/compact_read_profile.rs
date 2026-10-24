//! Untimed-admission diagnostic; these instrumented times are not RPC latency.
use prep_proto::zcash::CompactBlock;
use prep_store::Archive;
use prost::Message;
use std::time::Instant;
fn main() -> anyhow::Result<()> {
    let a: Vec<_> = std::env::args().collect();
    anyhow::ensure!(
        a.len() == 4,
        "usage: compact_read_profile ARCHIVE START END"
    );
    let archive = Archive::open(&a[1])?;
    let start: u64 = a[2].parse()?;
    let end: u64 = a[3].parse()?;
    anyhow::ensure!(
        start <= end && start >= archive.catalog().start_height && Some(end) <= archive.head(),
        "range is outside the admitted archive"
    );
    let mut checked = 0u128;
    let mut decode = 0u128;
    let mut projection = 0u128;
    let mut encode = 0u128;
    let mut count = 0u64;
    let mut bytes = 0usize;
    let wall = Instant::now();
    let (_, phases) = prep_store::profiling::measure_reads(|| {
        for lo in (start..=end).step_by(10000) {
            let mut reader = archive.read_range(lo, (lo + 9999).min(end))?;
            loop {
                let now = Instant::now();
                let item = reader.next();
                checked += now.elapsed().as_nanos();
                let Some(record) = item else { break };
                let record = record?;
                let now = Instant::now();
                let mut block = CompactBlock::decode(record.payload.as_slice()).unwrap();
                decode += now.elapsed().as_nanos();
                let now = Instant::now();
                prep::importer::shielded_projection(&mut block);
                projection += now.elapsed().as_nanos();
                let now = Instant::now();
                let encoded = block.encode_to_vec();
                encode += now.elapsed().as_nanos();
                bytes += encoded.len();
                count += 1;
            }
        }
        Ok(())
    })?;
    println!(
        "{}",
        serde_json::json!({"blocks":count,"wirePayloadBytes":bytes,"wallSeconds":wall.elapsed().as_secs_f64(),"checkedReadSeconds":checked as f64/1e9,"outerDecodeSeconds":decode as f64/1e9,"projectionSeconds":projection as f64/1e9,"encodeSeconds":encode as f64/1e9,"storePhases":phases,"scope":"instrumented synchronous replay, no network or asynchronous handoff; admission excluded"})
    );
    Ok(())
}
