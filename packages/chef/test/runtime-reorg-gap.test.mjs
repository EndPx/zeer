import assert from "node:assert/strict";
import test from "node:test";
import { syncStep } from "../dist/runtime.js";

const h = value => BigInt(value).toString(16).padStart(64, "0");

// Prep publishes its verified prefix before replacement segments are downloaded.
// Chef retains heights 11..14, so a published prefix ending at 10 cannot yet
// establish whether the common ancestor is inside its three-block undo window.
function fixture({ archiveHeight = 10, sourceHeight = 15, sourceMode = "follower", ancestorHeight = 11 } = {}) {
  const checkpoint = { height: 14, hash: h(14), anchorHash: h(0), status: "ready" };
  const retained = new Map([11, 12, 13, 14].map(height => [height, h(height)]));
  const state = { archiveHeight, sourceHeight, sourceMode };
  const reads = [], rollbacks = [], applied = [];
  let blocked = 0;
  const canonicalHash = height => h(height <= ancestorHeight ? height : 100 + height);
  const store = {
    checkpoint: async () => ({ ...checkpoint }),
    markReconciling: async () => { checkpoint.status = "reconciling"; },
    markReady: async () => { checkpoint.status = "ready"; },
    markBlocked: async () => { blocked++; checkpoint.status = "blocked"; },
    blockHash: async height => retained.get(height) ?? null,
    rollback: async (height, hash) => {
      rollbacks.push(height);
      for (const retainedHeight of retained.keys()) if (retainedHeight > height) retained.delete(retainedHeight);
      Object.assign(checkpoint, { height, hash, status: "reconciling" });
    },
    apply: async (block, handler) => {
      assert.equal(block.height, checkpoint.height + 1);
      assert.equal(block.previousHash, checkpoint.hash);
      await handler({});
      applied.push(block.height);
      retained.set(block.height, block.hash);
      Object.assign(checkpoint, { height: block.height, hash: block.hash });
    },
  };
  const client = {
    getHeight: async () => ({ network: "regtest", payload_kind: "full-v1", ready: true,
      archive_height: state.archiveHeight, indexed_height: state.archiveHeight,
      source_height: state.sourceHeight, lag_blocks: state.sourceHeight == null ? null : Math.max(0, state.sourceHeight - state.archiveHeight),
      source_mode: state.sourceMode, source_observed_at: 1000, start_block: 1, epoch: "2", revision: "11" }),
    get: async query => {
      reads.push(query.from_block);
      assert.ok(query.to_block <= state.archiveHeight + 1, "runtime must only request the published prefix");
      const count = Math.min(query.to_block - query.from_block, query.limit);
      const heights = Array.from({ length: count }, (_, index) => query.from_block + index);
      return { network: "regtest", epoch: "2", from_block: query.from_block, next_block: query.from_block + count,
        data: {
          blocks: heights.map(height => ({ height, hash: canonicalHash(height), previous_hash: canonicalHash(height - 1), time: 1000 })),
          transactions: query.field_selection.transaction.length ? heights.map(height => ({ block_height: height, index: 0,
            txid: h(1000 + height), version: 5, locktime: 0, decoded: {} })) : [],
        } };
    },
  };
  const step = () => syncStep({ client, store, indexer: {}, network: "regtest", startHeight: 1, reorgWindow: 3 });
  return { state, checkpoint, retained, reads, rollbacks, applied, step, blocked: () => blocked };
}

test("runtime waits for Prep replacement history below the undo floor and recovers at the exact window boundary", async () => {
  const f = fixture();
  const original = [...f.retained];
  assert.equal((await f.step()).state, "source_unavailable");
  assert.equal(f.checkpoint.height, 14);
  assert.equal(f.checkpoint.status, "reconciling");
  assert.equal(f.blocked(), 0);
  assert.deepEqual([...f.retained], original);
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.rollbacks, []);
  assert.deepEqual(f.applied, []);

  f.state.archiveHeight = 13;
  assert.equal((await f.step()).height, 13);
  assert.deepEqual(f.rollbacks, [11]);
  assert.deepEqual(f.applied, [12, 13]);
  f.state.archiveHeight = 15;
  assert.equal((await f.step()).height, 15);
  assert.equal(f.checkpoint.hash, h(115));
  assert.equal(f.checkpoint.status, "ready");
  assert.deepEqual(f.applied, [12, 13, 14, 15]);
  assert.equal(f.blocked(), 0);
});

test("runtime still blocks a proven deep reorg once Prep exposes the retained floor", async () => {
  for (const archiveHeight of [11, 15]) {
    const f = fixture({ archiveHeight, sourceHeight: 16, ancestorHeight: 10 });
    await assert.rejects(f.step(), /REBUILD_REQUIRED/);
    assert.equal(f.checkpoint.status, "blocked");
    assert.equal(f.blocked(), 1);
    assert.ok(f.reads.includes(11), "the retained floor must be compared before declaring a deep reorg");
    assert.deepEqual(f.rollbacks, []);
    assert.deepEqual(f.applied, []);
  }
});

test("runtime waits when the observed source tip is exactly the retained floor", async () => {
  const f = fixture({ sourceHeight: 11 });
  assert.equal((await f.step()).state, "source_unavailable");
  assert.equal(f.checkpoint.status, "reconciling");
  assert.equal(f.checkpoint.height, 14);
  assert.equal(f.blocked(), 0);
  assert.deepEqual(f.rollbacks, []);
  assert.deepEqual(f.applied, []);
});

test("runtime does not defer permanently shorter chains or historical snapshots with unknown source height", async () => {
  for (const options of [
    { sourceHeight: 10 },
    { archiveHeight: 9, sourceHeight: 10 },
    { sourceHeight: null },
    { sourceHeight: undefined },
    { sourceHeight: null, sourceMode: "historical_snapshot" },
    { sourceHeight: undefined, sourceMode: "historical_snapshot" },
    { sourceHeight: 15, sourceMode: "historical_snapshot" },
  ]) {
    const f = fixture(options);
    // Preserve undefined exactly: destructuring defaults otherwise supply 15.
    f.state.sourceHeight = options.sourceHeight;
    await assert.rejects(f.step(), /REBUILD_REQUIRED/);
    assert.equal(f.checkpoint.status, "blocked");
    assert.equal(f.blocked(), 1);
    assert.deepEqual(f.rollbacks, []);
    assert.deepEqual(f.applied, []);
  }
});
