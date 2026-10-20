#!/usr/bin/env node
// Bounded prepared-source indexing benchmark. No namespace is ever dropped.
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { PrepClient } from '@zeer-dev/prep-client';
import { PostgresStore, parseModel, syncStep, createChefServer } from '@zeer-dev/chef';
import { FrozenRpcSource } from './rpc_source.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const assert = (ok, code) => { if (!ok) throw new Error(code); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const flags = new Map();
const allowed = ['--config', '--manifest', '--out', '--source-url', '--prep-url', '--dsn-env', '--timeout-seconds', '--page-size', '--source-mode', '--repetitions'];
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert(allowed.includes(key) && !flags.has(key) && value && !value.startsWith('--'), 'INVALID_ARGUMENT');
  flags.set(key, value);
}
for (const key of ['--config', '--manifest', '--out', '--source-url']) assert(flags.has(key), 'MISSING_ARGUMENT');
const configPath = resolve(flags.get('--config'));
const reportPath = resolve(flags.get('--out'));
const configBytes = await readFile(configPath);
const config = (await import(pathToFileURL(configPath).href)).default;
assert(config.network === 'mainnet' && config.startHeight === 1 && typeof config.handlerVersion === 'string' && config.indexer, 'INVALID_BENCHMARK_CONFIG');
const schemaBytes = await readFile(resolve(dirname(configPath), config.schema), 'utf8');
const model = parseModel(schemaBytes);
assert(model.entities.Block && model.entities.PublicTransaction, 'EXPECTED_PUBLIC_EXAMPLE_MODEL');
const manifestBytes = await readFile(resolve(flags.get('--manifest')));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
assert(manifest.selection_end_height === 2048 && manifest.end_height === 6764 && manifest.records.length === 128, 'INVALID_FROZEN_MANIFEST');
const end = 2048;
const sourceMode = flags.get('--source-mode') ?? 'prep';
assert(['prep', 'rpc'].includes(sourceMode), 'INVALID_SOURCE_MODE');
const prepUrl = flags.get('--prep-url') ?? process.env[config.prepUrlEnv ?? 'PREP_URL'];
const dsn = process.env[flags.get('--dsn-env') ?? config.databaseUrlEnv ?? 'DATABASE_URL'];
assert(dsn && (sourceMode === 'rpc' || prepUrl), 'PREP_URL_AND_DSN_REQUIRED');
const timeoutSeconds = Number(flags.get('--timeout-seconds') ?? 1800);
const pageSize = Number(flags.get('--page-size') ?? 16);
const repetitions = Number(flags.get('--repetitions') ?? 5);
assert(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 5, 'INVALID_REPETITIONS');
assert(Number.isInteger(timeoutSeconds) && timeoutSeconds >= 1 && timeoutSeconds <= 7200, 'INVALID_TIMEOUT');
assert(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100, 'INVALID_PAGE_SIZE');
const sourceUrl = new URL(flags.get('--source-url'));
assert(['http:', 'https:'].includes(sourceUrl.protocol) && !sourceUrl.username && !sourceUrl.password && !sourceUrl.search && !sourceUrl.hash, 'INVALID_SOURCE_URL');
const controller = new AbortController();
// Bound oracle preparation as well as each measured application run.
const oracleSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutSeconds * 1000)]);
const stop = () => controller.abort();
let sqlRequests = 0;
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (...args) { sqlRequests++; return originalQuery.apply(this, args); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
const report = {
  format: 'chef-bounded-indexing-v1', status: 'RUNNING', started_at: new Date().toISOString(),
  candidate: sourceMode === 'prep' ? 'Chef + Prep' : 'Chef + full-node RPC (benchmark adapter)',
  source_mode: sourceMode,
  workload: { network: 'mainnet', from_height: 1, to_height: end, source_head: manifest.end_height, source_hash: manifest.end_hash,
    config_sha256: sha(configBytes), schema_sha256: sha(schemaBytes), manifest_sha256: sha(manifestBytes), page_size: pageSize },
  phases: {}, runs: [],
  limitations: [
    'Prepared Prep archive and frozen node are prerequisites; node sync and archive construction are not timed here.',
    'Primary elapsed starts with the first selected source request and ends after the final PostgreSQL block/entity/checkpoint commit.',
    'Migration, independent oracle collection, persisted-output checks and GraphQL validation have separate timers.',
    'transaction_overhead_ms is apply minus awaited handlers; it includes BEGIN, identity/journal/checkpoint/prune/COMMIT, not pure COMMIT latency.',
    'CPU and sampled RSS describe this Node process only. Prep, PostgreSQL and source resource usage require separate host/container measurements.',
    'Fresh entity namespaces reuse prepared sources; repetition count is explicit. Single-run reports require external aggregation; no claim of cold source/cache throughput.',
    'This 1..2048 pre-Overwinter public prefix includes legacy v1/v2 public transaction projections; it is not a genesis-to-current-tip or decrypted shielded workload result.',
    'No external indexer speed ranking is produced; equivalence requires the same durable entity workload.'
  ]
};
await mkdir(dirname(reportPath), { recursive: true });
// Exclusive creation protects previous evidence, including incomplete runs.
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const save = async () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
const rpc = async (method, params) => {
  const response = await fetch(sourceUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
  assert(response.ok, 'ORACLE_HTTP_FAILURE');
  const raw = await response.text(); assert(Buffer.byteLength(raw) <= 16 * 1024 * 1024, 'ORACLE_RESPONSE_TOO_LARGE');
  const body = JSON.parse(raw); assert(!body.error && Object.hasOwn(body, 'result'), 'ORACLE_RPC_FAILURE'); return body.result;
};
const anchor = async () => {
  const info = await rpc('getblockchaininfo', []);
  assert(['main', 'mainnet'].includes(info.chain) && info.blocks === manifest.end_height && info.bestblockhash === manifest.end_hash, 'FROZEN_SOURCE_MISMATCH');
  assert(await rpc('getblockhash', [0]) === manifest.genesis_hash, 'GENESIS_MISMATCH');
  return { height: info.blocks, hash: info.bestblockhash };
};
const projectPrefix = `bench_${randomBytes(8).toString('hex')}`;
let pool;
try {
  const oracleStart = performance.now();
  report.source_before = await anchor();
  const oracleBlocks = new Map(), oracleTransactions = new Map();
  let parent = manifest.genesis_hash;
  for (let height = 1; height <= end; height++) {
    oracleSignal.throwIfAborted();
    const hash = await rpc('getblockhash', [height]);
    const block = await rpc('getblock', [hash, 1]);
    assert(block.hash === hash && block.height === height && block.previousblockhash === parent && Array.isArray(block.tx) && block.tx.length > 0, 'ORACLE_BLOCK_MISMATCH');
    oracleBlocks.set(String(height), { id: String(height), hash, time: String(block.time), transactionCount: block.tx.length });
    for (const txid of block.tx) {
      oracleSignal.throwIfAborted();
      report.oracle_position = { height, txid: typeof txid === 'string' && /^[0-9a-f]{64}$/.test(txid) ? txid : null };
      assert(typeof txid === 'string' && /^[0-9a-f]{64}$/.test(txid) && !oracleTransactions.has(txid), 'ORACLE_TRANSACTION_ID');
      const tx = await rpc('getrawtransaction', [txid, 1]);
      assert(tx.txid === txid && tx.blockhash === hash && [1, 2].includes(tx.version) && Number.isInteger(tx.locktime) && tx.locktime >= 0 && tx.locktime <= 0xffffffff && typeof tx.hex === 'string' && /^[0-9a-f]+$/i.test(tx.hex) && tx.hex.length >= 20 && tx.hex.length % 2 === 0 && Array.isArray(tx.vin) && Array.isArray(tx.vout), 'ORACLE_TRANSACTION_INVALID');
      const raw = Buffer.from(tx.hex, 'hex');
      const digest = createHash('sha256').update(createHash('sha256').update(raw).digest()).digest().reverse().toString('hex');
      // v2 can append JoinSplit fields after nLockTime; only v1 ends at locktime.
      assert(digest === txid && raw.readUInt32LE(0) === tx.version && (tx.version !== 1 || raw.readUInt32LE(raw.length - 4) === tx.locktime), 'ORACLE_RAW_IDENTITY_MISMATCH');
      oracleTransactions.set(txid, { id: txid, minedHeight: height, version: tx.version, locktime: String(tx.locktime), sizeBytes: raw.length,
        transparentInputCount: tx.vin.length, transparentOutputCount: tx.vout.length });
    }
    parent = hash;
  }
  // Retained manifest adds a previously independent seven-field check to the fresh oracle.
  for (const row of manifest.records) {
    const actual = oracleTransactions.get(row.txid);
    assert(equal(actual, { id: row.txid, minedHeight: row.mined_height, version: row.version, locktime: String(row.locktime), sizeBytes: row.size_bytes,
      transparentInputCount: row.transparent_input_count, transparentOutputCount: row.transparent_output_count }), 'MANIFEST_ORACLE_MISMATCH');
  }
  report.phases.oracle_collection_ms = performance.now() - oracleStart;
  const oracleOutput = JSON.stringify({ source: report.source_before, range: { from: 1, to: end },
    blocks: [...oracleBlocks.values()], transactions: [...oracleTransactions.values()] }, null, 2) + '\n';
  const oraclePath = reportPath + '.oracle.json';
  await writeFile(oraclePath, oracleOutput, { flag: 'wx' });
  report.oracle = { blocks: oracleBlocks.size, transactions: oracleTransactions.size,
    file: oraclePath, sha256: sha(oracleOutput) };
  pool = new pg.Pool({ connectionString: dsn, max: 1, connectionTimeoutMillis: 5000 });
  pool.on('error', () => {});
  // A single TCP client connection and explicit query timeout for verification.
  await pool.query('SET statement_timeout = 20000');
  const client = sourceMode === 'rpc'
    ? new FrozenRpcSource({ url: sourceUrl.href, headHeight: manifest.end_height, headHash: manifest.end_hash, signal: controller.signal })
    : new PrepClient({ url: prepUrl, ...(process.env[config.prepTokenEnv ?? 'PREP_API_TOKEN'] ? { token: process.env[config.prepTokenEnv ?? 'PREP_API_TOKEN'] } : {}) });
  if (sourceMode === 'rpc') report.limitations.push('RPC source adapter uses sequential getblockhash + getblock verbosity 2 for full data, verbosity 1 for headers, one in-flight request, and native JSON source-token preservation. It is not a production Chef source adapter.');
  for (let index = 1; index <= repetitions; index++) {
    const project = `${projectPrefix}_${index}`;
    assert(/^[a-z][a-z0-9_]{0,31}$/.test(project), 'INVALID_GENERATED_PROJECT');
    const namespace = `chef_${project}`, sql = `"${namespace}"`;
    assert((await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [namespace])).rowCount === 0, 'NAMESPACE_ALREADY_EXISTS');
    const reorgWindow = config.reorgWindow ?? 100;
    const fingerprint = sha(Buffer.concat([configBytes, Buffer.from(JSON.stringify({ model: model.fingerprint, project, prepUrl, reorgWindow, ...(sourceMode === 'rpc' ? { sourceMode, sourceUrl: sourceUrl.href } : {}) }))]));
    const options = { project, network: config.network, startHeight: 1, reorgWindow, model, fingerprint };
    let store = new PostgresStore(dsn, options), sampler, runStarted;
    const run = { repetition: index, project, namespace, fingerprint, status: 'INITIALIZING', started_at: new Date().toISOString(),
      blocks: 0, transactions: 0, fetch_ms: 0, handler_including_entity_io_ms: 0, transaction_overhead_ms: 0, pages: [] };
    report.runs.push(run); await save();
    try {
      run.source_before = await anchor();
      const migrateStarted = performance.now(); await store.migrate(); await store.acquire();
      run.initialization_ms = performance.now() - migrateStarted;
      const checkpoint = await store.checkpoint();
      assert(checkpoint.height === null && checkpoint.hash === null && checkpoint.anchorHash === null, 'INITIAL_CHECKPOINT_NOT_EMPTY');
      assert(Number((await pool.query(`SELECT count(*) AS n FROM ${sql}.entities`)).rows[0].n) === 0, 'INITIAL_ENTITIES_NOT_EMPTY');
      run.status = 'INDEXING';
      const usageBefore = process.resourceUsage();
      const requestsBefore = client.requests ?? null, bytesBefore = client.responseBytes ?? null;
      let peakRss = process.memoryUsage().rss;
      sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 25);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutSeconds * 1000)]);
      const sqlBefore = sqlRequests;
      runStarted = performance.now();
      while (true) {
        signal.throwIfAborted();
        const step = await syncStep({ client, store, indexer: config.indexer, network: config.network, startHeight: 1, reorgWindow, pageSize, signal }, end);
        assert(step.state === 'progress', 'REQUESTED_RANGE_UNAVAILABLE_OR_INCOMPLETE');
        run.blocks += step.blocks; run.transactions += step.transactions;
        run.fetch_ms += step.fetchMs; run.handler_including_entity_io_ms += step.handlerIncludingEntityIoMs; run.transaction_overhead_ms += step.transactionOverheadMs;
        run.last_committed_height = step.height;
        run.pages.push({ ...step, elapsed_ms: performance.now() - runStarted });
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        if (step.height === end) break;
      }
      run.elapsed_ms = performance.now() - runStarted;
      run.sql_requests = sqlRequests - sqlBefore;
      if (sourceMode === 'rpc') { run.source_rpc_requests = client.requests - requestsBefore; run.source_response_bytes = client.responseBytes - bytesBefore; }
      const usageAfter = process.resourceUsage(); clearInterval(sampler); sampler = undefined;
      run.cpu_user_ms = (usageAfter.userCPUTime - usageBefore.userCPUTime) / 1000;
      run.cpu_system_ms = (usageAfter.systemCPUTime - usageBefore.systemCPUTime) / 1000;
      run.sampled_peak_rss_bytes = peakRss;
      run.process_lifetime_max_rss_bytes = usageAfter.maxRSS * 1024;
      run.blocks_per_second = run.blocks / (run.elapsed_ms / 1000);
      run.committed_transactions_per_second = run.transactions / (run.elapsed_ms / 1000);
      run.status = 'COMMITTED_UNVERIFIED'; await save();
      // Reopen after release: successful COMMIT alone does not substitute for persisted-output verification.
      await store.close(); store = new PostgresStore(dsn, options);
      const verificationStarted = performance.now();
      const final = await store.checkpoint();
      assert(final.height === end && final.hash === parent && final.status === 'ready', 'FINAL_CHECKPOINT_MISMATCH');
      const rows = (await pool.query(`SELECT entity,id,data FROM ${sql}.entities ORDER BY entity,id`)).rows;
      let blocks = 0, transactions = 0;
      for (const row of rows) {
        const expected = row.entity === 'Block' ? oracleBlocks.get(row.id) : row.entity === 'PublicTransaction' ? oracleTransactions.get(row.id) : undefined;
        assert(expected && Object.keys(row.data).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => row.data[key] === value), 'PERSISTED_ENTITY_MISMATCH');
        if (row.entity === 'Block') blocks++; else transactions++;
      }
      assert(blocks === end && transactions === oracleTransactions.size && run.blocks === blocks && run.transactions === transactions, 'PERSISTED_COUNTS_MISMATCH');
      run.persisted_verification_ms = performance.now() - verificationStarted;
      run.persisted_blocks = blocks; run.persisted_transactions = transactions; run.persisted_entities = rows.length;
      const footprint = await pool.query('SELECT coalesce(sum(pg_total_relation_size(c.oid)),0)::text AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN (\'r\',\'m\')', [namespace]);
      run.namespace_relation_bytes = footprint.rows[0].bytes;
      const graphqlStarted = performance.now(), token = randomBytes(24).toString('hex');
      const server = createChefServer({ store, model, token });
      await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
      try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ query: 'query($id: ID!) { _meta { height hash status } PublicTransactionById(id:$id) { id minedHeight version locktime sizeBytes transparentInputCount transparentOutputCount } }', variables: { id: manifest.records[0].txid } }), signal: AbortSignal.timeout(20000) });
        const body = await response.json();
        assert(response.ok && !body.errors && body.data._meta.height === end && body.data._meta.hash === parent && body.data._meta.status === 'ready' && equal(body.data.PublicTransactionById, oracleTransactions.get(manifest.records[0].txid)), 'GRAPHQL_VERIFICATION_FAILED');
      } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
      run.graphql_validation_ms = performance.now() - graphqlStarted;
      run.ingestion_to_verified_graphql_ms = performance.now() - runStarted;
      run.source_after = await anchor();
      run.status = 'PASS';
    } catch (error) {
      run.status = controller.signal.aborted ? 'INTERRUPTED' : 'FAIL';
      run.failure_code = /^[A-Z_]+$/.test(error.message) ? error.message : 'BENCHMARK_RUN_FAILED';
      if (runStarted && run.elapsed_ms === undefined) run.partial_elapsed_ms = performance.now() - runStarted;
      run.checkpoint_after_failure = await store.checkpoint().catch(() => null);
      run.last_committed_height = run.checkpoint_after_failure?.height ?? run.last_committed_height ?? null;
      throw error;
    } finally {
      if (sampler) clearInterval(sampler);
      await store.close(); run.finished_at = new Date().toISOString(); await save();
    }
  }
  const values = report.runs.map(run => run.elapsed_ms).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  report.summary = { repetitions, elapsed_ms_min: values[0], elapsed_ms_median: median, elapsed_ms_max: values.at(-1),
    blocks: end, transactions: report.oracle.transactions, committed_transactions_per_second_median: report.oracle.transactions / (median / 1000) };
  report.source_after = await anchor(); report.status = 'PASS';
} catch (error) {
  report.status = controller.signal.aborted ? 'INTERRUPTED' : 'FAIL';
  report.failure_code = /^[A-Z_]+$/.test(error.message) ? error.message : 'BENCHMARK_FAILED';
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
  report.finished_at = new Date().toISOString(); await save();
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
  pg.Client.prototype.query = originalQuery;
}
process.stdout.write(JSON.stringify({ status: report.status, report: reportPath, summary: report.summary, failure_code: report.failure_code }) + '\n');
