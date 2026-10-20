//! Read-only full-node RPC source. No viewing keys, transaction broadcast or signing.
//!
//! Header hashes and exact transaction-byte inclusion are checked here. The node
//! remains the consensus authority: this is not an independent Zcash validator,
//! and post-Overwinter transaction identifiers are not incorrectly SHA256d'ed.
use std::{
    net::{IpAddr, SocketAddr},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, ensure, Result};
use prep_proto::prep::FullBlock;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;

use crate::importer::validate_source_url;

pub const MAX_RAW_BLOCK_BYTES: usize = 2_000_000;
pub const MAX_RPC_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_FULL_ENVELOPE_BYTES: usize = 64 * 1024 * 1024;

/// Only transport interruptions and explicitly temporary HTTP statuses acquire
/// this type. Integrity, JSON-RPC, authorization and local storage errors never
/// become retryable merely because their text resembles a transport failure.
#[derive(Debug)]
pub(crate) enum TransientSourceError {
    Transport,
    HttpStatus,
}

impl std::fmt::Display for TransientSourceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Transport => "rpc_transport_failed",
            Self::HttpStatus => "rpc_http_status_failed",
        })
    }
}

impl std::error::Error for TransientSourceError {}

pub(crate) fn is_transient_source_error(error: &anyhow::Error) -> bool {
    error.downcast_ref::<TransientSourceError>().is_some()
}

fn transport_error(error: reqwest::Error, fallback: &'static str) -> anyhow::Error {
    use std::error::Error;
    use std::io::ErrorKind;
    let mut source: Option<&(dyn Error + 'static)> = Some(&error);
    let mut transient = error.is_timeout();
    while let Some(cause) = source {
        if let Some(io) = cause.downcast_ref::<std::io::Error>() {
            transient |= matches!(
                io.kind(),
                ErrorKind::ConnectionRefused
                    | ErrorKind::ConnectionReset
                    | ErrorKind::ConnectionAborted
                    | ErrorKind::NotConnected
                    | ErrorKind::BrokenPipe
                    | ErrorKind::TimedOut
                    | ErrorKind::UnexpectedEof
            );
        }
        source = cause.source();
    }
    if transient {
        TransientSourceError::Transport.into()
    } else {
        // Do not preserve an upstream URL, authentication detail or TLS error.
        anyhow!(fallback)
    }
}

/// RPC display-order hash of Zebra's fixed regtest genesis header. Zebra 6.2.3
/// can report `chain: "test"` for Regtest, so the RPC label alone is ambiguous.
/// Verified by SHA256d of the serialized header in the official v6.2.3 fixture:
/// https://github.com/ZcashFoundation/zebra/blob/v6.2.3/zebra-chain/src/block/genesis/block-regtest-0-000-000.txt
/// Also matches benchmarks/fixtures/regtest-1024/regtest-full_transactions.json.
/// Custom genesis networks are not inferred from difficulty or upgrade heights.
pub const ZEBRA_REGTEST_GENESIS_HASH: &str =
    "029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChainInfo {
    pub network: String,
    pub height: u64,
    pub hash: String,
}

#[derive(Clone)]
pub struct NodeRpc {
    client: reqwest::Client,
    url: Url,
    auth: Option<(String, String)>,
    sequence: Arc<AtomicU64>,
}

fn private_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}

pub fn check_hash(value: &str) -> Result<()> {
    ensure!(
        value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "invalid_rpc_hash"
    );
    Ok(())
}

pub fn rpc_hash(bytes: &[u8]) -> Result<String> {
    ensure!(bytes.len() == 32, "invalid_protocol_hash");
    Ok(hex::encode(bytes.iter().rev().copied().collect::<Vec<_>>()))
}

pub fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

impl NodeRpc {
    pub async fn new(source: &str, allow_insecure: bool) -> Result<Self> {
        let auth = match (
            std::env::var("PREP_SOURCE_USER"),
            std::env::var("PREP_SOURCE_PASSWORD"),
        ) {
            (Ok(user), Ok(password)) => {
                ensure!(
                    !user.is_empty() && !password.is_empty(),
                    "empty_rpc_auth_environment"
                );
                Some((user, password))
            }
            (Err(std::env::VarError::NotPresent), Err(std::env::VarError::NotPresent)) => None,
            _ => return Err(anyhow!("rpc_auth_requires_user_and_password_environment")),
        };
        Self::with_auth(source, allow_insecure, auth).await
    }

    pub async fn with_auth(
        source: &str,
        allow_insecure: bool,
        auth: Option<(String, String)>,
    ) -> Result<Self> {
        let url = validate_source_url(source, allow_insecure)?;
        let mut builder = reqwest::Client::builder()
            .https_only(url.scheme() == "https")
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(15));
        if url.scheme() == "http" {
            let addresses: Vec<SocketAddr> = match url.host() {
                Some(url::Host::Ipv4(ip)) => vec![SocketAddr::new(
                    ip.into(),
                    url.port_or_known_default().unwrap_or(80),
                )],
                Some(url::Host::Ipv6(ip)) => vec![SocketAddr::new(
                    ip.into(),
                    url.port_or_known_default().unwrap_or(80),
                )],
                Some(url::Host::Domain(host)) => tokio::time::timeout(
                    Duration::from_secs(10),
                    tokio::net::lookup_host((host, url.port_or_known_default().unwrap_or(80))),
                )
                .await
                .map_err(|_| anyhow!("rpc_dns_timeout"))?
                .map_err(|_| anyhow!("rpc_dns_failed"))?
                .collect(),
                None => return Err(anyhow!("rpc_host_required")),
            };
            ensure!(
                !addresses.is_empty()
                    && addresses
                        .iter()
                        .all(|address| private_address(address.ip())),
                "http_requires_private_address"
            );
            if let Some(url::Host::Domain(host)) = url.host() {
                // Pin the admitted private DNS answer for this client instance.
                builder = builder.resolve_to_addrs(host, &addresses);
            }
        }
        let client = builder
            .build()
            .map_err(|_| anyhow!("rpc_client_configuration_failed"))?;
        Ok(Self {
            client,
            url,
            auth,
            sequence: Arc::new(AtomicU64::new(1)),
        })
    }

    /// No credentials, query, fragment or sensitive path can enter this label.
    pub fn source_label(&self) -> String {
        self.url.as_str().to_owned()
    }

    async fn call(&self, method: &'static str, params: Value) -> Result<Value> {
        ensure!(
            matches!(
                method,
                "getblockchaininfo"
                    | "getblockhash"
                    | "getblock"
                    | "getrawmempool"
                    | "getrawtransaction"
            ),
            "rpc_method_not_readonly_allowlisted"
        );
        let id = self.sequence.fetch_add(1, Ordering::Relaxed);
        let mut request = self
            .client
            .post(self.url.clone())
            .json(&json!({"jsonrpc": "1.0", "id": id, "method": method, "params": params}));
        if let Some((user, password)) = &self.auth {
            request = request.basic_auth(user, Some(password));
        }
        let mut response = request
            .send()
            .await
            .map_err(|error| transport_error(error, "rpc_transport_failed"))?;
        let lookup_error_status =
            method == "getrawtransaction" && response.status().as_u16() == 500;
        if (response.status().is_server_error() || response.status().as_u16() == 429)
            && !lookup_error_status
        {
            return Err(TransientSourceError::HttpStatus.into());
        }
        ensure!(
            response.status().is_success() || lookup_error_status,
            "rpc_http_status_failed"
        );
        ensure!(
            response
                .content_length()
                .map(|size| size <= MAX_RPC_BYTES as u64)
                .unwrap_or(true),
            "rpc_response_too_large"
        );
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| transport_error(error, "rpc_body_failed"))?
        {
            ensure!(
                body.len()
                    .checked_add(chunk.len())
                    .map(|len| len <= MAX_RPC_BYTES)
                    .unwrap_or(false),
                "rpc_response_too_large"
            );
            body.extend_from_slice(&chunk);
        }
        let mut reply: Value =
            serde_json::from_slice(&body).map_err(|_| anyhow!("rpc_invalid_json"))?;
        if method == "getrawtransaction"
            && reply.get("id").and_then(Value::as_u64) == Some(id)
            && reply
                .get("error")
                .and_then(|e| e.get("code"))
                .and_then(Value::as_i64)
                == Some(-5)
        {
            return Ok(Value::Null);
        }
        ensure!(
            reply.is_object()
                && reply.get("id").and_then(Value::as_u64) == Some(id)
                && reply.get("error").map(Value::is_null).unwrap_or(true),
            "rpc_response_error"
        );
        let result = reply
            .as_object_mut()
            .and_then(|map| map.remove("result"))
            .ok_or_else(|| anyhow!("rpc_missing_result"))?;
        ensure!(!result.is_null(), "rpc_null_result");
        Ok(result)
    }

    pub async fn chain_info(&self) -> Result<ChainInfo> {
        let result = self.call("getblockchaininfo", json!([])).await?;
        let network = match result.get("chain").and_then(Value::as_str) {
            Some("main" | "mainnet") => "mainnet",
            Some("test" | "testnet") => {
                // Do not turn a failed/invalid genesis lookup into a guessed
                // network. block_hash validates the response and propagates errors.
                if self.block_hash(0).await? == ZEBRA_REGTEST_GENESIS_HASH {
                    "regtest"
                } else {
                    "testnet"
                }
            }
            Some("regtest") => "regtest",
            _ => return Err(anyhow!("rpc_unknown_network")),
        };
        let height = result
            .get("blocks")
            .and_then(Value::as_u64)
            .ok_or_else(|| anyhow!("rpc_invalid_chain_height"))?;
        ensure!(height <= u64::from(u32::MAX), "rpc_chain_height_overflow");
        let hash = result
            .get("bestblockhash")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("rpc_missing_chain_hash"))?
            .to_owned();
        check_hash(&hash)?;
        Ok(ChainInfo {
            network: network.into(),
            height,
            hash,
        })
    }

    pub async fn mempool(&self) -> Result<Value> {
        self.call("getrawmempool", json!([true])).await
    }

    pub async fn transaction(&self, txid: &str) -> Result<Option<Value>> {
        check_hash(txid)?;
        let result = self.call("getrawtransaction", json!([txid, 1])).await?;
        if result.is_null() {
            return Ok(None);
        }
        ensure!(
            result.is_object() && result.get("txid").and_then(Value::as_str) == Some(txid),
            "rpc_transaction_identity_mismatch"
        );
        Ok(Some(result))
    }

    pub async fn block_hash(&self, height: u64) -> Result<String> {
        ensure!(height <= u64::from(u32::MAX), "rpc_block_height_overflow");
        let result = self.call("getblockhash", json!([height])).await?;
        let hash = result
            .as_str()
            .ok_or_else(|| anyhow!("rpc_missing_block_hash"))?
            .to_owned();
        check_hash(&hash)?;
        Ok(hash)
    }

    pub async fn full_block(&self, height: u64) -> Result<FullBlock> {
        let expected_hash = self.block_hash(height).await?;
        self.full_block_by_hash(height, &expected_hash).await
    }

    pub async fn full_block_by_hash(&self, height: u64, expected_hash: &str) -> Result<FullBlock> {
        check_hash(expected_hash)?;
        // Both representations address the same immutable hash. Fetch them
        // together while keeping per-response limits and request deadlines;
        // try_join drops the sibling request if either RPC fails. The follower
        // still processes one block at a time and verifies the source anchors.
        let raw_request = async {
            let raw_result = self.call("getblock", json!([expected_hash, 0])).await?;
            let raw_hex = raw_result
                .as_str()
                .ok_or_else(|| anyhow!("rpc_missing_raw_block"))?;
            ensure!(
                raw_hex.len() <= MAX_RAW_BLOCK_BYTES * 2,
                "raw_block_too_large"
            );
            hex::decode(raw_hex).map_err(|_| anyhow!("rpc_invalid_raw_block_hex"))
        };
        let (raw, decoded) = tokio::try_join!(
            raw_request,
            self.call("getblock", json!([expected_hash, 2])),
        )?;
        validate_full_block(height, expected_hash, raw, decoded)
    }
}

fn compact_size(bytes: &[u8], position: &mut usize) -> Result<u64> {
    let tag = *bytes
        .get(*position)
        .ok_or_else(|| anyhow!("truncated_compact_size"))?;
    *position += 1;
    if tag < 253 {
        return Ok(u64::from(tag));
    }
    let (size, minimum) = match tag {
        253 => (2, 253),
        254 => (4, 65536),
        _ => (8, 4_294_967_296),
    };
    let end = position
        .checked_add(size)
        .ok_or_else(|| anyhow!("compact_size_overflow"))?;
    let encoded = bytes
        .get(*position..end)
        .ok_or_else(|| anyhow!("truncated_compact_size"))?;
    let mut padded = [0u8; 8];
    padded[..size].copy_from_slice(encoded);
    let value = u64::from_le_bytes(padded);
    ensure!(value >= minimum, "noncanonical_compact_size");
    *position = end;
    Ok(value)
}

/// Validate full raw-block identity and exact inclusion of every RPC transaction.
pub fn validate_full_block(
    height: u64,
    expected_hash: &str,
    raw: Vec<u8>,
    decoded: Value,
) -> Result<FullBlock> {
    use prost::Message;
    check_hash(expected_hash)?;
    ensure!(height <= u64::from(u32::MAX), "invalid_full_block_height");
    ensure!(
        raw.len() >= 142 && raw.len() <= MAX_RAW_BLOCK_BYTES,
        "invalid_raw_block_size"
    );
    ensure!(decoded.is_object(), "decoded_block_must_be_object");
    ensure!(
        decoded.get("hash").and_then(Value::as_str) == Some(expected_hash),
        "decoded_block_hash_mismatch"
    );
    ensure!(
        decoded.get("height").and_then(Value::as_u64) == Some(height),
        "decoded_block_height_mismatch"
    );
    let mut cursor = 140;
    let solution_length = usize::try_from(compact_size(&raw, &mut cursor)?)
        .map_err(|_| anyhow!("solution_length_overflow"))?;
    let header_end = cursor
        .checked_add(solution_length)
        .ok_or_else(|| anyhow!("header_length_overflow"))?;
    let header = raw
        .get(..header_end)
        .ok_or_else(|| anyhow!("truncated_header_solution"))?;
    let hash = Sha256::digest(Sha256::digest(header));
    ensure!(
        rpc_hash(hash.as_slice())? == expected_hash,
        "raw_header_hash_mismatch"
    );
    let previous = &raw[4..36];
    ensure!(
        height != 0 || previous.iter().all(|byte| *byte == 0),
        "genesis_parent_must_be_zero"
    );
    ensure!(
        decoded.get("previousblockhash").and_then(Value::as_str)
            == Some(rpc_hash(previous)?.as_str()),
        "raw_header_parent_mismatch"
    );
    let time = u32::from_le_bytes(
        raw[100..104]
            .try_into()
            .expect("fixed checked header range"),
    );
    ensure!(
        decoded.get("time").and_then(Value::as_u64) == Some(u64::from(time)),
        "raw_header_time_mismatch"
    );
    if let Some(size) = decoded.get("size") {
        ensure!(
            size.as_u64() == Some(raw.len() as u64),
            "decoded_raw_size_mismatch"
        );
    }
    cursor = header_end;
    let transaction_count = compact_size(&raw, &mut cursor)?;
    let transactions = decoded
        .get("tx")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("full_transaction_objects_required"))?;
    ensure!(
        transaction_count > 0 && transaction_count == transactions.len() as u64,
        "raw_transaction_count_mismatch"
    );
    if let Some(count) = decoded.get("nTx") {
        ensure!(
            count.as_u64() == Some(transaction_count),
            "decoded_transaction_count_mismatch"
        );
    }
    let mut ids = std::collections::HashSet::new();
    for transaction in transactions {
        ensure!(transaction.is_object(), "full_transaction_objects_required");
        let id = transaction
            .get("txid")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("transaction_id_required"))?;
        check_hash(id)?;
        ensure!(ids.insert(id), "duplicate_transaction_id");
        let hex = transaction
            .get("hex")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("full_transaction_hex_required"))?;
        ensure!(
            !hex.is_empty() && hex.len() <= MAX_RAW_BLOCK_BYTES * 2,
            "invalid_transaction_hex_size"
        );
        let bytes = hex::decode(hex).map_err(|_| anyhow!("invalid_transaction_hex"))?;
        let end = cursor
            .checked_add(bytes.len())
            .ok_or_else(|| anyhow!("transaction_length_overflow"))?;
        ensure!(
            raw.get(cursor..end) == Some(bytes.as_slice()),
            "raw_transaction_bytes_mismatch"
        );
        cursor = end;
    }
    ensure!(cursor == raw.len(), "trailing_raw_block_data");
    // Retain all decoded source fields, including unknown extensions and values
    // such as confirmations that are only true at capture time. Capture time is
    // recorded in the segment source sidecar, not inserted into upstream JSON.
    let decoded_json = serde_json::to_string(&decoded)?;
    ensure!(
        decoded_json.len() <= MAX_RPC_BYTES,
        "decoded_json_too_large"
    );
    let result = FullBlock {
        height,
        hash: hash.to_vec(),
        prev_hash: previous.to_vec(),
        time: u64::from(time),
        raw_block: raw,
        decoded_json,
    };
    ensure!(
        result.encoded_len() <= MAX_FULL_ENVELOPE_BYTES,
        "full_block_envelope_too_large"
    );
    Ok(result)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[tokio::test]
    async fn only_temporary_http_statuses_and_connection_failures_are_retryable() {
        use axum::{extract::State, http::StatusCode, routing::post, Router};
        use tokio::net::TcpListener;
        async fn handler(State(code): State<StatusCode>) -> (StatusCode, &'static str) {
            (
                code,
                "invalid JSON or an upstream secret must never reach errors",
            )
        }
        for (code, retryable) in [
            (429, true),
            (500, true),
            (503, true),
            (400, false),
            (401, false),
            (403, false),
            (200, false),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let source = format!("http://{}", listener.local_addr().unwrap());
            let app = Router::new()
                .route("/", post(handler))
                .with_state(StatusCode::from_u16(code).unwrap());
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let client = NodeRpc::with_auth(&source, false, None).await.unwrap();
            let error = client.chain_info().await.unwrap_err();
            assert_eq!(
                is_transient_source_error(&error),
                retryable,
                "HTTP {code}: {error}"
            );
            assert!(!format!("{error:#}").contains("secret"));
            server.abort();
            let _ = server.await;
        }
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let source = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let client = NodeRpc::with_auth(&source, false, None).await.unwrap();
        assert!(is_transient_source_error(
            &client.chain_info().await.unwrap_err()
        ));
        for message in [
            "rpc_transport_failed",
            "rpc_http_status_failed",
            "raw_header_hash_mismatch",
            "source_network_mismatch",
            "archive_disk_budget_exhausted",
            "deep_reorg_requires_operator_recovery",
            "sync_deadline_exceeded",
        ] {
            assert!(!is_transient_source_error(&anyhow!(message)));
        }
    }

    pub(crate) fn fixture(height: u64, parent: &[u8], marker: u8) -> (String, Vec<u8>, Value) {
        let mut raw = vec![0u8; 140];
        raw[..4].copy_from_slice(&4u32.to_le_bytes());
        raw[4..36].copy_from_slice(parent);
        raw[100..104].copy_from_slice(&(1_700_000_000u32 + height as u32).to_le_bytes());
        raw[108] = marker;
        raw.push(0); // Canonical empty Equihash solution for a structural fixture.
        let id = rpc_hash(&Sha256::digest(Sha256::digest(&raw))).unwrap();
        let tx1 = vec![5, 0, 0, 128, marker, 22, 23];
        let tx2 = vec![1, 0, 0, 0, marker, 33];
        raw.push(2);
        raw.extend_from_slice(&tx1);
        raw.extend_from_slice(&tx2);
        let decoded = json!({
            "hash": id, "height": height, "previousblockhash": rpc_hash(parent).unwrap(),
            "time": 1_700_000_000u64 + height, "size": raw.len(), "nTx": 2,
            "confirmations": 42, "futureField": {"preserve": true},
            "tx": [
                {"txid": "11".repeat(32), "hex": hex::encode(tx1), "vin": [], "vout": [], "orchard": {"encryptedPayload": "abcd"}},
                {"txid": "22".repeat(32), "hex": hex::encode(tx2), "vin": [], "vout": []}
            ]
        });
        (id, raw, decoded)
    }

    #[test]
    fn genesis_requires_a_zero_predecessor() {
        let (id, raw, decoded) = fixture(0, &[0; 32], 1);
        assert!(validate_full_block(0, &id, raw, decoded).is_ok());
        let (id, raw, decoded) = fixture(0, &[1; 32], 1);
        assert_eq!(
            validate_full_block(0, &id, raw, decoded)
                .unwrap_err()
                .to_string(),
            "genesis_parent_must_be_zero"
        );
    }

    #[test]
    fn full_bytes_extensions_and_non_sha256d_v5_ids_are_preserved() {
        let (id, raw, mut decoded) = fixture(10, &[9; 32], 1);
        decoded["futurePreciseAmount"] =
            serde_json::from_str("0.12345678901234567890123456789").unwrap();
        let block = validate_full_block(10, &id, raw.clone(), decoded.clone()).unwrap();
        assert_eq!(block.raw_block, raw);
        assert_eq!(
            serde_json::from_str::<Value>(&block.decoded_json).unwrap(),
            decoded
        );
        assert!(block
            .decoded_json
            .contains("0.12345678901234567890123456789"));
    }

    #[test]
    fn header_identity_transaction_inclusion_and_counts_are_checked() {
        let (id, raw, decoded) = fixture(10, &[9; 32], 1);
        let mut wrong = raw.clone();
        wrong[100] ^= 1;
        assert!(validate_full_block(10, &id, wrong, decoded.clone()).is_err());
        let mut wrong = decoded.clone();
        wrong["tx"][1]["hex"] = json!("00");
        assert!(validate_full_block(10, &id, raw.clone(), wrong).is_err());
        let mut wrong = decoded.clone();
        wrong["nTx"] = json!(3);
        assert!(validate_full_block(10, &id, raw.clone(), wrong).is_err());
        let mut wrong = decoded.clone();
        wrong["tx"] = json!(["txid-only"]);
        assert!(validate_full_block(10, &id, raw.clone(), wrong).is_err());
        let mut wrong = decoded.clone();
        wrong["previousblockhash"] = json!("00".repeat(32));
        assert!(validate_full_block(10, &id, raw.clone(), wrong).is_err());
        let mut wrong = raw.clone();
        wrong.push(0);
        assert!(validate_full_block(10, &id, wrong, decoded).is_err());
    }

    #[test]
    fn compact_size_rejects_noncanonical_and_truncated_values() {
        assert!(compact_size(&[253, 1, 0], &mut 0).is_err());
        assert!(compact_size(&[254, 255, 255, 0, 0], &mut 0).is_err());
        assert!(compact_size(&[255, 1], &mut 0).is_err());
        assert_eq!(compact_size(&[253, 253, 0], &mut 0).unwrap(), 253);
    }

    #[tokio::test]
    async fn full_rpc_requests_overlap_and_preserve_validated_content() {
        use axum::{extract::State, routing::post, Json, Router};
        use tokio::{net::TcpListener, sync::Barrier};

        #[derive(Clone)]
        struct Reply {
            hash: String,
            raw: String,
            decoded: Value,
            arrivals: Arc<AtomicU64>,
            both_requests: Arc<Barrier>,
        }
        async fn handler(State(state): State<Reply>, Json(request): Json<Value>) -> Json<Value> {
            assert_eq!(request["method"], "getblock");
            assert_eq!(request["params"][0], state.hash);
            let result = match request["params"][1].as_u64().unwrap() {
                0 => {
                    state.arrivals.fetch_or(1, Ordering::SeqCst);
                    json!(state.raw)
                }
                2 => {
                    state.arrivals.fetch_or(2, Ordering::SeqCst);
                    state.decoded
                }
                _ => panic!("unexpected block verbosity"),
            };
            // Neither response can finish until both requests reached the
            // server. This proves overlap without comparing elapsed timings.
            state.both_requests.wait().await;
            Json(json!({"id": request["id"], "result": result, "error": null}))
        }

        for corrupt_raw in [false, true] {
            let (hash, raw, mut decoded) = fixture(10, &[9; 32], 1);
            decoded["futurePreciseAmount"] =
                serde_json::from_str("0.12345678901234567890123456789").unwrap();
            let mut served_raw = raw.clone();
            if corrupt_raw {
                *served_raw.last_mut().unwrap() ^= 1;
            }
            let arrivals = Arc::new(AtomicU64::new(0));
            let app = Router::new().route("/", post(handler)).with_state(Reply {
                hash: hash.clone(),
                raw: hex::encode(served_raw),
                decoded: decoded.clone(),
                arrivals: arrivals.clone(),
                both_requests: Arc::new(Barrier::new(2)),
            });
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let source = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let client = NodeRpc::with_auth(&source, false, None).await.unwrap();
            // A sequential implementation deadlocks at the barrier; this is a
            // bounded test guard rather than a throughput expectation.
            let result =
                tokio::time::timeout(Duration::from_secs(3), client.full_block_by_hash(10, &hash))
                    .await;
            server.abort();
            let _ = server.await;
            assert_eq!(arrivals.load(Ordering::SeqCst), 3);
            let result = result.expect("both RPC requests must reach the barrier");
            if corrupt_raw {
                assert_eq!(
                    result.unwrap_err().to_string(),
                    "raw_transaction_bytes_mismatch"
                );
            } else {
                assert_eq!(
                    result.unwrap(),
                    validate_full_block(10, &hash, raw, decoded).unwrap()
                );
            }
        }
    }

    #[tokio::test]
    async fn failed_full_rpc_does_not_wait_for_pending_sibling() {
        use axum::{extract::State, routing::post, Json, Router};
        use tokio::{net::TcpListener, sync::Barrier};

        #[derive(Clone)]
        struct Reply {
            failed_verbosity: u64,
            failed_result: Option<Value>,
            both_requests: Arc<Barrier>,
        }
        async fn handler(State(state): State<Reply>, Json(request): Json<Value>) -> Json<Value> {
            state.both_requests.wait().await;
            if request["params"][1].as_u64() != Some(state.failed_verbosity) {
                // The companion request never supplies a response. try_join
                // must return the other request's error without waiting for it.
                std::future::pending::<()>().await;
            }
            match state.failed_result {
                Some(result) => Json(json!({"id": request["id"], "result": result, "error": null})),
                None => Json(json!({
                    "id": request["id"], "result": null,
                    "error": {"code": -8, "message": "unavailable"}
                })),
            }
        }
        for (failed_verbosity, failed_result, expected_error) in [
            (0, None, "rpc_response_error"),
            (2, None, "rpc_response_error"),
            (0, Some(json!("zz")), "rpc_invalid_raw_block_hex"),
            (0, Some(json!({})), "rpc_missing_raw_block"),
        ] {
            let app = Router::new().route("/", post(handler)).with_state(Reply {
                failed_verbosity,
                failed_result,
                both_requests: Arc::new(Barrier::new(2)),
            });
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let source = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let client = NodeRpc::with_auth(&source, false, None).await.unwrap();
            let result = tokio::time::timeout(
                Duration::from_secs(3),
                client.full_block_by_hash(10, &"11".repeat(32)),
            )
            .await;
            server.abort();
            let _ = server.await;
            assert_eq!(
                result
                    .expect("RPC failure must cancel the pending sibling")
                    .unwrap_err()
                    .to_string(),
                expected_error
            );
        }
    }

    #[tokio::test]
    async fn test_rpc_alias_uses_exact_genesis_and_lookup_errors_fail_closed() {
        use axum::{extract::State, routing::post, Json, Router};
        use tokio::{net::TcpListener, sync::oneshot};

        #[derive(Clone)]
        struct Reply {
            label: &'static str,
            genesis: Option<Value>,
            genesis_requests: Arc<AtomicU64>,
        }
        async fn handler(State(state): State<Reply>, Json(request): Json<Value>) -> Json<Value> {
            let result = match request["method"].as_str().unwrap() {
                "getblockchaininfo" => Some(json!({
                    "chain": state.label, "blocks": 1024,
                    "bestblockhash": "11".repeat(32)
                })),
                "getblockhash" => {
                    assert_eq!(request["params"], json!([0]));
                    state.genesis_requests.fetch_add(1, Ordering::SeqCst);
                    state.genesis.clone()
                }
                _ => panic!("unexpected RPC method"),
            };
            match result {
                Some(value) => Json(json!({"id": request["id"], "result": value, "error": null})),
                None => Json(
                    json!({"id": request["id"], "result": null, "error": {"code": -8, "message": "unavailable"}}),
                ),
            }
        }
        let mut cases = Vec::new();
        for label in ["test", "testnet"] {
            cases.push((
                label,
                Some(json!(ZEBRA_REGTEST_GENESIS_HASH)),
                Some("regtest"),
            ));
            cases.push((label, Some(json!("22".repeat(32))), Some("testnet")));
            cases.push((label, Some(json!("malformed")), None));
            cases.push((label, None, None));
        }
        // Mainnet's unambiguous RPC label does not acquire a new dependency on
        // getblockhash(0); the actual Mainnet integration remains unchanged.
        cases.push(("main", None, Some("mainnet")));
        for (label, genesis, expected) in cases {
            let requests = Arc::new(AtomicU64::new(0));
            let app = Router::new().route("/", post(handler)).with_state(Reply {
                label,
                genesis,
                genesis_requests: requests.clone(),
            });
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let source = format!("http://{}", listener.local_addr().unwrap());
            let (stop, stopped) = oneshot::channel();
            let task = tokio::spawn(async move {
                axum::serve(listener, app)
                    .with_graceful_shutdown(async {
                        let _ = stopped.await;
                    })
                    .await
                    .unwrap();
            });
            let client = NodeRpc::with_auth(&source, false, None).await.unwrap();
            let result = client.chain_info().await;
            if let Some(expected) = expected {
                assert_eq!(result.unwrap().network, expected);
            } else {
                assert!(result.is_err());
            }
            assert_eq!(requests.load(Ordering::SeqCst), u64::from(label != "main"));
            stop.send(()).unwrap();
            tokio::time::timeout(Duration::from_secs(2), task)
                .await
                .unwrap()
                .unwrap();
        }
    }
}
