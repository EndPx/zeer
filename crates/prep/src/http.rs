//! Private-development HTTP API. Historical snapshots, not a consensus oracle.
use std::{
    future::Future,
    io::Read,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::Result;
use axum::{
    body::{Body, Bytes},
    extract::{rejection::BytesRejection, DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use prep_store::Archive;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::{
    net::TcpListener,
    sync::{OwnedSemaphorePermit, Semaphore},
};

use crate::query::{
    check_cursor_epoch, execute_query, validate_query, QueryArchive, QueryControl, QueryError,
    QueryRequest,
};
use crate::transactions::{
    check_snapshot, encode_response, execute_transactions, validate_transactions,
    TransactionRequest, MAX_LOOKUP_BYTES,
};

pub const MAX_ACTIVE_QUERIES: usize = 2;
pub const MAX_WAITING_QUERIES: usize = 8;
pub const QUERY_QUEUE_TIMEOUT_MILLIS: u64 = 250;
pub const MAX_REQUEST_BYTES: usize = 64 * 1024;
pub const STATUS_MAX_AGE_SECONDS: u64 = 120;
pub(crate) const QUERY_TIMEOUT_SECONDS: u64 = 30;

#[derive(Clone)]
struct HttpState {
    archive: Arc<Mutex<Archive>>,
    root: PathBuf,
    token_hash: Option<[u8; 32]>,
    permits: Arc<Semaphore>,
    waiting: Arc<Semaphore>,
    saw_status: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
}

fn error_response(error: QueryError) -> Response {
    let mut response = (
        StatusCode::from_u16(error.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        axum::Json(json!({"error": {"code": error.code}})),
    )
        .into_response();
    response.headers_mut().insert(
        "cache-control",
        axum::http::HeaderValue::from_static("no-store"),
    );
    if error.status == 429 {
        response
            .headers_mut()
            .insert("retry-after", axum::http::HeaderValue::from_static("1"));
    }
    response
}

async fn admit(state: &HttpState) -> Result<OwnedSemaphorePermit, QueryError> {
    let stopped = || QueryError::new(503, "SHUTTING_DOWN");
    let capacity = || QueryError::new(429, "QUERY_CAPACITY_EXCEEDED");
    if state.stopping.load(Ordering::Acquire) {
        return Err(stopped());
    }
    if let Ok(permit) = state.permits.clone().try_acquire_owned() {
        return Ok(permit);
    }
    // Tokio's semaphore enqueues acquisition futures FIFO; try_acquire cannot
    // jump an existing waiter. This second semaphore bounds queued parsed bodies.
    let _waiting = state
        .waiting
        .clone()
        .try_acquire_owned()
        .map_err(|_| capacity())?;
    let permit = tokio::time::timeout(
        Duration::from_millis(QUERY_QUEUE_TIMEOUT_MILLIS),
        state.permits.clone().acquire_owned(),
    )
    .await
    .map_err(|_| capacity())?
    .map_err(|_| stopped())?;
    if state.stopping.load(Ordering::Acquire) {
        return Err(stopped());
    }
    Ok(permit)
}
fn authorize(state: &HttpState, headers: &HeaderMap) -> Result<(), QueryError> {
    if state.stopping.load(Ordering::Acquire) {
        return Err(QueryError::new(503, "SHUTTING_DOWN"));
    }
    if let Some(wanted) = state.token_hash {
        let provided = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .ok_or_else(|| QueryError::new(401, "UNAUTHORIZED"))?;
        let actual: [u8; 32] = Sha256::digest(provided.as_bytes()).into();
        let mut difference = 0_u8;
        for (a, b) in actual.iter().zip(wanted) {
            difference |= a ^ b;
        }
        if difference != 0 {
            return Err(QueryError::new(401, "UNAUTHORIZED"));
        }
    }
    Ok(())
}
fn refreshed(state: &HttpState) -> Result<Archive, QueryError> {
    let mut cache = state
        .archive
        .lock()
        .map_err(|_| QueryError::new(503, "ARCHIVE_UNAVAILABLE"))?;
    let next = cache
        .refresh()
        .map_err(|_| QueryError::new(503, "ARCHIVE_UNAVAILABLE"))?;
    *cache = next.clone();
    Ok(next)
}

#[derive(Clone)]
struct SourceState {
    ready: bool,
    mode: &'static str,
    state: &'static str,
    source_height: Option<u64>,
    lag_blocks: Option<u64>,
    source_observed_at: Option<u64>,
}

fn source_state(state: &HttpState, archive: &Archive) -> SourceState {
    let not_ready = |code| SourceState {
        ready: false,
        mode: "follower",
        state: code,
        source_height: None,
        lag_blocks: None,
        source_observed_at: None,
    };
    let path = state.root.join("status.json");
    let mut file = match std::fs::File::open(path) {
        Ok(file) => {
            state.saw_status.store(true, Ordering::Release);
            file
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if state.saw_status.load(Ordering::Acquire) {
                return not_ready("STATUS_MISSING");
            }
            return SourceState {
                ready: archive.head().is_some(),
                mode: "historical_snapshot",
                state: if archive.head().is_some() {
                    "FRESHNESS_UNKNOWN"
                } else {
                    "EMPTY_ARCHIVE"
                },
                source_height: None,
                lag_blocks: None,
                source_observed_at: None,
            };
        }
        Err(_) => return not_ready("STATUS_UNREADABLE"),
    };
    let mut bytes = vec![];
    if (&mut file)
        .take(64 * 1024 + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() > 64 * 1024
    {
        return not_ready("STATUS_INVALID");
    }
    let value: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => return not_ready("STATUS_INVALID"),
    };
    let mode = match value.get("mode").and_then(Value::as_str) {
        Some("historical") => "historical_snapshot",
        Some("follow") => "follower",
        _ => return not_ready("STATUS_INVALID"),
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let Some(updated) = value.get("updated_at_unix").and_then(Value::as_u64) else {
        return not_ready("STATUS_INVALID");
    };
    let observed = |ready, code| SourceState {
        ready,
        mode,
        state: code,
        source_height: value
            .get("source_height")
            .and_then(Value::as_u64)
            .filter(|height| *height <= u64::from(u32::MAX)),
        lag_blocks: value
            .get("lag_blocks")
            .and_then(Value::as_u64)
            .filter(|height| *height <= u64::from(u32::MAX)),
        source_observed_at: Some(updated).filter(|timestamp| {
            *timestamp <= 9_007_199_254_740_991
                && value.get("ready").and_then(Value::as_bool) == Some(true)
        }),
    };
    if updated > now.saturating_add(60)
        || (mode == "follower" && now.saturating_sub(updated) > STATUS_MAX_AGE_SECONDS)
    {
        return observed(false, "STATUS_STALE");
    }
    if value.get("schema_version").and_then(Value::as_u64) != Some(1)
        || value.get("ready").and_then(Value::as_bool) != Some(true)
    {
        return observed(false, "SOURCE_NOT_READY");
    }
    if value.get("epoch").and_then(Value::as_u64) != Some(archive.catalog().epoch) {
        return observed(false, "STATUS_EPOCH_MISMATCH");
    }
    if value.get("revision").and_then(Value::as_u64) != Some(archive.catalog().revision)
        || value.get("indexed_height").and_then(Value::as_u64) != archive.head()
    {
        return observed(false, "STATUS_REVISION_MISMATCH");
    }
    if archive.head().is_none() {
        return observed(false, "EMPTY_ARCHIVE");
    }
    observed(
        true,
        if mode == "follower" {
            "READY_SOURCE_OBSERVATION_ONLY"
        } else {
            "FRESHNESS_UNKNOWN"
        },
    )
}

fn height_json(archive: &Archive, source: &SourceState) -> Value {
    let meta = archive.query_meta();
    json!({"archive_height": meta.head, "start_block": meta.start_height, "network": meta.network,
        "indexed_height": meta.head, "source_height": source.source_height, "lag_blocks": source.lag_blocks, "source_observed_at": source.source_observed_at,
        "epoch": meta.epoch.to_string(), "revision": meta.revision.to_string(), "payload_kind": meta.payload_kind,
        "ready": source.ready && meta.payload_kind == "full-v1", "source_mode": source.mode, "state": source.state,
        "canonicality": "historical_snapshot_not_independently_consensus_validated"})
}

fn coherent_snapshot(state: &HttpState) -> Result<(Archive, SourceState), QueryError> {
    for attempt in 0..2 {
        let archive = refreshed(state)?;
        let source = source_state(state, &archive);
        if attempt == 0
            && matches!(
                source.state,
                "STATUS_EPOCH_MISMATCH" | "STATUS_REVISION_MISMATCH"
            )
        {
            continue;
        }
        return Ok((archive, source));
    }
    Err(QueryError::new(503, "SOURCE_NOT_READY"))
}

async fn metadata(state: HttpState, headers: HeaderMap, require_ready: bool) -> Response {
    if let Err(error) = authorize(&state, &headers) {
        return error_response(error);
    }
    let permit = match state.permits.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => return error_response(QueryError::new(429, "QUERY_CAPACITY_EXCEEDED")),
    };
    let task = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let (archive, source) = coherent_snapshot(&state)?;
        let ready = source.ready && archive.catalog().payload_kind == "full-v1";
        Ok::<_, QueryError>((height_json(&archive, &source), ready))
    });
    match tokio::time::timeout(Duration::from_secs(30), task).await {
        Ok(Ok(Ok((value, ready)))) => (
            (if require_ready && !ready {
                StatusCode::SERVICE_UNAVAILABLE
            } else {
                StatusCode::OK
            }),
            axum::Json(value),
        )
            .into_response(),
        Ok(Ok(Err(error))) => error_response(error),
        Ok(Err(_)) => error_response(QueryError::new(503, "ARCHIVE_UNAVAILABLE")),
        Err(_) => error_response(QueryError::new(408, "QUERY_TIMED_OUT")),
    }
}
async fn height(State(state): State<HttpState>, headers: HeaderMap) -> Response {
    metadata(state, headers, false).await
}
async fn ready(State(state): State<HttpState>, headers: HeaderMap) -> Response {
    metadata(state, headers, true).await
}
async fn health(State(state): State<HttpState>, headers: HeaderMap) -> Response {
    match authorize(&state, &headers) {
        Ok(()) => {
            axum::Json(json!({"status":"ok", "service":"zeer-prep", "production_ready": false}))
                .into_response()
        }
        Err(error) => error_response(error),
    }
}
async fn capabilities(State(state): State<HttpState>, headers: HeaderMap) -> Response {
    if let Err(error) = authorize(&state, &headers) {
        return error_response(error);
    }
    let mut response = axum::Json(crate::capabilities::document()).into_response();
    response.headers_mut().insert(
        "cache-control",
        axum::http::HeaderValue::from_static("no-store"),
    );
    response
}

struct CancelOnDrop(Arc<AtomicBool>);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

struct PermitBytes {
    bytes: Vec<u8>,
    _permit: Arc<OwnedSemaphorePermit>,
}
impl AsRef<[u8]> for PermitBytes {
    fn as_ref(&self) -> &[u8] {
        &self.bytes
    }
}

async fn query(
    State(state): State<HttpState>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    if let Err(error) = authorize(&state, &headers) {
        return error_response(error);
    }
    let body = match body {
        Ok(body) => body,
        Err(_) => return error_response(QueryError::new(413, "REQUEST_TOO_LARGE")),
    };
    let request: QueryRequest = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return error_response(QueryError::new(400, "INVALID_QUERY_JSON")),
    };
    if let Err(error) = validate_query(&request) {
        return error_response(error);
    }
    drop(body);
    read_response(state, ReadRequest::Query(request)).await
}

async fn transactions(
    State(state): State<HttpState>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    if let Err(error) = authorize(&state, &headers) {
        return error_response(error);
    }
    let body = match body {
        Ok(body) => body,
        Err(_) => return error_response(QueryError::new(413, "REQUEST_TOO_LARGE")),
    };
    let request: TransactionRequest = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return error_response(QueryError::new(400, "INVALID_LOOKUP_JSON")),
    };
    if let Err(error) = validate_transactions(&request) {
        return error_response(error);
    }
    drop(body);
    read_response(state, ReadRequest::Transactions(request)).await
}

enum ReadRequest {
    Query(QueryRequest),
    Transactions(TransactionRequest),
}
async fn read_response(state: HttpState, request: ReadRequest) -> Response {
    let permit = match admit(&state).await {
        Ok(permit) => Arc::new(permit),
        Err(error) => return error_response(error),
    };
    let worker_permit = permit.clone();
    let control = QueryControl {
        deadline: Instant::now() + Duration::from_secs(QUERY_TIMEOUT_SECONDS),
        max_response_bytes: if matches!(&request, ReadRequest::Transactions(_)) {
            MAX_LOOKUP_BYTES
        } else {
            crate::query::MAX_RESPONSE_BYTES
        },
        ..Default::default()
    };
    let _cancel = CancelOnDrop(control.cancelled.clone());
    let task = tokio::task::spawn_blocking(move || {
        let _permit = worker_permit;
        // A handler may disappear while this closure is still in the blocking
        // pool's queue. Do not start archive work for an abandoned request.
        if state.stopping.load(Ordering::Acquire) {
            return Err(QueryError::new(503, "SHUTTING_DOWN"));
        }
        if control.cancelled.load(Ordering::Acquire) || Instant::now() >= control.deadline {
            return Err(QueryError::new(408, "QUERY_CANCELLED_OR_TIMED_OUT"));
        }
        let (archive, source) = coherent_snapshot(&state)?;
        // Epoch conflicts take precedence over range/source status, allowing clients
        // to distinguish a rollback from temporary source unavailability.
        match &request {
            ReadRequest::Query(request) => check_cursor_epoch(request, &archive.query_meta())?,
            ReadRequest::Transactions(request) => check_snapshot(&archive, request)?,
        }
        if !source.ready {
            return Err(QueryError::new(503, "SOURCE_NOT_READY"));
        }
        let (bytes, lookup_snapshot) = match &request {
            ReadRequest::Query(request) => (
                serde_json::to_vec(&execute_query(&archive, request, &control)?)
                    .map_err(|_| QueryError::new(500, "RESPONSE_ENCODING_FAILED"))?,
                None,
            ),
            ReadRequest::Transactions(request) => {
                let response = execute_transactions(&archive, request, &control)?;
                let snapshot = response.snapshot.clone();
                (encode_response(&response, &control)?, Some(snapshot))
            }
        };
        let (latest, latest_source) = coherent_snapshot(&state)?;
        if latest.catalog().epoch != archive.catalog().epoch {
            return Err(QueryError::new(409, "REORG"));
        }
        if let (ReadRequest::Transactions(request), Some(snapshot)) = (&request, lookup_snapshot) {
            // Recheck the pinned prefix as well as epoch, including rebuilt epoch-zero archives.
            let mut pinned = request.clone();
            pinned.at = Some(snapshot);
            check_snapshot(&latest, &pinned)?;
        }
        if !latest_source.ready {
            return Err(QueryError::new(503, "SOURCE_NOT_READY"));
        }
        if bytes.len() > control.max_response_bytes {
            return Err(QueryError::new(
                413,
                "RESPONSE_TOO_LARGE_USE_FIELD_SELECTION",
            ));
        }
        Ok::<_, QueryError>(bytes)
    });
    match tokio::time::timeout(Duration::from_secs(QUERY_TIMEOUT_SECONDS), task).await {
        Ok(Ok(Ok(bytes))) => {
            // The frame's byte owner, rather than just the Body wrapper, retains
            // admission while the transport still owns the response allocation.
            let bytes = Bytes::from_owner(PermitBytes {
                bytes,
                _permit: permit,
            });
            let mut response = Response::new(Body::from(bytes));
            response.headers_mut().insert(
                "content-type",
                axum::http::HeaderValue::from_static("application/json"),
            );
            response.headers_mut().insert(
                "cache-control",
                axum::http::HeaderValue::from_static("no-store"),
            );
            response
        }
        Ok(Ok(Err(error))) => error_response(error),
        Ok(Err(_)) => error_response(QueryError::new(503, "QUERY_WORKER_FAILED")),
        Err(_) => error_response(QueryError::new(408, "QUERY_TIMED_OUT")),
    }
}

fn build_router(state: HttpState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/capabilities", get(capabilities))
        .route("/ready", get(ready))
        .route("/height", get(height))
        .route("/query", post(query))
        .route("/transactions", post(transactions))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}
fn make_state(archive: Archive, token: Option<String>) -> Result<HttpState> {
    anyhow::ensure!(
        token.as_ref().is_none_or(|token| !token.is_empty()),
        "api_token_must_not_be_empty"
    );
    Ok(HttpState {
        root: archive.path().to_path_buf(),
        archive: Arc::new(Mutex::new(archive)),
        token_hash: token.map(|value| Sha256::digest(value.as_bytes()).into()),
        permits: Arc::new(Semaphore::new(MAX_ACTIVE_QUERIES)),
        waiting: Arc::new(Semaphore::new(MAX_WAITING_QUERIES)),
        saw_status: Arc::new(AtomicBool::new(false)),
        stopping: Arc::new(AtomicBool::new(false)),
    })
}
pub fn router(archive: Archive, token: Option<String>) -> Result<Router> {
    Ok(build_router(make_state(archive, token)?))
}

pub async fn serve<F>(
    archive: Archive,
    listener: TcpListener,
    token: Option<String>,
    shutdown: F,
) -> Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    let state = make_state(archive, token)?;
    let stopping = state.stopping.clone();
    let permits = state.permits.clone();
    let (send, receive) = tokio::sync::oneshot::channel::<()>();
    let server = axum::serve(listener, build_router(state)).with_graceful_shutdown(async {
        let _ = receive.await;
    });
    let server = std::future::IntoFuture::into_future(server);
    tokio::pin!(server);
    tokio::pin!(shutdown);
    tokio::select! {
        result = &mut server => { result?; },
        _ = &mut shutdown => {
            stopping.store(true, Ordering::Release);
            permits.close();
            let _ = send.send(());
            if let Ok(result) = tokio::time::timeout(Duration::from_secs(2), &mut server).await { result?; }
        }
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use prep_proto::prep::FullBlock;
    use prep_store::{ArchiveWriter, BlockRecord, StoreWriter};
    use prost::Message;
    use tokio_stream::StreamExt;

    fn add_segment(root: &std::path::Path, writer: &mut ArchiveWriter, height: u64) {
        let directory = format!("segments/block-{height}");
        let mut segment = StoreWriter::create_full(
            root.join(&directory),
            "regtest",
            height,
            height,
            &hex::encode(vec![height as u8 - 1; 32]),
            &hex::encode(vec![height as u8; 32]),
        )
        .unwrap();
        let full = FullBlock { height, hash: vec![height as u8;32], prev_hash: vec![height as u8 - 1;32], time: 1,
            raw_block: vec![1,2,3], decoded_json: json!({"tx":[{"txid":"11".repeat(32),"version":1,"locktime":0,"hex":"010203","vin":[],"vout":[]}]}).to_string() };
        segment
            .push(BlockRecord {
                height,
                hash: full.hash.clone(),
                prev_hash: full.prev_hash.clone(),
                payload: full.encode_to_vec(),
            })
            .unwrap();
        segment.finish().unwrap();
        writer.append_segment(&directory).unwrap();
    }
    fn fixture() -> (tempfile::TempDir, ArchiveWriter) {
        let root = tempfile::tempdir().unwrap();
        let mut writer =
            ArchiveWriter::create_or_open_with_kind(root.path(), "regtest", 1, "full-v1").unwrap();
        add_segment(root.path(), &mut writer, 1);
        add_segment(root.path(), &mut writer, 2);
        (root, writer)
    }

    async fn wait_for_waiters(state: &HttpState, count: usize) {
        tokio::time::timeout(Duration::from_millis(200), async {
            while state.waiting.available_permits() != MAX_WAITING_QUERIES - count {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn bounded_admission_is_fifo_and_cancelled_waiters_release_slots() {
        let (_root, writer) = fixture();
        let state = make_state(writer.snapshot(), None).unwrap();
        let a = admit(&state).await.unwrap();
        let b = admit(&state).await.unwrap();
        let mut pending = vec![];
        for count in 1..=MAX_WAITING_QUERIES {
            let queued_state = state.clone();
            pending.push(tokio::spawn(async move { admit(&queued_state).await }));
            wait_for_waiters(&state, count).await;
        }
        let error = admit(&state).await.unwrap_err();
        assert_eq!(error.code, "QUERY_CAPACITY_EXCEEDED");
        assert_eq!(error_response(error).headers()["retry-after"], "1");
        // Drop a future in the middle of the FIFO, then reclaim its queue slot.
        pending.remove(3).abort();
        wait_for_waiters(&state, MAX_WAITING_QUERIES - 1).await;
        drop(a);
        for task in pending {
            let permit = tokio::time::timeout(Duration::from_millis(200), task)
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            // Only the next FIFO waiter may own the newly released permit.
            assert_eq!(state.permits.available_permits(), 0);
            drop(permit);
        }
        drop(b);
        assert_eq!(state.permits.available_permits(), MAX_ACTIVE_QUERIES);
        assert_eq!(state.waiting.available_permits(), MAX_WAITING_QUERIES);
    }

    #[tokio::test]
    async fn queue_deadline_and_shutdown_release_all_waiting_slots() {
        let (_root, writer) = fixture();
        let state = make_state(writer.snapshot(), None).unwrap();
        let a = admit(&state).await.unwrap();
        let b = admit(&state).await.unwrap();
        let started = Instant::now();
        assert_eq!(
            admit(&state).await.unwrap_err().code,
            "QUERY_CAPACITY_EXCEEDED"
        );
        assert!(started.elapsed() >= Duration::from_millis(QUERY_QUEUE_TIMEOUT_MILLIS));
        assert_eq!(state.waiting.available_permits(), MAX_WAITING_QUERIES);
        let queued = {
            let state = state.clone();
            tokio::spawn(async move { admit(&state).await })
        };
        wait_for_waiters(&state, 1).await;
        state.stopping.store(true, Ordering::Release);
        state.permits.close();
        assert_eq!(queued.await.unwrap().unwrap_err().code, "SHUTTING_DOWN");
        assert_eq!(state.waiting.available_permits(), MAX_WAITING_QUERIES);
        assert_eq!(admit(&state).await.unwrap_err().code, "SHUTTING_DOWN");
        drop((a, b));
    }

    #[tokio::test]
    async fn queued_reads_refresh_snapshot_and_source_only_after_admission() {
        let (root, mut writer) = fixture();
        let state = make_state(writer.snapshot(), None).unwrap();
        let request = json!({"from_block":1,"to_block":3,"txids":["11".repeat(32)]});
        let response = transactions(
            State(state.clone()),
            HeaderMap::new(),
            Ok(Bytes::from(request.to_string())),
        )
        .await;
        let result: Value = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), MAX_LOOKUP_BYTES)
                .await
                .unwrap(),
        )
        .unwrap();
        let mut pinned = request.clone();
        pinned["at"] = result["snapshot"].clone();
        let a = admit(&state).await.unwrap();
        let b = admit(&state).await.unwrap();
        let queued = {
            let state = state.clone();
            tokio::spawn(async move {
                transactions(
                    State(state),
                    HeaderMap::new(),
                    Ok(Bytes::from(pinned.to_string())),
                )
                .await
            })
        };
        wait_for_waiters(&state, 1).await;
        writer.rollback_to(1).unwrap();
        std::fs::write(
            root.path().join("status.json"),
            json!({"schema_version":1,"mode":"historical","ready":false,"updated_at_unix":1})
                .to_string(),
        )
        .unwrap();
        drop(a);
        let conflict = queued.await.unwrap();
        assert_eq!(conflict.status(), StatusCode::CONFLICT);
        let error: Value = serde_json::from_slice(
            &axum::body::to_bytes(conflict.into_body(), 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(error["error"]["code"], "REORG");
        // A request without a pinned snapshot sees the newly unready source.
        let archive = writer.snapshot();
        let mut status = json!({"schema_version":1,"mode":"historical","ready":true,"updated_at_unix":1,"indexed_height":archive.head(),"epoch":archive.catalog().epoch,"revision":archive.catalog().revision});
        std::fs::write(root.path().join("status.json"), status.to_string()).unwrap();
        let a = admit(&state).await.unwrap();
        let queued = {
            let state = state.clone();
            tokio::spawn(async move {
                transactions(
                    State(state),
                    HeaderMap::new(),
                    Ok(Bytes::from(request.to_string())),
                )
                .await
            })
        };
        wait_for_waiters(&state, 1).await;
        status["ready"] = json!(false);
        std::fs::write(root.path().join("status.json"), status.to_string()).unwrap();
        drop(a);
        assert_eq!(
            queued.await.unwrap().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        drop(b);
        assert_eq!(state.permits.available_permits(), MAX_ACTIVE_QUERIES);
    }

    #[tokio::test]
    async fn actual_http_disconnect_cancels_queued_handler_before_deadline() {
        use std::io::Write;
        let (_root, writer) = fixture();
        let state = make_state(writer.snapshot(), None).unwrap();
        let a = admit(&state).await.unwrap();
        let b = admit(&state).await.unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = build_router(state.clone());
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let mut socket = std::net::TcpStream::connect(address).unwrap();
        let body = r#"{"from_block":1,"to_block":3}"#;
        write!(socket, "POST /query HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\nContent-Type: application/json\r\n\r\n{}", body.len(), body).unwrap();
        wait_for_waiters(&state, 1).await;
        socket.shutdown(std::net::Shutdown::Both).unwrap();
        drop(socket);
        // Well before the 250ms queue timeout: prove transport cancellation,
        // rather than eventual timeout cleanup, removes the queued request.
        tokio::time::timeout(Duration::from_millis(150), wait_for_waiters(&state, 0))
            .await
            .unwrap();
        drop((a, b));
        tokio::task::yield_now().await;
        assert_eq!(state.permits.available_permits(), MAX_ACTIVE_QUERIES);
        server.abort();
    }

    #[tokio::test]
    async fn batch_lookup_and_query_share_admission_and_retained_response_frames() {
        let (_root, writer) = fixture();
        let state = make_state(writer.snapshot(), Some("fixture-token".into())).unwrap();
        let body =
            Bytes::from(json!({"from_block":1,"to_block":3,"txids":["11".repeat(32)]}).to_string());
        let unauthorized =
            transactions(State(state.clone()), HeaderMap::new(), Ok(body.clone())).await;
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer fixture-token".parse().unwrap());
        let a = state.permits.clone().try_acquire_owned().unwrap();
        let b = state.permits.clone().try_acquire_owned().unwrap();
        assert_eq!(
            transactions(State(state.clone()), headers.clone(), Ok(body.clone()))
                .await
                .status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        drop(a);
        drop(b);
        let response = transactions(State(state.clone()), headers.clone(), Ok(body.clone())).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let mut stream = response.into_body().into_data_stream();
        let frame = stream.next().await.unwrap().unwrap();
        drop(stream);
        assert_eq!(state.permits.available_permits(), 1);
        let query_body = Bytes::from(json!({"from_block":1,"to_block":3}).to_string());
        let query_response = query(State(state.clone()), headers.clone(), Ok(query_body)).await;
        assert_eq!(query_response.status(), StatusCode::OK);
        assert_eq!(state.permits.available_permits(), 0);
        assert_eq!(
            transactions(State(state.clone()), headers, Ok(body))
                .await
                .status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        drop(frame);
        drop(query_response);
        assert_eq!(state.permits.available_permits(), 2);
    }

    #[tokio::test]
    async fn actual_batch_http_is_complete_and_snapshot_conflicts_precede_source_readiness() {
        let (root, mut writer) = fixture();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let (stop, shutdown) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(serve(
            writer.snapshot(),
            listener,
            Some("fixture-token".into()),
            async {
                let _ = shutdown.await;
            },
        ));
        let client = reqwest::Client::new();
        let mut request = json!({"from_block":1,"to_block":3,"txids":["11".repeat(32),"22".repeat(32),"11".repeat(32)]});
        let response = client
            .post(format!("{base}/transactions"))
            .bearer_auth("fixture-token")
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let result: Value = response.json().await.unwrap();
        assert_eq!(result["complete"], true);
        assert_eq!(result["transactions"].as_array().unwrap().len(), 2);
        assert_eq!(result["missing_txids"], json!(["22".repeat(32)]));
        request["at"] = result["snapshot"].clone();
        add_segment(root.path(), &mut writer, 3);
        assert_eq!(
            client
                .post(format!("{base}/transactions"))
                .bearer_auth("fixture-token")
                .json(&request)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        writer.rollback_to(1).unwrap();
        std::fs::write(
            root.path().join("status.json"),
            json!({"schema_version":1,"mode":"follow","ready":false,"updated_at_unix":1})
                .to_string(),
        )
        .unwrap();
        let conflict = client
            .post(format!("{base}/transactions"))
            .bearer_auth("fixture-token")
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(conflict.status(), StatusCode::CONFLICT);
        assert_eq!(
            conflict.json::<Value>().await.unwrap()["error"]["code"],
            "REORG"
        );
        request.as_object_mut().unwrap().remove("at");
        assert_eq!(
            client
                .post(format!("{base}/transactions"))
                .bearer_auth("fixture-token")
                .json(&request)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        let _ = stop.send(());
        task.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn transport_frame_keeps_admission_after_body_drop() {
        let slots = Arc::new(Semaphore::new(1));
        let permit = Arc::new(slots.clone().try_acquire_owned().unwrap());
        let bytes = Bytes::from_owner(PermitBytes {
            bytes: vec![5; 1024],
            _permit: permit,
        });
        let mut body = Body::from(bytes).into_data_stream();
        let frame = body.next().await.unwrap().unwrap();
        drop(body);
        assert_eq!(slots.available_permits(), 0);
        drop(frame);
        assert_eq!(slots.available_permits(), 1);
    }

    #[test]
    fn historical_status_survives_age_but_follow_stale_and_revision_mismatch_fail() {
        let (root, writer) = fixture();
        let archive = writer.snapshot();
        let state = make_state(archive.clone(), None).unwrap();
        let mut status = json!({"schema_version":1,"mode":"historical","ready":true,"source_height":2,"indexed_height":2,"lag_blocks":0,"updated_at_unix":1,"epoch":archive.catalog().epoch,"revision":archive.catalog().revision});
        let write = |status: &Value| {
            std::fs::write(root.path().join("status.json"), status.to_string()).unwrap()
        };
        write(&status);
        assert!(source_state(&state, &archive).ready);
        status["mode"] = json!("follow");
        write(&status);
        assert_eq!(source_state(&state, &archive).state, "STATUS_STALE");
        status["mode"] = json!("historical");
        status["revision"] = json!(99);
        write(&status);
        assert_eq!(
            source_state(&state, &archive).state,
            "STATUS_REVISION_MISMATCH"
        );
        std::fs::remove_file(root.path().join("status.json")).unwrap();
        assert_eq!(source_state(&state, &archive).state, "STATUS_MISSING");
    }

    #[tokio::test]
    async fn actual_http_auth_append_cursor_and_reorg_rejection() {
        let (root, mut writer) = fixture();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let (stop, shutdown) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(serve(
            writer.snapshot(),
            listener,
            Some("fixture-token".into()),
            async {
                let _ = shutdown.await;
            },
        ));
        let client = reqwest::Client::new();
        assert_eq!(
            client
                .get(format!("{base}/height"))
                .send()
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::UNAUTHORIZED
        );
        let height: Value = client
            .get(format!("{base}/height"))
            .bearer_auth("fixture-token")
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(height["archive_height"], 2);
        assert_eq!(height["ready"], true);
        let mut request = json!({"from_block":1,"limit":1,"field_selection":{"block":["height","raw"],"transaction":["txid","raw"]}});
        let first: Value = client
            .post(format!("{base}/query"))
            .bearer_auth("fixture-token")
            .json(&request)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(first["next_block"], 2);
        assert_eq!(first["data"]["transactions"][0]["raw"], "010203");
        request["cursor"] = first["cursor"].clone();
        add_segment(root.path(), &mut writer, 3);
        let second: Value = client
            .post(format!("{base}/query"))
            .bearer_auth("fixture-token")
            .json(&request)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(second["next_block"], 3);
        assert_eq!(second["to_block"], 3);
        assert!(second["cursor"].is_null());
        writer.rollback_to(1).unwrap();
        let reorg = client
            .post(format!("{base}/query"))
            .bearer_auth("fixture-token")
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(reorg.status(), reqwest::StatusCode::CONFLICT);
        assert_eq!(
            reorg.json::<Value>().await.unwrap()["error"]["code"],
            "REORG"
        );
        stop.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }
}
