#![cfg(unix)]
use prep::{
    compact_rpc::{self, CompactService, MAX_ACTIVE_READS, MAX_QUEUED_READS},
    importer::shielded_projection,
};
use prep_proto::zcash::{
    compact_tx_streamer_client::CompactTxStreamerClient,
    compact_tx_streamer_server::CompactTxStreamer, BlockId, BlockRange, ChainSpec, CompactBlock,
    CompactSaplingOutput, CompactTx, Empty, TxOut,
};
use prep_store::{Archive, ArchiveWriter, BlockRecord, StoreWriter};
use prost::Message;
use sha2::{Digest, Sha256};
use std::{sync::Arc, time::Duration};
use tempfile::TempDir;
use tokio::{
    net::TcpListener,
    sync::{oneshot, watch},
};
use tokio_stream::StreamExt;
use tonic::{Code, Request};

fn hash(height: u64) -> Vec<u8> {
    Sha256::digest(height.to_le_bytes()).to_vec()
}
fn display(hash: &[u8]) -> String {
    hex::encode(hash.iter().rev().copied().collect::<Vec<_>>())
}
fn block(height: u64, padding: usize) -> CompactBlock {
    CompactBlock {
        height,
        hash: hash(height),
        prev_hash: hash(height - 1),
        time: 123,
        header: vec![42; padding],
        vtx: vec![
            CompactTx {
                index: 0,
                txid: hash(height + 100000),
                vout: vec![TxOut {
                    value: 42,
                    script_pub_key: vec![0x51],
                }],
                ..Default::default()
            },
            CompactTx {
                index: 2,
                txid: hash(height + 200000),
                outputs: vec![CompactSaplingOutput {
                    cmu: vec![1; 32],
                    ephemeral_key: vec![2; 32],
                    ciphertext: vec![3; 52],
                }],
                vout: vec![TxOut {
                    value: 99,
                    script_pub_key: vec![0x51],
                }],
                ..Default::default()
            },
        ],
        ..Default::default()
    }
}
fn fixture(blocks: u64, padding: usize) -> (TempDir, Archive) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("archive");
    let mut archive = ArchiveWriter::create_or_open(&root, "regtest", 1).unwrap();
    for first in (1..=blocks).step_by(6000) {
        let last = (first + 5999).min(blocks);
        let name = format!("segments/s{first}");
        let mut writer = StoreWriter::create(
            root.join(&name),
            "regtest",
            first,
            last,
            &display(&hash(first - 1)),
            &display(&hash(last)),
        )
        .unwrap();
        for height in first..=last {
            let b = block(height, padding);
            writer
                .push(BlockRecord {
                    height,
                    hash: b.hash.clone(),
                    prev_hash: b.prev_hash.clone(),
                    payload: b.encode_to_vec(),
                })
                .unwrap();
        }
        writer.finish().unwrap();
        archive.append_segment(&name).unwrap();
    }
    (dir, archive.snapshot())
}
fn range(start: u64, end: u64) -> Request<BlockRange> {
    Request::new(BlockRange {
        start: Some(BlockId {
            height: start,
            hash: vec![],
        }),
        end: Some(BlockId {
            height: end,
            hash: vec![],
        }),
        pool_types: vec![],
    })
}

#[test]
fn shielded_projection_retains_positions_and_note_bytes() {
    let mut b = block(1, 0);
    let old_hash = b.hash.clone();
    shielded_projection(&mut b);
    assert_eq!(b.hash, old_hash);
    assert_eq!(b.vtx.len(), 1);
    assert_eq!(b.vtx[0].index, 2);
    assert!(b.vtx[0].vout.is_empty());
    assert_eq!(b.vtx[0].outputs[0].ciphertext, vec![3; 52]);
    let once = b.encode_to_vec();
    shielded_projection(&mut b);
    assert_eq!(once, b.encode_to_vec());
}

#[tokio::test]
async fn real_grpc_stream_crosses_segment_and_internal_chunk_boundaries() {
    let (_dir, archive) = fixture(12000, 0);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let (stop, stopped) = oneshot::channel();
    let server = tokio::spawn(compact_rpc::serve(archive, listener, async {
        let _ = stopped.await;
    }));
    let mut client = CompactTxStreamerClient::connect(endpoint).await.unwrap();
    let info = client.get_lightd_info(Empty {}).await.unwrap().into_inner();
    assert_eq!(info.block_height, 12000);
    assert!(!info.taddr_support);
    let tip = client
        .get_latest_block(ChainSpec {})
        .await
        .unwrap()
        .into_inner();
    assert_eq!(tip.hash, hash(12000));
    let mut stream = client
        .get_block_range(range(1, 12000))
        .await
        .unwrap()
        .into_inner();
    let mut height = 1;
    while let Some(b) = stream.message().await.unwrap() {
        assert_eq!(b.height, height);
        assert_eq!(b.hash, hash(height));
        assert_eq!(b.vtx.len(), 1);
        assert_eq!(b.vtx[0].index, 2);
        assert!(b.vtx[0].vin.is_empty() && b.vtx[0].vout.is_empty());
        assert_eq!(b.vtx[0].outputs[0].ciphertext, vec![3; 52]);
        height += 1;
    }
    assert_eq!(height, 12001);
    let b = client
        .get_block(BlockId {
            height: 6001,
            hash: vec![],
        })
        .await
        .unwrap()
        .into_inner();
    assert_eq!(b.height, 6001);
    assert_eq!(b.vtx.len(), 1);
    assert_eq!(
        client
            .get_block_range(range(0, 1))
            .await
            .unwrap_err()
            .code(),
        Code::OutOfRange
    );
    assert_eq!(
        client
            .get_block_range(range(9, 8))
            .await
            .unwrap_err()
            .code(),
        Code::OutOfRange
    );
    assert_eq!(
        client
            .get_block(BlockId {
                height: 1,
                hash: vec![0; 32]
            })
            .await
            .unwrap_err()
            .code(),
        Code::InvalidArgument
    );
    assert_eq!(
        client
            .get_tree_state(BlockId {
                height: 1,
                hash: vec![]
            })
            .await
            .unwrap_err()
            .code(),
        Code::Unimplemented
    );
    stop.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(4), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}

async fn wait_until(mut predicate: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while !predicate() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn queue_is_bounded_and_cancellation_and_shutdown_release_leases() {
    let (_dir, archive) = fixture(500, 4096);
    let (stop, stopped) = watch::channel(false);
    let service = Arc::new(CompactService::new(archive, stopped).unwrap());
    let mut held = vec![];
    for _ in 0..MAX_ACTIVE_READS {
        held.push(
            service
                .get_block_range(range(1, 500))
                .await
                .unwrap()
                .into_inner(),
        );
    }
    assert_eq!(service.active_reads(), MAX_ACTIVE_READS);
    let mut waiting = vec![];
    for _ in 0..MAX_QUEUED_READS {
        let s = service.clone();
        waiting.push(tokio::spawn(async move {
            s.get_block_range(range(1, 500)).await
        }));
    }
    wait_until(|| service.queued_reads() == MAX_QUEUED_READS).await;
    assert!(
        matches!(service.get_block_range(range(1,12)).await,Err(e) if e.code()==Code::ResourceExhausted)
    );
    for task in waiting {
        task.abort();
        assert!(matches!(task.await, Err(error) if error.is_cancelled()));
    }
    wait_until(|| service.queued_reads() == 0).await;
    let s = service.clone();
    let waiting = tokio::spawn(async move { s.get_block_range(range(1, 500)).await });
    wait_until(|| service.queued_reads() == 1).await;
    stop.send(true).unwrap();
    assert!(matches!(waiting.await.unwrap(),Err(e) if e.code()==Code::Unavailable));
    let mut interrupted = false;
    while let Some(item) = held[0].next().await {
        if let Err(status) = item {
            assert_eq!(status.code(), Code::Unavailable);
            interrupted = true;
            break;
        }
    }
    assert!(
        interrupted,
        "shutdown must not turn a partial range into successful EOF"
    );
    held.clear();
    wait_until(|| service.active_reads() == 0 && service.queued_reads() == 0).await;
}
