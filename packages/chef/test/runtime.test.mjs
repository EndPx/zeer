import assert from "node:assert/strict";
import test from "node:test";
import { ReorgError } from "@zeer/prep-client";
import { decodePage, syncStep, toZatoshis, validateSyncOptions } from "../dist/runtime.js";

const h = n => BigInt(n).toString(16).padStart(64, "0");
test("public pool union is admitted without accepting other pools or duplicate predicates",()=>{
  for(const pools of [[],["sapling"],["orchard"],["ironwood"],["sapling","orchard","ironwood"]]) assert.doesNotThrow(()=>validateSyncOptions({transactionFilter:{shielded_pools:pools,has_ironwood:true}}));
  for(const pools of [["sprout"],["orchard","orchard"],["sapling","orchard","sapling"],"orchard",[1]]) assert.throws(()=>validateSyncOptions({transactionFilter:{shielded_pools:pools}}),{code:"INVALID_TRANSACTION_FILTER"});
});
const page = () => ({ from_block: 1, next_block: 3, network: "regtest", epoch: "1", data: {
  blocks: [1, 2].map(height => ({ height, hash: h(height), previous_hash: h(height - 1), time: 1000 })),
  transactions: [1, 2].map(block_height => ({ block_height, index: 0, txid: h(100 + block_height), version: 5, locktime: 0, decoded: { amount: "1" } })),
} });

test("runtime validates whole contiguous blocks and per-block transaction ordering", () => {
  assert.deepEqual(decodePage(page(), 1, 3).map(batch => [batch.block.height, batch.transactions.length]), [[1, 1], [2, 1]]);
  const brokenChain = page(); brokenChain.data.blocks[1].previous_hash = h(999);
  assert.throws(() => decodePage(brokenChain, 1, 3), /NONCONTIGUOUS_PREP_CHAIN/);
  const missing = page(); missing.data.transactions.pop();
  assert.throws(() => decodePage(missing, 1, 3), /MISSING_COINBASE_OR_TRANSACTIONS/);
  const badIndex = page(); badIndex.data.transactions[1].index = 1;
  assert.throws(() => decodePage(badIndex, 1, 3), /INVALID_PREP_TRANSACTION_ORDER/);
  const backwards = page(); backwards.data.transactions.reverse();
  assert.throws(() => decodePage(backwards, 1, 3), /INVALID_PREP_TRANSACTION/);
  const missingBlock = page(); missingBlock.data.blocks.pop();
  assert.throws(() => decodePage(missingBlock, 1, 3), /INCOMPLETE_PREP_BLOCKS/);
});

test("ZEC conversion preserves exact decimal/exponent values and rejects floating inputs or rounding", () => {
  for (const [value, expected] of [["1", 100000000n], ["0.00000001", 1n], ["1e-8", 1n], ["1.25e2", 12500000000n], ["-2.5E-7", -25n], ["0.0000000100", 1n], ["9007199254740993", 900719925474099300000000n]]) assert.equal(toZatoshis(value), expected);
  for (const value of [0.1, "NaN", "Infinity", "01", "1e101"]) assert.throws(() => toZatoshis(value), /INVALID_ZEC/);
  for (const value of ["0.000000001", "1e-9", "-0.000000011"]) assert.throws(() => toZatoshis(value), /FRACTIONAL_ZATOSHI/);
});

test("filtered pages retain complete headers but allow empty blocks and nonconsecutive transaction positions", () => {
  const value = page();
  value.data.transactions = [{ ...value.data.transactions[1], index: 7 }];
  delete value.data.transactions[0].decoded;
  const selection = { mode: "metadata", filtered: true };
  const decoded = decodePage(value, 1, 3, selection);
  assert.deepEqual(decoded.map(b => b.transactions.length), [0, 1]);
  assert.equal(decoded[1].transactions[0].index, 7);
  assert.equal(Object.hasOwn(decoded[1].transactions[0], "decoded"), false);
  const duplicate = structuredClone(value); duplicate.data.transactions.push({ ...duplicate.data.transactions[0] });
  assert.throws(() => decodePage(duplicate, 1, 3, selection), /INVALID_PREP_TRANSACTION_ORDER/);
  const gap = structuredClone(value); gap.data.blocks.shift();
  assert.throws(() => decodePage(gap, 1, 3, selection), /INCOMPLETE_PREP_BLOCKS/);
  const fork = structuredClone(value); fork.data.blocks[1].previous_hash = h(999);
  assert.throws(() => decodePage(fork, 1, 3, selection), /NONCONTIGUOUS_PREP_CHAIN/);
  assert.throws(() => decodePage(value, 1, 3, { mode: "decoded", filtered: true }), /INVALID_PREP_TRANSACTION/);
});

test("filtered metadata runtime pushes predicates to Prep and commits empty ranges without transaction handlers", async () => {
  const calls = [], handled = [], groups = [];
  const value = page(); value.data.transactions = [];
  const filter = { has_orchard: true };
  const store = {
    checkpoint: async () => ({ height: null, hash: null, anchorHash: null, status: "ready" }),
    applyBatch: async (blocks, handler) => {
      groups.push(blocks.map(b => b.height));
      for (const block of blocks) await handler(block, {});
    },
  };
  const client = {
    getHeight: async () => ({ network: "regtest", payload_kind: "full-v1", ready: true, archive_height: 2, start_block: 1, epoch: "1" }),
    get: async query => { calls.push(query); return value; },
  };
  const result = await syncStep({ client, store, indexer: { transactionMetadata: args => handled.push(args) },
    network: "regtest", startHeight: 1, reorgWindow: 3, pageSize: 1000, batchSize: 100, transactionFilter: filter });
  assert.equal(result.height, 2); assert.equal(result.blocks, 2); assert.equal(result.transactions, 0);
  assert.deepEqual(groups, [[1, 2]]); assert.deepEqual(handled, []);
  assert.deepEqual(calls[0].transaction_filter, filter);
  assert.equal(calls[0].limit, 1000);
  assert.equal(calls[0].field_selection.transaction.includes("decoded"), false);
  assert.deepEqual(calls[0].field_selection.block, ["height", "hash", "previous_hash", "time"]);
});

test("block-only runtime does not download transactions; complete transactions still require coinbase", async () => {
  const value = page(); value.data.transactions = [];
  const calls = [];
  const result = await syncStep({
    network: "regtest", startHeight: 1, reorgWindow: 3, indexer: { block: ({ block }) => calls.push(block.height) },
    store: { checkpoint: async () => ({ height: null, anchorHash: null, status: "ready" }), apply: async (_block, handler) => handler({}) },
    client: {
      getHeight: async () => ({ network: "regtest", payload_kind: "full-v1", ready: true, archive_height: 2, start_block: 1, epoch: "1" }),
      get: async query => { assert.deepEqual(query.field_selection.transaction, []); return value; },
    },
  });
  assert.equal(result.transactions, 0); assert.deepEqual(calls, [1, 2]);
  assert.throws(() => decodePage(value, 1, 3, { mode: "metadata", filtered: false }), /MISSING_COINBASE/);
});

test("sync configuration rejects unbounded or mistyped filters and batching before reading a source", () => {
  for (const options of [{ batchSize: 0 }, { batchSize: 101 }, { pageSize: 1001 }, { transactionFilter: [] },
    { transactionFilter: { typo: true } }, { transactionFilter: { txids: ["bad"] } },
    { transactionFilter: { has_orchard: "true" } }, { transactionFilter: { versions: [1.5] } },
    { transactionFilter: { versions: Array(129).fill(5) } }]) assert.throws(() => validateSyncOptions(options));
  validateSyncOptions({ pageSize: 1000, batchSize: 100, transactionFilter: { txids: [], versions: null, has_sapling: false } });
  validateSyncOptions({ pageSize: 1_000_000, adaptiveScan: true });
  assert.throws(() => validateSyncOptions({ pageSize: 1_000_001, adaptiveScan: true }), /INVALID_PAGE_SIZE/);
  assert.throws(() => validateSyncOptions({ adaptiveScan: "true" }), /INVALID_SCAN_MODE/);
});

test("runtime does not silently downgrade requested batch atomicity on custom stores", async () => {
  await assert.rejects(syncStep({ client: {}, store: {}, indexer: {}, network: "regtest", startHeight: 0,
    reorgWindow: 100, batchSize: 32 }), error => error.code === "BATCHING_UNSUPPORTED");
});

test("adaptive Chef requests retain full headers and accept a shorter time-bounded page", async () => {
  const seen=[];
  const result=await syncStep({
    network:"regtest",startHeight:0,reorgWindow:100,pageSize:1_000_000,adaptiveScan:true,batchSize:32,
    indexer:{block:({block})=>seen.push(block.height)},
    store:{checkpoint:async()=>({height:null,hash:null,anchorHash:null,status:"ready"}),
      applyBatch:async(blocks,handler)=>{for(const block of blocks)await handler(block,{});}},
    client:{
      getHeight:async()=>({network:"regtest",payload_kind:"full-v1",ready:true,archive_height:999999,start_block:0,epoch:"1"}),
      get:async q=>{
        assert.equal(q.scan_mode,"adaptive");assert.equal(q.limit,1_000_000);
        assert.deepEqual(q.field_selection.block,["height","hash","previous_hash","time"]);
        return {network:"regtest",epoch:"1",from_block:0,next_block:2,data:{
          blocks:[0,1].map(height=>({height,hash:h(height+1),previous_hash:h(height),time:1000})),transactions:[]}};
      },
    },
  });
  assert.deepEqual(seen,[0,1]);assert.equal(result.height,1);assert.equal(result.blocks,2);
});

test("observed source outages, head regressions and header/page epoch races close the durable read gate", async () => {
  const meta = { network: "regtest", payload_kind: "full-v1", ready: true, archive_height: 2, epoch: "1", start_block: 1 };
  for (const scenario of ["unready", "head_regression", "height_error", "header_race", "page_race"]) {
    const checkpoint = { height: scenario === "page_race" ? null : 2, hash: h(2), anchorHash: null, status: "ready" };
    let gated = 0;
    const sourceError = new Error("source unavailable");
    const store = { checkpoint: async () => checkpoint, markReconciling: async () => { gated++; checkpoint.status = "reconciling"; } };
    const client = {
      getHeight: async () => { if (scenario === "height_error") throw sourceError; return { ...meta, ...(scenario === "unready" ? { ready: false } : {}), ...(scenario === "head_regression" ? { archive_height: 0 } : {}) }; },
      get: async () => ({ ...page(), epoch: "2" }),
    };
    const work = syncStep({ store, client, indexer: {}, network: "regtest", startHeight: 1, reorgWindow: 2 });
    if (scenario === "unready" || scenario === "head_regression") assert.equal((await work).state, "source_unavailable");
    else await assert.rejects(work, error => scenario === "height_error" ? error === sourceError : error instanceof ReorgError);
    assert.equal(checkpoint.status, "reconciling", scenario);
    assert.ok(gated >= 1, scenario);
  }
});
