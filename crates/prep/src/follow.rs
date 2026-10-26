//! Process-level sync loop. Keeps one writer session across source polls.
use std::{
    future::Future,
    io::Write,
    sync::{mpsc, Arc, Mutex, OnceLock},
    thread,
    time::Duration,
};

use anyhow::{ensure, Result};

use crate::{
    follower::{source_error_code, SyncEvent, SyncOptions, SyncSession},
    full_source::{is_transient_source_error, unix_seconds},
};

pub struct LoopOptions {
    pub poll_seconds: u64,
    pub max_steps: Option<u64>,
    /// Additional attempts after consecutive temporary source failures.
    pub max_source_retries: u32,
}

struct RetryBudget {
    limit: u32,
    used: u32,
}

fn diagnostic_sink() -> Option<mpsc::SyncSender<SyncEvent>> {
    static SINK: OnceLock<Option<mpsc::SyncSender<SyncEvent>>> = OnceLock::new();
    SINK.get_or_init(|| {
        let (sender, events) = mpsc::sync_channel::<SyncEvent>(8);
        // One process-wide writer may block on an undrained stderr pipe. It has
        // no archive/session resources and is deliberately never joined by sync.
        let worker = thread::Builder::new()
            .name("prep-diagnostics".into())
            .spawn(move || {
                for event in events {
                    if let Ok(json) = serde_json::to_string(&event) {
                        let _ = writeln!(std::io::stderr().lock(), "{json}");
                    }
                }
            });
        worker.ok().map(|_| sender)
    })
    .clone()
}

/// Independent of Tokio so synchronous archive validation remains observable.
/// The worker only logs a redacted in-memory snapshot; no RPC or disk access.
struct Reporter {
    state: Arc<Mutex<SyncEvent>>,
    stop: mpsc::Sender<()>,
    worker: Option<thread::JoinHandle<()>>,
    sink: Option<mpsc::SyncSender<SyncEvent>>,
}

impl Reporter {
    fn new() -> Self {
        Self::with_interval(Duration::from_secs(5))
    }

    fn with_interval(interval: Duration) -> Self {
        Self::with_sink(interval, diagnostic_sink())
    }

    fn with_sink(interval: Duration, sink: Option<mpsc::SyncSender<SyncEvent>>) -> Self {
        let state = Arc::new(Mutex::new(SyncEvent::new("checking_source", "started")));
        let (stop, stopped) = mpsc::channel();
        let snapshot = state.clone();
        let heartbeat_sink = sink.clone();
        let worker = thread::spawn(move || {
            while matches!(
                stopped.recv_timeout(interval),
                Err(mpsc::RecvTimeoutError::Timeout)
            ) {
                let Ok(state) = snapshot.lock() else { break };
                let mut event = state.clone();
                drop(state);
                event.heartbeat = true;
                event.observed_at_unix = unix_seconds();
                Self::print(&heartbeat_sink, &event);
            }
        });
        Self {
            state,
            stop,
            worker: Some(worker),
            sink,
        }
    }

    fn print(sink: &Option<mpsc::SyncSender<SyncEvent>>, event: &SyncEvent) {
        if let Some(sink) = sink {
            // A full/closed diagnostic pipe must not delay indexing or shutdown.
            let _ = sink.try_send(event.clone());
        }
    }

    fn record(&self, mut event: SyncEvent) {
        self.record_update(&mut event, false);
    }

    fn record_checkpoint(&self, mut event: SyncEvent) {
        self.record_update(&mut event, true);
    }

    fn record_update(&self, event: &mut SyncEvent, authoritative: bool) {
        if let Ok(mut state) = self.state.lock() {
            event.source_height = event.source_height.or(state.source_height);
            if !authoritative {
                event.committed_height = event.committed_height.or(state.committed_height);
            }
            event.last_progress_at_unix = if event.state == "completed" {
                Some(event.observed_at_unix)
            } else {
                state.last_progress_at_unix
            };
            *state = event.clone();
        }
        Self::print(&self.sink, event);
    }
}

impl Drop for Reporter {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl RetryBudget {
    fn next_delay(&mut self, error: &anyhow::Error) -> Option<Duration> {
        if !is_transient_source_error(error) || self.used >= self.limit {
            return None;
        }
        let seconds = 1_u64 << self.used.min(5);
        self.used += 1;
        Some(Duration::from_secs(seconds.min(30)))
    }

    fn reset(&mut self) {
        self.used = 0;
    }
}

pub async fn run(
    options: SyncOptions,
    controls: LoopOptions,
    shutdown: impl Future<Output = ()>,
) -> Result<()> {
    ensure!(
        (1..=60).contains(&controls.poll_seconds),
        "poll_seconds_must_be_1_to_60"
    );
    ensure!(
        !options.follow_mode || options.to.is_none(),
        "follow_cannot_have_fixed_end_height"
    );
    ensure!(
        controls.max_steps.is_none_or(|n| n > 0),
        "max_steps_must_be_positive"
    );
    ensure!(
        controls.max_source_retries <= 20,
        "max_source_retries_must_be_0_to_20"
    );
    let follow = options.follow_mode;
    let to = options.to;
    tokio::pin!(shutdown);
    let mut retries = RetryBudget {
        limit: if follow {
            controls.max_source_retries
        } else {
            0
        },
        used: 0,
    };
    let reporter = Reporter::new();
    let mut session = loop {
        let result = tokio::select! {
            biased;
            _ = &mut shutdown => return Ok(()),
            result = SyncSession::new_with_observer(options.clone(), |event| reporter.record(event)) => result,
        };
        match result {
            Ok(session) => {
                retries.reset();
                break session;
            }
            Err(error) => {
                let Some(delay) = retries.next_delay(&error) else {
                    return Err(error);
                };
                let mut event = SyncEvent::new("waiting_source", "retrying");
                event.error_code = Some(source_error_code(&error));
                event.retry_attempt = Some(retries.used);
                event.retry_limit = Some(retries.limit);
                event.retry_delay_seconds = Some(delay.as_secs());
                reporter.record(event);
                tokio::select! {
                    biased;
                    _ = &mut shutdown => return Ok(()),
                    _ = tokio::time::sleep(delay) => {},
                }
            }
        }
    };
    let mut steps = 0_u64;
    let mut previous_revision = None;
    loop {
        reporter.record(SyncEvent::new("catching_up", "started"));
        let result = tokio::select! {
            biased;
            _ = &mut shutdown => break,
            result = session.step_with_observer(|event| reporter.record(event)) => result,
        };
        let progress = match result {
            Ok(progress) => {
                retries.reset();
                progress
            }
            Err(error) => {
                // step() has already durably published ready=false. The same
                // session retains its writer lock and committed archive head.
                let mut event = SyncEvent::new("catching_up", "failed");
                event.error_code = Some(source_error_code(&error));
                let observed = session.progress_snapshot();
                event.committed_height = observed.head;
                event.source_height = Some(observed.source_height);
                reporter.record_checkpoint(event);
                let Some(delay) = retries.next_delay(&error) else {
                    return Err(error);
                };
                let mut event = SyncEvent::new("waiting_source", "retrying");
                event.error_code = Some(source_error_code(&error));
                event.retry_attempt = Some(retries.used);
                event.retry_limit = Some(retries.limit);
                event.retry_delay_seconds = Some(delay.as_secs());
                reporter.record(event);
                tokio::select! {
                    biased;
                    _ = &mut shutdown => break,
                    _ = tokio::time::sleep(delay) => {},
                }
                continue;
            }
        };
        let mut event = SyncEvent::new(
            if progress.head.is_none() {
                "waiting_for_blocks"
            } else if progress.progress {
                "catching_up"
            } else {
                "ready"
            },
            if previous_revision != Some(progress.revision) {
                "completed"
            } else {
                "observed"
            },
        );
        event.source_height = Some(progress.source_height);
        event.committed_height = progress.head;
        previous_revision = Some(progress.revision);
        reporter.record_checkpoint(event);
        println!("{}", serde_json::to_string(&progress)?);
        steps += 1;
        if controls.max_steps.is_some_and(|limit| steps >= limit)
            || (!follow
                && (!progress.progress
                    || to.is_some_and(|end| progress.head.is_some_and(|head| head >= end))))
        {
            break;
        }
        if !progress.progress {
            tokio::select! {
                biased;
                _ = &mut shutdown => break,
                _ = tokio::time::sleep(Duration::from_secs(controls.poll_seconds)) => {},
            }
        }
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use axum::{
        extract::State,
        http::StatusCode,
        response::{IntoResponse, Response},
        routing::post,
        Json, Router,
    };
    use serde_json::{json, Value};
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    };
    use tokio::net::TcpListener;

    #[test]
    fn heartbeat_keeps_progress_metadata_and_worker_stops_with_reporter() {
        let reporter = Reporter::with_interval(Duration::from_millis(10));
        let weak = Arc::downgrade(&reporter.state);
        let mut event = SyncEvent::new("catching_up", "completed");
        event.committed_height = Some(12);
        event.source_height = Some(20);
        reporter.record(event);
        let checkpoint_time = reporter.state.lock().unwrap().last_progress_at_unix;
        assert!(checkpoint_time.is_some());
        reporter.record(SyncEvent::new("catching_up", "started"));
        thread::sleep(Duration::from_millis(35));
        let state = reporter.state.lock().unwrap().clone();
        assert_eq!(state.last_progress_at_unix, checkpoint_time);
        assert_eq!(state.committed_height, Some(12));
        assert_eq!(state.source_height, Some(20));
        assert!(
            !state.heartbeat,
            "heartbeat must never mutate the stored progress snapshot"
        );
        let mut rollback = SyncEvent::new("waiting_for_blocks", "completed");
        rollback.source_height = Some(0);
        reporter.record_checkpoint(rollback);
        reporter.record(SyncEvent::new("catching_up", "started"));
        assert_eq!(reporter.state.lock().unwrap().committed_height, None,
            "an authoritative empty rollback must clear the previous head, including on later phase changes");
        drop(reporter);
        assert!(
            weak.upgrade().is_none(),
            "drop must join the diagnostic worker"
        );
    }

    #[test]
    fn full_diagnostic_queue_never_blocks_progress_or_reporter_shutdown() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let reporter = Reporter::with_sink(Duration::from_millis(1), Some(sender));
        reporter.record(SyncEvent::new("catching_up", "started"));
        let start = std::time::Instant::now();
        for height in 1..=1000 {
            let mut event = SyncEvent::new("catching_up", "completed");
            event.committed_height = Some(height);
            reporter.record_checkpoint(event);
        }
        assert_eq!(reporter.state.lock().unwrap().committed_height, Some(1000));
        drop(reporter);
        assert!(start.elapsed() < Duration::from_secs(1));
        assert!(receiver.try_recv().is_ok());
        assert!(
            matches!(receiver.try_recv(), Err(mpsc::TryRecvError::Disconnected)),
            "only the bounded first record can remain; all later diagnostics are dropped"
        );
    }

    #[test]
    fn retries_are_bounded_exponential_resettable_and_typed() {
        let temporary = anyhow::Error::from(crate::full_source::TransientSourceError::Transport);
        let mut budget = RetryBudget { limit: 8, used: 0 };
        let expected = [1, 2, 4, 8, 16, 30, 30, 30];
        for seconds in expected {
            assert_eq!(
                budget.next_delay(&temporary),
                Some(Duration::from_secs(seconds))
            );
        }
        assert_eq!(budget.next_delay(&temporary), None);
        budget.reset();
        assert_eq!(
            budget.next_delay(&anyhow::anyhow!("rpc_transport_failed")),
            None
        );
        assert_eq!(budget.used, 0);
        assert_eq!(budget.next_delay(&temporary), Some(Duration::from_secs(1)));
        budget.limit = 0;
        budget.reset();
        assert_eq!(budget.next_delay(&temporary), None);
    }

    #[tokio::test]
    async fn exhausted_budget_historical_mode_and_authorization_errors_exit() {
        #[derive(Clone)]
        struct Failure {
            code: StatusCode,
            requests: Arc<AtomicU64>,
        }
        async fn handler(State(failure): State<Failure>) -> StatusCode {
            failure.requests.fetch_add(1, Ordering::SeqCst);
            failure.code
        }
        for (follow_mode, code, retries, requests_expected) in [
            (true, StatusCode::SERVICE_UNAVAILABLE, 2, 3),
            (false, StatusCode::SERVICE_UNAVAILABLE, 8, 1),
            (true, StatusCode::FORBIDDEN, 8, 1),
            (true, StatusCode::SERVICE_UNAVAILABLE, 0, 1),
        ] {
            let requests = Arc::new(AtomicU64::new(0));
            let app = Router::new().route("/", post(handler)).with_state(Failure {
                code,
                requests: requests.clone(),
            });
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let source = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let root = tempfile::tempdir().unwrap();
            let options = SyncOptions {
                source,
                network: "regtest".into(),
                archive: root.path().join("archive"),
                follow_mode,
                ..SyncOptions::default()
            };
            let result = tokio::time::timeout(
                Duration::from_secs(6),
                run(
                    options.clone(),
                    LoopOptions {
                        poll_seconds: 1,
                        max_steps: None,
                        max_source_retries: retries,
                    },
                    std::future::pending(),
                ),
            )
            .await
            .unwrap();
            assert!(result.is_err());
            assert_eq!(requests.load(Ordering::SeqCst), requests_expected);
            assert!(
                !options.archive.exists(),
                "failed preflight must not initialize an archive"
            );
            server.abort();
            let _ = server.await;
        }
    }

    #[tokio::test]
    async fn cancellation_interrupts_backoff_and_releases_writer() {
        let requests = Arc::new(AtomicU64::new(0));
        async fn handler(State(requests): State<Arc<AtomicU64>>) -> StatusCode {
            requests.fetch_add(1, Ordering::SeqCst);
            StatusCode::SERVICE_UNAVAILABLE
        }
        let app = Router::new()
            .route("/", post(handler))
            .with_state(requests.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let source = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let root = tempfile::tempdir().unwrap();
        let options = SyncOptions {
            source,
            network: "regtest".into(),
            archive: root.path().join("archive"),
            follow_mode: true,
            ..SyncOptions::default()
        };
        let (cancel, cancelled) = tokio::sync::oneshot::channel();
        let task_options = options.clone();
        let task = tokio::spawn(async move {
            run(
                task_options,
                LoopOptions {
                    poll_seconds: 1,
                    max_steps: None,
                    max_source_retries: 8,
                },
                async {
                    let _ = cancelled.await;
                },
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if requests.load(Ordering::SeqCst) == 1 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        cancel.send(()).unwrap();
        tokio::time::timeout(Duration::from_millis(500), task)
            .await
            .expect("shutdown must interrupt the one-second backoff")
            .unwrap()
            .unwrap();
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        assert!(!options.archive.exists());
        let _writer = prep_store::ArchiveWriter::create_or_open_with_kind(
            &options.archive,
            "regtest",
            1,
            prep_store::FULL_KIND,
        )
        .expect("shutdown must release writer lock");
        server.abort();
        let _ = server.await;
    }

    #[tokio::test]
    async fn follow_recovers_after_startup_and_later_http_outages_without_duplicate_segments() {
        #[derive(Clone)]
        struct Source {
            hash: String,
            raw: String,
            decoded: Value,
            polls: Arc<AtomicU64>,
        }
        async fn handler(State(source): State<Source>, Json(request): Json<Value>) -> Response {
            let result = match request["method"].as_str().unwrap() {
                "getblockchaininfo" => {
                    let count = source.polls.fetch_add(1, Ordering::SeqCst) + 1;
                    // Fail preflight once; the next attempt succeeds without
                    // initializing the archive prematurely. The first segment
                    // then performs three source-anchor reads (3..=5).
                    // Fail two more attempts after that segment is committed.
                    if count == 1 || (6..=7).contains(&count) {
                        return StatusCode::SERVICE_UNAVAILABLE.into_response();
                    }
                    json!({"chain": "regtest", "blocks": 1, "bestblockhash": source.hash})
                }
                "getblockhash" => {
                    if request["params"][0] == 0 {
                        json!("00".repeat(32))
                    } else {
                        json!(source.hash)
                    }
                }
                "getblock" => {
                    if request["params"][1] == 0 {
                        json!(source.raw)
                    } else {
                        source.decoded
                    }
                }
                _ => panic!("unexpected RPC"),
            };
            Json(json!({"id": request["id"], "result": result, "error": null})).into_response()
        }
        let (hash, raw, decoded) = crate::full_source::tests::fixture(1, &[0; 32], 1);
        let polls = Arc::new(AtomicU64::new(0));
        let app = Router::new().route("/", post(handler)).with_state(Source {
            hash,
            raw: hex::encode(raw),
            decoded,
            polls: polls.clone(),
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let source = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let root = tempfile::tempdir().unwrap();
        let options = SyncOptions {
            source,
            network: "regtest".into(),
            archive: root.path().join("archive"),
            confirmations: 0,
            follow_mode: true,
            ..SyncOptions::default()
        };
        let task_options = options.clone();
        let task = tokio::spawn(async move {
            run(
                task_options,
                LoopOptions {
                    poll_seconds: 1,
                    max_steps: Some(2),
                    max_source_retries: 8,
                },
                std::future::pending(),
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let status = std::fs::read(options.archive.join("status.json"))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
                if let Some(status) = status {
                    if status["error"] == "sync_failed" {
                        assert_eq!(status["ready"], false);
                        assert_eq!(status["indexed_height"], 1);
                        assert_eq!(status["revision"], 1);
                        break;
                    }
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("committed prefix must become unready during outage");
        let result = tokio::time::timeout(Duration::from_secs(8), task).await;
        server.abort();
        result
            .expect("recovery must be bounded")
            .unwrap()
            .expect("follow must recover from source HTTP 503");
        let archive = prep_store::Archive::open(&options.archive).unwrap();
        assert_eq!(archive.catalog().segments.len(), 1);
        assert_eq!(archive.catalog().segments[0].end_height, 1);
        assert_eq!(archive.catalog().revision, 1);
        assert_eq!(polls.load(Ordering::SeqCst), 8);
        let status: Value =
            serde_json::from_slice(&std::fs::read(options.archive.join("status.json")).unwrap())
                .unwrap();
        assert_eq!(status["ready"], true);
        assert_eq!(status["indexed_height"], 1);
    }
}
