//! Bounded native gRPC serving of immutable on-disk snapshots.
use std::{
    future::Future,
    net::SocketAddr,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};

use anyhow::{ensure, Result};
use prep_proto::prep::{
    prep_server::{Prep, PrepServer},
    BlockBatch, DatasetInfo, InfoRequest, RangeRequest,
};
use prep_store::Store;
use prost::Message;
use tokio::{
    net::TcpListener,
    sync::{mpsc, watch, OwnedSemaphorePermit, Semaphore},
};
use tokio_stream::{
    wrappers::{ReceiverStream, TcpListenerStream},
    Stream,
};
use tonic::{Request, Response, Status};

use crate::{MAX_BLOCK_BYTES, MAX_GRPC_BYTES};

pub const MAX_ACTIVE_STREAMS: usize = 4;
pub const MAX_RANGE_BLOCKS: u64 = 10_000;
pub const SHUTDOWN_GRACE_SECONDS: u64 = 2;
const BATCH_CHANNEL_SIZE: usize = 2;

struct BoundedStream {
    receiver: ReceiverStream<Result<BlockBatch, Status>>,
    // Shared with the producer: release only after both disk work and the
    // response stream end, including queued messages a slow client has not read.
    _permit: Arc<OwnedSemaphorePermit>,
}

impl Stream for BoundedStream {
    type Item = Result<BlockBatch, Status>;
    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Pin::new(&mut self.receiver).poll_next(cx)
    }
}

#[derive(Clone)]
pub struct PrepService {
    store: Store,
    info: Arc<DatasetInfo>,
    streams: Arc<Semaphore>,
    shutdown: watch::Receiver<bool>,
}

impl PrepService {
    pub fn new(store: Store, shutdown: watch::Receiver<bool>) -> Result<Self> {
        let manifest = store.manifest();
        let info = DatasetInfo {
            dataset_id: manifest.dataset_id.clone(),
            network: manifest.network.clone(),
            start_height: manifest.start_height,
            end_height: manifest.end_height,
            // Summary only: the full per-block index can exceed message limits.
            manifest_json: serde_json::to_string(&serde_json::json!({
                "schema_version": manifest.schema_version,
                "dataset_id": manifest.dataset_id,
                "network": manifest.network,
                "start_height": manifest.start_height,
                "end_height": manifest.end_height,
                "predecessor_hash": manifest.predecessor_hash,
                "end_hash": manifest.end_hash,
                "block_count": manifest.block_count,
                "segment_bytes": manifest.segment_bytes,
                "segment_sha256": manifest.segment_sha256,
                "kind": "manifest_summary_without_block_index"
            }))?,
        };
        ensure!(
            info.encoded_len() <= MAX_GRPC_BYTES,
            "dataset_info_exceeds_grpc_limit"
        );
        Ok(Self {
            store,
            info: Arc::new(info),
            streams: Arc::new(Semaphore::new(MAX_ACTIVE_STREAMS)),
            shutdown,
        })
    }

    /// Exposed for operational tests; counts currently held producer permits.
    pub fn active_streams(&self) -> usize {
        MAX_ACTIVE_STREAMS - self.streams.available_permits()
    }
}

fn blocking_send(
    sender: &mpsc::Sender<Result<BlockBatch, Status>>,
    item: Result<BlockBatch, Status>,
    shutdown: &mut watch::Receiver<bool>,
    runtime: &tokio::runtime::Handle,
) -> bool {
    if *shutdown.borrow() {
        return false;
    }
    runtime.block_on(async {
        tokio::select! {
            biased;
            _ = shutdown.changed() => false,
            result = sender.send(item) => result.is_ok(),
        }
    })
}

#[tonic::async_trait]
impl Prep for PrepService {
    async fn get_info(&self, _: Request<InfoRequest>) -> Result<Response<DatasetInfo>, Status> {
        if *self.shutdown.borrow() {
            return Err(Status::unavailable("server_shutting_down"));
        }
        Ok(Response::new((*self.info).clone()))
    }

    type GetRangeStream = Pin<Box<dyn Stream<Item = Result<BlockBatch, Status>> + Send>>;

    async fn get_range(
        &self,
        request: Request<RangeRequest>,
    ) -> Result<Response<Self::GetRangeStream>, Status> {
        if *self.shutdown.borrow() {
            return Err(Status::unavailable("server_shutting_down"));
        }
        let request = request.into_inner();
        if request.dataset_id != self.info.dataset_id {
            return Err(Status::failed_precondition("dataset_id_mismatch"));
        }
        if request.start_height > request.end_height
            || request.start_height < self.info.start_height
            || request.end_height > self.info.end_height
        {
            return Err(Status::out_of_range("range_outside_dataset"));
        }
        if request.end_height - request.start_height + 1 > MAX_RANGE_BLOCKS {
            return Err(Status::resource_exhausted("range_block_limit"));
        }
        if request.batch_blocks > 128 {
            return Err(Status::invalid_argument(
                "batch_blocks_must_be_1_to_128_or_default_zero",
            ));
        }
        let batch_blocks = if request.batch_blocks == 0 {
            32
        } else {
            request.batch_blocks as usize
        };
        let permit = Arc::new(
            self.streams
                .clone()
                .try_acquire_owned()
                .map_err(|_| Status::resource_exhausted("active_stream_limit"))?,
        );
        let stream_permit = permit.clone();
        let (sender, receiver) = mpsc::channel(BATCH_CHANNEL_SIZE);
        let store = self.store.clone();
        let mut shutdown = self.shutdown.clone();
        let runtime = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            // The permit spans the producer and all blocking/backpressured sends.
            let _permit = permit;
            let mut reader = match store.read_range(request.start_height, request.end_height) {
                Ok(reader) => reader,
                Err(_) => {
                    blocking_send(
                        &sender,
                        Err(Status::data_loss("dataset_read_failed")),
                        &mut shutdown,
                        &runtime,
                    );
                    return;
                }
            };
            let mut batch = BlockBatch {
                dataset_id: request.dataset_id,
                start_height: request.start_height,
                next_height: request.start_height,
                compact_blocks: Vec::new(),
            };
            let mut bytes = 0usize;
            loop {
                if sender.is_closed() || *shutdown.borrow() {
                    return;
                }
                let Some(record) = reader.next() else { break };
                let record = match record {
                    Ok(record) => record,
                    Err(_) => {
                        blocking_send(
                            &sender,
                            Err(Status::data_loss("dataset_read_failed")),
                            &mut shutdown,
                            &runtime,
                        );
                        return;
                    }
                };
                if !batch.compact_blocks.is_empty()
                    && (batch.compact_blocks.len() >= batch_blocks
                        || bytes + record.payload.len() > MAX_BLOCK_BYTES)
                {
                    let next = batch.next_height;
                    let dataset_id = batch.dataset_id.clone();
                    let outgoing = std::mem::replace(
                        &mut batch,
                        BlockBatch {
                            dataset_id,
                            start_height: next,
                            next_height: next,
                            compact_blocks: Vec::new(),
                        },
                    );
                    if !blocking_send(&sender, Ok(outgoing), &mut shutdown, &runtime) {
                        return;
                    }
                    bytes = 0;
                }
                bytes += record.payload.len();
                let Some(next_height) = record.height.checked_add(1) else {
                    blocking_send(
                        &sender,
                        Err(Status::data_loss("block_height_overflow")),
                        &mut shutdown,
                        &runtime,
                    );
                    return;
                };
                batch.next_height = next_height;
                batch.compact_blocks.push(record.payload);
            }
            if !batch.compact_blocks.is_empty() {
                blocking_send(&sender, Ok(batch), &mut shutdown, &runtime);
            }
        });
        Ok(Response::new(Box::pin(BoundedStream {
            receiver: ReceiverStream::new(receiver),
            _permit: stream_permit,
        })))
    }
}

pub fn validate_listen(address: SocketAddr, allow_network: bool) -> Result<()> {
    ensure!(
        address.ip().is_loopback() || allow_network,
        "nonloopback_listener_requires_allow_network"
    );
    Ok(())
}

pub async fn serve<F>(store: Store, listener: TcpListener, shutdown: F) -> Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let service = PrepService::new(store, shutdown_receiver.clone())?;
    let mut server_shutdown = shutdown_receiver;
    let stop = async move {
        let _ = server_shutdown.changed().await;
    };
    let server = tonic::transport::Server::builder()
        .add_service(
            PrepServer::new(service)
                .max_decoding_message_size(16 * 1024)
                .max_encoding_message_size(MAX_GRPC_BYTES),
        )
        .serve_with_incoming_shutdown(TcpListenerStream::new(listener), stop);
    tokio::pin!(server);
    tokio::pin!(shutdown);
    tokio::select! {
        result = &mut server => { result?; }
        _ = &mut shutdown => {
            let _ = shutdown_sender.send(true);
            // A client can hold an HTTP/2 stream open without reading. Stop
            // producers first, then bound graceful transport draining as well.
            match tokio::time::timeout(Duration::from_secs(SHUTDOWN_GRACE_SECONDS), &mut server).await {
                Ok(result) => result?,
                Err(_) => eprintln!("Prep graceful shutdown deadline reached; closing server"),
            }
        }
    }
    Ok(())
}
