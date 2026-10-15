#!/usr/bin/env node
// Real Prep -> public-example handlers -> fresh PostgreSQL namespace, with paced actual commits.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import pg from 'pg';
import { PrepClient } from '@zeer/prep-client';
import { PostgresStore, parseModel, encodeEntity, syncStep } from '@zeer/chef';
import { check, hash, digest, publicFixture } from '../chef/query/fixture.mjs';

export function privateOrigin(value) {
  const url = new URL(value), host = url.hostname;
  check(url.protocol === 'http:' && isIP(host) === 4 && !url.username && !url.password
    && !url.search && !url.hash && url.pathname === '/', 'PRIVATE_NUMERIC_HTTP_ORIGIN_REQUIRED');
  const octets = host.split('.').map(Number);
  check(octets[0] === 127 || octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168), 'PRIVATE_NUMERIC_HTTP_ORIGIN_REQUIRED');
  return url.origin;
}

export function ignoredPath(value, root) {
  const path = resolve(value), within = relative(resolve(root, 'benchmarks/results'), path);
  check(within && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within), 'PATH_MUST_BE_IGNORED_RESULTS');
  return path;
}

export function cleanupFailures(results, names) {
  return results.flatMap((result, index) => result.status === 'rejected'
    ? [{ resource: names[index], errorName: /^[A-Za-z][A-Za-z0-9]*$/.test(result.reason?.name) ? result.reason.name : 'CleanupError' }] : []);
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const flags = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    check(['--oracle', '--out', '--start-file', '--prep-url', '--port', '--config', '--schema', '--source',
      '--dsn-env', '--token-env', '--prep-token-env', '--initial-height', '--end-height', '--page-size', '--delay-ms', '--max-seconds', '--source-timeout-ms'].includes(key)
      && !flags.has(key) && value && !value.startsWith('--'), 'INVALID_ARGUMENT');
    flags.set(key, value);
  }
  for (const key of ['--oracle', '--out', '--start-file', '--prep-url', '--port']) check(flags.has(key), 'REQUIRED_ARGUMENT');
  const integer = (key, fallback, min, max) => {
    const value = flags.get(key) ?? String(fallback); check(/^(0|[1-9][0-9]*)$/.test(value), 'INVALID_INTEGER');
    const n = Number(value); check(Number.isSafeInteger(n) && n >= min && n <= max, 'INTEGER_OUTSIDE_BOUNDS'); return n;
  };
  const initial = integer('--initial-height', 128, 1, 2047), end = integer('--end-height', 2048, initial + 1, 2048);
  const pageSize = integer('--page-size', 16, 1, 100), delayMs = integer('--delay-ms', 50, 0, 1000);
  const maxSeconds = integer('--max-seconds', 120, 10, 600), port = integer('--port', 39380, 1024, 65535);
  const sourceTimeoutMs = integer('--source-timeout-ms', 30000, 100, 30000);
  const output = ignoredPath(flags.get('--out'), root), startFile = ignoredPath(flags.get('--start-file'), root);
  check(output !== startFile, 'OUTPUT_AND_START_MUST_DIFFER');
  for (const path of [output, startFile]) {
    let exists = false; try { await access(path); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    check(!exists, 'OUTPUT_OR_START_ALREADY_EXISTS');
  }
  const dsn = process.env[flags.get('--dsn-env') ?? 'CHEF_QUERY_DATABASE_URL'];
  const token = process.env[flags.get('--token-env') ?? 'CHEF_API_TOKEN'];
  const prepToken = process.env[flags.get('--prep-token-env') ?? 'PREP_API_TOKEN'];
  check(dsn && token && Buffer.byteLength(token) >= 16 && prepToken, 'DATABASE_AND_AUTH_ENV_REQUIRED');
  const prepUrl = privateOrigin(flags.get('--prep-url'));
  const configPath = resolve(flags.get('--config') ?? resolve(root, 'examples/chef-public/chef.config.ts'));
  const configRaw = await readFile(configPath), config = (await import(pathToFileURL(configPath).href)).default;
  check(config.network === 'mainnet' && config.startHeight === 1 && config.indexer && config.handlerVersion === '1', 'PUBLIC_MAINNET_CONFIG_REQUIRED');
  const schemaPath = resolve(flags.get('--schema') ?? resolve(dirname(configPath), config.schema));
  const schemaRaw = await readFile(schemaPath, 'utf8'), model = parseModel(schemaRaw);
  check(model.entities.Block && model.entities.PublicTransaction, 'PUBLIC_PROJECTION_MODEL_REQUIRED');
  const oracleRaw = await readFile(resolve(flags.get('--oracle')));
  const oracle = JSON.parse(flags.get('--oracle').endsWith('.gz') ? gunzipSync(oracleRaw) : oracleRaw);
  check(oracle.range.from === 1 && oracle.range.to === end, 'EXACT_ORACLE_RANGE_REQUIRED');
  const fixture = publicFixture(oracle);
  check(fixture.blocks.length === end && [...fixture.blocks].sort((a, b) => Number(a.id) - Number(b.id))
    .every((row, index) => row.id === String(index + 1)), 'CONTIGUOUS_ORACLE_BLOCKS_REQUIRED');
  const expectedRows = [...fixture.blocks.map(data => ({ entity: 'Block', id: data.id, data: encodeEntity(model, 'Block', data) })),
    ...fixture.transactions.map(data => ({ entity: 'PublicTransaction', id: data.id, data: encodeEntity(model, 'PublicTransaction', data) }))]
    .sort((a, b) => a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const project = `ingest_${randomBytes(8).toString('hex')}`, namespace = `chef_${project}`;
  const options = { project, network: 'mainnet', startHeight: 1, reorgWindow: config.reorgWindow,
    model, fingerprint: digest({ schema: model.fingerprint, config: hash(configRaw), oracle: hash(oracleRaw), project }) };
  const source = resolve(flags.get('--source') ?? resolve(root, 'packages/chef/dist/graphql.js'));
  const { createChefServer } = await import(pathToFileURL(source).href);
  const writer = new PostgresStore(dsn, options), reader = new PostgresStore(dsn, options);
  const admin = new pg.Client({ connectionString: dsn, connectionTimeoutMillis: 5000 });
  const client = new PrepClient({ url: prepUrl, token: prepToken, timeoutMs: sourceTimeoutMs });
  const abort = new AbortController(), deadline = AbortSignal.timeout(maxSeconds * 1000);
  const signal = AbortSignal.any([abort.signal, deadline]);
  const report = { format: 'chef-active-ingest-v1', status: 'RUNNING', startedUnixMs: Date.now(), namespace,
    options: { ...options, model: undefined }, input: { oracleSha256: hash(oracleRaw), configSha256: hash(configRaw),
      schemaSha256: hash(schemaRaw), serverSourceSha256: hash(await readFile(source)), source: oracle.source,
      expectedEntityDigest: digest(expectedRows), blocks: fixture.blocks.length, transactions: fixture.transactions.length },
    settings: { initialHeight: initial, endHeight: end, pageSize, delayMs, maxSeconds, sourceTimeoutMs }, steps: [],
    limitations: ['Actual syncStep fetches full decoded public blocks from a prebuilt immutable private Prep source and invokes the existing public example handlers.',
      'Delay paces real PostgreSQL page commits for an append-only consistency experiment; ingestion speed here is intentionally paced.',
      'Final all-row verification occurs after writer completion. Namespace is retained. No reorg, crash durability or public broadcast is asserted.',
      'AbortSignal bounds source requests and pacing, not every SQL/cleanup call. Run in an outer systemd unit with RuntimeMaxSec, TimeoutStopSec and KillMode=control-group for a hard complete-process bound.'] };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const save = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
  const server = createChefServer({ store: reader, model, token });
  let connected = false, timer;
  const stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const pause = ms => new Promise((done, reject) => {
    signal.throwIfAborted(); const timeout = setTimeout(() => { signal.removeEventListener('abort', onAbort); done(); }, ms);
    const onAbort = () => { clearTimeout(timeout); reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const sourceIdentity = meta => ({ network: meta.network, epoch: meta.epoch, revision: meta.revision, archive_height: meta.archive_height, payload_kind: meta.payload_kind, ready: meta.ready });
  const runTo = async (target, paced) => {
    while ((await writer.checkpoint()).height < target) {
      signal.throwIfAborted();
      const startedUnixMs = Date.now();
      const step = await syncStep({ client, store: writer, indexer: config.indexer, network: 'mainnet', startHeight: 1,
        reorgWindow: options.reorgWindow, pageSize, signal }, target);
      check(step.state === 'progress' && step.blocks > 0, 'INGEST_DID_NOT_ADVANCE');
      const checkpoint = await writer.checkpoint();
      check(checkpoint.height === step.height && checkpoint.status === 'ready', 'WRITER_CHECKPOINT_NOT_READY');
      const expectedBlock = fixture.blocks.find(row => Number(row.id) === checkpoint.height);
      check(checkpoint.hash === expectedBlock.hash, 'WRITER_CHECKPOINT_HASH_MISMATCH');
      const event = { stage: paced ? 'active_append' : 'warmup', startedUnixMs, completedUnixMs: Date.now(), step, checkpoint };
      report.steps.push(event); await save();
      console.log(JSON.stringify({ event: 'COMMITTED_PAGE', ...event }));
      if (paced && checkpoint.height < target) await pause(delayMs);
    }
  };
  try {
    await admin.connect(); connected = true; await admin.query('SET statement_timeout=30000');
    check(!(await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [namespace])).rowCount, 'NAMESPACE_ALREADY_EXISTS');
    report.databaseSettings = (await admin.query("SELECT name,setting FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','server_version') ORDER BY name")).rows;
    for (const name of ['fsync', 'synchronous_commit', 'full_page_writes']) check(report.databaseSettings.find(row => row.name === name).setting === 'on', 'DURABLE_POSTGRES_SETTINGS_REQUIRED');
    const meta = await client.getHeight({ signal });
    check(meta.ready && meta.network === 'mainnet' && meta.payload_kind === 'full-v1' && meta.start_block === 1 && meta.archive_height >= end, 'READY_COMPLETE_PREP_SOURCE_REQUIRED');
    report.sourceBefore = sourceIdentity(meta);
    await writer.migrate(); await writer.acquire();
    await runTo(initial, false);
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
    report.readyUnixMs = Date.now(); report.initialCheckpoint = await reader.checkpoint(); await save();
    console.log(JSON.stringify({ event: 'READY', endpoint: `http://127.0.0.1:${port}`, namespace, checkpoint: report.initialCheckpoint, startFile }));
    while (true) {
      signal.throwIfAborted();
      let raw;
      try { raw = await readFile(startFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (raw !== undefined) {
        const release = JSON.parse(raw);
        check(release.event === 'load_preflight_passed' && typeof release.unix_ns === 'string' && /^[1-9][0-9]{15,24}$/.test(release.unix_ns)
          && Number.isSafeInteger(release.unix_ms) && Math.abs(Date.now() - release.unix_ms) < maxSeconds * 1000
          && typeof release.report === 'string', 'INVALID_LOAD_RELEASE_SIGNAL');
        report.release = release; break;
      }
      await pause(20);
    }
    report.activeStartedUnixMs = Date.now(); await save();
    await runTo(end, true);
    report.activeCompletedUnixMs = Date.now();
    report.sourceAfter = sourceIdentity(await client.getHeight({ signal }));
    check(digest(report.sourceAfter) === digest(report.sourceBefore), 'PREP_SOURCE_CHANGED');
    const verifyStart = performance.now();
    await admin.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const rows = (await admin.query(`SELECT entity,id,data FROM "${namespace}".entities ORDER BY entity COLLATE "C",id COLLATE "C"`)).rows;
      const checkpoint = (await admin.query(`SELECT height,hash,status FROM "${namespace}".state WHERE singleton=true`)).rows[0];
      check(rows.length === expectedRows.length && digest(rows) === report.input.expectedEntityDigest, 'ALL_FINAL_ROWS_DIFFER_FROM_ORACLE');
      check(Number(checkpoint.height) === end && checkpoint.hash === fixture.head.hash && checkpoint.status === 'ready', 'FINAL_DATABASE_CHECKPOINT_MISMATCH');
      report.finalProof = { rows: rows.length, entityDigest: digest(rows), checkpoint, elapsedMs: performance.now() - verifyStart };
      await admin.query('COMMIT');
    } catch (error) { await admin.query('ROLLBACK'); throw error; }
    report.stage = 'writer_verified_serving'; report.writerDoneUnixMs = Date.now(); await save();
    console.log(JSON.stringify({ event: 'WRITER_DONE', namespace, finalProof: report.finalProof }));
    // Keep the final ready checkpoint available for client postflight until signal/lifetime.
    await new Promise(done => {
      if (signal.aborted) return done();
      signal.addEventListener('abort', done, { once: true });
      timer = setTimeout(done, maxSeconds * 1000);
    });
  } catch (error) {
    report.status = 'FAIL'; report.failureCode = /^[A-Z_]+$/.test(error?.message) ? error.message : error?.name ?? 'INGEST_FAILED';
    process.exitCode = 1;
  } finally {
    clearTimeout(timer); abort.abort(); server.closeAllConnections();
    if (server.listening) await new Promise(done => server.close(done));
    const names = ['writer', 'reader', ...(connected ? ['admin'] : [])];
    const results = await Promise.allSettled([writer.close(), reader.close(), ...(connected ? [admin.end()] : [])]);
    report.cleanupFailures = cleanupFailures(results, names);
    if (report.cleanupFailures.length) { report.status = 'FAIL'; report.failureCode = 'OWNED_RESOURCE_CLEANUP_FAILED'; process.exitCode = 1; }
    else if (report.writerDoneUnixMs && report.status !== 'FAIL') report.status = 'PASS';
    report.closedUnixMs = Date.now(); await save();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
