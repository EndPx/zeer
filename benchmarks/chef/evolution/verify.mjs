// PostgreSQL evolution acceptance; synthetic public source, no routing mutation.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresStore } from '../../../packages/chef/dist/store.js';
import { parseModel } from '../../../packages/chef/dist/schema.js';
import { syncStep } from '../../../packages/chef/dist/runtime.js';
import { createChefServer } from '../../../packages/chef/dist/graphql.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
assert.equal(process.argv.length, 4, 'Use --output benchmarks/results/<new-run>');
assert.equal(process.argv[2], '--output');
const output = resolve(root, process.argv[3]);
const within = relative(resolve(root, 'benchmarks/results'), output);
assert.ok(within && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within), 'Evidence must be below benchmarks/results');
const url = process.env.CHEF_TEST_DATABASE_URL;
assert.ok(url, 'CHEF_TEST_DATABASE_URL must select a disposable PostgreSQL database; no skipped acceptance');
await mkdir(resolve(root, 'benchmarks/results'), { recursive: true });
await mkdir(output, { recursive: false });
const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
const projects = [`ev_${suffix}_v1`, `ev_${suffix}_v2`];
const h = n => BigInt(n).toString(16).padStart(64, '0');
const source = { epoch: '1', ready: true, network: 'regtest',
  blocks: [1, 2, 3, 4].map(height => ({ height, hash: h(height), previous_hash: h(height - 1), time: 1000,
    txid: h(100 + height), amount: ['9007199254740993', '2', '3', '4'][height - 1] })) };
const client = {
  async getHeight() { return { network: source.network, payload_kind: 'full-v1', ready: source.ready,
    archive_height: source.blocks.at(-1).height, start_block: 1, epoch: source.epoch }; },
  async get(query) {
    const blocks = source.blocks.filter(b => b.height >= query.from_block && b.height < query.to_block).slice(0, query.limit);
    assert.ok(blocks.length);
    return { network: source.network, epoch: source.epoch, from_block: query.from_block, next_block: blocks.at(-1).height + 1,
      data: { blocks: blocks.map(({ txid, amount, ...block }) => block), transactions: query.field_selection.transaction.length
        ? blocks.map(b => ({ block_height: b.height, index: 0, txid: b.txid, version: 5, locktime: 0, decoded: { amount: b.amount } })) : [] } };
  },
};
const models = [parseModel('type Total { id: ID! amount: BigInt! } type Transfer { id: ID! amount: BigInt! height: Int! }'),
  parseModel('type Total { id: ID! amount: BigInt! weighted: BigInt! } type Transfer { id: ID! amount: BigInt! weighted: BigInt! height: Int! rule: String! }')];
const options = projects.map((project, i) => ({ project, fingerprint: `evolution-handler-v${i + 1}`, model: models[i], network: 'regtest', startHeight: 1, reorgWindow: 3 }));
const stores = options.map(value => new PostgresStore(url, value));
const extraStores = [], servers = [];
const record = { status: 'RUNNING', projects, versions: options.map(value => ({ project: value.project,
  fingerprint: value.fingerprint, modelFingerprint: value.model.fingerprint, network: value.network,
  startHeight: value.startHeight, reorgWindow: value.reorgWindow })),
  scope: 'Synthetic full-v1 source with actual PostgreSQL and loopback GraphQL; no live-node or routing proof', stages: [] };
let failShadow = false;
const indexers = options.map((_, i) => ({ async transaction({ transaction, context }) {
  const amount = BigInt(transaction.decoded.amount);
  const total = await context.entities.get('Total', 'all');
  const weighted = amount * 2n;
  await context.entities.set('Transfer', { id: transaction.txid, amount, height: transaction.blockHeight,
    ...(i ? { weighted, rule: 'double-v2' } : {}) });
  await context.entities.set('Total', { id: 'all', amount: (total?.amount ?? 0n) + amount,
    ...(i ? { weighted: (total?.weighted ?? 0n) + weighted } : {}) });
  if (i && failShadow && transaction.blockHeight === 3) throw new Error('intentional shadow interruption');
} }));
const step = i => syncStep({ client, store: stores[i], indexer: indexers[i], network: 'regtest', startHeight: 1, reorgWindow: 3, pageSize: 4 }, 4);
async function replay(i) { for (let attempt = 0; attempt < 10; attempt++) if ((await step(i)).state === 'caught_up') return; assert.fail('Replay did not converge'); }
const snapshot = i => stores[i].read(async view => ({ checkpoint: view.checkpoint,
  total: await view.get('Total', 'all'), rows: await view.list('Transfer', { first: 20 }) }));
const event = (stage, details = {}) => record.stages.push({ stage, ...details });
async function graph(i, query, authorized = true) {
  const response = await fetch(`http://127.0.0.1:${servers[i].address().port}/graphql`, { method: 'POST',
    headers: { ...(authorized ? { authorization: 'Bearer evolution-disposable-token' } : {}), 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  return { status: response.status, body: await response.json() };
}
async function pin() { const meta = await client.getHeight(); return { epoch: meta.epoch, height: 4, hash: source.blocks[3].hash, network: meta.network }; }
async function eligible(i, target) {
  const now = await pin(), cp = await stores[i].checkpoint();
  return source.ready && now.network === 'regtest' && now.epoch === target.epoch && now.hash === target.hash
    && cp.status === 'ready' && cp.height === target.height && cp.hash === target.hash;
}
try {
  for (const store of stores) { await store.migrate(); await store.acquire(); }
  for (let i = 0; i < 2; i++) {
    const server = createChefServer({ store: stores[i], model: models[i], token: 'evolution-disposable-token' });
    await new Promise(done => server.listen(0, '127.0.0.1', done)); servers.push(server);
  }
  await replay(0);
  const old = await snapshot(0), target = await pin();
  assert.equal(old.total.amount, '9007199254741002');
  event('v1_pinned', { target, snapshot: old });
  for (const changes of [{ model: models[1] }, { fingerprint: 'changed-handler' }]) {
    const changed = new PostgresStore(url, { ...options[0], ...changes }); extraStores.push(changed);
    await assert.rejects(changed.migrate(), /identity mismatch/);
    await assert.rejects(changed.checkpoint(), /identity mismatch/);
  }
  assert.deepEqual(await snapshot(0), old); event('same_namespace_identity_changes_rejected');
  assert.equal(await eligible(1, target), false, 'An empty ready namespace is not cutover eligible');
  failShadow = true; await assert.rejects(step(1), /intentional shadow interruption/);
  const prefix = await snapshot(1);
  assert.equal(prefix.checkpoint.height, 2);
  assert.deepEqual({ total: prefix.total, rows: prefix.rows }, {
    total: { id: 'all', amount: '9007199254740995', weighted: '18014398509481990' }, rows: [
      { id: h(101), amount: '9007199254740993', weighted: '18014398509481986', height: 1, rule: 'double-v2' },
      { id: h(102), amount: '2', weighted: '4', height: 2, rule: 'double-v2' },
    ],
  });
  assert.deepEqual(await snapshot(0), old); event('shadow_failure_atomic_prefix_old_unchanged', { snapshot: prefix });
  failShadow = false; await replay(1);
  const expected = { total: { id: 'all', amount: '9007199254741002', weighted: '18014398509482004' }, rows: [
    { id: h(101), amount: '9007199254740993', weighted: '18014398509481986', height: 1, rule: 'double-v2' },
    { id: h(102), amount: '2', weighted: '4', height: 2, rule: 'double-v2' },
    { id: h(103), amount: '3', weighted: '6', height: 3, rule: 'double-v2' },
    { id: h(104), amount: '4', weighted: '8', height: 4, rule: 'double-v2' },
  ] };
  const shadow = await snapshot(1); assert.deepEqual({ total: shadow.total, rows: shadow.rows }, expected);
  assert.equal(await eligible(1, target), true);
  assert.deepEqual(await snapshot(0), old);
  const oldQuery = await graph(0, '{ TotalById(id:"all") { weighted } }');
  assert.equal(oldQuery.status, 400, 'A v2-only field must be a v1 schema validation failure');
  assert.ok(oldQuery.body.errors?.length, 'V1 must not pretend the v2 field is compatible');
  assert.equal((await graph(0, '{ _meta { height } }', false)).status, 401);
  assert.equal((await graph(1, '{ _meta { height } }', false)).status, 401);
  const newQuery = await graph(1, '{ _meta { height hash status } TotalById(id:"all") { amount weighted } }');
  assert.equal(newQuery.status, 200); assert.deepEqual(newQuery.body.data.TotalById, { amount: expected.total.amount, weighted: expected.total.weighted });
  event('v2_independent_oracle_and_graphql_contract', { target, snapshot: shadow, graphql: newQuery, v1IncompatibleQueryStatus: oldQuery.status, unauthenticatedStatus: 401 });
  const beforeRepeat = await snapshot(1); assert.equal((await step(1)).blocks, 0); assert.deepEqual(await snapshot(1), beforeRepeat);
  event('repeated_replay_zero_blocks');
  source.ready = false; assert.equal((await step(1)).state, 'source_unavailable');
  assert.equal(await eligible(1, target), false); assert.equal((await graph(1, '{ _meta { height } }')).status, 503);
  source.ready = true; await replay(1); assert.equal(await eligible(1, target), true); event('unready_shadow_gated_and_recovered');
  source.network = 'mainnet'; await assert.rejects(step(1), error => error.code === 'SOURCE_NETWORK_OR_KIND_MISMATCH');
  assert.equal((await graph(1, '{ _meta { height } }')).status, 503);
  source.network = 'regtest'; await replay(1); event('network_mismatch_gated');
  source.epoch = '2';
  assert.equal(source.blocks[3].hash, target.hash);
  assert.equal(await eligible(1, target), false, 'Epoch-only change must invalidate approval even with unchanged hash');
  assert.equal((await step(1)).blocks, 0);
  assert.deepEqual(await snapshot(1), shadow);
  const epochOnlyPin = await pin(); assert.equal(await eligible(1, epochOnlyPin), true);
  event('epoch_only_change_requires_new_pin', { oldPin: target, newPin: epochOnlyPin, unchangedSnapshot: shadow });
  source.epoch = '3'; source.blocks[3] = { ...source.blocks[3], hash: h(404), txid: h(204), amount: '40' };
  assert.equal(await eligible(1, epochOnlyPin), false, 'Changed branch must invalidate the current approval before cutover');
  await replay(1);
  const current = await pin(); assert.equal(await eligible(1, current), true);
  const reorgged = await snapshot(1);
  assert.deepEqual({ total: reorgged.total, rows: reorgged.rows }, {
    total: { id: 'all', amount: '9007199254741038', weighted: '18014398509482076' }, rows: [
      { id: h(101), amount: '9007199254740993', weighted: '18014398509481986', height: 1, rule: 'double-v2' },
      { id: h(102), amount: '2', weighted: '4', height: 2, rule: 'double-v2' },
      { id: h(103), amount: '3', weighted: '6', height: 3, rule: 'double-v2' },
      { id: h(204), amount: '40', weighted: '80', height: 4, rule: 'double-v2' },
    ],
  });
  assert.equal((await stores[0].checkpoint()).status, 'ready');
  assert.equal(await eligible(0, current), false, 'Stopped v1 can remain ready while stale; rollback must revalidate it');
  assert.deepEqual(await snapshot(0), old); event('changed_pin_refuses_cutover_and_stale_rollback', { current, shadow: reorgged });
  await replay(0); assert.equal(await eligible(0, current), true);
  const rollback = await snapshot(0);
  assert.deepEqual({ total: rollback.total, rows: rollback.rows }, {
    total: { id: 'all', amount: '9007199254741038' }, rows: [
      { id: h(101), amount: '9007199254740993', height: 1 },
      { id: h(102), amount: '2', height: 2 },
      { id: h(103), amount: '3', height: 3 },
      { id: h(204), amount: '40', height: 4 },
    ],
  });
  event('old_writer_reconciled_before_rollback_eligibility', { current, snapshot: rollback });
  record.status = 'PASS';
} catch (error) { record.status = 'FAIL'; record.error = { name: error.name, message: error.message }; throw error; }
finally {
  for (const server of servers) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  for (const store of [...stores, ...extraStores]) await store.close();
  // Deliberately retain both uniquely named experiment schemas and evidence.
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(record, null, 2) + '\n');
}
console.log(JSON.stringify({ status: record.status, output, projects, scope: record.scope }));
