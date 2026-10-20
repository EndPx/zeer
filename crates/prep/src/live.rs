//! Optional read-only node observations. Never feed mempool data into the archive.
use crate::full_source::{check_hash, unix_seconds, NodeRpc};
use crate::query::{lossless_node_json, transaction_summary};
use anyhow::{anyhow, ensure, Result};
use serde_json::{json, Value};
use std::{io::Read, path::Path};

pub const MAX_LIVE_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_MEMPOOL_ROWS: usize = 20;
const TESTNET_GENESIS: &str = "05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38";

fn protected_text(path: &str) -> Result<String> {
    ensure!(
        Path::new(path).is_absolute(),
        "live_source_path_must_be_absolute"
    );
    let file = std::fs::File::open(path)?;
    let mut text = String::new();
    file.take(4097).read_to_string(&mut text)?;
    ensure!(text.len() <= 4096, "live_source_configuration_too_large");
    Ok(text.trim().to_owned())
}
async fn connect() -> Result<NodeRpc> {
    let path = std::env::var("PREP_LIVE_SOURCE_FILE")
        .map_err(|_| anyhow!("LIVE_SOURCE_NOT_CONFIGURED"))?;
    let url = protected_text(&path)?;
    let cookie_path = std::env::var("PREP_LIVE_COOKIE_FILE")?;
    let cookie = protected_text(&cookie_path)?;
    let (user, password) = cookie
        .split_once(':')
        .ok_or_else(|| anyhow!("invalid_live_cookie"))?;
    ensure!(
        !user.is_empty() && !password.is_empty(),
        "invalid_live_cookie"
    );
    NodeRpc::with_auth(
        &url,
        std::env::var("PREP_LIVE_ALLOW_INSECURE").as_deref() == Ok("true"),
        Some((user.into(), password.into())),
    )
    .await
}
pub fn configured() -> bool {
    std::env::var_os("PREP_LIVE_SOURCE_FILE").is_some()
}

async fn identity(rpc: &NodeRpc) -> Result<()> {
    let info = rpc.chain_info().await?;
    ensure!(
        info.network == "testnet" && rpc.block_hash(0).await? == TESTNET_GENESIS,
        "live_source_network_mismatch"
    );
    Ok(())
}

fn mempool_entries(value: &Value) -> Result<Vec<(String, Option<u64>)>> {
    let mut entries = match value {
        Value::Object(map) => map
            .iter()
            .map(|(id, entry)| (id.clone(), entry.get("time").and_then(Value::as_u64)))
            .collect::<Vec<_>>(),
        Value::Array(ids) => ids
            .iter()
            .map(|id| {
                id.as_str()
                    .map(|id| (id.to_owned(), None))
                    .ok_or_else(|| anyhow!("invalid_mempool_id"))
            })
            .collect::<Result<Vec<_>>>()?,
        _ => return Err(anyhow!("invalid_mempool_response")),
    };
    ensure!(entries.len() <= 50_000, "mempool_snapshot_too_large");
    for (id, _) in &entries {
        check_hash(id)?;
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries.dedup_by(|a, b| a.0 == b.0);
    Ok(entries)
}

fn mined_height(tx: &Value) -> Result<Option<u64>> {
    if tx.get("blockhash").is_some_and(Value::is_string) {
        let height = tx
            .get("height")
            .and_then(Value::as_u64)
            .ok_or_else(|| anyhow!("mined_transaction_height_missing"))?;
        ensure!(height <= u64::from(u32::MAX), "invalid_transaction_height");
        Ok(Some(height))
    } else {
        Ok(None)
    }
}

pub async fn transaction(txid: &str) -> Result<Value> {
    check_hash(txid)?;
    let rpc = connect().await?;
    transaction_from(&rpc, txid).await
}
async fn transaction_from(rpc: &NodeRpc, txid: &str) -> Result<Value> {
    check_hash(txid)?;
    identity(rpc).await?;
    let tx = rpc.transaction(txid).await?;
    let Some(tx) = tx else {
        let entries = mempool_entries(&rpc.mempool().await?)?;
        ensure!(
            !entries.iter().any(|(id, _)| id == txid),
            "mempool_lookup_race"
        );
        return Ok(
            json!({"network":"testnet","status":"not_observed","txid":txid,"observed_at":unix_seconds(),"transaction":null}),
        );
    };
    let summary = transaction_summary(&tx).map_err(|_| anyhow!("invalid_source_transaction"))?;
    let height = mined_height(&tx)?;
    let (status, confirmations, source_height, first_seen) = if let Some(height) = height {
        let block_hash = tx
            .get("blockhash")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("missing_block_hash"))?;
        check_hash(block_hash)?;
        ensure!(
            rpc.block_hash(height).await? == block_hash,
            "source_chain_changed"
        );
        let info = rpc.chain_info().await?;
        ensure!(info.height >= height, "source_chain_changed");
        // Recheck after the observed tip, rather than trusting cached confirmations.
        ensure!(
            rpc.block_hash(height).await? == block_hash,
            "source_chain_changed"
        );
        (
            "mined",
            Some(info.height - height + 1),
            Some(info.height),
            None,
        )
    } else {
        ensure!(
            summary["is_coinbase"] == false,
            "coinbase_cannot_be_pending"
        );
        let entries = mempool_entries(&rpc.mempool().await?)?;
        let entry = entries
            .iter()
            .find(|(id, _)| id == txid)
            .ok_or_else(|| anyhow!("mempool_lookup_race"))?;
        (
            "pending",
            None,
            None,
            entry.1.filter(|time| *time <= unix_seconds() + 5),
        )
    };
    Ok(
        json!({"network":"testnet","status":status,"txid":txid,"observed_at":unix_seconds(),"source_height":source_height,
        "block_height":height,"block_hash":tx.get("blockhash"),"confirmations":confirmations,"source_first_seen_at":first_seen,
        "transaction":summary,"decoded":lossless_node_json(&tx)}),
    )
}

pub async fn mempool() -> Result<Value> {
    let rpc = connect().await?;
    mempool_from(&rpc).await
}
async fn mempool_from(rpc: &NodeRpc) -> Result<Value> {
    identity(rpc).await?;
    let entries = mempool_entries(&rpc.mempool().await?)?;
    let observed_total = entries.len();
    let mut rows = vec![];
    let mut raced = 0;
    for (id, time) in entries.iter().take(MAX_MEMPOOL_ROWS) {
        if let Some(tx) = rpc.transaction(id).await? {
            if mined_height(&tx)?.is_some() {
                raced += 1;
                continue;
            }
            let mut summary =
                transaction_summary(&tx).map_err(|_| anyhow!("invalid_source_transaction"))?;
            ensure!(
                summary["is_coinbase"] == false,
                "coinbase_cannot_be_pending"
            );
            summary["source_first_seen_at"] =
                json!(time.filter(|time| *time <= unix_seconds() + 5));
            rows.push(summary);
        } else {
            raced += 1;
        }
    }
    // Omit entries that left during decoding; never claim they are still pending.
    let current = mempool_entries(&rpc.mempool().await?)?;
    let count = rows.len();
    rows.retain(|row| {
        current
            .iter()
            .any(|(id, _)| row["txid"].as_str() == Some(id.as_str()))
    });
    raced += count - rows.len();
    Ok(
        json!({"network":"testnet","observed_at":unix_seconds(),"source_total":observed_total,"max_rows":MAX_MEMPOOL_ROWS,"raced_out":raced,"has_more":observed_total>MAX_MEMPOOL_ROWS,"transactions":rows}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mempool_shapes_do_not_invent_waiting_times_or_accept_invalid_ids() {
        let id = "11".repeat(32);
        let entries = mempool_entries(&json!({id.clone():{"size":2}})).unwrap();
        assert_eq!(entries, vec![(id.clone(), None)]);
        assert_eq!(mempool_entries(&json!([id.clone(), id])).unwrap().len(), 1);
        assert!(mempool_entries(&json!(["bad"])).is_err());
        assert!(mempool_entries(&Value::Null).is_err());
        assert!(mined_height(&json!({"blockhash":"11".repeat(32)})).is_err());
        assert_eq!(mined_height(&json!({"height":0})).unwrap(), None);
    }

    #[tokio::test]
    async fn actual_rpc_pending_mined_absent_and_reorg_observations_remain_distinct() {
        use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
        use std::sync::{
            atomic::{AtomicU8, Ordering},
            Arc,
        };
        async fn reply(
            State(mode): State<Arc<AtomicU8>>,
            Json(q): Json<Value>,
        ) -> (StatusCode, Json<Value>) {
            let state = mode.load(Ordering::SeqCst);
            let id = "11".repeat(32);
            if q["method"] == "getrawtransaction" && state == 2 {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        json!({"id":q["id"],"result":null,"error":{"code":-5,"message":"No information"}}),
                    ),
                );
            }
            let result = match q["method"].as_str().unwrap() {
                "getblockchaininfo" => {
                    json!({"chain":"test","blocks":10,"bestblockhash":"aa".repeat(32)})
                }
                "getblockhash" => {
                    if q["params"][0] == 0 {
                        json!(TESTNET_GENESIS)
                    } else {
                        json!(if state == 4 {
                            "44".repeat(32)
                        } else {
                            "33".repeat(32)
                        })
                    }
                }
                "getrawmempool" => {
                    if state == 0 || state == 3 {
                        json!({id:{"time":1}})
                    } else {
                        json!({})
                    }
                }
                "getrawtransaction" => {
                    let mut tx = json!({"txid":id,"hex":"010203","size":3,"version":6,"locktime":0,"vin":[],"vout":[],"orchard":{"actions":[{},{}]},"ironwood":{"actions":[{}]}});
                    if state == 1 || state == 4 {
                        tx["height"] = json!(9);
                        tx["blockhash"] = json!("33".repeat(32));
                        tx["confirmations"] = json!(999);
                    }
                    if state == 3 {
                        tx["vin"] = json!([{"coinbase":"00"}]);
                    }
                    tx
                }
                _ => panic!("Unexpected RPC method"),
            };
            (
                StatusCode::OK,
                Json(json!({"id":q["id"],"error":null,"result":result})),
            )
        }
        let mode = Arc::new(AtomicU8::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let state = mode.clone();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route("/", post(reply)).with_state(state),
            )
            .await
            .unwrap()
        });
        let rpc = NodeRpc::with_auth(&format!("http://{address}/"), true, None)
            .await
            .unwrap();
        let id = "11".repeat(32);
        let pending = transaction_from(&rpc, &id).await.unwrap();
        assert_eq!(pending["status"], "pending");
        assert_eq!(pending["confirmations"], Value::Null);
        assert_eq!(pending["transaction"]["ironwood_action_count"], 1);
        assert_eq!(
            mempool_from(&rpc).await.unwrap()["transactions"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        mode.store(1, Ordering::SeqCst);
        let mined = transaction_from(&rpc, &id).await.unwrap();
        assert_eq!(mined["status"], "mined");
        assert_eq!(mined["confirmations"], 2);
        mode.store(2, Ordering::SeqCst);
        assert_eq!(
            transaction_from(&rpc, &id).await.unwrap()["status"],
            "not_observed"
        );
        mode.store(3, Ordering::SeqCst);
        assert!(transaction_from(&rpc, &id).await.is_err());
        mode.store(4, Ordering::SeqCst);
        assert!(transaction_from(&rpc, &id).await.is_err());
        server.abort();
    }
}
