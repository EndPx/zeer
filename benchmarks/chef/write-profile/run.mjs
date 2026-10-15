#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { parseModel, encodeEntity } from '../../../packages/chef/dist/schema.js';
import { check, digest, hash, publicFixture } from '../query/fixture.mjs';
import { installQueryProfiler, verifyProfileObserved } from './instrument.mjs';
import { verifyRows, verifyCheckpoint } from './verify.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  check(['--oracle', '--schema', '--module', '--out', '--profile', '--dsn-env', '--anchor-hash', '--warmup'].includes(key) && !args.has(key) && value && !value.startsWith('--'), 'INVALID_ARGUMENT');
  args.set(key, value);
}
for (const key of ['--oracle', '--schema', '--module', '--out', '--profile', '--anchor-hash']) check(args.has(key), 'REQUIRED_ARGUMENT_MISSING');
check(['true', 'false'].includes(args.get('--profile')), 'INVALID_PROFILE_FLAG');
const profiled = args.get('--profile') === 'true', anchor = args.get('--anchor-hash');
check(/^[0-9a-f]{64}$/.test(anchor), 'INVALID_ANCHOR_HASH');
const warmText = args.get('--warmup') ?? '32';
check(/^(0|[1-9][0-9]*)$/.test(warmText), 'INVALID_WARMUP');
const warmup = Number(warmText), output = resolve(args.get('--out'));
const within = relative(resolve(root, 'benchmarks/results'), output);
check(within && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within), 'OUTPUT_MUST_BE_LOCAL_RESULTS');
const dsnEnv = args.get('--dsn-env') ?? 'CHEF_WRITE_DATABASE_URL';
check(/^[A-Z][A-Z0-9_]{0,63}$/.test(dsnEnv) && process.env[dsnEnv], 'DATABASE_ENV_REQUIRED');
const raw = await readFile(resolve(args.get('--oracle')));
const oracle = JSON.parse(args.get('--oracle').endsWith('.gz') ? gunzipSync(raw) : raw);
const fixture = publicFixture(oracle), blocks = fixture.blocks.sort((a, b) => Number(a.id) - Number(b.id));
check(blocks.length <= 32768 && fixture.transactions.length <= 500000 && warmup < blocks.length, 'WORKLOAD_OUT_OF_BOUNDS');
const startHeight = Number(blocks[0].id);
check(Number.isSafeInteger(startHeight) && blocks.every((b, i) => Number(b.id) === startHeight + i && /^[0-9a-f]{64}$/.test(b.hash)), 'NONCONTIGUOUS_ORACLE');
const schemaSource = await readFile(resolve(args.get('--schema')), 'utf8'), model = parseModel(schemaSource);
const modulePath = resolve(args.get('--module')), moduleBytes = await readFile(modulePath);
const { PostgresStore } = await import(pathToFileURL(modulePath).href);
check(typeof PostgresStore === 'function', 'STORE_EXPORT_REQUIRED');
const grouped = new Map(blocks.map(b => [Number(b.id), []]));
for (const row of fixture.transactions) grouped.get(row.minedHeight).push({ ...row, locktime: BigInt(row.locktime) });
const prepared = blocks.map((b, i) => ({ data: { ...b, time: BigInt(b.time) },
  identity: { height: Number(b.id), hash: b.hash, previousHash: i ? blocks[i - 1].hash : anchor, time: Number(b.time) }, transactions: grouped.get(Number(b.id)) }));
const expected = [...blocks.map(data => ({ entity: 'Block', id: data.id, data: encodeEntity(model, 'Block', { ...data, time: BigInt(data.time) }) })),
  ...fixture.transactions.map(data => ({ entity: 'PublicTransaction', id: data.id, data: encodeEntity(model, 'PublicTransaction', { ...data, locktime: BigInt(data.locktime) }) }))]
  .sort((a, b) => a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const project = `wp_${randomBytes(8).toString('hex')}`, namespace = `chef_${project}`, sql = `"${namespace}"`;
const options = { project, model, network: 'mainnet', startHeight, reorgWindow: 100, fingerprint: digest({ schema: model.fingerprint, oracle: hash(raw), workload: 'public-handler-operations-v1' }) };
const report = { format: 'chef-write-profile-v1', status: 'RUNNING', startedAt: new Date().toISOString(), profile: profiled,
  namespace, node: process.version, platform: process.platform, moduleSha256: hash(moduleBytes), schemaSha256: hash(schemaSource), oracleSha256: hash(raw),
  dataset: { source: oracle.source, range: oracle.range, blocks: blocks.length, transactions: fixture.transactions.length, anchorHash: anchor, expectedDigest: digest(expected) }, warmupBlocks: warmup,
  scope: 'Prepared public entity write replay through actual PostgresStore.apply, including example handler set/get/increment operations. Concurrency one, fresh migrated namespace, advisory writer lock. Prep fetch, decode, setup, migration and verification excluded from apply timing.',
  limitations: ['Profile query timings include wrapper overhead; use profile=false runs for before/after wall claims.', 'Warm cache on shared host; external controller must record CPU/RAM/PostgreSQL resource limits and competing activity.', 'No live-source ingestion, cold-cache, end-to-end throughput or production-readiness claim. Namespaces retained.'], samples: [] };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const admin = new pg.Client({ connectionString: process.env[dsnEnv], connectionTimeoutMillis: 5000 });
const store = new PostgresStore(process.env[dsnEnv], options);
let profiler;
const resourceBefore = process.resourceUsage(), cpuBefore = process.cpuUsage();
try {
  await admin.connect(); await admin.query('SET statement_timeout=30000');
  report.settings = (await admin.query("SELECT name,setting FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','wal_level','shared_buffers','work_mem','server_version') ORDER BY name")).rows;
  for (const name of ['fsync', 'synchronous_commit', 'full_page_writes']) check(report.settings.find(row => row.name === name)?.setting === 'on', 'DURABILITY_MUST_BE_ON');
  await store.migrate(); await store.acquire();
  if (profiled) profiler = installQueryProfiler(pg.Client);
  for (let i = 0; i < prepared.length; i++) {
    const block = prepared[i], sample = { height: block.identity.height, phase: i < warmup ? 'warmup' : 'steady', transactions: block.transactions.length, sql: {} };
    const apply = () => store.apply(block.identity, async entities => {
      await entities.set('Block', { ...block.data, transactionCount: 0 });
      for (const transaction of block.transactions) {
        await entities.set('PublicTransaction', transaction);
        const current = await entities.get('Block', block.data.id);
        check(current, 'BLOCK_HANDLER_MUST_RUN_FIRST');
        await entities.set('Block', { ...current, transactionCount: current.transactionCount + 1 });
      }
    });
    const began = performance.now();
    if (profiler) await profiler.run(sample, apply); else await apply();
    sample.applyMs = performance.now() - began;
    if (profiler) verifyProfileObserved(sample);
    report.samples.push(sample);
  }
  if (profiler) { profiler.restore(); profiler = undefined; }
  await admin.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const rows = (await admin.query(`SELECT entity,id,data FROM ${sql}.entities ORDER BY entity COLLATE "C",id COLLATE "C"`)).rows;
    const state = (await admin.query(`SELECT * FROM ${sql}.state WHERE singleton=true`)).rows[0];
    const actualDigest = verifyRows(rows, expected);
    verifyCheckpoint(state, options, model, blocks.at(-1), anchor);
    report.verification = { allRowsEqual: true, rows: rows.length, digest: actualDigest, checkpoint: { height: Number(state.height), hash: state.hash, anchorHash: state.anchor_hash, status: state.status }, repeatableReadReadOnly: true };
    await admin.query('COMMIT');
  } catch (error) { await admin.query('ROLLBACK'); throw error; }
  report.summary = ['warmup', 'steady'].map(phase => {
    const samples = report.samples.filter(s => s.phase === phase), times = samples.map(s => s.applyMs).sort((a, b) => a - b), sqlTotals = {};
    for (const sample of samples) for (const [key, value] of Object.entries(sample.sql)) {
      const total = sqlTotals[key] ??= { count: 0, totalMs: 0, failures: 0 };
      for (const field of Object.keys(total)) total[field] += value[field];
    }
    return { phase, blocks: samples.length, transactions: samples.reduce((sum, s) => sum + s.transactions, 0), totalApplyMs: times.reduce((a, b) => a + b, 0), medianApplyMs: times[Math.ceil(times.length * .5) - 1] ?? null, p95ApplyMs: times[Math.ceil(times.length * .95) - 1] ?? null, sql: sqlTotals };
  });
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failureCode = /^[A-Z_]+$/.test(error?.message) ? error.message : 'WRITE_REPLAY_FAILED'; process.exitCode = 1;
} finally {
  report.cleanup = {};
  for (const [name, close] of [['profiler', () => profiler?.restore()], ['store', () => store.close()], ['admin', () => admin.end()]]) {
    try { await close(); report.cleanup[name] = 'PASS'; } catch { report.cleanup[name] = 'FAIL'; report.status = 'FAIL'; process.exitCode = 1; }
  }
  report.processResources = { cpuMicroseconds: process.cpuUsage(cpuBefore), before: resourceBefore, after: process.resourceUsage(), memoryAfter: process.memoryUsage() };
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ status: report.status, output, namespace }));
