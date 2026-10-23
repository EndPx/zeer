//! Import a frozen length-prefixed compact capture through Prep's checked writer.
use clap::Parser;
use prep_proto::zcash::CompactBlock;
use prep_store::{BlockRecord, StoreWriter};
use prost::Message;
use std::{
    io::{self, Read},
    path::PathBuf,
};

#[derive(Parser)]
struct Args {
    #[arg(long)]
    out: PathBuf,
    #[arg(long)]
    network: String,
    #[arg(long)]
    start: u64,
    #[arg(long)]
    end: u64,
    #[arg(long)]
    predecessor: String,
    #[arg(long)]
    end_hash: String,
}
fn main() -> anyhow::Result<()> {
    let a = Args::parse();
    let mut writer = StoreWriter::create(
        &a.out,
        &a.network,
        a.start,
        a.end,
        &a.predecessor,
        &a.end_hash,
    )?;
    let mut input = io::BufReader::new(io::stdin().lock());
    for height in a.start..=a.end {
        let mut prefix = [0; 4];
        input.read_exact(&mut prefix)?;
        let length = u32::from_le_bytes(prefix) as usize;
        anyhow::ensure!(
            length > 0 && length <= prep::MAX_BLOCK_BYTES,
            "invalid_compact_frame_size"
        );
        let mut payload = vec![0; length];
        input.read_exact(&mut payload)?;
        let block = CompactBlock::decode(payload.as_slice())?;
        anyhow::ensure!(block.height == height, "capture_height_mismatch");
        writer.push(BlockRecord {
            height,
            hash: block.hash,
            prev_hash: block.prev_hash,
            payload,
        })?;
    }
    let mut extra = [0; 1];
    anyhow::ensure!(input.read(&mut extra)? == 0, "extra_capture_bytes");
    let manifest = writer.finish()?;
    println!(
        "{}",
        serde_json::json!({"dataset_id":manifest.dataset_id,"blocks":manifest.block_count,"segment_bytes":manifest.segment_bytes})
    );
    Ok(())
}
