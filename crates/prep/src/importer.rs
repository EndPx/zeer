//! Bounded, read-only ingestion from a real CompactTxStreamer endpoint.
use std::{net::IpAddr, path::PathBuf, time::Duration};

use anyhow::{anyhow, ensure, Result};
use prep_proto::zcash::{
    compact_tx_streamer_client::CompactTxStreamerClient, BlockId, BlockRange, CompactBlock, Empty,
};
use prep_store::{BlockRecord, Manifest, StoreWriter};
use prost::Message;
use tokio::time::{timeout_at, Instant};
use tonic::{
    transport::{Channel, ClientTlsConfig, Endpoint},
    Request,
};
use url::Url;

use crate::{MAX_BLOCK_BYTES, MAX_DATASET_BYTES, MAX_GRPC_BYTES};

#[derive(Debug, Clone)]
pub struct ImportOptions {
    pub source: String,
    pub network: String,
    pub start: u64,
    pub end: u64,
    pub out: PathBuf,
    /// End block hash in RPC display order, supplied independently by the operator.
    pub expected_end_hash: String,
    pub allow_insecure: bool,
    pub deadline_seconds: u64,
    /// Normalize to the lightwallet protocol's default shielded-only view.
    pub shielded_only: bool,
}

pub fn shielded_projection(block: &mut CompactBlock) {
    block.vtx.retain_mut(|tx| {
        tx.vin.clear();
        tx.vout.clear();
        !tx.spends.is_empty()
            || !tx.outputs.is_empty()
            || !tx.actions.is_empty()
            || !tx.ironwood_actions.is_empty()
    });
}

fn hash_display(hash: &[u8]) -> Result<String> {
    ensure!(hash.len() == 32, "invalid_block_hash_length");
    Ok(hex::encode(hash.iter().rev().copied().collect::<Vec<_>>()))
}

fn check_anchor(block: &CompactBlock, height: u64, expected: Option<&str>) -> Result<String> {
    ensure!(block.height == height, "anchor_height_mismatch");
    ensure!(
        block.encoded_len() <= MAX_BLOCK_BYTES,
        "anchor_block_too_large"
    );
    let actual = hash_display(&block.hash)?;
    if let Some(expected) = expected {
        ensure!(actual == expected, "anchor_hash_mismatch");
    }
    Ok(actual)
}

fn private_or_loopback(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}

/// Parse without exposing URL credentials or path data in diagnostics.
pub fn validate_source_url(source: &str, allow_insecure: bool) -> Result<Url> {
    let url = Url::parse(source).map_err(|_| anyhow!("invalid_source_url"))?;
    ensure!(
        matches!(url.scheme(), "http" | "https"),
        "unsupported_source_scheme"
    );
    ensure!(url.host_str().is_some(), "source_host_required");
    ensure!(
        url.username().is_empty() && url.password().is_none(),
        "source_credentials_forbidden"
    );
    ensure!(
        url.query().is_none() && url.fragment().is_none(),
        "source_query_or_fragment_forbidden"
    );
    ensure!(
        url.path().is_empty() || url.path() == "/",
        "source_path_forbidden"
    );
    let loopback = match url.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        Some(url::Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        None => false,
    };
    ensure!(
        url.scheme() == "https" || loopback || allow_insecure,
        "http_nonloopback_requires_allow_insecure"
    );
    if url.scheme() == "http" {
        match url.host() {
            Some(url::Host::Ipv4(ip)) => ensure!(
                private_or_loopback(ip.into()),
                "http_requires_private_address"
            ),
            Some(url::Host::Ipv6(ip)) => ensure!(
                private_or_loopback(ip.into()),
                "http_requires_private_address"
            ),
            _ => {}
        }
    }
    Ok(url)
}

fn remaining(deadline: Instant) -> Result<Duration> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    ensure!(!remaining.is_zero(), "import_deadline_exceeded");
    Ok(remaining)
}

async fn connect(url: &Url, deadline: Instant) -> Result<CompactTxStreamerClient<Channel>> {
    if url.scheme() == "http" && matches!(url.host(), Some(url::Host::Domain(_))) {
        let host = url
            .host_str()
            .ok_or_else(|| anyhow!("source_host_required"))?;
        // DNS is admitted only when every resolved address is local/private.
        let addresses = timeout_at(
            deadline,
            tokio::net::lookup_host((host, url.port_or_known_default().unwrap_or(80))),
        )
        .await
        .map_err(|_| anyhow!("import_deadline_exceeded"))?
        .map_err(|_| anyhow!("source_dns_failed"))?
        .collect::<Vec<_>>();
        ensure!(
            !addresses.is_empty() && addresses.iter().all(|addr| private_or_loopback(addr.ip())),
            "http_requires_private_address"
        );
    }
    let mut endpoint = Endpoint::from_shared(url.as_str().to_owned())
        .map_err(|_| anyhow!("invalid_source_endpoint"))?
        .connect_timeout(remaining(deadline)?.min(Duration::from_secs(15)));
    if url.scheme() == "https" {
        endpoint = endpoint
            .tls_config(ClientTlsConfig::new().with_webpki_roots())
            .map_err(|_| anyhow!("source_tls_configuration_failed"))?;
    }
    let channel = timeout_at(deadline, endpoint.connect())
        .await
        .map_err(|_| anyhow!("import_deadline_exceeded"))?
        .map_err(|_| anyhow!("upstream_connection_failed"))?;
    Ok(CompactTxStreamerClient::new(channel).max_decoding_message_size(MAX_GRPC_BYTES))
}

async fn get_block(
    client: &mut CompactTxStreamerClient<Channel>,
    height: u64,
    deadline: Instant,
) -> Result<CompactBlock> {
    let mut request = Request::new(BlockId {
        height,
        hash: vec![],
    });
    request.set_timeout(remaining(deadline)?.min(Duration::from_secs(15)));
    let response = timeout_at(deadline, client.get_block(request))
        .await
        .map_err(|_| anyhow!("import_deadline_exceeded"))?
        .map_err(|_| anyhow!("upstream_get_block_failed"))?;
    Ok(response.into_inner())
}

fn network_matches(expected: &str, actual: &str) -> bool {
    matches!(
        (expected, actual.to_ascii_lowercase().as_str()),
        ("mainnet", "main" | "mainnet") | ("testnet", "test" | "testnet") | ("regtest", "regtest")
    )
}

fn validate_options(options: &ImportOptions) -> Result<Url> {
    ensure!(
        matches!(options.network.as_str(), "mainnet" | "testnet" | "regtest"),
        "invalid_network"
    );
    ensure!(
        options.start >= 1 && options.start <= options.end && options.end <= u64::from(u32::MAX),
        "invalid_import_range"
    );
    ensure!(
        (1..=600).contains(&options.deadline_seconds),
        "deadline_must_be_1_to_600_seconds"
    );
    ensure!(
        options.expected_end_hash.len() == 64
            && options
                .expected_end_hash
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)),
        "expected_end_hash_must_be_lowercase_rpc_hex"
    );
    validate_source_url(&options.source, options.allow_insecure)
}

/// Import only publishes a readable manifest after all source post-checks pass.
pub async fn import(options: ImportOptions) -> Result<Manifest> {
    let url = validate_options(&options)?;
    ensure!(
        options.end - options.start < prep_store::MAX_BLOCKS,
        "import_range_too_large"
    );
    let deadline = Instant::now() + Duration::from_secs(options.deadline_seconds);
    let mut client = connect(&url, deadline).await?;
    let mut request = Request::new(Empty {});
    request.set_timeout(remaining(deadline)?.min(Duration::from_secs(15)));
    let info = timeout_at(deadline, client.get_lightd_info(request))
        .await
        .map_err(|_| anyhow!("import_deadline_exceeded"))?
        .map_err(|_| anyhow!("upstream_get_info_failed"))?
        .into_inner();
    ensure!(
        network_matches(&options.network, &info.chain_name),
        "source_network_mismatch"
    );
    let predecessor = get_block(&mut client, options.start - 1, deadline).await?;
    let predecessor_hex = check_anchor(&predecessor, options.start - 1, None)?;
    let end_before = get_block(&mut client, options.end, deadline).await?;
    check_anchor(&end_before, options.end, Some(&options.expected_end_hash))?;
    let out = options.out.clone();
    let network = options.network.clone();
    let expected = options.expected_end_hash.clone();
    let predecessor_copy = predecessor_hex.clone();
    let mut writer = tokio::task::spawn_blocking(move || {
        StoreWriter::create(
            &out,
            &network,
            options.start,
            options.end,
            &predecessor_copy,
            &expected,
        )
    })
    .await
    .map_err(|_| anyhow!("store_worker_failed"))??;
    let mut request = Request::new(BlockRange {
        start: Some(BlockId {
            height: options.start,
            hash: vec![],
        }),
        end: Some(BlockId {
            height: options.end,
            hash: vec![],
        }),
        pool_types: vec![],
    });
    // Stream lifetime has the finite overall deadline; each message additionally
    // has a 15-second idle deadline. Unary RPCs use at most 15 seconds each.
    request.set_timeout(remaining(deadline)?);
    let mut stream = timeout_at(deadline, client.get_block_range(request))
        .await
        .map_err(|_| anyhow!("import_deadline_exceeded"))?
        .map_err(|_| anyhow!("upstream_get_range_failed"))?
        .into_inner();
    let mut next = options.start;
    let mut payload_bytes = 0_u64;
    loop {
        let message_deadline = deadline.min(Instant::now() + Duration::from_secs(15));
        let block = timeout_at(message_deadline, stream.message())
            .await
            .map_err(|_| anyhow!("upstream_stream_deadline_exceeded"))?
            .map_err(|_| anyhow!("upstream_stream_failed"))?;
        let Some(mut block) = block else { break };
        ensure!(
            next <= options.end && block.height == next,
            "range_height_gap_or_extra_block"
        );
        if options.shielded_only {
            shielded_projection(&mut block);
        }
        let length = block.encoded_len();
        ensure!(length <= MAX_BLOCK_BYTES, "compact_block_too_large");
        payload_bytes = payload_bytes
            .checked_add(length as u64 + 4)
            .ok_or_else(|| anyhow!("dataset_size_overflow"))?;
        ensure!(payload_bytes <= MAX_DATASET_BYTES, "dataset_too_large");
        let record = BlockRecord {
            height: block.height,
            hash: block.hash.clone(),
            prev_hash: block.prev_hash.clone(),
            payload: block.encode_to_vec(),
        };
        writer = tokio::task::spawn_blocking(move || {
            writer.push(record)?;
            Ok::<_, prep_store::Error>(writer)
        })
        .await
        .map_err(|_| anyhow!("store_worker_failed"))??;
        remaining(deadline)?;
        next += 1;
    }
    ensure!(next == options.end + 1, "truncated_upstream_range");
    let end_after = get_block(&mut client, options.end, deadline).await?;
    check_anchor(&end_after, options.end, Some(&options.expected_end_hash))?;
    let predecessor_after = get_block(&mut client, options.start - 1, deadline).await?;
    check_anchor(
        &predecessor_after,
        options.start - 1,
        Some(&predecessor_hex),
    )?;
    let mut request = Request::new(Empty {});
    request.set_timeout(remaining(deadline)?.min(Duration::from_secs(15)));
    let after_info = timeout_at(deadline, client.get_lightd_info(request))
        .await
        .map_err(|_| anyhow!("import_deadline_exceeded"))?
        .map_err(|_| anyhow!("upstream_get_info_failed"))?
        .into_inner();
    ensure!(
        network_matches(&options.network, &after_info.chain_name),
        "source_network_changed"
    );
    remaining(deadline)?;
    let provenance = serde_json::json!({
        "projection": if options.shielded_only { "shielded-only" } else { "source-payload" },
        "schema_version": 1,
        "source": url.as_str(),
        "network": options.network,
        "upstream_vendor": info.vendor.chars().take(256).collect::<String>(),
        "upstream_version": info.version.chars().take(256).collect::<String>(),
        "upstream_git_commit": info.git_commit.chars().take(256).collect::<String>(),
        "start_height": options.start,
        "end_height": options.end,
        "expected_end_hash": options.expected_end_hash,
        "predecessor_hash": predecessor_hex,
        "anchors_checked_before_and_after": true,
        "pool_types": "empty: upstream default shielded pools",
        "encoding": "prost re-encoding of all fields in pinned CompactBlock schema; unknown future fields are not retained",
        "claim": "immutable source snapshot; integrity and linkage checked, not independent consensus validation or current-chain status"
    });
    let out = options.out;
    tokio::task::spawn_blocking(move || {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(out.join("source.json"))?;
        file.write_all(&serde_json::to_vec_pretty(&provenance)?)?;
        file.sync_all()?;
        Ok::<_, anyhow::Error>(writer.finish()?)
    })
    .await
    .map_err(|_| anyhow!("store_worker_failed"))?
}
