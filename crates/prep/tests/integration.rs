#![cfg(unix)]

use std::{
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use prep::{
    importer::{import, validate_source_url, ImportOptions},
    server::{serve, validate_listen, PrepService},
};
use prep_proto::{
    prep::{prep_client::PrepClient, prep_server::Prep, InfoRequest, RangeRequest},
    zcash::{
        self,
        compact_tx_streamer_server::{CompactTxStreamer, CompactTxStreamerServer},
        BlockId, BlockRange, CompactBlock, CompactOrchardAction, CompactSaplingOutput,
        CompactSaplingSpend, CompactTx, Empty, LightdInfo,
    },
};
use prep_store::{BlockRecord, Store, StoreWriter};
use prost::Message;
use tempfile::TempDir;
use tokio::{
    net::TcpListener,
    sync::{oneshot, watch},
};
use tokio_stream::{wrappers::TcpListenerStream, Stream, StreamExt};
use tonic::{Request, Response, Status};

fn block(height: u64) -> CompactBlock {
    CompactBlock {
        height,
        hash: vec![height as u8; 32],
        prev_hash: vec![height.saturating_sub(1) as u8; 32],
        time: 1_700_000_000 + height as u32,
        chain_metadata: Some(zcash::ChainMetadata {
            sapling_commitment_tree_size: height as u32,
            orchard_commitment_tree_size: height as u32,
            ironwood_commitment_tree_size: 0,
        }),
        vtx: vec![CompactTx {
            index: 1,
            txid: vec![height as u8; 32],
            fee: 17,
            spends: vec![CompactSaplingSpend { nf: vec![7; 32] }],
            outputs: vec![CompactSaplingOutput {
                cmu: vec![8; 32],
                ephemeral_key: vec![9; 32],
                ciphertext: vec![10; 52],
            }],
            actions: vec![CompactOrchardAction {
                nullifier: vec![11; 32],
                cmx: vec![12; 32],
                ephemeral_key: vec![13; 32],
                ciphertext: vec![14; 52],
            }],
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn hash(height: u64) -> String {
    hex::encode(vec![height as u8; 32])
}

fn make_store(count: u64, payload_size: usize) -> (TempDir, Store, Vec<Vec<u8>>) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("dataset");
    let mut writer =
        StoreWriter::create(&path, "regtest", 1, count, &hash(0), &hash(count)).unwrap();
    let mut records = Vec::new();
    for height in 1..=count {
        let mut block = block(height);
        // Artificial header padding tests wire-size limits, not consensus validity.
        block.header = vec![42; payload_size];
        let payload = block.encode_to_vec();
        writer
            .push(BlockRecord {
                height,
                hash: block.hash,
                prev_hash: block.prev_hash,
                payload: payload.clone(),
            })
            .unwrap();
        records.push(payload);
    }
    writer.finish().unwrap();
    let store = Store::open(path).unwrap();
    (dir, store, records)
}

fn request(id: &str, start: u64, end: u64, batch: u32) -> Request<RangeRequest> {
    Request::new(RangeRequest {
        dataset_id: id.into(),
        start_height: start,
        end_height: end,
        batch_blocks: batch,
    })
}

async fn collect(
    client: &mut PrepClient<tonic::transport::Channel>,
    id: &str,
    start: u64,
    end: u64,
    batch: u32,
) -> Vec<Vec<u8>> {
    let mut stream = client
        .get_range(request(id, start, end, batch))
        .await
        .unwrap()
        .into_inner();
    let mut next = start;
    let mut payloads = Vec::new();
    while let Some(batch) = stream.message().await.unwrap() {
        assert_eq!(batch.dataset_id, id);
        assert_eq!(batch.start_height, next);
        assert_eq!(batch.next_height, next + batch.compact_blocks.len() as u64);
        assert!(batch.compact_blocks.iter().map(Vec::len).sum::<usize>() <= prep::MAX_BLOCK_BYTES);
        next = batch.next_height;
        payloads.extend(batch.compact_blocks);
    }
    assert_eq!(next, end + 1);
    payloads
}

#[tokio::test]
async fn actual_grpc_two_clients_subranges_and_full_shielded_payloads() {
    let (_dir, store, payloads) = make_store(40, 0);
    let id = store.manifest().dataset_id.clone();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let (stop, stopped) = oneshot::channel();
    let task = tokio::spawn(serve(store, listener, async {
        let _ = stopped.await;
    }));
    let mut first = PrepClient::connect(endpoint.clone()).await.unwrap();
    let mut second = PrepClient::connect(endpoint).await.unwrap();
    let info = first.get_info(InfoRequest {}).await.unwrap().into_inner();
    let summary: serde_json::Value = serde_json::from_str(&info.manifest_json).unwrap();
    assert_eq!(summary["block_count"], 40);
    assert!(summary.get("blocks").is_none());
    let (a, b) = tokio::join!(
        collect(&mut first, &id, 1, 40, 0),
        collect(&mut second, &id, 11, 21, 3)
    );
    assert_eq!(a, payloads);
    assert_eq!(b, payloads[10..21]);
    let decoded = CompactBlock::decode(a[0].as_slice()).unwrap();
    assert_eq!(decoded.vtx[0].outputs[0].ciphertext, vec![10; 52]);
    assert_eq!(decoded.vtx[0].actions[0].ciphertext, vec![14; 52]);
    assert_eq!(decoded.vtx[0].spends[0].nf, vec![7; 32]);
    assert_eq!(
        first
            .get_range(request("wrong", 1, 1, 1))
            .await
            .unwrap_err()
            .code(),
        tonic::Code::FailedPrecondition
    );
    assert_eq!(
        first
            .get_range(request(&id, 0, 1, 1))
            .await
            .unwrap_err()
            .code(),
        tonic::Code::OutOfRange
    );
    assert_eq!(
        first
            .get_range(request(&id, 2, 1, 1))
            .await
            .unwrap_err()
            .code(),
        tonic::Code::OutOfRange
    );
    assert_eq!(
        first
            .get_range(request(&id, 1, 1, 129))
            .await
            .unwrap_err()
            .code(),
        tonic::Code::InvalidArgument
    );
    stop.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(3), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn byte_bounded_batch_splits_large_blocks() {
    let (_dir, store, payloads) = make_store(3, 3 * 1024 * 1024);
    let id = store.manifest().dataset_id.clone();
    let (_stop, shutdown) = watch::channel(false);
    let service = PrepService::new(store, shutdown).unwrap();
    let mut stream = service
        .get_range(request(&id, 1, 3, 128))
        .await
        .unwrap()
        .into_inner();
    for expected in payloads {
        let batch = stream.next().await.unwrap().unwrap();
        assert_eq!(batch.compact_blocks, vec![expected]);
    }
    assert!(stream.next().await.is_none());
}

#[tokio::test]
async fn native_server_shutdown_is_bounded_with_unread_large_response() {
    let (_dir, store, _) = make_store(3, 3 * 1024 * 1024);
    let id = store.manifest().dataset_id.clone();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let (stop, stopped) = oneshot::channel();
    let task = tokio::spawn(serve(store, listener, async {
        let _ = stopped.await;
    }));
    let mut client = PrepClient::connect(endpoint).await.unwrap();
    let _unread_response = client
        .get_range(request(&id, 1, 3, 1))
        .await
        .unwrap()
        .into_inner();
    stop.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn short_unread_responses_keep_permits_until_stream_drop() {
    let (_dir, store, _) = make_store(1, 0);
    let id = store.manifest().dataset_id.clone();
    let (_stop, shutdown) = watch::channel(false);
    let service = PrepService::new(store, shutdown).unwrap();
    let mut streams = Vec::new();
    for _ in 0..4 {
        streams.push(
            service
                .get_range(request(&id, 1, 1, 1))
                .await
                .unwrap()
                .into_inner(),
        );
    }
    // Even after each one-block producer has finished, unread response streams
    // must still occupy their permits (the previous producer-only design did not).
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(service.active_streams(), 4);
    match service.get_range(request(&id, 1, 1, 1)).await {
        Err(status) => assert_eq!(status.code(), tonic::Code::ResourceExhausted),
        Ok(_) => panic!("fifth unread stream admitted"),
    }
    streams.clear();
    tokio::time::timeout(Duration::from_secs(2), async {
        while service.active_streams() != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let mut retry = service
        .get_range(request(&id, 1, 1, 1))
        .await
        .unwrap()
        .into_inner();
    assert!(retry.next().await.unwrap().is_ok());
}

#[tokio::test]
async fn cancellation_and_shutdown_release_backpressured_producers() {
    let (_dir, store, _) = make_store(40, 0);
    let id = store.manifest().dataset_id.clone();
    let (stop, shutdown) = watch::channel(false);
    let service = PrepService::new(store, shutdown).unwrap();
    let stream = service
        .get_range(request(&id, 1, 40, 1))
        .await
        .unwrap()
        .into_inner();
    tokio::time::sleep(Duration::from_millis(25)).await;
    drop(stream);
    tokio::time::timeout(Duration::from_secs(2), async {
        while service.active_streams() != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let mut stream = service
        .get_range(request(&id, 1, 40, 1))
        .await
        .unwrap()
        .into_inner();
    stop.send(true).unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        while stream.next().await.is_some() {}
    })
    .await
    .unwrap();
    drop(stream);
    assert!(service
        .get_info(Request::new(InfoRequest {}))
        .await
        .is_err());
}

#[derive(Clone, Copy)]
enum Fault {
    None,
    Gap,
    Truncated,
    ChangedEnd,
    WrongNetwork,
    BrokenParent,
    Extra,
    Oversized,
    Stall,
}

#[derive(Clone)]
struct Upstream {
    fault: Fault,
    end_reads: Arc<AtomicUsize>,
}

#[tonic::async_trait]
impl CompactTxStreamer for Upstream {
    async fn get_lightd_info(&self, _: Request<Empty>) -> Result<Response<LightdInfo>, Status> {
        Ok(Response::new(LightdInfo {
            chain_name: if matches!(self.fault, Fault::WrongNetwork) {
                "main"
            } else {
                "regtest"
            }
            .into(),
            version: "fixture".into(),
            block_height: 4,
            ..Default::default()
        }))
    }

    async fn get_block(&self, request: Request<BlockId>) -> Result<Response<CompactBlock>, Status> {
        let height = request.into_inner().height;
        let mut block = block(height);
        if height == 4
            && self.end_reads.fetch_add(1, Ordering::SeqCst) > 0
            && matches!(self.fault, Fault::ChangedEnd)
        {
            block.hash = vec![99; 32];
        }
        Ok(Response::new(block))
    }

    async fn get_block_range(
        &self,
        _: Request<BlockRange>,
    ) -> Result<Response<Pin<Box<dyn Stream<Item = Result<CompactBlock, Status>> + Send>>>, Status>
    {
        if matches!(self.fault, Fault::Stall) {
            return Ok(Response::new(Box::pin(tokio_stream::pending())));
        }
        let mut blocks = (1..=4).map(block).collect::<Vec<_>>();
        match self.fault {
            Fault::Gap => {
                blocks.remove(1);
            }
            Fault::Truncated => {
                blocks.pop();
            }
            Fault::BrokenParent => {
                blocks[2].prev_hash = vec![99; 32];
            }
            Fault::Extra => {
                blocks.push(block(5));
            }
            Fault::Oversized => {
                blocks[1].header = vec![42; prep::MAX_BLOCK_BYTES];
            }
            _ => {}
        }
        Ok(Response::new(Box::pin(tokio_stream::iter(
            blocks.into_iter().map(Ok),
        ))))
    }
}

async fn import_fixture(fault: Fault) -> (TempDir, anyhow::Result<prep_store::Manifest>) {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let source = format!("http://{}", listener.local_addr().unwrap());
    let upstream = Upstream {
        fault,
        end_reads: Arc::new(AtomicUsize::new(0)),
    };
    let (stop, stopped) = oneshot::channel();
    let task = tokio::spawn(
        tonic::transport::Server::builder()
            .add_service(CompactTxStreamerServer::new(upstream))
            .serve_with_incoming_shutdown(TcpListenerStream::new(listener), async {
                let _ = stopped.await;
            }),
    );
    let result = import(ImportOptions {
        source,
        network: "regtest".into(),
        start: 1,
        end: 4,
        out: dir.path().join("dataset"),
        expected_end_hash: hash(4),
        allow_insecure: false,
        deadline_seconds: if matches!(fault, Fault::Stall) { 1 } else { 10 },
        shielded_only: false,
    })
    .await;
    stop.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    (dir, result)
}

#[tokio::test]
async fn importer_grpc_preserves_payload_and_publishes_only_after_anchor_checks() {
    let (dir, result) = import_fixture(Fault::None).await;
    assert_eq!(result.unwrap().block_count, 4);
    let store = Store::open(dir.path().join("dataset")).unwrap();
    for height in 1..=4 {
        assert_eq!(
            store.read_block(height).unwrap().payload,
            block(height).encode_to_vec()
        );
    }
    let source: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path().join("dataset/source.json")).unwrap())
            .unwrap();
    assert_eq!(source["anchors_checked_before_and_after"], true);
    for fault in [
        Fault::Gap,
        Fault::Truncated,
        Fault::ChangedEnd,
        Fault::WrongNetwork,
        Fault::BrokenParent,
        Fault::Extra,
        Fault::Oversized,
        Fault::Stall,
    ] {
        let (dir, result) = import_fixture(fault).await;
        assert!(result.is_err());
        assert!(!dir.path().join("dataset/manifest.json").exists());
        assert!(Store::open(dir.path().join("dataset")).is_err());
    }
}

#[test]
fn url_and_listener_policies_reject_credentials_and_implicit_exposure() {
    for url in [
        "https://user:secret@example.com",
        "https://example.com/?secret=1",
        "https://example.com/#secret",
        "https://example.com/path",
        "ftp://localhost",
        "http://8.8.8.8",
    ] {
        assert!(validate_source_url(url, true).is_err());
    }
    assert!(validate_source_url("http://zaino:8137", false).is_err());
    assert!(validate_source_url("http://zaino:8137", true).is_ok());
    assert!(validate_source_url("http://127.0.0.1:8137", false).is_ok());
    assert!(validate_source_url("http://[::1]:8137", false).is_ok());
    assert!(validate_source_url("https://zec.rocks:443", false).is_ok());
    assert!(validate_listen("0.0.0.0:39367".parse().unwrap(), false).is_err());
    assert!(validate_listen("127.0.0.1:39367".parse().unwrap(), false).is_ok());
    assert!(validate_listen("0.0.0.0:39367".parse().unwrap(), true).is_ok());
}
