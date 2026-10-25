import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { syncStep } from "../dist/runtime.js";
import { createProgressTracker, startProgressHeartbeat } from "../dist/progress.js";

const hash = n => n.toString(16).padStart(64, "0");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const meta = { network: "testnet", payload_kind: "full-v1", ready: true, archive_height: 2, indexed_height: 2,
  source_mode: "follower", source_height: 3, source_observed_at: 1792886400, start_block: 1, epoch: "1" };
const block = height => ({ height, hash: hash(height), previous_hash: hash(height - 1), time: 1 });
function source() {
  let reads = 0;
  return { get reads() { return reads; },
    async getHeight() { reads++; return meta; },
    async get(q) {
      reads++;
      const heights = Array.from({ length: q.to_block - q.from_block }, (_, i) => i + q.from_block);
      return { from_block: q.from_block, next_block: q.to_block, network: "testnet", epoch: "1", data: {
        blocks: heights.map(block), transactions: q.field_selection.transaction.length ? heights.map(height => ({
          block_height: height, index: 0, txid: hash(height + 100), version: 5, locktime: 0, raw: "abcd",
        })) : [],
      } };
    },
  };
}
async function heartbeatWhen(beats, phase) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const result = beats.find(item => item.phase === phase);
    if (result) return result;
    await delay(2);
  }
  assert.fail(`No heartbeat during ${phase}`);
}

test("heartbeat observes stalled scan, handler and commit without extra reads or premature checkpoint advancement", async t => {
  const scanning = deferred(), handling = deferred(), committing = deferred();
  const client = source(), tracker = createProgressTracker(null), beats = [];
  let checkpointReads = 0, committed = null, scans = 0;
  const stop = startProgressHeartbeat(() => beats.push(tracker.snapshot()), 5);
  t.after(() => { stop(); scanning.resolve(); handling.resolve(); committing.resolve(); });
  const run = syncStep({
    client, network: "testnet", startHeight: 1, reorgWindow: 3, batchSize: 2, onProgress: tracker.update,
    receiptSource: { identity: hash(20), keyFingerprint: hash(21), accountId: "sensitive_account_never_emitted",
      async scan() { scans++; await scanning.promise; return []; } },
    indexer: { receipt() {}, async block() { await handling.promise; } },
    store: { async checkpoint() { checkpointReads++; return { height: committed, hash: null, anchorHash: null, status: "ready" }; },
      async applyBatch(blocks, handler) { for (const item of blocks) await handler(item, {}); await committing.promise; committed = blocks.at(-1).height; } },
  }, 2);
  const scanBeat = await heartbeatWhen(beats, "scanning");
  assert.equal(scanBeat.committedHeight, null); assert.deepEqual(scanBeat.processingRange, { from: 1, to: 2 });
  const readsAtScan = client.reads, dbReadsAtScan = checkpointReads, progressAtScan = tracker.snapshot().lastProgressAt;
  await delay(20);
  assert.equal(client.reads, readsAtScan); assert.equal(checkpointReads, dbReadsAtScan);
  assert.equal(tracker.snapshot().lastProgressAt, progressAtScan);
  scanning.resolve();
  const handlerBeat = await heartbeatWhen(beats, "handlers");
  assert.equal(handlerBeat.committedHeight, null);
  handling.resolve();
  const commitBeat = await heartbeatWhen(beats, "committing");
  assert.equal(commitBeat.committedHeight, null); assert.equal(committed, null);
  committing.resolve();
  const result = await run;
  assert.equal(result.blocks, 2); assert.equal(scans, 2); assert.equal(committed, 2);
  assert.equal(tracker.snapshot().committedHeight, 2); assert.equal(tracker.snapshot().processingRange, null);
  stop(); const count = beats.length; await delay(20); assert.equal(beats.length, count);
  assert.equal(JSON.stringify(beats).includes("sensitive_account"), false);
  assert.equal(JSON.stringify(beats).includes(hash(101)), false);
});

test("progress timestamps separate liveness from completed work and range snapshots are detached", () => {
  let clock = 0;
  const tracker = createProgressTracker(10, () => String(clock++));
  tracker.update({ phase: "scanning", processingRange: { from: 11, to: 12 } });
  const first = tracker.snapshot(), second = tracker.snapshot();
  assert.equal(first.lastProgressAt, null); assert.equal(second.lastProgressAt, null);
  assert.notEqual(first.heartbeatAt, second.heartbeatAt); assert.equal(first.phaseSince, second.phaseSince);
  first.processingRange.from = 999;
  assert.deepEqual(tracker.snapshot().processingRange, { from: 11, to: 12 });
  tracker.update({ phase: "scanning", progressed: true });
  const progressed = tracker.snapshot(); assert.notEqual(progressed.lastProgressAt, null);
  tracker.update({ phase: "source_wait" });
  assert.equal(tracker.snapshot().lastProgressAt, progressed.lastProgressAt);
  assert.equal(tracker.snapshot().committedHeight, 10);
});

test("an interrupted page reports only acknowledged batches and observer failures do not affect commits", async () => {
  const events = [], client = source(); let height = null;
  await assert.rejects(syncStep({ client, network: "testnet", startHeight: 1, reorgWindow: 3,
    onProgress(event) { events.push(event); throw new Error("observer output broken"); },
    store: { checkpoint: async () => ({ height, hash: null, anchorHash: null, status: "ready" }),
      async apply(item, handler) { await handler({}); height = item.height; } },
    indexer: { block({ block }) { if (block.height === 2) throw new Error("handler failed"); } },
  }, 2), /handler failed/);
  assert.equal(height, 1);
  assert.deepEqual(events.filter(item => item.committedHeight !== undefined).map(item => item.committedHeight), [null, 1]);
  assert.deepEqual(events.at(-1).phase, "handlers");
  const result = await syncStep({ client: source(), network: "testnet", startHeight: 1, reorgWindow: 3,
    onProgress: async () => { throw new Error("accidental async observer"); },
    store: { checkpoint: async () => ({ height: null, anchorHash: null, status: "ready" }), apply: async (_block, handler) => handler({}) },
    indexer: { block() {} },
  }, 2);
  assert.equal(result.height, 2); await delay(0);
});

test("heartbeat output failure is isolated and stopping clears future ticks", async () => {
  let calls = 0;
  const stop = startProgressHeartbeat(() => { calls++; throw new Error("closed output"); }, 5);
  await delay(20); assert.ok(calls > 0); stop();
  const stopped = calls; await delay(15); assert.equal(calls, stopped);
});

test("heartbeat skips backpressured output rather than queueing diagnostics", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let writable = false, calls = 0;
  const stop = startProgressHeartbeat(() => calls++, 5000, () => writable);
  t.after(stop);
  t.mock.timers.tick(60000); assert.equal(calls, 0);
  writable = true; t.mock.timers.tick(5000); assert.equal(calls, 1);
  stop(); t.mock.timers.tick(5000); assert.equal(calls, 1);
});

test("heartbeat source observations require ready follower metadata with a valid observation timestamp", async () => {
  for (const changes of [{ ready: false }, { source_mode: "historical_snapshot" }, { source_observed_at: null }, { source_observed_at: "wrong" }]) {
    const client = source(), tracker = createProgressTracker(null);
    client.getHeight = async () => ({ ...meta, ...changes });
    await syncStep({ client, network: "testnet", startHeight: 1, reorgWindow: 3, onProgress: tracker.update,
      store: { checkpoint: async () => ({ height: null, anchorHash: null, status: "ready" }), markReconciling: async () => {}, apply: async (_item, handler) => handler({}) },
      indexer: { block() {} },
    }, 2);
    assert.equal(tracker.snapshot().sourceObservedHeight, null); assert.equal(tracker.snapshot().sourceObservedAt, null);
    assert.equal(tracker.snapshot().prepReady, changes.ready ?? true);
  }
});
