//! Bounded, immutable lightwallet compact-block serving over a Prep archive.
//! Only block retrieval and snapshot metadata are supported; this is not a wallet backend.
use crate::{
    importer::shielded_projection,
    server::{blocking_send, BoundedStream, SHUTDOWN_GRACE_SECONDS},
    MAX_BLOCK_BYTES, MAX_GRPC_BYTES,
};
use anyhow::{ensure, Result};
use prep_proto::zcash::{
    compact_tx_streamer_server::{CompactTxStreamer, CompactTxStreamerServer},
    BlockId, BlockRange, ChainSpec, CompactBlock, Empty, LightdInfo,
};
use prep_store::{Archive, COMPACT_KIND};
use prost::Message;
use std::{
    future::Future,
    io,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::{mpsc, watch, OwnedSemaphorePermit, Semaphore},
};
use tokio_stream::{
    wrappers::{ReceiverStream, TcpListenerStream},
    Stream, StreamExt,
};
use tonic::{
    transport::server::{Connected, TcpConnectInfo},
    Request, Response, Status,
};

pub const MAX_RANGE_BLOCKS: u64 = 100_000;
pub const MAX_CONNECTIONS: usize = 128;
pub const MAX_ACTIVE_READS: usize = 8;
pub const MAX_QUEUED_READS: usize = 128;
const QUEUE_WAIT: Duration = Duration::from_secs(30);
type BlockStream = Pin<Box<dyn Stream<Item = Result<CompactBlock, Status>> + Send>>;

struct CompleteStream {
    inner: BoundedStream<Vec<CompactBlock>>,
    batch: std::vec::IntoIter<CompactBlock>,
    complete: Arc<AtomicBool>,
    terminal: bool,
}
impl Stream for CompleteStream {
    type Item = Result<CompactBlock, Status>;
    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        if self.terminal {
            return Poll::Ready(None);
        }
        if let Some(block) = self.batch.next() {
            return Poll::Ready(Some(Ok(block)));
        }
        match Pin::new(&mut self.inner).poll_next(cx) {
            Poll::Ready(Some(Ok(batch))) => {
                self.batch = batch.into_iter();
                match self.batch.next() {
                    Some(block) => Poll::Ready(Some(Ok(block))),
                    None => {
                        self.terminal = true;
                        Poll::Ready(Some(Err(Status::data_loss("empty_snapshot_batch"))))
                    }
                }
            }
            Poll::Ready(Some(Err(error))) => {
                self.terminal = true;
                Poll::Ready(Some(Err(error)))
            }
            Poll::Ready(None) => {
                self.terminal = true;
                if self.complete.load(Ordering::Acquire) {
                    Poll::Ready(None)
                } else {
                    Poll::Ready(Some(Err(Status::unavailable(
                        "snapshot_stream_interrupted",
                    ))))
                }
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

#[derive(Clone)]
pub struct CompactService {
    archive: Archive,
    reads: Arc<Semaphore>,
    waiting: Arc<Semaphore>,
    shutdown: watch::Receiver<bool>,
}

impl CompactService {
    pub fn new(archive: Archive, shutdown: watch::Receiver<bool>) -> Result<Self> {
        ensure!(
            archive.catalog().payload_kind == COMPACT_KIND,
            "compact_archive_required"
        );
        ensure!(
            archive.head().is_some(),
            "nonempty_compact_archive_required"
        );
        Ok(Self {
            archive,
            reads: Arc::new(Semaphore::new(MAX_ACTIVE_READS)),
            waiting: Arc::new(Semaphore::new(MAX_QUEUED_READS)),
            shutdown,
        })
    }
    pub fn active_reads(&self) -> usize {
        MAX_ACTIVE_READS - self.reads.available_permits()
    }
    pub fn queued_reads(&self) -> usize {
        MAX_QUEUED_READS - self.waiting.available_permits()
    }
    fn available(&self) -> Result<(), Status> {
        if *self.shutdown.borrow() {
            Err(Status::unavailable("snapshot_server_shutting_down"))
        } else {
            Ok(())
        }
    }
    fn bounds(&self, start: u64, end: u64) -> Result<(), Status> {
        if start > end
            || start < self.archive.catalog().start_height
            || Some(end) > self.archive.head()
        {
            return Err(Status::out_of_range("outside_frozen_snapshot"));
        }
        if end - start + 1 > MAX_RANGE_BLOCKS {
            return Err(Status::resource_exhausted("range_block_limit"));
        }
        Ok(())
    }
    async fn admit(&self) -> Result<OwnedSemaphorePermit, Status> {
        self.available()?;
        if let Ok(permit) = self.reads.clone().try_acquire_owned() {
            return Ok(permit);
        }
        let _waiting = self
            .waiting
            .clone()
            .try_acquire_owned()
            .map_err(|_| Status::resource_exhausted("snapshot_queue_full"))?;
        let mut stop = self.shutdown.clone();
        self.available()?;
        tokio::select! {
            biased;
            _=stop.changed()=>Err(Status::unavailable("snapshot_server_shutting_down")),
            permit=tokio::time::timeout(QUEUE_WAIT,self.reads.clone().acquire_owned())=>permit.map_err(|_|Status::resource_exhausted("snapshot_queue_timeout"))?.map_err(|_|Status::unavailable("snapshot_server_shutting_down")),
        }
    }
}

#[tonic::async_trait]
impl CompactTxStreamer for CompactService {
    async fn get_lightd_info(&self, _: Request<Empty>) -> Result<Response<LightdInfo>, Status> {
        self.available()?;
        let network = self.archive.catalog().network.as_str();
        let height = self.archive.head().unwrap();
        Ok(Response::new(LightdInfo {
            version: env!("CARGO_PKG_VERSION").into(),
            vendor: "Zeer Prep immutable compact snapshot".into(),
            chain_name: match network {
                "mainnet" => "main",
                "testnet" => "test",
                other => other,
            }
            .into(),
            block_height: height,
            estimated_height: height,
            sapling_activation_height: match network {
                "mainnet" => 419200,
                "testnet" => 280000,
                _ => 1,
            },
            lightwallet_protocol_version: "v0.5.0 (compact retrieval subset)".into(),
            ..Default::default()
        }))
    }
    async fn get_latest_block(&self, _: Request<ChainSpec>) -> Result<Response<BlockId>, Status> {
        self.available()?;
        let mut hash = hex::decode(self.archive.head_hash().unwrap())
            .map_err(|_| Status::data_loss("invalid_snapshot_hash"))?;
        hash.reverse();
        Ok(Response::new(BlockId {
            height: self.archive.head().unwrap(),
            hash,
        }))
    }
    async fn get_block(&self, request: Request<BlockId>) -> Result<Response<CompactBlock>, Status> {
        let id = request.into_inner();
        self.bounds(id.height, id.height)?;
        if !id.hash.is_empty() {
            return Err(Status::invalid_argument("height_lookup_only"));
        }
        let permit = self.admit().await?;
        let archive = self.archive.clone();
        let block = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let record = archive
                .read_block(id.height)
                .map_err(|_| Status::data_loss("snapshot_read_failed"))?;
            let mut block = CompactBlock::decode(record.payload.as_slice())
                .map_err(|_| Status::data_loss("snapshot_decode_failed"))?;
            shielded_projection(&mut block);
            Ok::<_, Status>(block)
        })
        .await
        .map_err(|_| Status::internal("snapshot_worker_failed"))??;
        Ok(Response::new(block))
    }
    async fn get_block_range(
        &self,
        request: Request<BlockRange>,
    ) -> Result<Response<BlockStream>, Status> {
        let request = request.into_inner();
        if !request.pool_types.is_empty() {
            return Err(Status::unimplemented("pool_selection_not_supported"));
        }
        let start = request
            .start
            .ok_or_else(|| Status::invalid_argument("missing_start"))?;
        let end = request
            .end
            .ok_or_else(|| Status::invalid_argument("missing_end"))?;
        if !start.hash.is_empty() || !end.hash.is_empty() {
            return Err(Status::invalid_argument("height_lookup_only"));
        }
        self.bounds(start.height, end.height)?;
        let permit = Arc::new(self.admit().await?);
        let lease = permit.clone();
        let (sender, receiver) = mpsc::channel(2);
        let complete = Arc::new(AtomicBool::new(false));
        let completed = complete.clone();
        let archive = self.archive.clone();
        let mut shutdown = self.shutdown.clone();
        let runtime = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let result = (|| {
                // Amortize the blocking/async handoff while retaining one
                // CompactBlock per wire message. Both count and bytes are bounded.
                let mut batch = Vec::with_capacity(64);
                let mut bytes = 0usize;
                for lo in (start.height..=end.height).step_by(10000) {
                    let hi = (lo + 9999).min(end.height);
                    let reader = archive
                        .read_range(lo, hi)
                        .map_err(|_| Status::data_loss("snapshot_read_failed"))?;
                    for record in reader {
                        if sender.is_closed() || *shutdown.borrow() {
                            return Ok(());
                        }
                        let record =
                            record.map_err(|_| Status::data_loss("snapshot_read_failed"))?;
                        if !batch.is_empty()
                            && (batch.len() == 64 || bytes + record.payload.len() > MAX_BLOCK_BYTES)
                        {
                            let outgoing = std::mem::replace(&mut batch, Vec::with_capacity(64));
                            if !blocking_send(&sender, Ok(outgoing), &mut shutdown, &runtime) {
                                return Ok(());
                            }
                            bytes = 0;
                        }
                        bytes += record.payload.len();
                        let mut block = CompactBlock::decode(record.payload.as_slice())
                            .map_err(|_| Status::data_loss("snapshot_decode_failed"))?;
                        shielded_projection(&mut block);
                        batch.push(block);
                    }
                }
                if !batch.is_empty() && !blocking_send(&sender, Ok(batch), &mut shutdown, &runtime)
                {
                    return Ok(());
                }
                completed.store(true, Ordering::Release);
                Ok::<_, Status>(())
            })();
            if let Err(error) = result {
                blocking_send(&sender, Err(error), &mut shutdown, &runtime);
            }
        });
        Ok(Response::new(Box::pin(CompleteStream {
            inner: BoundedStream {
                receiver: ReceiverStream::new(receiver),
                _permit: lease,
            },
            complete,
            batch: Vec::new().into_iter(),
            terminal: false,
        })))
    }
}

// Bound outstanding wire responses as well as active readers: at most one
// HTTP/2 stream per accepted connection, and a bounded connection population.
struct LimitedSocket {
    socket: TcpStream,
    _permit: OwnedSemaphorePermit,
}
impl Connected for LimitedSocket {
    type ConnectInfo = TcpConnectInfo;
    fn connect_info(&self) -> Self::ConnectInfo {
        self.socket.connect_info()
    }
}
impl AsyncRead for LimitedSocket {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.socket).poll_read(cx, buf)
    }
}
impl AsyncWrite for LimitedSocket {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.socket).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.socket).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.socket).poll_shutdown(cx)
    }
    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.socket).poll_write_vectored(cx, bufs)
    }
    fn is_write_vectored(&self) -> bool {
        self.socket.is_write_vectored()
    }
}

pub async fn serve<F>(archive: Archive, listener: TcpListener, shutdown: F) -> Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    let (stop, receiver) = watch::channel(false);
    let service = CompactService::new(archive, receiver.clone())?;
    let mut server_stop = receiver;
    let connections = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    let incoming = TcpListenerStream::new(listener).filter_map(move |accepted| match accepted {
        Err(error) => Some(Err(error)),
        Ok(socket) => match connections.clone().try_acquire_owned() {
            Err(_) => None,
            Ok(permit) => Some(socket.set_nodelay(true).map(|()| LimitedSocket {
                socket,
                _permit: permit,
            })),
        },
    });
    let server = tonic::transport::Server::builder()
        .max_concurrent_streams(Some(1))
        .concurrency_limit_per_connection(1)
        .add_service(
            CompactTxStreamerServer::new(service)
                .max_decoding_message_size(4096)
                .max_encoding_message_size(MAX_GRPC_BYTES),
        )
        .serve_with_incoming_shutdown(incoming, async move {
            let _ = server_stop.changed().await;
        });
    tokio::pin!(server);
    tokio::pin!(shutdown);
    tokio::select! {
        result=&mut server=>result?,
        _=&mut shutdown=>{
            let _=stop.send(true);
            match tokio::time::timeout(Duration::from_secs(SHUTDOWN_GRACE_SECONDS),&mut server).await{
                Ok(result)=>result?,Err(_)=>eprintln!("Compact snapshot shutdown deadline reached"),
            }
        }
    }
    Ok(())
}
