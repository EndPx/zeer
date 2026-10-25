// Controlled source-interruption acceptance. No live chain, viewing key or financial action.
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, realpath} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {ContinuousConsumer} from './consumer.mjs';

const example = dirname(fileURLToPath(import.meta.url));
const sdk = await realpath(resolve(process.env.CHEF_ACCEPTANCE_SDK_ROOT ?? join(example, '../../packages/chef')));
const packageInfo = JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'));
assert.equal(packageInfo.name, '@zeer-dev/chef');
const {default: pg} = await import(pathToFileURL(createRequire(join(sdk, 'package.json')).resolve('pg')).href);
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'Set DATABASE_URL to an existing disposable PostgreSQL database');
const project = `src_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
const namespace = `chef_${project}`;
assert.match(namespace, /^chef_src_[a-f0-9]{24}$/);
const directory = resolve(process.env.CHEF_ACCEPTANCE_OUTPUT_DIR ?? join(example, 'private'), project);
await mkdir(directory, {recursive: true, mode: 0o700});
const token = randomUUID() + randomUUID();
const cli = join(sdk, 'dist/cli.js');
const config = join(directory, 'chef.config.mjs');
const proof = {
  scenario: 'controlled-testnet-source-interruption', live_network: false, synthetic_block_hashes: true,
  viewing_key_loaded: false, financial_execution: false, sdk_version: packageInfo.version,
  project, initial_height: 31, restored_height: 1600, backlog_blocks: 1569,
  consumer: {mode: 'continuous', window_blocks: 128, page_rows: 25, total_row_limit: 5000},
  checks: {}, processes: [], observations: [],
};
const hash = height => createHash('sha256').update(`zeer-controlled-source-block:${height}`).digest('hex');
let tip = 31, mode = 'ready';
const sourceRequests = [];
const source = createServer(async (request, response) => {
  sourceRequests.push({path: request.url, mode, at: new Date().toISOString()});
  if (mode === 'transport_down') { request.socket.destroy(); return; }
  const json = (status, value) => { response.writeHead(status, {'content-type': 'application/json'}); response.end(JSON.stringify(value)); };
  if (request.method === 'GET' && request.url === '/height') {
    json(200, {network: 'testnet', payload_kind: 'full-v1', source_mode: 'follower', ready: mode === 'ready',
      start_block: 0, archive_height: tip, indexed_height: tip, source_height: tip,
      source_observed_at: Math.floor(Date.now() / 1000), lag_blocks: 0, epoch: '1', revision: '1'});
    return;
  }
  if (request.method !== 'POST' || request.url !== '/query') { json(404, {error: 'NOT_FOUND'}); return; }
  if (mode !== 'ready') { json(503, {error: 'SOURCE_NOT_READY'}); return; }
  let bytes = '';
  for await (const chunk of request) {
    bytes += chunk;
    if (bytes.length > 65536) { json(413, {error: 'REQUEST_TOO_LARGE'}); return; }
  }
  try {
    const query = JSON.parse(bytes), from = query.from_block, to = query.to_block ?? tip + 1;
    assert.ok(Number.isInteger(from) && from >= 0 && Number.isInteger(to) && to > from && to <= tip + 1);
    assert.ok(Number.isInteger(query.limit) && query.limit > 0 && query.limit <= 1000);
    const next = Math.min(to, from + query.limit);
    const blocks = Array.from({length: next - from}, (_, index) => {
      const height = from + index;
      return {height, hash: hash(height), previous_hash: hash(height - 1), time: 1700000000 + height};
    });
    json(200, {network: 'testnet', epoch: '1', revision: '1', archive_height: tip,
      from_block: from, to_block: to, next_block: next, cursor: next === to ? null : 'aa',
      data: {blocks, transactions: []}});
  } catch { json(400, {error: 'FIXTURE_REQUEST_INVALID'}); }
});

const pool = new pg.Pool({connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000});
pool.on('error', () => {});
const children = new Set();
const childExits = new Map();
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(new Error('ACCEPTANCE_DEADLINE_EXCEEDED')), 180000);
let consumer, passed = false, sourceListening = false;
const signal = controller.signal;
const stopSignal = () => controller.abort(new Error('ACCEPTANCE_CANCELLED'));
process.once('SIGINT', stopSignal); process.once('SIGTERM', stopSignal);

async function waitFor(label, operation, seconds = 30) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    signal.throwIfAborted();
    const value = await operation();
    if (value) return value;
    await delay(50, undefined, {signal});
  }
  throw new Error(`WAIT_TIMEOUT_${label}`);
}
async function freePort() {
  const reservation = createTcpServer();
  await new Promise((done, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', done); });
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  return port;
}
function launch(role, args) {
  const env = {...process.env, PREP_URL: sourceUrl, DATABASE_URL: databaseUrl, PREP_API_TOKEN: '', CHEF_API_TOKEN: token};
  for (const name of ['ZEER_VIEWING_KEY_FILE', 'ZEER_SCANNER_EXECUTABLE', 'ZEER_KEY_FINGERPRINT', 'ZEER_ACCOUNT_ID']) delete env[name];
  const child = spawn(process.execPath, [cli, ...args, '--config', config, '--json'], {
    cwd: directory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const record = {role, pid: child.pid ?? null, events: [], stderr: '', exit: null};
  proof.processes.push(record); children.add(child);
  let pending = '', bytes = 0;
  child.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) { controller.abort(new Error('CLI_OUTPUT_BUDGET')); return; }
    pending += chunk;
    for (;;) {
      const newline = pending.indexOf('\n'); if (newline < 0) break;
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      if (!line.trim()) continue;
      try { record.events.push(JSON.parse(line)); } catch { controller.abort(new Error('CLI_OUTPUT_NOT_JSON')); }
    }
  });
  child.stderr.on('data', chunk => {
    if (record.stderr.length + chunk.length < 65536) record.stderr += chunk;
    else controller.abort(new Error('CLI_STDERR_BUDGET'));
  });
  const exited = new Promise(done => {
    child.once('error', () => { record.exit = {code: null, signal: null, spawn_error: true}; children.delete(child); done(record.exit); });
    // close follows stdout/stderr EOF, so one-shot diagnostics are fully captured.
    child.once('close', (code, childSignal) => { record.exit = {code, signal: childSignal}; children.delete(child); done(record.exit); });
  });
  childExits.set(child, exited);
  return {child, record, exited};
}
async function once(role, args, expected = 0) {
  const run = launch(role, args);
  const exit = await waitFor(`${role}_exit`, () => run.record.exit, 15);
  assert.equal(exit.code, expected, `Unexpected ${role} exit; inspect private proof`);
  return run.record;
}
async function stop(run) {
  if (!run || run.record.exit) return;
  // IPC uses Chef's supported graceful-stop path on Windows and Linux alike.
  if (run.child.connected) run.child.send({type: 'zeer-stop'});
  else run.child.kill('SIGTERM');
  try { await waitFor(`${run.record.role}_stop`, () => run.record.exit, 10); }
  catch { run.child.kill('SIGKILL'); await run.exited; throw new Error('CLI_GRACEFUL_STOP_FAILED'); }
  assert.equal(run.record.exit.code, 0, 'Controlled stop must exit successfully');
}
async function http(path, payload) {
  const response = await fetch(apiUrl + path, {method: payload ? 'POST' : 'GET',
    headers: {authorization: `Bearer ${token}`, ...(payload ? {'content-type': 'application/json'} : {})},
    ...(payload ? {body: JSON.stringify(payload)} : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])});
  return {status: response.status, body: await response.json()};
}
async function state() {
  const {rows} = await pool.query(`SELECT height::text,hash,status,data_revision::text FROM "${namespace}".state WHERE singleton=true`);
  return rows[0];
}
async function entityRows() {
  const {rows} = await pool.query(`SELECT data FROM "${namespace}".entities WHERE entity='BlockSummary' ORDER BY (data->>'height')::int,id`);
  return rows.map(row => row.data);
}
const expectedRows = last => Array.from({length: last + 1}, (_, height) => ({id: `block:${height}`, height, blockHash: hash(height), sampleCount: height % 7}));
const rowsDigest = rows => createHash('sha256').update(JSON.stringify(rows.map(row => [row.id, row.height, row.blockHash, row.sampleCount]))).digest('hex');
function makeConsumer() {
  return new ContinuousConsumer({file: join(directory, 'consumer.sqlite'), url: apiUrl, token, project, from: 0,
    entity: 'BlockSummary', heightField: 'height', fields: ['id', 'height', 'blockHash', 'sampleCount'],
    pageSize: 25, maxRange: 128, maxRows: 1000, maxTotalRows: 5000});
}
async function consumeThrough(height) {
  const started = Date.now(); let rounds = 0;
  while (rounds++ < 100) {
    signal.throwIfAborted();
    const result = await consumer.step({maxPages: 20, signal});
    proof.observations.push({kind: 'consumer', state: result.state, reason: result.reason ?? null, at: new Date().toISOString()});
    if (consumer.state().complete?.caughtUp && consumer.state().complete.to === height) break;
    assert.ok(Date.now() - started < 30000, 'Consumer catch-up deadline');
    if (result.state === 'waiting') await delay(100, undefined, {signal});
  }
  assert.equal(consumer.state().complete?.to, height);
  assert.equal(consumer.state().complete?.caughtUp, true);
  assert.deepEqual(consumer.rows(), expectedRows(height));
}
let sourceUrl, apiUrl;
try {
  await pool.query('SELECT 1');
  const existing = await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [namespace]);
  assert.equal(existing.rowCount, 0, 'Fixture namespace must be new');
  await new Promise((done, reject) => { source.once('error', reject); source.listen(0, '127.0.0.1', done); });
  sourceListening = true; sourceUrl = `http://127.0.0.1:${source.address().port}`;
  const port = await freePort(); apiUrl = `http://127.0.0.1:${port}`;
  await writeFile(join(directory, 'schema.graphql'), 'type BlockSummary { id: ID! height: Int! @index blockHash: ID! sampleCount: Int! }\n', {mode: 0o600});
  await writeFile(config, `export default {project:${JSON.stringify(project)},network:'testnet',startHeight:0,schema:'schema.graphql',handlerVersion:'controlled-source-recovery-v1',reorgWindow:16,sync:{pageSize:64,batchSize:16},indexer:{async block({block,context}){await context.entities.set('BlockSummary',{id:'block:'+block.height,height:block.height,blockHash:block.hash,sampleCount:block.height%7});}}};\n`, {mode: 0o600});
  await once('migrate', ['migrate']);
  const api = launch('serve', ['serve', '--port', String(port)]);
  await waitFor('api_listen', () => { assert.equal(api.record.exit, null, 'API exited early'); return api.record.events.some(row => row.status === 'listening'); });
  let follower = launch('follow_initial', ['sync', '--follow', '--poll-seconds', '1']);
  await waitFor('initial_caught_up', async () => { const row = await state(); return row.height === '31' && row.status === 'ready'; });
  const before = await state();
  assert.deepEqual(await entityRows(), expectedRows(31));
  const initialStatus = await once('status_initial', ['status']);
  assert.equal(initialStatus.events.at(-1).state, 'caught_up');
  consumer = makeConsumer(); await consumeThrough(31);
  const initialConsumer = consumer.rows();
  proof.checks.initial_projection = true;

  mode = 'unready';
  await waitFor('unready_read_gate', async () => (await state()).status === 'reconciling');
  const gated = await http('/graphql', {query: '{ BlockSummaryList(first:1){items{id}} }'});
  assert.equal(gated.status, 503);
  const unready = await once('status_unready', ['status'], 1);
  assert.equal(unready.events.at(-1).state, 'source_not_ready');
  assert.equal(unready.events.at(-1).source.ready, false);
  assert.equal((await state()).height, before.height);
  assert.equal((await state()).hash, before.hash);
  assert.deepEqual(await entityRows(), expectedRows(31));
  const waiting = await consumer.step({signal});
  assert.equal(waiting.state, 'waiting'); assert.deepEqual(consumer.rows(), initialConsumer);
  proof.observations.push({kind: 'consumer_unready', state: waiting.state, reason: waiting.reason});
  await waitFor('cached_wait_heartbeat', () => follower.record.events.find(row => row.state === 'heartbeat' && row.progress?.phase === 'source_wait'), 10);
  proof.checks.unready_gate_and_cached_heartbeat = true;

  const outagesBefore = sourceRequests.length;
  mode = 'transport_down';
  await waitFor('transport_observed', () => sourceRequests.slice(outagesBefore).some(row => row.mode === 'transport_down'));
  const unavailable = await once('status_transport_down', ['status'], 1);
  assert.equal(unavailable.events.at(-1).state, 'source_unavailable');
  assert.equal(unavailable.events.at(-1).source.availability, 'unavailable');
  assert.equal((await http('/graphql', {query: '{ BlockSummaryList(first:1){items{id}} }'})).status, 503);
  assert.equal((await consumer.step({signal})).state, 'waiting');
  assert.deepEqual(consumer.rows(), initialConsumer);
  assert.deepEqual(await entityRows(), expectedRows(31));
  assert.equal((await state()).height, before.height); assert.equal((await state()).hash, before.hash);
  proof.checks.transport_wait_preserves_projection = true;

  tip = 1600; mode = 'ready';
  await waitFor('restored_caught_up', async () => {
    assert.equal(follower.record.exit, null, 'Follower exited during recovery');
    const row = await state(); return row.height === '1600' && row.status === 'ready';
  }, 60);
  await waitFor('follow_caught_up_record', () => follower.record.events.find(row => row.state === 'caught_up' && row.checkpoint?.height === 1600));
  const restored = await state(), stored = await entityRows();
  assert.equal(restored.hash, hash(1600)); assert.deepEqual(stored, expectedRows(1600));
  assert.equal(new Set(stored.map(row => row.id)).size, 1601);
  await consumeThrough(1600);
  const consumerBeforeRestart = consumer.rows(), consumerState = consumer.state();
  assert.ok(consumerState.complete.sealedThrough >= 1500);
  consumer.close(); consumer = undefined;
  await stop(follower);
  follower = launch('follow_restart', ['sync', '--follow', '--poll-seconds', '1']);
  await waitFor('restart_caught_up_record', () => follower.record.events.find(row => row.state === 'caught_up' && row.checkpoint?.height === 1600));
  assert.deepEqual(await state(), restored); assert.deepEqual(await entityRows(), stored);
  consumer = makeConsumer(); await consumeThrough(1600);
  assert.deepEqual(consumer.rows(), consumerBeforeRestart);
  const finalStatus = await once('status_final', ['status']);
  assert.equal(finalStatus.events.at(-1).state, 'caught_up');
  assert.equal(finalStatus.events.at(-1).checkpoint.hash, hash(1600));
  assert.equal(finalStatus.events.at(-1).source.chefPrepLagBlocks, 0);
  await stop(follower); await stop(api);
  proof.checks.backlog_above_1024 = true;
  proof.checks.restart_checkpoint_revision_entities_exact = true;
  proof.checks.bounded_sqlite_consumer_reopens_without_duplicates = true;
  proof.final_checkpoint = {height: 1600, hash: restored.hash, revision: restored.data_revision};
  proof.entity_count = 1601; proof.entity_digest = rowsDigest(stored);
  proof.consumer_count = consumer.count(); proof.consumer_digest = rowsDigest(consumer.rows());
  assert.equal(proof.entity_digest, proof.consumer_digest);
  assert.ok(proof.processes.every(run => run.exit && run.exit.signal === null));
  passed = true;
} catch (error) {
  proof.failure = {code: error?.code ?? 'ACCEPTANCE_FAILED', message: String(error?.message ?? 'Unknown failure').slice(0, 4096)};
  process.stderr.write(JSON.stringify({state: 'failed', proof: join(directory, 'proof.json')}) + '\n');
  throw error;
} finally {
  controller.abort(new Error('ACCEPTANCE_FINISHED')); clearTimeout(deadline);
  process.off('SIGINT', stopSignal); process.off('SIGTERM', stopSignal);
  for (const child of children) { try { if (child.connected) child.send({type: 'zeer-stop'}); else child.kill('SIGTERM'); } catch {} }
  const remainingUntil = Date.now() + 5000;
  while (children.size && Date.now() < remainingUntil) await delay(50);
  const forced = [...children];
  for (const child of forced) child.kill('SIGKILL');
  await Promise.all(forced.map(child => childExits.get(child)));
  if (consumer) consumer.close();
  if (sourceListening) { source.closeAllConnections(); await new Promise(done => source.close(done)); }
  if (passed) {
    // Only this run's random, absent-before-migrate, marked Chef namespace is removable.
    const marker = await pool.query('SELECT to_regclass($1)::text AS relation', [`${namespace}.chef_owned_namespace`]);
    assert.ok(marker.rows[0].relation);
    const owned = await pool.query(`SELECT version FROM "${namespace}".chef_owned_namespace WHERE singleton=true`);
    assert.equal(owned.rows[0].version, 2);
    await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    proof.checks.owned_namespace_removed = true;
  }
  await pool.end();
  proof.cli_process_count = proof.processes.length;
  proof.source_requests = sourceRequests.length;
  proof.passed = passed;
  await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', {mode: 0o600});
}
console.log(JSON.stringify({state: 'complete', source: proof.scenario, live_network: false,
  entityCount: proof.entity_count, cliProcessCount: proof.cli_process_count, proof: join(directory, 'proof.json')}));
