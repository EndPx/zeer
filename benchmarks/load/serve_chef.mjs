#!/usr/bin/env node
// Operator-started read-only loopback server for a retained PASS query fixture.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PostgresStore, parseModel } from '@zeer-dev/chef';
import { check, hash } from '../chef/query/fixture.mjs';

const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  check(['--report', '--schema', '--port', '--token-env', '--dsn-env', '--max-seconds', '--source'].includes(key)
    && !flags.has(key) && value && !value.startsWith('--'), 'INVALID_ARGUMENT');
  flags.set(key, value);
}
for (const key of ['--report', '--schema', '--port', '--token-env']) check(flags.has(key), 'REQUIRED_ARGUMENT');
const integer = (key, fallback, min, max) => {
  const raw = flags.get(key) ?? String(fallback); check(/^[1-9][0-9]*$/.test(raw), 'INVALID_INTEGER');
  const n = Number(raw); check(Number.isSafeInteger(n) && n >= min && n <= max, 'INTEGER_OUTSIDE_BOUNDS'); return n;
};
const port = integer('--port', 39379, 1024, 65535), seconds = integer('--max-seconds', 900, 1, 1800);
const dsn = process.env[flags.get('--dsn-env') ?? 'CHEF_QUERY_DATABASE_URL'];
const token = process.env[flags.get('--token-env')];
check(dsn && token && Buffer.byteLength(token) >= 16, 'DATABASE_AND_TOKEN_ENV_REQUIRED');
const reportRaw = await readFile(resolve(flags.get('--report'))), report = JSON.parse(reportRaw);
check(report.format === 'chef-query-baseline-v1' && report.status === 'PASS'
  && /^chef_q_[0-9a-f]{16}$/.test(report.namespace), 'PASS_QUERY_REPORT_REQUIRED');
const schemaRaw = await readFile(resolve(flags.get('--schema')), 'utf8'), model = parseModel(schemaRaw);
const source = resolve(flags.get('--source') ?? 'packages/chef/dist/graphql.js');
const { createChefServer } = await import(pathToFileURL(source).href);
const store = new PostgresStore(dsn, { ...report.options, model });
const server = createChefServer({ store, model, token });
let timer, closing = false;
const close = async () => {
  if (closing) return; closing = true; clearTimeout(timer);
  server.closeAllConnections();
  if (server.listening) await new Promise(done => server.close(done));
  await store.close();
};
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
try {
  const checkpoint = await store.checkpoint();
  check(checkpoint.status === 'ready' && checkpoint.height === report.dataset.checkpoint.height
    && checkpoint.hash === report.dataset.checkpoint.hash, 'CHECKPOINT_MISMATCH');
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  console.log(JSON.stringify({ event: 'READY', endpoint: `http://127.0.0.1:${port}`, namespace: report.namespace,
    checkpoint, queryReportSha256: hash(reportRaw), sourceSha256: hash(await readFile(source)), schemaSha256: hash(schemaRaw), maxSeconds: seconds }));
  timer = setTimeout(() => void close(), seconds * 1000);
} catch (error) {
  await close(); throw error;
}
