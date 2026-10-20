#!/usr/bin/env node
// Real Prep -> public-example handlers -> fresh PostgreSQL namespace, with paced actual commits.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import pg from 'pg';
import { PrepClient } from '@zeer-dev/prep-client';
import { PostgresStore, parseModel, encodeEntity, syncStep } from '@zeer-dev/chef';
import { isSourceUnavailable } from '../../packages/chef/dist/runtime.js';
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

/** Inclusive captured range; a short range reserves at least half for active appends. */
export function ingestRange(oracle, initialHeight, endHeight) {
  const start = oracle?.range?.from, end = oracle?.range?.to;
  check(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 1
    && end <= 0xffff_fffe && end > start && end - start + 1 <= 32768, 'BOUNDED_ORACLE_RANGE_REQUIRED');
  check(endHeight === undefined || endHeight === end, 'EXACT_ORACLE_RANGE_REQUIRED');
  const initial = initialHeight ?? start + Math.min(128, Math.floor((end - start + 1) / 2)) - 1;
  check(Number.isSafeInteger(initial) && initial >= start && initial < end, 'INITIAL_HEIGHT_OUTSIDE_ORACLE_PREFIX');
  return { start, end, initial };
}

export function contiguousFixture(oracle) {
  const { start, end } = ingestRange(oracle);
  const fixture = publicFixture(oracle);
  check(fixture.blocks.length === end - start + 1 && [...fixture.blocks].sort((a, b) => Number(a.id) - Number(b.id))
    .every((row, index) => row.id === String(start + index)), 'CONTIGUOUS_ORACLE_BLOCKS_REQUIRED');
  return fixture;
}

/** Follow mode retries only the runtime's classified source errors and idle states. */
export function ingestDecision(step, followSource, error) {
  if (error !== undefined) {
    if (followSource && isSourceUnavailable(error)) return 'wait';
    throw error;
  }
  if (step?.state === 'progress' && step.blocks > 0) return 'commit';
  if (followSource && step?.blocks === 0 && ['caught_up', 'source_unavailable'].includes(step.state)) return 'wait';
  throw new Error('INGEST_DID_NOT_ADVANCE');
}

export function verifyProgressCheckpoint(step, checkpoint, expectedBlock, followSource) {
  check(checkpoint.height === step.height && (checkpoint.status === 'ready'
    || (followSource && checkpoint.status === 'reconciling')), 'WRITER_CHECKPOINT_NOT_READY');
  check(expectedBlock && checkpoint.hash === expectedBlock.hash, 'WRITER_CHECKPOINT_HASH_MISMATCH');
}

export function sameSource(before, after, followSource, end) {
  if (!followSource) return digest(after) === digest(before);
  return after.network === before.network && after.epoch === before.epoch
    && after.payload_kind === before.payload_kind && after.ready === true
    && Number.isSafeInteger(after.archive_height) && after.archive_height >= Math.max(end, before.archive_height)
    && /^[0-9]+$/.test(String(before.revision)) && /^[0-9]+$/.test(String(after.revision))
    && BigInt(after.revision) >= BigInt(before.revision);
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const flags = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    check(['--oracle', '--out', '--start-file', '--prep-url', '--port', '--config', '--schema', '--source',
      '--follow-source', '--dsn-env', '--token-env', '--prep-token-env', '--initial-height', '--end-height', '--page-size', '--delay-ms', '--max-seconds', '--source-timeout-ms'].includes(key)
      && !flags.has(key) && value && !value.startsWith('--'), 'INVALID_ARGUMENT');
    flags.set(key, value);
  }
  for (const key of ['--oracle', '--out', '--start-file', '--prep-url', '--port']) check(flags.has(key), 'REQUIRED_ARGUMENT');
  const integer = (key, fallback, min, max) => {
    const value = flags.get(key) ?? String(fallback); check(/^(0|[1-9][0-9]*)$/.test(value), 'INVALID_INTEGER');
    const n = Number(value); check(Number.isSafeInteger(n) && n >= min && n <= max, 'INTEGER_OUTSIDE_BOUNDS'); return n;
  };
  check(!flags.has('--follow-source') || ['true', 'false'].includes(flags.get('--follow-source')), 'INVALID_FOLLOW_SOURCE');
  const followSource = flags.get('--follow-source') === 'true';
  const sourcePollMs = 100;
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
  check(config.network === 'mainnet' && Number.isSafeInteger(config.startHeight) && config.startHeight >= 1
    && config.indexer && config.handlerVersion === '1', 'PUBLIC_MAINNET_CONFIG_REQUIRED');
  const schemaPath = resolve(flags.get('--schema') ?? resolve(dirname(configPath), config.schema));
  const schemaRaw = await readFile(schemaPath, 'utf8'), model = parseModel(schemaRaw);
  check(model.entities.Block && model.entities.PublicTransaction, 'PUBLIC_PROJECTION_MODEL_REQUIRED');
  const oracleRaw = await readFile(resolve(flags.get('--oracle')));
  const oracle = JSON.parse(flags.get('--oracle').endsWith('.gz') ? gunzipSync(oracleRaw) : oracleRaw);
  const { start, end, initial } = ingestRange(oracle,
    flags.has('--initial-height') ? integer('--initial-height', 0, 1, 0xffff_fffe) : undefined,
    flags.has('--end-height') ? integer('--end-height', 0, 1, 0xffff_fffe) : undefined);
  const fixture = contiguousFixture(oracle);
  const blockByHeight = new Map(fixture.blocks.map(row => [Number(row.id), row]));
  const expectedRows = [...fixture.blocks.map(data => ({ entity: 'Block', id: data.id, data: encodeEntity(model, 'Block', data) })),
    ...fixture.transactions.map(data => ({ entity: 'PublicTransaction', id: data.id, data: encodeEntity(model, 'PublicTransaction', data) }))]
    .sort((a, b) => a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const project = `ingest_${randomBytes(8).toString('hex')}`, namespace = `chef_${project}`;
  const options = { project, network: 'mainnet', startHeight: start, reorgWindow: config.reorgWindow,
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
    settings: { startHeight: start, initialHeight: initial, endHeight: end, pageSize, delayMs, maxSeconds, sourceTimeoutMs, followSource, sourcePollMs }, steps: [],
    limitations: [followSource
      ? 'Actual syncStep follows an append-only private Prep source and invokes the existing public example handlers. Only known runtime source-unavailable errors and idle states are polled; all waits share the lifetime bound.'
      : 'Actual syncStep fetches full decoded public blocks from a prebuilt immutable private Prep source and invokes the existing public example handlers.',
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
    while (((await writer.checkpoint()).height ?? start - 1) < target) {
      signal.throwIfAborted();
      const startedUnixMs = Date.now();
      let step, decision;
      try {
        step = await syncStep({ client, store: writer, indexer: config.indexer, network: 'mainnet', startHeight: start,
          reorgWindow: options.reorgWindow, pageSize, signal }, target);
      } catch (error) {
        signal.throwIfAborted();
        decision = ingestDecision(undefined, followSource, error);
        step = { state: 'source_error', errorName: /^[A-Za-z][A-Za-z0-9]*$/.test(error?.name) ? error.name : 'SourceError' };
      }
      decision ??= ingestDecision(step, followSource);
      if (step.sourceEpoch !== undefined) check(step.sourceEpoch === report.sourceBefore.epoch, 'PREP_SOURCE_CHANGED');
      if (decision === 'wait') {
        const event = { stage: paced ? 'active_wait' : 'warmup_wait', startedUnixMs, completedUnixMs: Date.now(), step,
          checkpoint: await writer.checkpoint() };
        report.steps.push(event); await save();
        console.log(JSON.stringify({ event: 'WAITING_FOR_SOURCE', ...event }));
        await pause(sourcePollMs);
        continue;
      }
      const checkpoint = await writer.checkpoint();
      verifyProgressCheckpoint(step, checkpoint, blockByHeight.get(checkpoint.height), followSource);
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
    check(meta.ready && meta.network === 'mainnet' && meta.payload_kind === 'full-v1' && meta.start_block <= start && meta.archive_height >= (followSource ? initial : end), 'READY_COMPLETE_PREP_SOURCE_REQUIRED');
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
    check(sameSource(report.sourceBefore, report.sourceAfter, followSource, end), 'PREP_SOURCE_CHANGED');
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
