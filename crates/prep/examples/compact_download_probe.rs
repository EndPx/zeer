//! Diagnostic typed consumer. Its verification work differs from ghz; do not
//! substitute its timing into the reference benchmark or a project ranking.
use anyhow::{ensure, Result};
use prep_proto::zcash::{
    compact_tx_streamer_client::CompactTxStreamerClient, BlockId, BlockRange, Empty,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

#[tokio::main(worker_threads = 2)]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    ensure!(
        args.len() == 5,
        "usage: compact_download_probe LOOPBACK_URL START END EXPECTED_DIGEST"
    );
    let url = url::Url::parse(&args[1])?;
    ensure!(
        url.scheme() == "http"
            && url.username().is_empty()
            && url.password().is_none()
            && url
                .host_str()
                .and_then(|h| h.parse::<std::net::IpAddr>().ok())
                .is_some_and(|h| h.is_loopback()),
        "loopback HTTP required"
    );
    let start: u64 = args[2].parse()?;
    let end: u64 = args[3].parse()?;
    ensure!(
        start <= end && end <= u64::from(u32::MAX),
        "invalid bounded range"
    );
    ensure!(
        args[4].len() == 64 && hex::decode(&args[4])?.len() == 32,
        "invalid expected SHA-256"
    );
    let channel = tonic::transport::Endpoint::from_shared(args[1].clone())?
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(120))
        .connect()
        .await?;
    let mut client =
        CompactTxStreamerClient::new(channel).max_decoding_message_size(prep::MAX_GRPC_BYTES);
    let info = client.get_lightd_info(Empty {}).await?.into_inner();
    ensure!(
        info.chain_name == "test" && info.block_height >= end,
        "testnet snapshot does not cover range"
    );
    let now = Instant::now();
    let mut whole = Sha256::new();
    let mut height = start;
    let mut requests = 0;
    let mut bytes = 0u64;
    let mut previous = None;
    let mut encoded = Vec::new();
    for lo in (start..=end).step_by(10000) {
        let hi = (lo + 9999).min(end);
        requests += 1;
        let mut stream = client
            .get_block_range(BlockRange {
                start: Some(BlockId {
                    height: lo,
                    hash: vec![],
                }),
                end: Some(BlockId {
                    height: hi,
                    hash: vec![],
                }),
                pool_types: vec![],
            })
            .await?
            .into_inner();
        while let Some(block) = stream.message().await? {
            ensure!(
                block.height == height && height <= hi,
                "missing, extra or unordered block"
            );
            if let Some(parent) = previous.as_ref() {
                ensure!(&block.prev_hash == parent, "block linkage mismatch");
            }
            previous = Some(block.hash.clone());
            height += 1;
            encoded.clear();
            block.encode(&mut encoded)?;
            bytes += encoded.len() as u64;
            whole.update((encoded.len() as u64).to_be_bytes());
            whole.update(&encoded);
        }
        ensure!(height == hi + 1, "partial range EOF");
    }
    let digest = hex::encode(whole.finalize());
    ensure!(digest == args[4], "full payload digest mismatch");
    println!(
        "{}",
        serde_json::json!({"format":"typed-compact-consumer-diagnostic-v1","blocks":end-start+1,"requests":requests,"payloadBytes":bytes,"digest":digest,"seconds":now.elapsed().as_secs_f64(),"scope":"typed decoding, height/link validation, re-encoding and full SHA-256 inside timer; connection and snapshot metadata excluded; not equivalent to ghz work"})
    );
    Ok(())
}
