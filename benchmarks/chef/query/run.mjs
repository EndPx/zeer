#!/usr/bin/env node
// Query-only benchmark: fresh namespace, retained state, no production schema changes.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgresStore, parseModel, encodeEntity, createChefServer } from '@zeer/chef';
import { queryIndexes } from '../../../packages/chef/dist/schema.js';
import { check, digest, hash, publicFixture, syntheticFixture, workloads, sqlQuery, same } from './fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const flags = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  check(['--out', '--oracle', '--dataset', '--rows', '--dsn-env', '--rounds', '--samples', '--compare-expression-indexes', '--compare-declared-indexes'].includes(key) && !flags.has(key), 'INVALID_ARGUMENT');
  const value = ['--compare-expression-indexes', '--compare-declared-indexes'].includes(key) ? true : process.argv[++index];
  check(value && (value === true || !value.startsWith('--')), 'MISSING_ARGUMENT_VALUE');
  flags.set(key, value);
}
check(flags.has('--out'), 'OUTPUT_REQUIRED');
check(!(flags.has('--compare-expression-indexes') && flags.has('--compare-declared-indexes')), 'CONFLICTING_INDEX_EXPERIMENTS');
const indexedVariant = flags.has('--compare-declared-indexes') ? 'declared_indexes' : flags.has('--compare-expression-indexes') ? 'expression_indexes' : null;
const out = resolve(flags.get('--out')), resultRoot = resolve(root, 'benchmarks/results');
const outputRelative = relative(resultRoot, out);
check(outputRelative && outputRelative !== '..' && !outputRelative.startsWith(`..${sep}`) && !isAbsolute(outputRelative), 'OUTPUT_MUST_BE_LOCAL_RESULTS');
const bounded = (flag, fallback, min, max) => {
  const value = flags.get(flag) ?? String(fallback);
  check(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'INVALID_INTEGER_ARGUMENT');
  const number = Number(value); check(Number.isInteger(number) && number >= min && number <= max, 'INTEGER_ARGUMENT_OUTSIDE_BOUNDS'); return number;
};
const rounds = bounded('--rounds', 5, 5, 20), samples = bounded('--samples', 5, 1, 50);
const dataset = flags.get('--dataset') ?? 'public';
check(['public', 'synthetic'].includes(dataset), 'INVALID_DATASET');
check(dataset === 'public' ? !flags.has('--rows') : !flags.has('--oracle'), 'CONFLICTING_DATASET_ARGUMENTS');
const dsnEnv = flags.get('--dsn-env') ?? 'CHEF_QUERY_DATABASE_URL';
check(/^[A-Z][A-Z0-9_]{0,63}$/.test(dsnEnv) && process.env[dsnEnv], 'QUERY_DATABASE_ENV_REQUIRED');
let schema = await readFile(resolve(root, 'examples/chef-public/schema.graphql'), 'utf8');
if (indexedVariant === 'declared_indexes') schema = schema.replace('minedHeight: Int!', 'minedHeight: Int! @index').replace('transactionCount: Int!', 'transactionCount: Int! @index');
const model = parseModel(schema);
let fixture, input;
if (dataset === 'public') {
  const path = resolve(flags.get('--oracle') ?? resolve(root, 'benchmarks/fixtures/mainnet-public-2048/oracle.json.gz'));
  const bytes = await readFile(path), decoded = path.endsWith('.gz') ? gunzipSync(bytes) : bytes;
  fixture = publicFixture(JSON.parse(decoded.toString('utf8')));
  input = { sha256: hash(bytes), compressed: path.endsWith('.gz') };
} else {
  fixture = syntheticFixture(bounded('--rows', 200000, 1000, 1000000));
  input = { generator: fixture.provenance.generator };
}
const rows = [...fixture.blocks.map(data => ({ entity: 'Block', id: data.id, data: encodeEntity(model, 'Block', data) })),
  ...fixture.transactions.map(data => ({ entity: 'PublicTransaction', id: data.id, data: encodeEntity(model, 'PublicTransaction', data) }))]
  .sort((a, b) => a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const expectedDigest = digest(rows), cases = workloads(fixture);
const project = `q_${randomBytes(8).toString('hex')}`, namespace = `chef_${project}`, sql = `"${namespace}"`;
const fingerprint = hash(JSON.stringify({ model: model.fingerprint, expectedDigest, provenance: fixture.provenance }));
const options = { project, network: dataset === 'public' ? 'mainnet' : 'regtest', startHeight: 1, reorgWindow: 100, model, fingerprint };
const report = { format: 'chef-query-baseline-v1', status: 'RUNNING', startedAt: new Date().toISOString(),
  namespace, options: { ...options, model: undefined }, input, provenance: fixture.provenance,
  dataset: { blocks: fixture.blocks.length, transactions: fixture.transactions.length, entityDigest: expectedDigest, checkpoint: fixture.head },
  workload: { rounds, samplesPerCasePerRound: samples, first: 100, concurrency: 1,
    cases: cases.map(({ query, variables, expected, ...item }) => ({ ...item, graphql: { query, variables }, expectedDigest: digest(expected) })) },
  limitations: [
    'Rows are seeded as query fixtures directly into a fresh marked namespace, not timed full-chain ingestion. Public input provenance is retained; synthetic identities are not real chain transactions.',
    'Measurements use existing authenticated Chef HTTP GraphQL and repeatable-read PostgreSQL snapshots. SQL plans run the exact current ID-keyset and parameterized JSONB equality shape.',
    'Cache is not flushed. Baseline and candidate phases alternate order by round and workloads rotate; repeated warm-cache latency is not cold-cache or public-service performance.',
    'Concurrency is one client, within the existing two-query admission limit. No capacity, WAN latency or external indexer ranking is measured.',
    'Expression-index mode uses three benchmark-only indexes. Declared-index mode uses two actual schema-declared partial indexes through PostgresStore.migrate. Baseline drops them only in this generated benchmark namespace. Index maintenance during ingestion/reorg is measured separately, not inferred from build time.',
    'The fixture does not prove source recovery or reorg correctness. Existing connected and PostgreSQL tests remain separate required acceptance gates.',
    'EXPLAIN ANALYZE instrumentation changes SQL timing. HTTP samples are separately timed through complete response receipt/JSON parse and checked against independent fixture results.',
  ], phases: [], stage: 'configured', failureCode: null };
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const save = () => writeFile(out, JSON.stringify(report, null, 2) + '\n');
const abort = new AbortController(), stop = () => abort.abort();
process.once('SIGINT', stop); process.once('SIGTERM', stop);
const signal = () => AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]);
const admin = new pg.Client({ connectionString: process.env[dsnEnv], connectionTimeoutMillis: 5000 });
const store = new PostgresStore(process.env[dsnEnv], options);
let server, indexesPresent = false;
const indexes = indexedVariant === 'declared_indexes' ? queryIndexes(model).map(row => [row.name, row.field])
  : [['qe_mined_height', 'minedHeight'], ['qe_version', 'version'], ['qe_transaction_count', 'transactionCount']];
const footprint = async () => (await admin.query(`SELECT pg_table_size('${sql}.entities'::regclass)::text AS table_bytes,pg_indexes_size('${sql}.entities'::regclass)::text AS index_bytes`)).rows[0];
const verifyAll = async () => {
  const actual = (await admin.query(`SELECT entity,id,data FROM ${sql}.entities ORDER BY entity COLLATE "C",id COLLATE "C"`)).rows;
  check(actual.length === rows.length && digest(actual) === expectedDigest, 'ALL_ROW_FIXTURE_MISMATCH');
  const checkpoint = await store.checkpoint();
  check(checkpoint.height === fixture.head.height && checkpoint.hash === fixture.head.hash && checkpoint.status === 'ready', 'CHECKPOINT_CHANGED');
};
const changeIndexes = async variant => {
  const begin = performance.now(), operations = [];
  if (variant === 'declared_indexes' && !indexesPresent) {
    const started = performance.now(); await store.migrate();
    operations.push({ operation: 'migrate_declared_set', seconds: (performance.now() - started) / 1000 });
    for (const [name, field] of indexes) operations.push({ operation: 'inspect', index: name, field,
      ...(await admin.query(`SELECT pg_relation_size($1::regclass)::text AS bytes,pg_get_indexdef($1::regclass) AS definition`, [`${sql}."${name}"`])).rows[0] });
    indexesPresent = true;
  } else if (variant === 'expression_indexes' && !indexesPresent) {
    for (const [name, field] of indexes) {
      const started = performance.now();
      await admin.query(`CREATE INDEX "${name}" ON ${sql}.entities (entity,(data -> '${field}'),id)`);
      operations.push({ operation: 'create', index: name, field, seconds: (performance.now() - started) / 1000,
        bytes: (await admin.query(`SELECT pg_relation_size('${sql}."${name}"'::regclass)::text AS bytes`)).rows[0].bytes });
    }
    indexesPresent = true;
  } else if (variant === 'baseline' && indexesPresent) {
    for (const [name] of indexes) {
      const started = performance.now(); await admin.query(`DROP INDEX ${sql}."${name}"`);
      operations.push({ operation: 'drop', index: name, seconds: (performance.now() - started) / 1000 });
    }
    indexesPresent = false;
  }
  const analyzeStarted = performance.now(); await admin.query(`ANALYZE ${sql}.entities`);
  return { operations, analyzeMs: performance.now() - analyzeStarted, elapsedMsIncludingAnalyze: performance.now() - begin,
    footprint: await footprint(), writeOverheadMeasured: false };
};
const http = async (workload, authenticated = true) => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/graphql`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query: workload.query, variables: workload.variables }), signal: signal() });
  const text = await response.text(); return { status: response.status, bytes: Buffer.byteLength(text), body: JSON.parse(text) };
};
const verifyResponse = (workload, response) => {
  check(response.status === 200 && !response.body.errors, 'GRAPHQL_QUERY_FAILED');
  check(same(response.body.data._meta, { ...fixture.head, status: 'ready' }), 'GRAPHQL_CHECKPOINT_MISMATCH');
  const root = `${workload.entity}${workload.byId ? 'ById' : 'List'}`;
  check(same(response.body.data[root], workload.expected), 'GRAPHQL_ROWS_OR_CURSOR_MISMATCH');
};
const token = randomBytes(24).toString('hex');
try {
  report.stage = 'database_connect'; await save();
  await admin.connect();
  await admin.query('SET statement_timeout=30000');
  check(!(await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [namespace])).rowCount, 'NAMESPACE_ALREADY_EXISTS');
  report.settings = (await admin.query("SELECT name,setting,unit FROM pg_settings WHERE name IN ('server_version','work_mem','shared_buffers','effective_cache_size','random_page_cost','seq_page_cost','plan_cache_mode','enable_seqscan','jit','max_parallel_workers_per_gather') ORDER BY name")).rows;
  await store.migrate(); await store.acquire();
  if (indexedVariant === 'declared_indexes') {
    indexesPresent = true;
    report.initialIndexRemovalForUntimedFixtureImport = await changeIndexes('baseline');
  }
  report.stage = 'fixture_import'; await save();
  const begin = performance.now();
  await admin.query('BEGIN');
  try {
    for (let index = 0; index < rows.length; index += 500) {
      abort.signal.throwIfAborted();
      await admin.query(`INSERT INTO ${sql}.entities(entity,id,data) SELECT entity,id,data FROM jsonb_to_recordset($1::jsonb) AS r(entity text,id text,data jsonb)`, [JSON.stringify(rows.slice(index, index + 500))]);
    }
    await admin.query(`INSERT INTO ${sql}.blocks(height,hash) VALUES($1,$2)`, [fixture.head.height, fixture.head.hash]);
    await admin.query(`UPDATE ${sql}.state SET height=$1,hash=$2,anchor_hash=$3 WHERE singleton=true`, [fixture.head.height, fixture.head.hash, hash('query-fixture-anchor')]);
    await admin.query('COMMIT');
  } catch (error) { await admin.query('ROLLBACK').catch(() => {}); throw error; }
  report.fixtureImport = { elapsedMs: performance.now() - begin, kind: 'direct_query_fixture_import_baseline_only', candidateWriteOverheadMeasured: false };
  await admin.query(`ANALYZE ${sql}.entities`); await verifyAll();
  server = createChefServer({ store, model, token });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  check((await http(cases[0], false)).status === 401, 'AUTH_GATE_FAILED');
  await store.markReconciling();
  check((await http(cases[0])).status === 503, 'READINESS_GATE_FAILED');
  await store.markReady();
  report.authAndReadGateChecks = 'PASS';
  for (let round = 0; round < rounds; round++) {
    const variants = indexedVariant ? round % 2 === 0 ? ['baseline', indexedVariant] : [indexedVariant, 'baseline'] : ['baseline'];
    for (const variant of variants) {
      abort.signal.throwIfAborted();
      report.stage = `round_${round + 1}_${variant}_index_transition`; await save();
      const phase = { round: round + 1, variant, status: 'RUNNING', indexTransition: await changeIndexes(variant), plans: [], samples: [] };
      report.phases.push(phase); await save();
      const rotated = cases.map((_, index) => cases[(index + round) % cases.length]);
      for (const workload of rotated) {
        report.stage = `round_${round + 1}_${variant}_plan_${workload.name}`;
        const query = sqlQuery(namespace, workload);
        const rowsFromSql = (await admin.query(query.text, query.values)).rows.map(row => row.data);
        const expectedSql = workload.byId ? [workload.expected] : fixture[workload.entity === 'Block' ? 'blocks' : 'transactions']
          .filter(row => (workload.options.after === undefined || row.id > workload.options.after) && Object.entries(workload.options.where).every(([key, value]) => same(row[key], value)))
          .slice(0, workload.options.first + 1);
        check(same(rowsFromSql, expectedSql), 'SQL_ROWS_MISMATCH');
        const plan = await admin.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query.text}`, query.values);
        phase.plans.push({ name: workload.name, sql: query.text, parameters: query.values, result: plan.rows[0]['QUERY PLAN'] });
        verifyResponse(workload, await http(workload)); // Explicit untimed per-case warmup.
      }
      for (let sample = 0; sample < samples; sample++) {
        const order = sample % 2 === 0 ? rotated : [...rotated].reverse();
        for (const workload of order) {
          report.stage = `round_${round + 1}_${variant}_http_${workload.name}`;
          abort.signal.throwIfAborted();
          const started = performance.now(), response = await http(workload), elapsedMs = performance.now() - started;
          verifyResponse(workload, response);
          phase.samples.push({ name: workload.name, sample: sample + 1, elapsedMs, responseBytes: response.bytes, status: response.status });
        }
      }
      report.stage = `round_${round + 1}_${variant}_all_row_verification`;
      await verifyAll(); phase.allRowsAndCursorChecks = 'PASS'; phase.status = 'PASS'; await save();
    }
  }
  report.summary = [];
  for (const variant of indexedVariant ? ['baseline', indexedVariant] : ['baseline']) {
    for (const workload of cases) {
      const values = report.phases.filter(phase => phase.variant === variant).flatMap(phase => phase.samples.filter(row => row.name === workload.name).map(row => row.elapsedMs)).sort((a, b) => a - b);
      const quantile = fraction => values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
      report.summary.push({ variant, workload: workload.name, samples: values.length, minMs: values[0], medianMs: quantile(0.5), p95Ms: quantile(0.95), maxMs: values.at(-1) });
    }
  }
  report.status = 'PASS'; report.stage = 'complete';
} catch (error) {
  report.status = abort.signal.aborted ? 'INTERRUPTED' : 'FAIL';
  report.failureCode = typeof error?.message === 'string' && /^[A-Z_]+$/.test(error.message) ? error.message : 'QUERY_BENCHMARK_FAILED';
  if (typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) report.failurePostgresCode = error.code;
  process.exitCode = 1;
} finally {
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  report.cleanupErrors = [];
  for (const [name, close] of [['store', () => store.close()], ['admin', () => admin.end()]]) {
    try { await close(); } catch { report.cleanupErrors.push(name); }
  }
  if (report.cleanupErrors.length) { report.status = 'FAIL'; report.failureCode = 'CLEANUP_FAILED'; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await save();
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
}
process.stdout.write(JSON.stringify({ status: report.status, report: out, namespace, failureCode: report.failureCode }) + '\n');
