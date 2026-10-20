import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { PostgresStore } from "../dist/store.js";
import { parseModel } from "../dist/schema.js";
import { syncStep } from "../dist/runtime.js";
import { createChefServer } from "../dist/graphql.js";

const url = process.env.CHEF_TEST_DATABASE_URL;
const h = n => BigInt(n).toString(16).padStart(64, "0");
const model = parseModel("type Total { id: ID! amount: BigInt! } type Transfer { id: ID! amount: BigInt! height: Int! }");
function source() {
  const state = { epoch: "1", ready: true, fail: false, blocks: [1, 2, 3, 4].map(height => ({ height, hash: h(height), previous_hash: h(height - 1), time: 1000, amount: String(height), txid: h(100 + height) })) };
  const client = {
    async getHeight() { if (state.fail) throw new Error("source offline"); return { network: "regtest", payload_kind: "full-v1", ready: state.ready, archive_height: state.blocks.at(-1)?.height ?? null, epoch: state.epoch, start_block: 1 }; },
    async get(query) {
      if (state.fail) throw new Error("source offline");
      const blocks = state.blocks.filter(b => b.height >= query.from_block && b.height < query.to_block).slice(0, query.limit);
      const next = blocks.at(-1).height + 1;
      return { network: "regtest", epoch: state.epoch, from_block: query.from_block, next_block: next, data: {
        blocks: blocks.map(({ amount, txid, ...block }) => block),
        transactions: query.field_selection.transaction.length ? blocks.map(b => ({ block_height: b.height, index: 0, txid: b.txid, version: 5, locktime: 0, decoded: { amount: b.amount } })) : [],
      } };
    },
  };
  return { state, client };
}
async function fixture(t) {
  const project = `t_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const options = { project, fingerprint: "runtime-v1", model, network: "regtest", startHeight: 1, reorgWindow: 3 };
  const stores = [];
  const open = async () => { const store = new PostgresStore(url, options); stores.push(store); await store.migrate(); await store.acquire(); return store; };
  t.after(async () => {
    for (const store of stores) await store.close();
    const cleanup = new pg.Client({ connectionString: url }); await cleanup.connect();
    try { assert.match(project, /^t_[0-9a-f]{24}$/); await cleanup.query(`DROP SCHEMA IF EXISTS "chef_${project}" CASCADE`); } finally { await cleanup.end(); }
  });
  const prep = source();
  const calls = [];
  let failure = null;
  const indexer = { async transaction({ transaction, context }) {
    calls.push(transaction.txid);
    const amount = BigInt(transaction.decoded.amount);
    const total = await context.entities.get("Total", "all");
    await context.entities.set("Total", { id: "all", amount: (total?.amount ?? 0n) + amount });
    await context.entities.set("Transfer", { id: transaction.txid, amount, height: transaction.blockHeight });
    if (transaction.blockHeight === failure) throw new Error("intentional handler failure");
  } };
  const step = (store, pageSize = 4, options = {}) => syncStep({ client: prep.client, store, indexer, network: "regtest", startHeight: 1, reorgWindow: 3, pageSize, ...options });
  const snapshot = store => store.read(async view => ({ checkpoint: view.checkpoint, total: await view.get("Total", "all"), rows: await view.list("Transfer", { first: 10 }) }));
  return { store: await open(), open, ...prep, calls, step, snapshot, failAt: height => { failure = height; } };
}

test("runtime/PostgreSQL catch-up and process restart never repeat committed handlers", { skip: !url }, async t => {
  const f = await fixture(t);
  const result = await f.step(f.store);
  assert.equal(result.blocks, 4); assert.equal(result.transactions, 4);
  const initial = await f.snapshot(f.store);
  assert.equal(initial.total.amount, "10"); assert.equal(initial.checkpoint.height, 4); assert.equal(initial.rows.length, 4);
  await f.store.release();
  const restarted = await f.open();
  assert.equal((await f.step(restarted)).state, "caught_up");
  assert.equal(f.calls.length, 4);
  assert.deepEqual(await f.snapshot(restarted), initial);
});

test("runtime/PostgreSQL batched failure resumes at the batch boundary and reorg replaces intra-batch state", { skip: !url }, async t => {
  const f = await fixture(t); f.failAt(4);
  await assert.rejects(f.step(f.store, 4, { batchSize: 2 }), /intentional handler failure/);
  assert.equal((await f.snapshot(f.store)).checkpoint.height, 2);
  assert.equal((await f.snapshot(f.store)).total.amount, "3");
  await f.store.release(); const restarted = await f.open(); f.failAt(null);
  assert.equal((await f.step(restarted, 4, { batchSize: 2 })).blocks, 2);
  assert.equal((await f.snapshot(restarted)).total.amount, "10");
  f.state.epoch = "2";
  f.state.blocks.splice(2, 2, { height: 3, hash: h(303), previous_hash: h(2), time: 1001, amount: "30", txid: h(203) },
    { height: 4, hash: h(304), previous_hash: h(303), time: 1001, amount: "40", txid: h(204) });
  await f.step(restarted, 4, { batchSize: 2 });
  const result = await f.snapshot(restarted);
  assert.equal(result.total.amount, "73");
  assert.deepEqual(result.rows.map(row => row.id).sort(), [h(101), h(102), h(203), h(204)].sort());
  assert.equal(result.checkpoint.status, "ready");
});

test("runtime/PostgreSQL cancellation inside a batch rolls back its entities and checkpoint", { skip: !url }, async t => {
  const f = await fixture(t), controller = new AbortController();
  await assert.rejects(f.step(f.store, 4, { batchSize: 4, signal: controller.signal, indexer: {
    async block({ block, context }) {
      await context.entities.set("Total", { id: "all", amount: BigInt(block.height) });
      if (block.height === 2) controller.abort();
    },
  } }), { name: "AbortError" });
  const result = await f.snapshot(f.store);
  assert.equal(result.checkpoint.height, null);
  assert.equal(result.total, null);
  assert.equal(await f.store.blockHash(1), null);
});

test("runtime/PostgreSQL filtered empty blocks and nonzero positions preserve exact entities through a batch reorg", { skip: !url }, async t => {
  const f = await fixture(t);
  let selected = new Set([1, 3]);
  const get = f.client.get;
  f.client.get = async query => {
    const result = await get(query);
    if (query.transaction_filter) {
      assert.deepEqual(query.transaction_filter, { has_orchard: true });
      result.data.transactions = result.data.transactions.filter(tx => selected.has(tx.block_height)).map(({ decoded, ...tx }) => ({ ...tx, index: 7 }));
    }
    return result;
  };
  const indexer = { async transactionMetadata({ transaction, context }) {
    assert.equal(transaction.index, 7);
    assert.equal(Object.hasOwn(transaction, "decoded"), false);
    const total = await context.entities.get("Total", "all");
    await context.entities.set("Total", { id: "all", amount: (total?.amount ?? 0n) + 1n });
    await context.entities.set("Transfer", { id: transaction.txid, amount: 1n, height: transaction.blockHeight });
  } };
  const options = { batchSize: 4, transactionFilter: { has_orchard: true }, indexer };
  const initial = await f.step(f.store, 4, options);
  assert.equal(initial.blocks, 4); assert.equal(initial.transactions, 2);
  assert.deepEqual((await f.snapshot(f.store)).rows.map(r => r.height), [1, 3]);
  selected = new Set([1, 4]); f.state.epoch = "2";
  f.state.blocks.splice(2, 2, { height: 3, hash: h(303), previous_hash: h(2), time: 1001, amount: "30", txid: h(203) },
    { height: 4, hash: h(304), previous_hash: h(303), time: 1001, amount: "40", txid: h(204) });
  await f.step(f.store, 4, options);
  const result = await f.snapshot(f.store);
  assert.equal(result.total.amount, "2");
  assert.deepEqual(result.rows.map(r => r.id), [h(101), h(204)]);
  assert.equal(result.checkpoint.height, 4); assert.equal(result.checkpoint.status, "ready");
});

test("temporary source recovery reopens a verified prefix before full catch-up, including after restart", { skip: !url }, async t => {
  const f = await fixture(t);
  await f.step(f.store, 1);
  f.state.fail = true;
  await assert.rejects(f.step(f.store, 1), /source offline/);
  assert.equal((await f.store.checkpoint()).reconcileKind, "source");
  await assert.rejects(f.snapshot(f.store), /reconciling/);
  await f.store.release();
  const restarted = await f.open();
  assert.equal((await restarted.checkpoint()).reconcileKind, "source");
  f.state.fail = false;
  assert.equal((await f.step(restarted, 1)).height, 2);
  const prefix = await f.snapshot(restarted);
  assert.equal(prefix.checkpoint.status, "ready");
  assert.equal(prefix.checkpoint.height, 2);
  assert.equal(prefix.total.amount, "3");
  assert.deepEqual(prefix.rows.map(row => row.height), [1, 2]);
});

test("runtime/PostgreSQL handler failure commits only its preceding block prefix and restarts at the failed block", { skip: !url }, async t => {
  const f = await fixture(t); f.failAt(3);
  await assert.rejects(f.step(f.store), /intentional handler failure/);
  const prefix = await f.snapshot(f.store);
  assert.equal(prefix.checkpoint.height, 2); assert.equal(prefix.total.amount, "3");
  assert.deepEqual(prefix.rows.map(row => row.height), [1, 2]);
  await f.store.release(); const restarted = await f.open(); f.failAt(null);
  assert.equal((await f.step(restarted)).blocks, 2);
  assert.equal((await f.snapshot(restarted)).total.amount, "10");
  assert.deepEqual(f.calls, [h(101), h(102), h(103), h(103), h(104)]);
});

test("runtime/PostgreSQL reorg undoes old aggregates/rows, gates partial replay and outages, and GraphQL recovers coherently", { skip: !url }, async t => {
  const f = await fixture(t); await f.step(f.store);
  const token = "runtime-test-token-0123456789";
  const server = createChefServer({ store: f.store, model, token });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const query = async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/graphql`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query: '{ _meta { height status } TotalById(id:"all") { amount } TransferList(first:10) { items { id amount height } } }' }) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await query()).body.data.TotalById.amount, "10");
  f.state.epoch = "2";
  f.state.blocks.splice(2, 2, { height: 3, hash: h(303), previous_hash: h(2), time: 1001, amount: "30", txid: h(203) }, { height: 4, hash: h(304), previous_hash: h(303), time: 1001, amount: "40", txid: h(204) });
  assert.equal((await f.step(f.store, 1)).height, 3);
  assert.equal((await f.store.checkpoint()).status, "reconciling");
  assert.equal((await f.store.checkpoint()).reconcileKind, "reorg");
  await assert.rejects(f.snapshot(f.store), /reconciling/);
  assert.equal((await query()).status, 503);
  await f.step(f.store, 1);
  const recovered = await query();
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.body.data._meta, { height: 4, status: "ready" });
  assert.equal(recovered.body.data.TotalById.amount, "73");
  assert.deepEqual(recovered.body.data.TransferList.items.map(row => row.id), [h(101), h(102), h(203), h(204)]);
  assert.deepEqual(recovered.body.data.TransferList.items.map(row => row.amount), ["1", "2", "30", "40"]);
  f.state.fail = true;
  await assert.rejects(f.step(f.store), /source offline/);
  assert.equal((await query()).status, 503);
  f.state.fail = false;
  assert.equal((await f.step(f.store)).state, "caught_up");
  assert.deepEqual(await query(), recovered);
});
