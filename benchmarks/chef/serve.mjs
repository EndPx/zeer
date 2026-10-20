#!/usr/bin/env node
// Serve one preserved benchmark namespace read-only for the supplemental lookup.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PostgresStore, parseModel, createChefServer } from '@zeer-dev/chef';
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--report', '--config', '--run', '--port', '--dsn-env'].includes(key) || args.has(key) || !value || value.startsWith('--')) throw new Error('INVALID_ARGUMENT');
  args.set(key, value);
}
const report = JSON.parse(await readFile(resolve(args.get('--report')), 'utf8'));
const configPath = resolve(args.get('--config')), configBytes = await readFile(configPath);
if (createHash('sha256').update(configBytes).digest('hex') !== report.workload.config_sha256) throw new Error('CONFIG_CHANGED');
const config = (await import(pathToFileURL(configPath).href)).default;
const schema = await readFile(resolve(dirname(configPath), config.schema), 'utf8');
if (createHash('sha256').update(schema).digest('hex') !== report.workload.schema_sha256) throw new Error('SCHEMA_CHANGED');
const index = Number(args.get('--run') ?? 5), port = Number(args.get('--port') ?? 39370);
if (!Number.isInteger(index) || index < 1 || index > 5 || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_RUN_OR_PORT');
const run = report.runs[index - 1];
if (report.format !== 'chef-bounded-indexing-v1' || run?.status !== 'PASS' || !/^bench_[0-9a-f]{16}_[1-5]$/.test(run.project)) throw new Error('UNVERIFIED_RUN');
const token = process.env.CHEF_API_TOKEN, dsn = process.env[args.get('--dsn-env') ?? config.databaseUrlEnv ?? 'DATABASE_URL'];
if (!token || Buffer.byteLength(token) < 16 || !dsn) throw new Error('TOKEN_AND_DATABASE_REQUIRED');
const store = new PostgresStore(dsn, { project: run.project, fingerprint: run.fingerprint, model: parseModel(schema), network: config.network, startHeight: config.startHeight, reorgWindow: config.reorgWindow ?? 100 });
// checkpoint validates stored project identity; no migrate/acquire/mutation.
const checkpoint = await store.checkpoint();
if (checkpoint.height !== report.workload.to_height || checkpoint.status !== 'ready') { await store.close(); throw new Error('CHECKPOINT_NOT_READY'); }
const server = createChefServer({ store, model: parseModel(schema), token });
await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
process.stdout.write(JSON.stringify({ status: 'listening', host: '127.0.0.1', port, project: run.project, checkpoint }) + '\n');
await new Promise(done => { process.once('SIGINT', done); process.once('SIGTERM', done); });
server.closeAllConnections(); await new Promise(done => server.close(done)); await store.close();
