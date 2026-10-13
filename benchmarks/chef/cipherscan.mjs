#!/usr/bin/env node
// Native, unmodified CipherScan ingestion. Separate workload, never a framework ranking.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import pg from 'pg';

const check = (ok, code) => { if (!ok) throw new Error(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const redact = text => text.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_DATABASE_URL]');
const args = new Map();
const allowed = ['--oracle', '--out', '--binary', '--state', '--schema', '--runtime-image', '--admin-dsn-env', '--docker-network', '--pg-container', '--source-container', '--timeout-seconds'];
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  check(allowed.includes(key) && !args.has(key) && value && !value.startsWith('--'), 'INVALID_ARGUMENT'); args.set(key, value);
}
for (const name of ['--oracle', '--out', '--binary', '--state', '--schema', '--runtime-image']) check(args.has(name), 'MISSING_ARGUMENT');
const path = resolve(args.get('--out')), binary = resolve(args.get('--binary')), state = resolve(args.get('--state'));
const schemaBytes = await readFile(resolve(args.get('--schema'))), binaryBytes = await readFile(binary);
const expectedBinary = '67932d9a4a2cf545ddeefefa785a007cc925b09884b8f18b703cb89598b2a735';
check(sha(binaryBytes) === expectedBinary, 'NATIVE_BINARY_PIN_MISMATCH');
const oracleBytes = await readFile(resolve(args.get('--oracle')));
const oracle = JSON.parse((args.get('--oracle').endsWith('.gz') ? gunzipSync(oracleBytes) : oracleBytes).toString('utf8'));
check(oracle.range.from === 1 && oracle.range.to === 2048 && oracle.source.height === 6764 && oracle.blocks.length === 2048 && oracle.transactions.length === 16962, 'ORACLE_RANGE_MISMATCH');
const expectedBlocks = new Map(oracle.blocks.map(row => [row.id, row])), expectedTransactions = new Map(oracle.transactions.map(row => [row.id, row]));
check(expectedBlocks.size === 2048 && expectedTransactions.size === 16962, 'ORACLE_DUPLICATE_ROWS');
const adminDsn = process.env[args.get('--admin-dsn-env') ?? 'DATABASE_URL']; check(adminDsn, 'ADMIN_DSN_REQUIRED');
const adminUrl = new URL(adminDsn);
// This runner is deliberately bound to root's dedicated Chef benchmark instance.
check(['postgres:', 'postgresql:'].includes(adminUrl.protocol) && ['127.0.0.1', 'localhost'].includes(adminUrl.hostname) && adminUrl.port === '39460', 'DEDICATED_PG_PORT_REQUIRED');
const pgContainer = args.get('--pg-container') ?? 'zeer-chef-pg';
check(pgContainer === 'zeer-chef-pg', 'DEDICATED_PG_CONTAINER_REQUIRED');
const network = args.get('--docker-network') ?? 'zeer-chef-cs';
check(/^zeer-chef-cs(?:-[a-z0-9]+)?$/.test(network), 'DEDICATED_NETWORK_REQUIRED');
const sourceContainer = args.get('--source-container') ?? 'zeer-bench-four-frozen';
check(sourceContainer === 'zeer-bench-four-frozen', 'FROZEN_SOURCE_CONTAINER_REQUIRED');
const timeout = Number(args.get('--timeout-seconds') ?? 1800);
check(Number.isInteger(timeout) && timeout >= 1 && timeout <= 7200, 'INVALID_TIMEOUT');
const docker = (values, options = {}) => new Promise((done, reject) => {
  const child = spawn('docker', values, { env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; if (stdout.length > 16 * 1024 * 1024) child.kill(); });
  child.stderr.on('data', bytes => { stderr += bytes; if (stderr.length > 16 * 1024 * 1024) child.kill(); });
  child.once('error', reject);
  child.once('close', (code, signal) => done({ code, signal, stdout: redact(stdout), stderr: redact(stderr) }));
});
const inspect = async name => {
  const output = await docker(['inspect', name]); check(output.code === 0, 'DOCKER_INSPECT_FAILED'); return JSON.parse(output.stdout)[0];
};
const pgInfo = await inspect(pgContainer);
check(pgInfo.State.Running && pgInfo.NetworkSettings.Ports['5432/tcp']?.some(binding => binding.HostPort === '39460' && ['127.0.0.1', '::1'].includes(binding.HostIp)), 'DEDICATED_PG_BINDING_MISMATCH');
check(pgInfo.NetworkSettings.Networks[network]?.Aliases?.includes('chef-pg'), 'DEDICATED_PG_NETWORK_ALIAS_REQUIRED');
check(!(await inspect(sourceContainer)).State.Running, 'STOP_FROZEN_NODE_BEFORE_SECONDARY_BACKFILL');
const netInfo = await docker(['network', 'inspect', network]); check(netInfo.code === 0 && JSON.parse(netInfo.stdout)[0].Internal, 'INTERNAL_NETWORK_REQUIRED');
const runtimeImageId = (await inspect(args.get('--runtime-image'))).Id;
check(typeof runtimeImageId === 'string' && /^sha256:[0-9a-f]{64}$/.test(runtimeImageId), 'RUNTIME_IMAGE_ID_REQUIRED');
const prefix = `chef_cs_${randomBytes(8).toString('hex')}`;
const report = { format: 'cipherscan-native-bounded-ingestion-v1', status: 'RUNNING', started_at: new Date().toISOString(),
  candidate: 'CipherScan native explorer backfill (unmodified binary)',
  runner_sha256: sha(await readFile(new URL(import.meta.url))),
  workload: { from_height: 1, to_height: 2048, source_height: oracle.source.height, source_hash: oracle.source.hash,
    expected_transactions: 16962, binary_sha256: sha(binaryBytes), schema_sha256: sha(schemaBytes), oracle_sha256: sha(oracleBytes), source_revision: '15d7f528f07a84d796ed89029de21bfb26a24d23' },
  deployment: { network, postgres_container: pgContainer, runtime_image: args.get('--runtime-image'), runtime_image_id: runtimeImageId, native_cpu_limit: 1.75, native_memory_limit_bytes: 4294967296 },
  runs: [], limitations: [
    'Native explorer ingestion writes additional inputs, outputs, addresses, flows and indexes. Its work differs from Chef Block/PublicTransaction handlers; results are separate observations, not a pure framework ranking.',
    'Common complete public transaction projection and block identities are verified against the independently captured Chef oracle; extra explorer entities are counted but their complete semantics are not independently verified here.',
    'Prepared read-only RocksDB state is shared; node synchronization/source preparation is excluded. Every PostgreSQL database is fresh.',
    'Primary wall time includes docker startup, native process initialization, RocksDB secondary open, parsing, entity writes/checkpoints and process shutdown; schema setup and independent verification are timed separately.',
    'Native-reported backfill elapsed is printed to 0.1 seconds and excludes process/source/connection initialization; it is secondary to measured complete process wall time.',
    'Native CPU user/system and precise peak RSS are null unless captured separately. Docker stats samples are retained as sampled cgroup observations, not process peak RSS.',
    'Frozen input covers historical public legacy v1/v2 transactions, not complete current mainnet or decrypted shielded data. Containers/databases are preserved; no drop command is used.'
  ] };
await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const save = async () => writeFile(path, JSON.stringify(report, null, 2) + '\n');
const admin = new pg.Client({ connectionString: adminDsn, connectionTimeoutMillis: 5000 });
let databaseClient, activeContainer, interrupted = false, requestStop = async () => {};
const interrupt = () => { interrupted = true; void requestStop(); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
try {
  await admin.connect();
  // These are the two owners/default-privilege grantees in the pinned schema.
  // Official images initialized as POSTGRES_USER=chef may have no postgres role.
  // Only create missing NOLOGIN roles in the positively identified benchmark cluster.
  for (const role of ['zcash_user', 'postgres']) {
    if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
      await admin.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    }
  }
  for (let index = 1; index <= 5; index++) {
    check(!interrupted, 'BENCHMARK_INTERRUPTED');
    const database = `${prefix}_${index}`, container = `zeer-${database.replaceAll('_', '-')}`;
    check(/^[a-z][a-z0-9_]{0,62}$/.test(database), 'GENERATED_DATABASE_INVALID');
    const run = { repetition: index, database, container, status: 'INITIALIZING', started_at: new Date().toISOString(), resource_samples: [], cpu_user_ms: null, cpu_system_ms: null, native_peak_rss_bytes: null };
    report.runs.push(run); await save();
    let interval, monitoring = false, expired = false, timer, startingOrRunning = false, stopPromise, processStarted;
    requestStop = () => stopPromise ??= (async () => {
      // A stop of a created container can precede daemon startup. Retry until
      // the attached start has returned, then verify that native execution ended.
      do {
        if (activeContainer) await docker(['stop', '--time', '10', activeContainer]);
        if (startingOrRunning) await new Promise(done => setTimeout(done, 250));
      } while (startingOrRunning);
    })();
    try {
      check(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 'DATABASE_EXISTS');
      check((await docker(['inspect', container])).code !== 0, 'CONTAINER_EXISTS');
      const preparationStarted = performance.now();
      await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
      const dbUrl = new URL(adminDsn); dbUrl.pathname = '/' + database;
      databaseClient = new pg.Client({ connectionString: dbUrl.href, connectionTimeoutMillis: 5000 }); await databaseClient.connect();
      await databaseClient.query(schemaBytes.toString('utf8'));
      check((await databaseClient.query('SELECT count(*)::int AS n FROM public.blocks')).rows[0].n === 0 && (await databaseClient.query('SELECT count(*)::int AS n FROM public.transactions')).rows[0].n === 0, 'DATABASE_NOT_EMPTY');
      run.schema_initialization_ms = performance.now() - preparationStarted;
      const nativeUrl = new URL(dbUrl); nativeUrl.hostname = 'chef-pg'; nativeUrl.port = '5432';
      run.status = 'INDEXING'; await save();
      interval = setInterval(async () => {
        if (monitoring) return; monitoring = true;
        try {
          const sample = await docker(['stats', '--no-stream', '--format', '{{json .}}', container]);
          if (sample.code === 0 && sample.stdout.trim()) run.resource_samples.push({ at: new Date().toISOString(), ...JSON.parse(sample.stdout.trim()) });
        } catch {} finally { monitoring = false; }
      }, 1000);
      processStarted = performance.now();
      const created = await docker(['create', '--name', container, '--network', network, '--cpus', '1.75', '--memory', '4g', '--memory-swap', '4g', '--pids-limit', '256',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,size=768m,mode=1777',
        '--mount', `type=bind,src=${binary},dst=/bench/cipherscan-indexer,readonly`, '--mount', `type=bind,src=${state},dst=/node/state,readonly`,
        '-e', 'DATABASE_URL', '-e', 'NETWORK=mainnet', '-e', 'ZEBRA_STATE_PATH=/node/state', '-e', 'BLOCK_SPOOL_PATH=/tmp/block-spool', '-e', 'MAX_OPEN_FILES=128',
        '--entrypoint', '/bench/cipherscan-indexer', runtimeImageId, '--batch-size', '1000', 'backfill', '--from', '1', '--to', '2048'],
        { env: { ...process.env, DATABASE_URL: nativeUrl.href } });
      check(created.code === 0, 'NATIVE_CONTAINER_CREATE_FAILED');
      activeContainer = container;
      check(!interrupted, 'BENCHMARK_INTERRUPTED');
      startingOrRunning = true;
      timer = setTimeout(() => { expired = true; void requestStop(); }, timeout * 1000);
      let output;
      try { output = await docker(['start', '--attach', container]); }
      finally { startingOrRunning = false; }
      run.process_elapsed_ms = performance.now() - processStarted;
      if (stopPromise) await stopPromise;
      clearInterval(interval); interval = undefined; clearTimeout(timer); timer = undefined;
      run.exit_code = output.code; run.exit_signal = output.signal;
      const stdoutPath = `${path}.run${index}.stdout.log`, stderrPath = `${path}.run${index}.stderr.log`;
      await writeFile(stdoutPath, output.stdout, { flag: 'wx' }); await writeFile(stderrPath, output.stderr, { flag: 'wx' });
      run.stdout_file = stdoutPath; run.stderr_file = stderrPath;
      const nativeTime = /\bTime:\s*([0-9]+(?:\.[0-9]+)?)s/.exec(output.stdout);
      run.native_reported_backfill_seconds = nativeTime ? Number(nativeTime[1]) : null;
      check(!interrupted && !expired && output.code === 0, interrupted ? 'BENCHMARK_INTERRUPTED' : expired ? 'NATIVE_BACKFILL_TIMEOUT' : 'NATIVE_BACKFILL_FAILED');
      run.status = 'COMMITTED_UNVERIFIED'; await save();
      const verificationStarted = performance.now();
      const blocks = (await databaseClient.query('SELECT height,hash,timestamp,transaction_count FROM public.blocks ORDER BY height')).rows;
      check(blocks.length === expectedBlocks.size, 'BLOCK_COUNT_MISMATCH');
      for (const row of blocks) {
        const expected = expectedBlocks.get(String(row.height));
        check(expected && row.hash === expected.hash && String(row.timestamp) === expected.time && row.transaction_count === expected.transactionCount, 'BLOCK_PROJECTION_MISMATCH');
      }
      const txs = (await databaseClient.query('SELECT txid,block_height,version,locktime,size,vin_count,vout_count FROM public.transactions ORDER BY txid')).rows;
      check(txs.length === expectedTransactions.size, 'TRANSACTION_COUNT_MISMATCH');
      for (const row of txs) {
        const expected = expectedTransactions.get(row.txid);
        check(expected && Number(row.block_height) === expected.minedHeight && row.version === expected.version && String(row.locktime) === expected.locktime && row.size === expected.sizeBytes && row.vin_count === expected.transparentInputCount && row.vout_count === expected.transparentOutputCount, 'TRANSACTION_PROJECTION_MISMATCH');
      }
      const checkpoint = (await databaseClient.query("SELECT value FROM public.indexer_state WHERE key='backfill_height'")).rows[0]?.value;
      check(checkpoint === '2048', 'NATIVE_CHECKPOINT_MISMATCH');
      run.blocks = blocks.length; run.transactions = txs.length; run.final_checkpoint = checkpoint;
      run.persisted_verification_ms = performance.now() - verificationStarted;
      run.blocks_per_second = blocks.length / (run.process_elapsed_ms / 1000);
      run.committed_transactions_per_second = txs.length / (run.process_elapsed_ms / 1000);
      run.database_bytes = (await databaseClient.query('SELECT pg_database_size(current_database())::text AS bytes')).rows[0].bytes;
      run.additional_table_counts = {};
      for (const table of ['transaction_inputs', 'transaction_outputs', 'addresses', 'address_transactions', 'shielded_flows']) run.additional_table_counts[table] = (await databaseClient.query(`SELECT count(*)::text AS n FROM public.${table}`)).rows[0].n;
      check(!(await inspect(sourceContainer)).State.Running, 'FROZEN_SOURCE_STARTED_DURING_BACKFILL');
      run.status = 'PASS';
    } catch (error) {
      run.status = interrupted ? 'INTERRUPTED' : 'FAIL'; run.failure_code = /^[A-Z_]+$/.test(error.message) ? error.message : 'NATIVE_RUN_FAILED';
      if (databaseClient) run.checkpoint_after_failure = await databaseClient.query("SELECT value FROM public.indexer_state WHERE key='backfill_height'").then(result => result.rows[0]?.value ?? null).catch(() => null);
      throw error;
    } finally {
      if (interval) clearInterval(interval); if (timer) clearTimeout(timer);
      if (stopPromise) await stopPromise;
      if (activeContainer) {
        const state = await inspect(activeContainer);
        if (state.State.Running) await docker(['stop', '--time', '10', activeContainer]);
        check(!(await inspect(activeContainer)).State.Running, 'NATIVE_CONTAINER_STILL_RUNNING');
        activeContainer = undefined;
      }
      if (processStarted && run.process_elapsed_ms === undefined) run.partial_process_elapsed_ms = performance.now() - processStarted;
      requestStop = async () => {};
      if (databaseClient) { await databaseClient.end(); databaseClient = undefined; }
      run.finished_at = new Date().toISOString(); await save();
    }
  }
  const elapsed = report.runs.map(run => run.process_elapsed_ms).sort((a, b) => a - b);
  report.summary = { repetitions: 5, process_elapsed_ms_min: elapsed[0], process_elapsed_ms_median: elapsed[2], process_elapsed_ms_max: elapsed[4], blocks: 2048, transactions: 16962,
    committed_transactions_per_second_median: 16962 / (elapsed[2] / 1000) }; report.status = 'PASS';
} catch (error) {
  report.status = interrupted ? 'INTERRUPTED' : 'FAIL'; report.failure_code = /^[A-Z_]+$/.test(error.message) ? error.message : 'NATIVE_BENCHMARK_FAILED'; process.exitCode = 1;
} finally { await admin.end().catch(() => {}); report.finished_at = new Date().toISOString(); await save(); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
process.stdout.write(JSON.stringify({ status: report.status, report: path, summary: report.summary, failure_code: report.failure_code }) + '\n');
