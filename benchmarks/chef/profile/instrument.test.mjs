import test from 'node:test';
import assert from 'node:assert/strict';
import { createChefServer } from '../../../packages/chef/dist/graphql.js';
import { parseModel } from '../../../packages/chef/dist/schema.js';
import { loadProfileModule, instrument } from './instrument.mjs';

test('measurement-only copy preserves responses, per-request variables and readiness', async t => {
  const { module: profiled } = await loadProfileModule('packages/chef/dist/graphql.js');
  const model = parseModel('type Payment { id: ID! amount: BigInt! }');
  const token = 'profile-test-token-0123456789';
  const checkpoint = { height: 42, hash: 'a', anchorHash: 'b', status: 'ready' };
  let reads = 0;
  const store = { async read(fn) { reads++; return fn({ checkpoint: { ...checkpoint }, async get(_entity, id) { return { id, amount: '9007199254740993' }; } }); } };
  const servers = [createChefServer, profiled.createChefServer].map(create => create({ store, model, token }));
  for (const server of servers) {
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  }
  const request = async (server, payload, authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  const query = 'query($id:ID!){ PaymentById(id:$id){id amount} _meta {height hash status} }';
  for (const payload of [{ query, variables: { id: 'a' } }, { query, variables: { id: 'b' } }, { query, variables: {} }, { query: '{ unknown }' }, { query: '{ __schema { queryType { name } } }' }, { query: '{' }]) {
    assert.deepEqual(await request(servers[1], payload), await request(servers[0], payload));
  }
  const successful = profiled.__chefProfileSamples.filter(row => row.executeMs !== undefined && row.validateMs !== undefined);
  assert.ok(successful.length >= 1);
  for (const row of successful) {
    for (const key of ['parseMs', 'limitsMs', 'validateMs', 'readEnvelopeMs', 'executeMs', 'serializeMs', 'handlerMs']) assert.ok(Number.isFinite(row[key]) && row[key] >= 0, key);
    assert.ok(Math.abs(row.readMs - row.executeMs - row.readEnvelopeMs) < .0001);
  }
  for (const status of ['reconciling', 'blocked']) {
    checkpoint.status = status;
    const result = await request(servers[1], { query, variables: { id: 'a' } });
    assert.equal(result.status, 503);
    assert.deepEqual(result, await request(servers[0], { query, variables: { id: 'a' } }));
  }
  const previousReads = reads, previousSamples = profiled.__chefProfileSamples.length;
  assert.equal((await request(servers[1], { query }, false)).status, 401);
  assert.equal(reads, previousReads);
  assert.equal(profiled.__chefProfileSamples.length, previousSamples);
});

async function cachedFixture(t, modelSource = 'type Payment { id: ID! amount: BigInt! }') {
  const { module: profiled } = await loadProfileModule('packages/chef/dist/graphql.js');
  const model = parseModel(modelSource), token = 'profile-cache-token-0123456789';
  const checkpoint = { height: 42, hash: 'a', anchorHash: 'b', status: 'ready' };
  let reads = 0;
  const store = { async read(fn) { reads++; return fn({ checkpoint: { ...checkpoint }, async get(_entity, id) { return { id, amount: '9007199254740993' }; } }); } };
  const server = profiled.createChefServer({ store, model, token });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const request = async (query, extra = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query, ...extra }) });
    const body = await response.json(), profile = profiled.__chefProfileSamples.pop();
    return { status: response.status, body, profile };
  };
  return { request, checkpoint, reads: () => reads };
}

test('document cache hits keep variables, operation selection, checkpoint and readiness per request', async t => {
  const { request, checkpoint, reads } = await cachedFixture(t);
  const query = 'query Q($id:ID!){ PaymentById(id:$id){id amount} _meta {height hash status} }';
  const first = await request(query, { variables: { id: 'a' }, operationName: 'Q' });
  assert.equal(first.status, 200); assert.ok(first.profile.validateMs >= 0);
  checkpoint.height = 43; checkpoint.hash = 'new-head';
  const second = await request(query, { variables: { id: 'b' }, operationName: 'Q' });
  assert.equal(second.status, 200); assert.equal(second.profile.parseMs, undefined); assert.equal(second.profile.validateMs, undefined);
  assert.equal(second.body.data.PaymentById.id, 'b'); assert.equal(second.body.data._meta.height, 43); assert.equal(second.body.data._meta.hash, 'new-head');
  for (const extra of [{ variables: {} }, { variables: { id: 'a' }, operationName: 'wrong' }, { variables: { id: '' } }]) {
    const result = await request(query, extra); assert.equal(result.status, 400); assert.equal(result.profile.parseMs, undefined);
  }
  for (const status of ['reconciling', 'blocked']) {
    checkpoint.status = status;
    const result = await request(query, { variables: { id: 'a' } }); assert.equal(result.status, 503); assert.equal(result.profile.parseMs, undefined);
  }
  checkpoint.status = 'ready';
  assert.equal((await request(query, { variables: { id: 'c' } })).body.data.PaymentById.id, 'c');
  assert.equal(reads(), 8);
});

test('document cache is server/schema isolated and invalid documents are never cached', async t => {
  const a = await cachedFixture(t), b = await cachedFixture(t, 'type Other { id: ID! }');
  const query = '{ PaymentById(id:"a"){id} }';
  assert.equal((await a.request(query)).status, 200);
  assert.equal((await a.request(query)).profile.parseMs, undefined);
  for (let i = 0; i < 2; i++) {
    const result = await b.request(query); assert.equal(result.status, 400); assert.ok(result.profile.parseMs >= 0); assert.ok(result.profile.validateMs >= 0);
  }
  assert.equal(b.reads(), 0);
  for (const invalid of ['{', '{ __schema { queryType { name } } }']) for (let i = 0; i < 2; i++) {
    const result = await a.request(invalid); assert.equal(result.status, 400); assert.ok(result.profile.parseMs >= 0);
  }
});

test('document LRU evicts by 64 entries while refreshing recently used documents', async t => {
  const { request } = await cachedFixture(t);
  const query = i => `query Q${i} { _meta { height } }`;
  for (let i = 0; i < 64; i++) assert.equal((await request(query(i))).status, 200);
  assert.equal((await request(query(0))).profile.parseMs, undefined);
  await request(query(64));
  assert.equal((await request(query(0))).profile.parseMs, undefined);
  assert.ok((await request(query(1))).profile.parseMs >= 0);
});

test('document LRU also bounds retained query source to 256 KiB', async t => {
  const { request } = await cachedFixture(t);
  // Three UTF-8 bytes per character catches accidental character-count budgets.
  const query = i => `#${i}${'€'.repeat(20 * 1024)}\n{ _meta { height } }`;
  for (let i = 0; i < 4; i++) assert.equal((await request(query(i))).status, 200);
  assert.equal((await request(query(0))).profile.parseMs, undefined);
  await request(query(4));
  assert.equal((await request(query(0))).profile.parseMs, undefined);
  assert.ok((await request(query(1))).profile.parseMs >= 0);
});

test('instrumentation refuses unknown or duplicate source instead of partial profiling', () => {
  assert.throws(() => instrument('export function createChefServer() {}'), /PROFILE_SOURCE_MISMATCH/);
  assert.throws(() => instrument('const server = createServer(async (request, response) => {\nconst server = createServer(async (request, response) => {'), /PROFILE_SOURCE_MISMATCH/);
});
