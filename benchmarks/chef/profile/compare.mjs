#!/usr/bin/env node
// Uninstrumented alternating baseline/candidate HTTP measurements, read-only DB.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { PostgresStore, parseModel } from '@zeer/chef';
import { check, digest, hash, same } from '../query/fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  check(['--report', '--schema', '--baseline', '--candidate', '--out', '--samples', '--pairs', '--dsn-env'].includes(key) && !flags.has(key) && value && !value.startsWith('--'), 'INVALID_ARGUMENT');
  flags.set(key, value);
}
check(['--report', '--schema', '--baseline', '--out'].every(key => flags.has(key)), 'REPORT_SCHEMA_BASELINE_OUTPUT_REQUIRED');
const output = resolve(flags.get('--out')), within = relative(resolve(root, 'benchmarks/results'), output);
check(within && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within), 'OUTPUT_MUST_BE_LOCAL_RESULTS');
const integer = (key, fallback, min, max) => { const raw = flags.get(key) ?? String(fallback); check(/^[1-9][0-9]*$/.test(raw), 'INVALID_INTEGER'); const n = Number(raw); check(n >= min && n <= max, 'INTEGER_OUT_OF_BOUNDS'); return n; };
const samples = integer('--samples', 20, 1, 1000), pairs = integer('--pairs', 5, 5, 20);
check(samples * pairs >= 100, 'AT_LEAST_100_SAMPLES_PER_CASE_REQUIRED');
const inputReport = await readFile(resolve(flags.get('--report')), 'utf8'), previous = JSON.parse(inputReport);
check(previous.format === 'chef-query-baseline-v1' && previous.status === 'PASS' && /^chef_q_[0-9a-f]{16}$/.test(previous.namespace), 'VERIFIED_QUERY_REPORT_REQUIRED');
const schemaSource = await readFile(resolve(flags.get('--schema')), 'utf8'), model = parseModel(schemaSource);
const dsnEnv = flags.get('--dsn-env') ?? 'CHEF_QUERY_DATABASE_URL';
check(/^[A-Z][A-Z0-9_]{0,63}$/.test(dsnEnv) && process.env[dsnEnv], 'DATABASE_ENV_REQUIRED');
const sources = { baseline: resolve(flags.get('--baseline')), candidate: resolve(flags.get('--candidate') ?? resolve(root, 'packages/chef/dist/graphql.js')) };
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([name, path]) => [name, hash(await readFile(path))])));
check(sourceSha256.baseline !== sourceSha256.candidate, 'IDENTICAL_SERVER_SOURCES');
const factories = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([name, path]) => [name, (await import(pathToFileURL(path).href)).createChefServer])));
const store = new PostgresStore(process.env[dsnEnv], { ...previous.options, model }), token = randomBytes(24).toString('hex');
const servers = Object.fromEntries(Object.entries(factories).map(([name, create]) => [name, create({ store, model, token })]));
const report = { format: 'chef-request-comparison-v1', status: 'RUNNING', startedAt: new Date().toISOString(), sourceSha256, inputReportSha256: hash(inputReport), schemaSha256: hash(schemaSource), node: process.version, platform: process.platform, namespace: previous.namespace, dataset: previous.dataset, pairs, samplesPerCasePerPair: samples,
  workload: previous.workload.cases.map(({ name, graphql, expectedDigest }) => ({ name, graphql, expectedDigest })), concurrency: 1,
  limitations: ['Uninstrumented authenticated loopback HTTP through complete response JSON parse; warm retained PostgreSQL fixture. No DB migration/write.', 'Baseline/candidate phases alternate by pair; cases rotate by pair and reverse by sample. One warmup per case before each phase.', 'Warm document-cache performance only; no claim about cold documents, WAN, public capacity or production readiness. Source budget is retained query text, not total AST heap.'], phases: [] };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const save = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
const request = async (variant, workload, authenticated = true) => {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${servers[variant].address().port}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(workload.graphql), signal: AbortSignal.timeout(15000) });
  const text = await response.text(), body = JSON.parse(text), elapsedMs = performance.now() - started;
  if (!authenticated) { check(response.status === 401, 'AUTH_GATE_FAILED'); return; }
  check(response.status === 200 && !body.errors, 'GRAPHQL_FAILED');
  check(body.data._meta.height === previous.dataset.checkpoint.height && body.data._meta.hash === previous.dataset.checkpoint.hash && body.data._meta.status === 'ready', 'CHECKPOINT_MISMATCH');
  check(digest(body.data[`${workload.entity}${workload.byId ? 'ById' : 'List'}`]) === workload.expectedDigest, 'RESULT_DIGEST_MISMATCH');
  return { name: workload.name, elapsedMs, responseBytes: Buffer.byteLength(text), status: response.status };
};
try {
  report.checkpointBefore = await store.checkpoint();
  check(report.checkpointBefore.status === 'ready', 'STORE_NOT_READY');
  for (const server of Object.values(servers)) await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const cases = previous.workload.cases;
  for (const variant of Object.keys(servers)) await request(variant, cases[0], false);
  report.authChecks = 'PASS';
  for (let pair = 0; pair < pairs; pair++) {
    const variants = pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    const rotated = cases.map((_, i) => cases[(i + pair) % cases.length]);
    for (const variant of variants) {
      for (const workload of rotated) await request(variant, workload);
      const phase = { pair: pair + 1, variant, samples: [], status: 'RUNNING' }; report.phases.push(phase);
      for (let sample = 0; sample < samples; sample++) for (const workload of sample % 2 ? [...rotated].reverse() : rotated) phase.samples.push({ sample: sample + 1, ...await request(variant, workload) });
      const checkpoint = await store.checkpoint();
      check(same(checkpoint, report.checkpointBefore), 'CHECKPOINT_CHANGED');
      phase.status = 'PASS'; await save();
    }
  }
  report.summary = Object.keys(servers).flatMap(variant => cases.map(workload => {
    const values = report.phases.filter(phase => phase.variant === variant).flatMap(phase => phase.samples.filter(row => row.name === workload.name).map(row => row.elapsedMs)).sort((a, b) => a - b);
    const quantile = fraction => values[Math.ceil(values.length * fraction) - 1];
    return { variant, name: workload.name, samples: values.length, medianMs: quantile(.5), p95Ms: quantile(.95), minMs: values[0], maxMs: values.at(-1) };
  }));
  report.paired = cases.map(workload => ({ name: workload.name, pairs: Array.from({ length: pairs }, (_, i) => {
    const medians = Object.fromEntries(Object.keys(servers).map(variant => { const values = report.phases.find(phase => phase.pair === i + 1 && phase.variant === variant).samples.filter(row => row.name === workload.name).map(row => row.elapsedMs).sort((a, b) => a - b); return [variant, values[Math.ceil(values.length / 2) - 1]]; }));
    return { pair: i + 1, ...medians, candidateMedianReductionPercent: 100 * (1 - medians.candidate / medians.baseline) };
  }) }));
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.failureCode = /^[A-Z_]+$/.test(error?.message) ? error.message : 'COMPARISON_FAILED'; process.exitCode = 1; }
finally {
  for (const server of Object.values(servers)) { server.closeAllConnections(); if (server.listening) await new Promise(done => server.close(done)); }
  await store.close(); report.finishedAt = new Date().toISOString(); await save();
}
