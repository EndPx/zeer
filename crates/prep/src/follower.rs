//! One bounded archive-sync step. The caller owns polling cadence and shutdown.
//!
//! Completed segments are immutable. Reorgs publish a catalog epoch change
//! before replacement data; orphaned/incomplete files remain counted on disk.
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, ensure, Result};
use prep_store::{ArchiveWriter, BlockRecord, Catalog, StoreLimits, StoreWriter, FULL_KIND};
use prost::Message;
use serde::Serialize;
use serde_json::json;

use crate::full_source::{rpc_hash, unix_seconds, ChainInfo, NodeRpc, MAX_FULL_ENVELOPE_BYTES};

const ADMISSION_RESERVE: u64 = 256 * 1024 * 1024;
const SEGMENT_PAYLOAD_BUDGET: u64 = prep_store::MAX_FULL_BLOCK_BYTES + 4096;
static FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug)]
pub struct SyncOptions {
    pub source: String,
    pub network: String,
    pub archive: PathBuf,
    pub from: u64,
    pub to: Option<u64>,
    pub segment_blocks: u64,
    /// Required confirmations, including the containing block; 0/1 admit tip.
    pub confirmations: u64,
    pub max_reorg_blocks: u64,
    pub max_archive_bytes: u64,
    pub allow_insecure: bool,
    pub deadline_seconds: u64,
    pub follow_mode: bool,
    pub compress: bool,
}

impl Default for SyncOptions {
    fn default() -> Self {
        Self {
            source: String::new(),
            network: "mainnet".into(),
            archive: "prep-archive".into(),
            from: 1,
            to: None,
            segment_blocks: 100,
            confirmations: 10,
            max_reorg_blocks: 100,
            max_archive_bytes: 4 * 1024 * 1024 * 1024,
            allow_insecure: false,
            deadline_seconds: 120,
            follow_mode: false,
            compress: false,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct SyncProgress {
    pub progress: bool,
    pub head: Option<u64>,
    pub source_height: u64,
    pub epoch: u64,
    pub revision: u64,
}

/// Process diagnostics only: no endpoint, credentials, archive paths or receipt
/// content. `heartbeat` reports liveness, not advancement of the archive head.
#[derive(Clone, Debug, Serialize)]
pub struct SyncEvent {
    pub event: &'static str,
    pub phase: &'static str,
    pub state: &'static str,
    pub heartbeat: bool,
    pub observed_at_unix: u64,
    pub last_progress_at_unix: Option<u64>,
    pub source_height: Option<u64>,
    pub committed_height: Option<u64>,
    pub error_code: Option<&'static str>,
    pub retry_attempt: Option<u32>,
    pub retry_limit: Option<u32>,
    pub retry_delay_seconds: Option<u64>,
}

impl SyncEvent {
    pub(crate) fn new(phase: &'static str, state: &'static str) -> Self {
        Self {
            event: "prep_operation",
            phase,
            state,
            heartbeat: false,
            observed_at_unix: unix_seconds(),
            last_progress_at_unix: None,
            source_height: None,
            committed_height: None,
            error_code: None,
            retry_attempt: None,
            retry_limit: None,
            retry_delay_seconds: None,
        }
    }
}

#[derive(Serialize)]
struct StatusFile<'a> {
    schema_version: u32,
    ready: bool,
    source_height: u64,
    indexed_height: Option<u64>,
    lag_blocks: Option<u64>,
    updated_at_unix: u64,
    error: Option<&'a str>,
    epoch: u64,
    revision: u64,
    mode: &'a str,
}

pub(crate) fn nonce() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_nanos())
        .unwrap_or(0);
    format!(
        "{}-{}-{}",
        std::process::id(),
        nanos,
        FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn write_status(
    root: &Path,
    catalog: &Catalog,
    source_height: u64,
    ready: bool,
    error: Option<&str>,
    follow_mode: bool,
) -> Result<()> {
    let indexed_height = catalog.segments.last().map(|segment| segment.end_height);
    let status = StatusFile {
        schema_version: 1,
        ready: ready && indexed_height.is_some(),
        source_height,
        indexed_height,
        lag_blocks: indexed_height.map(|height| source_height.saturating_sub(height)),
        updated_at_unix: unix_seconds(),
        error,
        epoch: catalog.epoch,
        revision: catalog.revision,
        mode: if follow_mode { "follow" } else { "historical" },
    };
    let temporary = root.join(format!("status-{}.pending", nonce()));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(&serde_json::to_vec(&status)?)?;
    file.sync_all()?;
    fs::rename(temporary, root.join("status.json"))?;
    fs::File::open(root)?.sync_all()?;
    Ok(())
}

/// Counts every regular file under the archive, including abandoned segments
/// and pending metadata. Reject symlinks rather than following them elsewhere.
pub fn archive_disk_bytes(root: &Path) -> Result<u64> {
    let mut pending = vec![root.to_path_buf()];
    let mut total = 0_u64;
    while let Some(path) = pending.pop() {
        let metadata = fs::symlink_metadata(&path)?;
        ensure!(
            !metadata.file_type().is_symlink(),
            "archive_symlink_forbidden"
        );
        if metadata.is_dir() {
            for entry in fs::read_dir(path)? {
                pending.push(entry?.path());
            }
        } else {
            ensure!(metadata.is_file(), "archive_special_file_forbidden");
            total = total
                .checked_add(metadata.len())
                .ok_or_else(|| anyhow!("archive_size_overflow"))?;
        }
    }
    Ok(total)
}

fn validate_options(options: &SyncOptions) -> Result<()> {
    ensure!(cfg!(unix), "archive_sync_requires_unix");
    ensure!(
        matches!(options.network.as_str(), "mainnet" | "testnet" | "regtest"),
        "invalid_network"
    );
    ensure!(options.from <= u64::from(u32::MAX), "invalid_start_height");
    ensure!(
        options
            .to
            .map(|end| end >= options.from && end <= u64::from(u32::MAX))
            .unwrap_or(true),
        "invalid_end_height"
    );
    ensure!(
        (1..=1000).contains(&options.segment_blocks),
        "segment_blocks_must_be_1_to_1000"
    );
    ensure!(
        options.confirmations <= 100_000,
        "confirmation_limit_exceeded"
    );
    ensure!(
        (1..=10_000).contains(&options.max_reorg_blocks),
        "reorg_depth_must_be_1_to_10000"
    );
    ensure!(
        options.max_archive_bytes >= ADMISSION_RESERVE,
        "archive_budget_below_segment_reserve"
    );
    ensure!(
        (1..=600).contains(&options.deadline_seconds),
        "sync_deadline_must_be_1_to_600_seconds"
    );
    Ok(())
}

fn status_code(error: &anyhow::Error) -> &'static str {
    // Error source details may contain credentials or upstream messages. Only
    // publish a small known vocabulary to HTTP health/status readers.
    match error.to_string().as_str() {
        "deep_reorg_requires_operator_recovery" => "deep_reorg_requires_operator_recovery",
        "source_network_mismatch" => "source_network_mismatch",
        "archive_disk_budget_exhausted" => "archive_disk_budget_exhausted",
        "catalog_consolidation_required_before_append"
        | "snapshot bound exceeded: catalog segment count"
        | "snapshot bound exceeded: catalog bytes" => "catalog_consolidation_required",
        "source_changed_during_segment" => "source_changed_during_segment",
        "sync_deadline_exceeded" => "sync_deadline_exceeded",
        _ => "sync_failed",
    }
}

/// A bounded vocabulary, never an upstream exception/body or URL. Authentication
/// errors are terminal; only the separately typed transport/status errors retry.
pub(crate) fn source_error_code(error: &anyhow::Error) -> &'static str {
    match error.to_string().as_str() {
        "rpc_authentication_failed" => "rpc_authentication_failed",
        "source_network_mismatch" => "source_network_mismatch",
        "source_preflight_timeout" => "source_preflight_timeout",
        "deep_reorg_requires_operator_recovery" => "deep_reorg_requires_operator_recovery",
        "archive_disk_budget_exhausted" => "archive_disk_budget_exhausted",
        "catalog_consolidation_required_before_append"
        | "snapshot bound exceeded: catalog segment count"
        | "snapshot bound exceeded: catalog bytes" => "catalog_consolidation_required",
        "source_changed_during_segment" => "source_changed_during_segment",
        "sync_deadline_exceeded" => "sync_deadline_exceeded",
        "rpc_transport_failed"
        | "rpc_http_status_failed"
        | "rpc_dns_timeout"
        | "rpc_dns_failed" => "source_unavailable",
        _ => "source_configuration_or_response_failed",
    }
}

/// Keeps the writer lock, validated stores and HTTP connection pool for the
/// lifetime of one process. Restart validates disk once; each step reuses it.
pub struct SyncSession {
    options: SyncOptions,
    writer: ArchiveWriter,
    source: NodeRpc,
    source_height: u64,
}

impl SyncSession {
    /// Cached admitted catalog state, including a rollback performed by a failed
    /// step. Does not read disk or contact the source; it is not a ready verdict.
    pub fn progress_snapshot(&self) -> SyncProgress {
        progress(&self.writer, self.source_height, false)
    }

    pub async fn new(options: SyncOptions) -> Result<Self> {
        Self::new_with_observer(options, |_| {}).await
    }

    /// Source preflight runs before creating the archive directory, writer lock,
    /// catalog or readiness file. Its observation is diagnostic only: step()
    /// independently rechecks the source after the full archive integrity pass.
    pub async fn new_with_observer(
        options: SyncOptions,
        observer: impl Fn(SyncEvent),
    ) -> Result<Self> {
        validate_options(&options)?;
        observer(SyncEvent::new("checking_source", "started"));
        let preflight = tokio::time::timeout(
            Duration::from_secs(options.deadline_seconds.min(30)),
            async {
                let source = NodeRpc::new(&options.source, options.allow_insecure).await?;
                let info = source.chain_info().await?;
                ensure!(info.network == options.network, "source_network_mismatch");
                Ok::<_, anyhow::Error>((source, info))
            },
        )
        .await
        .unwrap_or_else(|_| Err(crate::full_source::TransientSourceError::PreflightTimeout.into()));
        let (source, info) = match preflight {
            Ok(result) => result,
            Err(error) => {
                let mut event = SyncEvent::new("checking_source", "failed");
                event.error_code = Some(source_error_code(&error));
                observer(event);
                return Err(error);
            }
        };
        let mut event = SyncEvent::new("checking_source", "completed");
        event.source_height = Some(info.height);
        observer(event);
        let mut opening = SyncEvent::new("opening_and_validating_archive", "started");
        opening.source_height = Some(info.height);
        observer(opening.clone());
        // Intentionally synchronous: cancellation must not detach a disk worker
        // which can later acquire the writer lock and mutate an abandoned root.
        let writer = match ArchiveWriter::create_or_open_with_kind(
            &options.archive,
            &options.network,
            options.from,
            FULL_KIND,
        ) {
            Ok(writer) => writer,
            Err(error) => {
                opening.state = "failed";
                opening.error_code = Some("archive_admission_failed");
                opening.observed_at_unix = unix_seconds();
                observer(opening);
                return Err(error.into());
            }
        };
        write_status(
            &options.archive,
            writer.catalog(),
            info.height,
            false,
            Some("synchronizing"),
            options.follow_mode,
        )?;
        opening.state = "completed";
        opening.observed_at_unix = unix_seconds();
        opening.committed_height = writer.head();
        observer(opening);
        Ok(Self {
            options,
            writer,
            source,
            source_height: info.height,
        })
    }

    pub async fn step(&mut self) -> Result<SyncProgress> {
        self.step_with_observer(|_| {}).await
    }

    pub(crate) async fn step_with_observer(
        &mut self,
        observer: impl Fn(SyncEvent) + Sync,
    ) -> Result<SyncProgress> {
        let options = &self.options;
        let result = tokio::time::timeout(
            Duration::from_secs(options.deadline_seconds),
            sync_locked(
                options,
                &self.source,
                &mut self.writer,
                &mut self.source_height,
                &observer,
            ),
        )
        .await
        .unwrap_or_else(|_| Err(anyhow!("sync_deadline_exceeded")));
        match result {
            Ok(progress) => {
                write_status(
                    &options.archive,
                    self.writer.catalog(),
                    self.source_height,
                    true,
                    None,
                    options.follow_mode,
                )?;
                Ok(progress)
            }
            Err(error) => {
                write_status(
                    &options.archive,
                    self.writer.catalog(),
                    self.source_height,
                    false,
                    Some(status_code(&error)),
                    options.follow_mode,
                )?;
                Err(error)
            }
        }
    }
}

/// Convenience for bounded callers/tests. Long-running followers should keep a
/// SyncSession and call step() to avoid reopening/revalidating prior segments.
pub async fn sync_once(options: &SyncOptions) -> Result<SyncProgress> {
    SyncSession::new(options.clone()).await?.step().await
}

async fn sync_locked(
    options: &SyncOptions,
    source: &NodeRpc,
    writer: &mut ArchiveWriter,
    source_height: &mut u64,
    observer: &(impl Fn(SyncEvent) + Sync),
) -> Result<SyncProgress> {
    let info = source.chain_info().await?;
    *source_height = info.height;
    ensure!(info.network == options.network, "source_network_mismatch");
    let mut changed = reconcile(options, source, writer, &info).await?;
    // A verified existing prefix remains readable while a new segment downloads.
    // Catalog append is atomic; consumers do not need to wait for catch-up.
    write_status(
        &options.archive,
        writer.catalog(),
        info.height,
        true,
        None,
        options.follow_mode,
    )?;
    let next = writer.head().map(|head| head + 1).unwrap_or(options.from);
    let eligible = info
        .height
        .saturating_sub(options.confirmations.saturating_sub(1));
    let target = options.to.map(|end| end.min(eligible)).unwrap_or(eligible);
    if next > target {
        return Ok(progress(writer, info.height, changed));
    }
    // Reclaim catalog entries before downloading/writing when the next append
    // would have no room. No complete unpublished segment is created at the cap.
    if options.follow_mode && crate::maintenance::required_before_append(writer)? {
        maintain_catalog(options, source, writer, source_height, observer).await?;
    }
    ensure!(
        writer.remaining_segment_slots() > 0
            && !crate::maintenance::required_before_append(writer)?,
        "catalog_consolidation_required_before_append"
    );
    let used = archive_disk_bytes(&options.archive)?;
    ensure!(
        used.checked_add(ADMISSION_RESERVE)
            .map(|bytes| bytes <= options.max_archive_bytes)
            .unwrap_or(false),
        "archive_disk_budget_exhausted"
    );
    let end_limit = target.min(next.saturating_add(options.segment_blocks - 1));
    let predecessor = predecessor_hash(source, next).await?;
    if let Some(local_head_hash) = writer.head_hash() {
        ensure!(
            local_head_hash == predecessor,
            "source_changed_during_segment"
        );
    }
    let captured_at = unix_seconds();
    let mut records = Vec::new();
    let mut previous = predecessor.clone();
    let mut encoded_bytes = 0_u64;
    for height in next..=end_limit {
        let block = source.full_block(height).await?;
        ensure!(
            rpc_hash(&block.prev_hash)? == previous,
            "source_changed_during_segment"
        );
        let size = block.encoded_len() as u64 + 4;
        ensure!(
            size <= SEGMENT_PAYLOAD_BUDGET,
            "single_full_block_exceeds_segment_budget"
        );
        if !records.is_empty() && encoded_bytes + size > SEGMENT_PAYLOAD_BUDGET {
            break;
        }
        encoded_bytes += size;
        previous = rpc_hash(&block.hash)?;
        records.push(BlockRecord {
            height,
            hash: block.hash.clone(),
            prev_hash: block.prev_hash.clone(),
            payload: block.encode_to_vec(),
        });
    }
    let end = records
        .last()
        .ok_or_else(|| anyhow!("empty_segment"))?
        .height;
    let end_hash = previous;
    recheck_source(
        source,
        &options.network,
        next,
        end,
        &predecessor,
        &end_hash,
        source_height,
    )
    .await?;
    let relative = format!("segments/full-{}-{}-{}", next, end, nonce());
    let path = options.archive.join(&relative);
    let mut segment = StoreWriter::create_full_with_limits(
        &path,
        &options.network,
        next,
        end,
        &predecessor,
        &end_hash,
        StoreLimits {
            max_block_bytes: MAX_FULL_ENVELOPE_BYTES as u64,
            max_segment_bytes: SEGMENT_PAYLOAD_BUDGET,
            ..StoreLimits::default()
        },
    )?;
    if options.compress {
        segment = segment.with_compression()?;
    }
    for record in records {
        segment.push(record)?;
    }
    // A second post-write check prevents publication after a source fork while
    // the local segment was being persisted. No await occurs after these checks
    // until the immutable segment and catalog are durably published.
    recheck_source(
        source,
        &options.network,
        next,
        end,
        &predecessor,
        &end_hash,
        source_height,
    )
    .await?;
    let source_record = json!({
        "schema_version": 1, "source": source.source_label(), "network": options.network,
        "payload_kind": FULL_KIND, "capture_started_at_unix": captured_at,
        "capture_completed_at_unix": unix_seconds(), "source_height": *source_height,
        "start_height": next, "end_height": end, "predecessor_hash": predecessor,
        "end_hash": end_hash, "anchors_checked_before_publication": true,
        "decoded_projection": "getblock verbosity 2 including all transaction objects and unknown fields; confirmations and nextblockhash are capture-time metadata",
        "validation": "SHA256d serialized header hash, header parent/time, canonical CompactSize, exact raw transaction concatenation and count; node remains consensus authority"
    });
    let mut provenance = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path.join("source.json"))?;
    provenance.write_all(&serde_json::to_vec_pretty(&source_record)?)?;
    provenance.sync_all()?;
    segment.finish()?;
    ensure!(
        archive_disk_bytes(&options.archive)? <= options.max_archive_bytes,
        "archive_disk_budget_exhausted"
    );
    writer.append_segment(&relative)?;
    changed = true;
    if options.follow_mode {
        // The newest block becomes readable before bounded maintenance starts.
        // Do not postpone this publication until a large segment fills up.
        write_status(
            &options.archive,
            writer.catalog(),
            *source_height,
            true,
            None,
            options.follow_mode,
        )?;
        maintain_catalog(options, source, writer, source_height, observer).await?;
    }
    Ok(progress(writer, *source_height, changed))
}

async fn maintain_catalog(
    options: &SyncOptions,
    source: &NodeRpc,
    writer: &mut ArchiveWriter,
    source_height: &mut u64,
    observer: &(impl Fn(SyncEvent) + Sync),
) -> Result<bool> {
    if !crate::maintenance::needed(writer)? {
        return Ok(false);
    }
    let mut event = SyncEvent::new("consolidating_archive", "started");
    event.committed_height = writer.head();
    event.source_height = Some(*source_height);
    observer(event.clone());
    let result = crate::maintenance::maintain_once(
        &options.archive,
        writer,
        options.max_reorg_blocks,
        options.max_archive_bytes,
    )?;
    if result.is_some() {
        // Consolidation invalidates physical-layout cursors. Its new catalog
        // must not make an old status timestamp look like a fresh observation.
        let info = source.chain_info().await?;
        *source_height = info.height;
        ensure!(info.network == options.network, "source_network_mismatch");
        if let Some(head) = writer.head() {
            ensure!(
                info.height >= head
                    && source.block_hash(head).await?.as_str()
                        == writer.head_hash().unwrap_or_default(),
                "source_changed_during_segment"
            );
        }
        write_status(
            &options.archive,
            writer.catalog(),
            *source_height,
            true,
            None,
            options.follow_mode,
        )?;
    }
    event.state = "completed";
    event.observed_at_unix = unix_seconds();
    event.source_height = Some(*source_height);
    observer(event);
    Ok(result.is_some())
}

fn progress(writer: &ArchiveWriter, source_height: u64, progress: bool) -> SyncProgress {
    SyncProgress {
        progress,
        head: writer.head(),
        source_height,
        epoch: writer.catalog().epoch,
        revision: writer.catalog().revision,
    }
}

async fn recheck_source(
    source: &NodeRpc,
    network: &str,
    start: u64,
    end: u64,
    predecessor: &str,
    end_hash: &str,
    source_height: &mut u64,
) -> Result<()> {
    let info = source.chain_info().await?;
    *source_height = info.height;
    ensure!(info.network == network, "source_network_mismatch");
    ensure!(
        info.height >= end
            && source.block_hash(end).await? == end_hash
            && predecessor_hash(source, start).await? == predecessor,
        "source_changed_during_segment"
    );
    Ok(())
}

async fn predecessor_hash(source: &NodeRpc, start: u64) -> Result<String> {
    match start.checked_sub(1) {
        Some(height) => source.block_hash(height).await,
        None => Ok("00".repeat(32)),
    }
}

async fn reconcile(
    options: &SyncOptions,
    source: &NodeRpc,
    writer: &mut ArchiveWriter,
    info: &ChainInfo,
) -> Result<bool> {
    let Some(head) = writer.head() else {
        return Ok(false);
    };
    let old_hash = writer
        .head_hash()
        .ok_or_else(|| anyhow!("missing_archive_head_hash"))?
        .to_owned();
    if head <= info.height && source.block_hash(head).await? == old_hash {
        return Ok(false);
    }
    write_status(
        &options.archive,
        writer.catalog(),
        info.height,
        false,
        Some("reorg_detected"),
        options.follow_mode,
    )?;
    let floor = head
        .saturating_sub(options.max_reorg_blocks)
        .max(options.from.saturating_sub(1));
    let mut height = head.min(info.height);
    ensure!(height >= floor, "deep_reorg_requires_operator_recovery");
    let snapshot = writer.snapshot();
    let first_parent = writer
        .catalog()
        .segments
        .first()
        .ok_or_else(|| anyhow!("missing_archive_segment"))?
        .predecessor_hash
        .clone();
    loop {
        let local_hash = if options.from.checked_sub(1) == Some(height) {
            first_parent.clone()
        } else {
            snapshot.block_hash(height)?
        };
        if source.block_hash(height).await? == local_hash {
            writer.rollback_to(height)?;
            // Invalidate old reader cursors through the committed epoch before
            // fetching replacement blocks. Ready stays false until sync succeeds.
            write_status(
                &options.archive,
                writer.catalog(),
                info.height,
                false,
                Some("reorg_recovery"),
                options.follow_mode,
            )?;
            return Ok(true);
        }
        if height == floor {
            break;
        }
        height -= 1;
    }
    Err(anyhow!("deep_reorg_requires_operator_recovery"))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use axum::{extract::State, routing::post, Json, Router};
    use prep_store::Archive;
    use serde_json::Value;
    use std::sync::{Arc, Mutex};
    use tokio::{net::TcpListener, sync::oneshot};

    type TestBlock = (String, Vec<u8>, Value);

    #[derive(Clone)]
    struct NodeState {
        blocks: Arc<Mutex<Vec<TestBlock>>>,
        invalid_raw: Arc<std::sync::atomic::AtomicBool>,
        delay_ms: Arc<AtomicU64>,
        info_delay_ms: Arc<AtomicU64>,
        reorg_after_decoded_height: Arc<AtomicU64>,
    }

    fn extend(blocks: &mut Vec<TestBlock>, end: u64, marker: u8) {
        while blocks.len() <= end as usize {
            let height = blocks.len() as u64;
            let parent = hex::decode(&blocks.last().unwrap().0)
                .unwrap()
                .into_iter()
                .rev()
                .collect::<Vec<_>>();
            blocks.push(crate::full_source::tests::fixture(height, &parent, marker));
        }
    }

    async fn rpc(State(state): State<NodeState>, Json(body): Json<Value>) -> Json<Value> {
        if body["method"] == "getblockchaininfo" {
            tokio::time::sleep(Duration::from_millis(
                state.info_delay_ms.load(Ordering::Relaxed),
            ))
            .await;
        }
        if body["method"] == "getblock" {
            tokio::time::sleep(Duration::from_millis(
                state.delay_ms.load(Ordering::Relaxed),
            ))
            .await;
        }
        let mut blocks = state.blocks.lock().unwrap();
        let params = body.get("params").and_then(Value::as_array).unwrap();
        let value = match body["method"].as_str().unwrap() {
            "getblockchaininfo" => Some(
                json!({"chain": "regtest", "blocks": blocks.len()-1, "bestblockhash": blocks.last().unwrap().0}),
            ),
            "getblockhash" => blocks
                .get(params[0].as_u64().unwrap() as usize)
                .map(|block| json!(block.0)),
            "getblock" => blocks
                .iter()
                .find(|block| block.0 == params[0].as_str().unwrap())
                .map(|block| {
                    if params[1] == 0 {
                        let mut raw = block.1.clone();
                        if state.invalid_raw.load(Ordering::Relaxed) {
                            raw[0] ^= 1;
                        }
                        json!(hex::encode(raw))
                    } else {
                        block.2.clone()
                    }
                }),
            _ => panic!("write or unexpected RPC method"),
        };
        if body["method"] == "getblock" && params.get(1) == Some(&json!(2)) {
            if let Some(height) = value
                .as_ref()
                .and_then(|block| block.get("height"))
                .and_then(Value::as_u64)
            {
                if height > 0
                    && state
                        .reorg_after_decoded_height
                        .compare_exchange(height, 0, Ordering::SeqCst, Ordering::SeqCst)
                        .is_ok()
                {
                    let old_end = blocks.len() as u64 - 1;
                    blocks.truncate(height as usize);
                    extend(&mut blocks, old_end, 9);
                }
            }
        }
        match value {
            Some(result) => Json(json!({"id": body["id"], "result": result, "error": null})),
            None => Json(
                json!({"id": body["id"], "result": null, "error": {"code": -8, "message": "not found"}}),
            ),
        }
    }

    async fn node(end: u64) -> (NodeState, String, oneshot::Sender<()>) {
        let mut blocks = vec![("00".repeat(32), vec![], Value::Null)];
        extend(&mut blocks, end, 1);
        let state = NodeState {
            blocks: Arc::new(Mutex::new(blocks)),
            invalid_raw: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            delay_ms: Arc::new(AtomicU64::new(0)),
            info_delay_ms: Arc::new(AtomicU64::new(0)),
            reorg_after_decoded_height: Arc::new(AtomicU64::new(0)),
        };
        let app = Router::new()
            .route("/", post(rpc))
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let (stop, stopped) = oneshot::channel();
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await
                .unwrap();
        });
        (state, endpoint, stop)
    }

    fn options(source: String, path: &Path) -> SyncOptions {
        SyncOptions {
            source,
            network: "regtest".into(),
            archive: path.join("archive"),
            segment_blocks: 2,
            confirmations: 1,
            deadline_seconds: 10,
            ..SyncOptions::default()
        }
    }

    fn status(path: &Path) -> Value {
        serde_json::from_slice(&fs::read(path.join("status.json")).unwrap()).unwrap()
    }

    #[tokio::test]
    async fn source_preflight_fails_before_archive_mutation_and_reports_safe_phases() {
        use axum::http::StatusCode;
        for code in [StatusCode::UNAUTHORIZED, StatusCode::SERVICE_UNAVAILABLE] {
            async fn failure(
                axum::extract::State(code): axum::extract::State<StatusCode>,
            ) -> (StatusCode, &'static str) {
                (
                    code,
                    "secret upstream exception must never enter diagnostics",
                )
            }
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("http://{}", listener.local_addr().unwrap());
            let app = Router::new().route("/", post(failure)).with_state(code);
            let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let directory = tempfile::tempdir().unwrap();
            let options = options(endpoint, directory.path());
            let events = Mutex::new(Vec::new());
            let result = SyncSession::new_with_observer(options.clone(), |event| {
                events.lock().unwrap().push(event)
            })
            .await;
            assert!(result.is_err());
            assert!(
                !options.archive.exists(),
                "failed authentication/source availability must not create a writer lock or status"
            );
            let events = events.into_inner().unwrap();
            assert_eq!(events.len(), 2);
            assert_eq!(events[0].phase, "checking_source");
            assert_eq!(events[1].state, "failed");
            assert_eq!(
                events[1].error_code,
                Some(if code == StatusCode::UNAUTHORIZED {
                    "rpc_authentication_failed"
                } else {
                    "source_unavailable"
                })
            );
            assert!(!serde_json::to_string(&events).unwrap().contains("secret"));

            // A failed restart must not overwrite an existing archive's previous
            // status, initialize a catalog, or create an incidental writer lock.
            fs::create_dir(&options.archive).unwrap();
            fs::write(
                options.archive.join("status.json"),
                b"existing status bytes",
            )
            .unwrap();
            fs::write(
                options.archive.join("catalog.json"),
                b"corrupt catalog sentinel",
            )
            .unwrap();
            assert!(SyncSession::new(options.clone()).await.is_err());
            assert_eq!(
                fs::read(options.archive.join("status.json")).unwrap(),
                b"existing status bytes"
            );
            assert_eq!(
                fs::read(options.archive.join("catalog.json")).unwrap(),
                b"corrupt catalog sentinel"
            );
            assert_eq!(fs::read_dir(&options.archive).unwrap().count(), 2);
            task.abort();
            let _ = task.await;
        }
    }

    #[tokio::test]
    async fn preflight_checks_network_deadline_and_reobserves_after_admission() {
        let (node, endpoint, stop) = node(4).await;
        let directory = tempfile::tempdir().unwrap();
        let mut options = options(endpoint, directory.path());
        options.network = "mainnet".into();
        assert_eq!(
            SyncSession::new(options.clone())
                .await
                .err()
                .unwrap()
                .to_string(),
            "source_network_mismatch"
        );
        assert!(!options.archive.exists());
        options.network = "regtest".into();
        options.deadline_seconds = 1;
        node.info_delay_ms.store(1500, Ordering::Relaxed);
        let start = std::time::Instant::now();
        assert_eq!(
            SyncSession::new(options.clone())
                .await
                .err()
                .unwrap()
                .to_string(),
            "source_preflight_timeout"
        );
        assert!(start.elapsed() < Duration::from_millis(1400));
        assert!(!options.archive.exists());
        node.info_delay_ms.store(0, Ordering::Relaxed);
        options.deadline_seconds = 10;
        let events = Mutex::new(Vec::new());
        let mut session = SyncSession::new_with_observer(options.clone(), |event| {
            events.lock().unwrap().push(event)
        })
        .await
        .unwrap();
        let events = events.into_inner().unwrap();
        assert_eq!(
            events
                .iter()
                .map(|event| (event.phase, event.state))
                .collect::<Vec<_>>(),
            vec![
                ("checking_source", "started"),
                ("checking_source", "completed"),
                ("opening_and_validating_archive", "started"),
                ("opening_and_validating_archive", "completed")
            ]
        );
        assert_eq!(events[1].source_height, Some(4));
        assert_eq!(status(&options.archive)["ready"], false);
        assert_eq!(status(&options.archive)["source_height"], 4);
        assert!(events
            .iter()
            .all(|event| event.committed_height.is_none() && !event.heartbeat));
        extend(&mut node.blocks.lock().unwrap(), 6, 1);
        assert_eq!(
            session.step().await.unwrap().source_height,
            6,
            "step must not reuse preflight source height"
        );
        drop(session);
        fs::write(options.archive.join("catalog.json"), b"corrupt").unwrap();
        let events = Mutex::new(Vec::new());
        assert!(SyncSession::new_with_observer(options, |event| events
            .lock()
            .unwrap()
            .push(event))
        .await
        .is_err());
        let events = events.into_inner().unwrap();
        assert_eq!(
            events.last().unwrap().phase,
            "opening_and_validating_archive"
        );
        assert_eq!(events.last().unwrap().state, "failed");
        assert_eq!(
            events.last().unwrap().error_code,
            Some("archive_admission_failed")
        );
        stop.send(()).unwrap();
    }

    #[tokio::test]
    async fn genesis_backfill_restart_and_reorg_never_request_negative_height() {
        let (node, endpoint, _stop) = node(0).await;
        {
            let mut blocks = node.blocks.lock().unwrap();
            blocks[0] = crate::full_source::tests::fixture(0, &[0; 32], 1);
            extend(&mut blocks, 4, 1);
        }
        let directory = tempfile::tempdir().unwrap();
        let mut options = options(endpoint, directory.path());
        options.from = 0;
        options.to = Some(0);
        assert_eq!(sync_once(&options).await.unwrap().head, Some(0));
        let archive = Archive::open(&options.archive).unwrap();
        assert_eq!(archive.catalog().start_height, 0);
        assert_eq!(archive.read_block(0).unwrap().prev_hash, vec![0; 32]);
        let genesis_hash = archive.block_hash(0).unwrap();
        drop(archive);
        options.to = None;
        assert_eq!(sync_once(&options).await.unwrap().head, Some(2));
        assert_eq!(sync_once(&options).await.unwrap().head, Some(4));
        assert!(!sync_once(&options).await.unwrap().progress);
        {
            let mut blocks = node.blocks.lock().unwrap();
            blocks.truncate(1);
            extend(&mut blocks, 4, 9);
        }
        assert_eq!(sync_once(&options).await.unwrap().head, Some(2));
        assert_eq!(sync_once(&options).await.unwrap().head, Some(4));
        assert_eq!(
            Archive::open(&options.archive)
                .unwrap()
                .block_hash(0)
                .unwrap(),
            genesis_hash
        );
        {
            let mut blocks = node.blocks.lock().unwrap();
            blocks.clear();
            blocks.push(crate::full_source::tests::fixture(0, &[0; 32], 8));
            extend(&mut blocks, 4, 8);
        }
        assert!(sync_once(&options)
            .await
            .unwrap_err()
            .to_string()
            .contains("deep_reorg_requires_operator_recovery"));
        assert_eq!(status(&options.archive)["ready"], false);
    }

    #[tokio::test]
    async fn http_source_backfill_restart_growth_and_confirmation_policy() {
        let (node, endpoint, stop) = node(6).await;
        let directory = tempfile::tempdir().unwrap();
        let mut options = options(endpoint, directory.path());
        options.follow_mode = true;
        {
            let mut session = SyncSession::new(options.clone()).await.unwrap();
            assert_eq!(session.step().await.unwrap().head, Some(2));
            assert!(
                SyncSession::new(options.clone()).await.is_err(),
                "must hold exclusive writer lock"
            );
        }
        let mut session = SyncSession::new(options.clone()).await.unwrap();
        assert_eq!(session.step().await.unwrap().head, Some(4));
        assert_eq!(session.step().await.unwrap().head, Some(6));
        assert!(!session.step().await.unwrap().progress);
        extend(&mut node.blocks.lock().unwrap(), 8, 1);
        assert_eq!(session.step().await.unwrap().head, Some(8));
        let archive = Archive::open(&options.archive).unwrap();
        let record = archive.read_block(3).unwrap();
        let full = prep_proto::prep::FullBlock::decode(record.payload.as_slice()).unwrap();
        assert_eq!(full.raw_block, node.blocks.lock().unwrap()[3].1);
        let decoded: Value = serde_json::from_str(&full.decoded_json).unwrap();
        assert_eq!(decoded["tx"].as_array().unwrap().len(), 2);
        assert_eq!(decoded["futureField"]["preserve"], true);
        assert_eq!(status(&options.archive)["mode"], "follow");
        drop(session);
        let other = tempfile::tempdir().unwrap();
        options.archive = other.path().join("archive");
        options.confirmations = 3;
        options.segment_blocks = 10;
        let report = sync_once(&options).await.unwrap();
        assert_eq!(report.source_height, 8);
        assert_eq!(report.head, Some(6)); // Heights 6,7,8 give three confirmations.
        stop.send(()).unwrap();
    }

    #[tokio::test]
    async fn shallow_reorg_replaces_segments_and_deep_reorg_fails_closed() {
        let (node, endpoint, stop) = node(6).await;
        let directory = tempfile::tempdir().unwrap();
        let options = options(endpoint, directory.path());
        let mut session = SyncSession::new(options.clone()).await.unwrap();
        for _ in 0..3 {
            session.step().await.unwrap();
        }
        let old = Archive::open(&options.archive).unwrap();
        let old_six = old.read_block(6).unwrap();
        {
            let mut blocks = node.blocks.lock().unwrap();
            blocks.truncate(5); // Common ancestor 4; replace heights 5 and 6.
            extend(&mut blocks, 6, 2);
        }
        let report = session.step().await.unwrap();
        assert_eq!(report.head, Some(6));
        assert_eq!(report.epoch, old.catalog().epoch + 1);
        let current = Archive::open(&options.archive).unwrap();
        assert_ne!(current.read_block(6).unwrap().hash, old_six.hash);
        assert_eq!(
            old.read_block(6).unwrap(),
            old_six,
            "pinned old segments remain immutable"
        );
        assert_eq!(status(&options.archive)["ready"], true);
        drop(session);
        let mut shallow_limit = options.clone();
        shallow_limit.max_reorg_blocks = 1;
        let mut session = SyncSession::new(shallow_limit).await.unwrap();
        {
            let mut blocks = node.blocks.lock().unwrap();
            blocks.truncate(1);
            extend(&mut blocks, 6, 3);
        }
        let error = session.step().await.unwrap_err();
        assert_eq!(error.to_string(), "deep_reorg_requires_operator_recovery");
        let failed = status(&options.archive);
        assert_eq!(failed["ready"], false);
        assert_eq!(failed["error"], "deep_reorg_requires_operator_recovery");
        assert_eq!(Archive::open(&options.archive).unwrap().head(), Some(6));
        stop.send(()).unwrap();
    }

    #[tokio::test]
    async fn shortened_source_rolls_back_without_claiming_future_data() {
        let (node, endpoint, stop) = node(6).await;
        let directory = tempfile::tempdir().unwrap();
        let options = options(endpoint, directory.path());
        let mut session = SyncSession::new(options.clone()).await.unwrap();
        for _ in 0..3 {
            session.step().await.unwrap();
        }
        node.blocks.lock().unwrap().truncate(5);
        let report = session.step().await.unwrap();
        assert_eq!(report.head, Some(4));
        assert_eq!(report.source_height, 4);
        assert!(report.progress);
        assert!(Archive::open(&options.archive)
            .unwrap()
            .read_block(5)
            .is_err());
        stop.send(()).unwrap();
    }

    #[tokio::test]
    async fn diagnostic_checkpoint_clears_after_empty_rollback_even_when_replacement_fetch_fails() {
        let (node, endpoint, stop) = node(6).await;
        let directory = tempfile::tempdir().unwrap();
        let options = options(endpoint, directory.path());
        let mut session = SyncSession::new(options.clone()).await.unwrap();
        for _ in 0..3 {
            session.step().await.unwrap();
        }
        assert_eq!(session.progress_snapshot().head, Some(6));
        // Matching retained predecessor at height 0; all indexed segments leave
        // the catalog. An empty archive is not a ready/readable prefix.
        node.blocks.lock().unwrap().truncate(1);
        assert_eq!(session.step().await.unwrap().head, None);
        assert_eq!(session.progress_snapshot().head, None);
        assert_eq!(status(&options.archive)["indexed_height"], Value::Null);
        assert_eq!(status(&options.archive)["ready"], false);
        extend(&mut node.blocks.lock().unwrap(), 6, 2);
        assert_eq!(session.step().await.unwrap().head, Some(2));
        // Reconcile another fork to the same predecessor, then fail while
        // checking the first replacement raw block. No success event exists to
        // update cached diagnostics; the error path must read the session head.
        {
            let mut blocks = node.blocks.lock().unwrap();
            blocks.truncate(1);
            extend(&mut blocks, 6, 3);
        }
        node.invalid_raw.store(true, Ordering::Relaxed);
        assert!(session.step().await.is_err());
        assert_eq!(session.progress_snapshot().head, None);
        assert_eq!(session.progress_snapshot().source_height, 6);
        assert_eq!(status(&options.archive)["indexed_height"], Value::Null);
        assert_eq!(status(&options.archive)["ready"], false);
        stop.send(()).unwrap();
    }

    #[tokio::test]
    async fn verified_prefix_remains_ready_during_slow_append() {
        let (node, endpoint, stop) = node(4).await;
        let directory = tempfile::tempdir().unwrap();
        let options = options(endpoint, directory.path());
        let mut session = SyncSession::new(options.clone()).await.unwrap();
        session.step().await.unwrap();
        node.delay_ms.store(100, Ordering::Relaxed);
        let append = tokio::spawn(async move { session.step().await });
        tokio::time::sleep(Duration::from_millis(100)).await;
        let reading = status(&options.archive);
        assert_eq!(reading["ready"], true);
        assert_eq!(reading["indexed_height"], 2);
        assert_eq!(
            Archive::open(&options.archive)
                .unwrap()
                .read_block(2)
                .unwrap()
                .height,
            2
        );
        assert_eq!(append.await.unwrap().unwrap().head, Some(4));
        stop.send(()).unwrap();
    }

    #[tokio::test]
    async fn corrupted_source_and_disk_admission_never_publish_segments() {
        let (node, endpoint, stop) = node(4).await;
        let directory = tempfile::tempdir().unwrap();
        let mut options = options(endpoint, directory.path());
        node.invalid_raw.store(true, Ordering::Relaxed);
        assert!(sync_once(&options).await.is_err());
        let archive = Archive::open(&options.archive).unwrap();
        assert!(archive.catalog().segments.is_empty());
        assert_eq!(status(&options.archive)["ready"], false);
        node.invalid_raw.store(false, Ordering::Relaxed);
        options.max_archive_bytes = ADMISSION_RESERVE;
        fs::write(options.archive.join("orphan.bin"), vec![0u8; 4096]).unwrap();
        assert!(archive_disk_bytes(&options.archive).unwrap() >= 4096);
        let error = sync_once(&options).await.unwrap_err();
        assert_eq!(error.to_string(), "archive_disk_budget_exhausted");
        assert!(Archive::open(&options.archive)
            .unwrap()
            .catalog()
            .segments
            .is_empty());
        assert!(options.archive.join("orphan.bin").exists());
        stop.send(()).unwrap();
    }

    #[tokio::test]
    async fn source_fork_during_capture_cannot_publish_stale_segment() {
        let (node, endpoint, stop) = node(4).await;
        let directory = tempfile::tempdir().unwrap();
        let options = options(endpoint, directory.path());
        node.reorg_after_decoded_height.store(2, Ordering::Relaxed);
        let error = sync_once(&options).await.unwrap_err();
        assert_eq!(error.to_string(), "source_changed_during_segment");
        assert!(Archive::open(&options.archive)
            .unwrap()
            .catalog()
            .segments
            .is_empty());
        assert_eq!(status(&options.archive)["ready"], false);
        // A later step acquires the replacement source range cleanly.
        assert_eq!(sync_once(&options).await.unwrap().head, Some(2));
        stop.send(()).unwrap();
    }
}
