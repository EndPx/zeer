// Isolate declared-index maintenance in real per-block PostgreSQL transactions.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgresStore, parseModel, encodeEntity } from '@zeer-dev/chef';
import { digest, hash, publicFixture } from './fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
assert.equal(process.argv.length, 8, 'Use --oracle FILE --anchor HASH --out benchmarks/results/FILE');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) { assert.ok(['--oracle', '--anchor', '--out'].includes(process.argv[i]) && !args.has(process.argv[i])); args.set(process.argv[i], process.argv[i + 1]); }
assert.equal(args.size, 3); assert.match(args.get('--anchor'), /^[0-9a-f]{64}$/);
const output = resolve(args.get('--out')), within = relative(resolve(root, 'benchmarks/results'), output);
assert.ok(within && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within));
const url = process.env.CHEF_QUERY_DATABASE_URL; assert.ok(url, 'Disposable CHEF_QUERY_DATABASE_URL required');
const raw = await readFile(args.get('--oracle'));
const oracle = JSON.parse(args.get('--oracle').endsWith('.gz') ? gunzipSync(raw) : raw);
const fixture = publicFixture(oracle), end = 2048;
const blocks = fixture.blocks.filter(b => Number(b.id) <= end).sort((a, b) => Number(a.id) - Number(b.id));
assert.equal(blocks.length, end); assert.ok(blocks.every((b, i) => Number(b.id) === i + 1));
const transactions = fixture.transactions.filter(t => t.minedHeight <= end);
const grouped = new Map(blocks.map(b => [Number(b.id), []]));
for (const t of transactions) grouped.get(t.minedHeight).push(t);
const plain = await readFile(resolve(root, 'examples/chef-public/schema.graphql'), 'utf8');
const models = { baseline: parseModel(plain), declared_indexes: parseModel(plain.replace('minedHeight: Int!', 'minedHeight: Int! @index').replace('transactionCount: Int!', 'transactionCount: Int! @index')) };
const expected = [...blocks.map(data => ({ entity: 'Block', id: data.id, data: encodeEntity(models.baseline, 'Block', data) })),
  ...transactions.map(data => ({ entity: 'PublicTransaction', id: data.id, data: encodeEntity(models.baseline, 'PublicTransaction', data) }))]
  .sort((a, b) => a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const expectedDigest = digest(expected);
const report = { status: 'RUNNING', input: { source: oracle.source, oracleSha256: hash(raw), blocks: end, transactions: transactions.length, anchor: args.get('--anchor'), expectedDigest },
  limits: 'Five alternating fresh namespaces per variant. Storage-only deterministic projection from public node oracle; no Prep fetch, CLI startup or migrations inside ingestion timer. Rollback/replay uses the same three canonical blocks and is not a real-node reorg proof. No cache eviction; shared-host resource limits recorded externally.', runs: [] };
await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' });
const save = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
const admin = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
let store;
try {
  await admin.connect(); await admin.query('SET statement_timeout=30000');
  report.settings = (await admin.query("SELECT name,setting FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','wal_level','shared_buffers','work_mem','server_version') ORDER BY name")).rows;
  for (const name of ['fsync', 'synchronous_commit', 'full_page_writes']) assert.equal(report.settings.find(row => row.name === name).setting, 'on');
  for (let round = 0; round < 5; round++) for (const variant of round % 2 ? ['declared_indexes', 'baseline'] : ['baseline', 'declared_indexes']) {
    const project = `wc_${randomBytes(8).toString('hex')}`, sql = `"chef_${project}"`, model = models[variant];
    store = new PostgresStore(url, { project, network: 'mainnet', startHeight: 1, reorgWindow: 100, model, fingerprint: digest({ model: model.fingerprint, expectedDigest }) });
    await store.migrate(); await store.acquire();
    const apply = async b => store.apply({ height: Number(b.id), hash: b.hash, previousHash: Number(b.id) === 1 ? args.get('--anchor') : blocks[Number(b.id) - 2].hash, time: Number(b.time) }, async entities => {
      await entities.set('Block', { ...b, time: BigInt(b.time) });
      for (const t of grouped.get(Number(b.id))) await entities.set('PublicTransaction', { ...t, locktime: BigInt(t.locktime) });
    });
    const began = performance.now(); for (const b of blocks) await apply(b);
    const ingestMs = performance.now() - began;
    const verify = async () => {
      const rows = (await admin.query(`SELECT entity,id,data FROM ${sql}.entities ORDER BY entity COLLATE "C",id COLLATE "C"`)).rows;
      assert.equal(digest(rows), expectedDigest); assert.equal(rows.length, expected.length);
      const checkpoint = await store.checkpoint(); assert.equal(checkpoint.height, end); assert.equal(checkpoint.hash, blocks.at(-1).hash);
    };
    await verify(); await store.markReconciling();
    const rollbackStarted = performance.now(); await store.rollback(end - 3, blocks[end - 4].hash);
    const rollbackMs = performance.now() - rollbackStarted;
    const prefix = expected.filter(r => r.entity === 'Block' ? Number(r.id) <= end - 3 : r.data.minedHeight <= end - 3);
    const rolled = (await admin.query(`SELECT entity,id,data FROM ${sql}.entities ORDER BY entity COLLATE "C",id COLLATE "C"`)).rows;
    assert.equal(digest(rolled), digest(prefix)); assert.equal((await store.checkpoint()).height, end - 3);
    const replayStarted = performance.now(); for (const b of blocks.slice(-3)) await apply(b); await store.markReady();
    const replayMs = performance.now() - replayStarted; await verify();
    const footprint = (await admin.query(`SELECT pg_table_size('${sql}.entities'::regclass)::text AS table_bytes,pg_indexes_size('${sql}.entities'::regclass)::text AS index_bytes`)).rows[0];
    report.runs.push({ round: round + 1, variant, project, ingestMs, rollbackMs, replayMs, footprint, allRowsEqual: true, rollbackPrefixEqual: true });
    await store.close(); store = undefined; await save();
  }
  report.summary = Object.keys(models).map(variant => {
    const rows = report.runs.filter(r => r.variant === variant), median = key => rows.map(r => r[key]).sort((a, b) => a - b)[2];
    return { variant, medianIngestMs: median('ingestMs'), medianRollbackMs: median('rollbackMs'), medianReplayMs: median('replayMs') };
  }); report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.error = error.name; process.exitCode = 1; }
finally {
  try { if (store) await store.close(); } catch { report.status = 'FAIL'; process.exitCode = 1; }
  try { await admin.end(); } catch { report.status = 'FAIL'; process.exitCode = 1; }
  await save();
}
console.log(JSON.stringify({ status: report.status, output }));
