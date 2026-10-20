#!/usr/bin/env node
// Read-only profiling of a retained query benchmark namespace over loopback HTTP.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { PostgresStore, parseModel } from '@zeer-dev/chef';
import { check, digest, hash } from '../query/fixture.mjs';
import { loadProfileModule } from './instrument.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  check(['--report', '--schema', '--source', '--out', '--samples', '--rounds', '--dsn-env'].includes(key) && !flags.has(key) && value && !value.startsWith('--'), 'INVALID_ARGUMENT');
  flags.set(key, value);
}
check(flags.has('--report') && flags.has('--schema') && flags.has('--out'), 'REPORT_SCHEMA_OUTPUT_REQUIRED');
const output = resolve(flags.get('--out')), within = relative(resolve(root, 'benchmarks/results'), output);
check(within && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within), 'OUTPUT_MUST_BE_LOCAL_RESULTS');
const integer = (key, fallback, min, max) => { const raw = flags.get(key) ?? String(fallback); check(/^[1-9][0-9]*$/.test(raw), 'INVALID_INTEGER'); const n = Number(raw); check(n >= min && n <= max, 'INTEGER_OUT_OF_BOUNDS'); return n; };
const samples = integer('--samples', 20, 1, 1000), rounds = integer('--rounds', 5, 1, 20);
const inputReport = await readFile(resolve(flags.get('--report')), 'utf8');
const previous = JSON.parse(inputReport);
check(previous.format === 'chef-query-baseline-v1' && previous.status === 'PASS' && /^chef_q_[0-9a-f]{16}$/.test(previous.namespace), 'VERIFIED_QUERY_REPORT_REQUIRED');
const schemaSource = await readFile(resolve(flags.get('--schema')), 'utf8');
const model = parseModel(schemaSource);
const dsnEnv = flags.get('--dsn-env') ?? 'CHEF_QUERY_DATABASE_URL';
check(/^[A-Z][A-Z0-9_]{0,63}$/.test(dsnEnv) && process.env[dsnEnv], 'DATABASE_ENV_REQUIRED');
const source = resolve(flags.get('--source') ?? resolve(root, 'packages/chef/dist/graphql.js'));
const { module: profiled, sourceSha256 } = await loadProfileModule(source);
const store = new PostgresStore(process.env[dsnEnv], { ...previous.options, model });
const token = randomBytes(24).toString('hex');
const server = profiled.createChefServer({ store, model, token });
const report = { format: 'chef-request-profile-v1', status: 'RUNNING', startedAt: new Date().toISOString(), sourceSha256, inputReportSha256: hash(inputReport), schemaSha256: hash(schemaSource), node: process.version, platform: process.platform, namespace: previous.namespace, dataset: previous.dataset, rounds, samplesPerCasePerRound: samples,
  workload: previous.workload.cases.map(({ name, graphql, expectedDigest }) => ({ name, graphql, expectedDigest })),
  scope: 'authenticated loopback HTTP, concurrency one, warm retained PostgreSQL fixture, measurement-only generated module',
  phases: { parseMs: 'GraphQL parse', limitsMs: 'document surface limits', validateMs: 'GraphQL schema validation', readEnvelopeMs: 'store.read less execute; pool, BEGIN, timeout, state/readiness, COMMIT', executeMs: 'GraphQL argument coercion, resolvers, SQL reads and result construction', serializeMs: 'JSON.stringify before response ceiling check', handlerMs: 'server handler through work completion, including request body arrival', httpMs: 'client fetch through complete response JSON parse' },
  limitations: ['Phase instrumentation adds overhead; use ordinary server HTTP measurements for final before/after performance claims.', 'readMs includes executeMs; use readEnvelopeMs for nonoverlapping comparisons. Phases do not partition all handler work.', 'No cold-cache, WAN, public capacity, ingestion or production-readiness claim. No database mutation or migration.'], samples: [] };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const verify = async workload => {
  const start = performance.now(), before = profiled.__chefProfileSamples.length;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/graphql`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(workload.graphql), signal: AbortSignal.timeout(15000) });
  const body = await response.json(), httpMs = performance.now() - start;
  check(response.status === 200 && !body.errors, 'GRAPHQL_FAILED');
  check(body.data._meta.height === previous.dataset.checkpoint.height && body.data._meta.hash === previous.dataset.checkpoint.hash && body.data._meta.status === 'ready', 'CHECKPOINT_MISMATCH');
  check(digest(body.data[`${workload.entity}${workload.byId ? 'ById' : 'List'}`]) === workload.expectedDigest, 'RESULT_DIGEST_MISMATCH');
  check(profiled.__chefProfileSamples.length === before + 1, 'PROFILE_SAMPLE_MISSING');
  return { name: workload.name, ...profiled.__chefProfileSamples.pop(), httpMs };
};
try {
  const checkpoint = await store.checkpoint(); // validates fingerprint, schema and retained identity
  check(checkpoint.status === 'ready', 'STORE_NOT_READY');
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const cases = previous.workload.cases;
  for (const workload of cases) await verify(workload);
  for (let round = 0; round < rounds; round++) for (let sample = 0; sample < samples; sample++) {
    const rotated = cases.map((_, i) => cases[(i + round) % cases.length]);
    for (const workload of sample % 2 ? rotated.reverse() : rotated) report.samples.push({ round: round + 1, sample: sample + 1, ...await verify(workload) });
  }
  report.summary = cases.map(workload => ({ name: workload.name, phases: Object.fromEntries(Object.keys(report.phases).map(key => {
    const values = report.samples.filter(row => row.name === workload.name).map(row => row[key] ?? 0).sort((a, b) => a - b);
    return [key, { medianMs: values[Math.ceil(values.length * .5) - 1], p95Ms: values[Math.ceil(values.length * .95) - 1], count: values.length }];
  })) }));
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.failureCode = /^[A-Z_]+$/.test(error?.message) ? error.message : 'PROFILE_FAILED'; process.exitCode = 1; }
finally {
  server.closeAllConnections(); if (server.listening) await new Promise(done => server.close(done));
  await store.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
