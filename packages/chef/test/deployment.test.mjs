import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {databaseUrl, runRuntime} from '../../../examples/chef-deployment/runtime.mjs';
import {healthReady, checkHealth} from '../../../examples/chef-deployment/healthcheck.mjs';

const ready = {state: 'caught_up', readGate: 'ready', source: {availability: 'available', checkpointAheadOfPrep: false}};

test('runtime database URL encodes punctuation and never accepts host DATABASE_URL override', () => {
  const url = new URL(databaseUrl({POSTGRES_PASSWORD: 'p@ss:/?#% !', DATABASE_URL: 'postgresql://remote/other', CHEF_DATABASE_NAME: 'recovered_1'}));
  assert.equal(decodeURIComponent(url.password), 'p@ss:/?#% !');
  assert.equal(url.hostname, 'postgres'); assert.equal(url.port, '5432');
  assert.equal(url.pathname, '/recovered_1'); assert.equal(url.username, 'chef');
  assert.equal(new URL(databaseUrl({POSTGRES_PASSWORD: 'pass'})).pathname, '/chef');
  for (const database of ['../chef', 'chef?x=1', '', 'UPPER', 'a'.repeat(64)]) {
    assert.throws(() => databaseUrl({POSTGRES_PASSWORD: 'pass', CHEF_DATABASE_NAME: database}), {code: 'INVALID_DATABASE_NAME'});
  }
  assert.throws(() => databaseUrl({}), {code: 'POSTGRES_PASSWORD_REQUIRED'});
});

test('API only starts after readonly status, without scanner paths or migration', async () => {
  const calls = [], env = {POSTGRES_PASSWORD: 'secret'};
  await runRuntime(['api'], {env, main: async (args, options) => {
    calls.push(args);
    if (args[0] === 'status') options.write(JSON.stringify(ready) + '\n');
  }});
  assert.deepEqual(calls, [['status', '--json'], ['serve', '--listen', '0.0.0.0', '--port', '39370', '--json']]);
  assert.equal(env.DATABASE_URL, 'postgresql://chef:secret@postgres:5432/chef');
  assert.equal(env.ZEER_VIEWING_KEY_FILE, undefined);
  for (const report of [undefined, {...ready, state: 'blocked'}, {...ready, state: 'reconciling'},
    {...ready, readGate: 'reconciling'}, {...ready, source: {...ready.source, checkpointAheadOfPrep: true}},
    {...ready, source: {availability: 'unavailable'}}]) {
    const commands = [];
    await assert.rejects(runRuntime(['api'], {env: {POSTGRES_PASSWORD: 'pass'}, main: async (args, options) => {
      commands.push(args[0]); if (report) options.write(JSON.stringify(report));
    }}), {code: 'API_PREFLIGHT_NOT_READY'});
    assert.deepEqual(commands, ['status']);
  }
  const failure = Object.assign(new Error('upstream unavailable'), {code: 'SOURCE_UNAVAILABLE'});
  await assert.rejects(runRuntime(['api'], {env, main: async () => { throw failure; }}), failure);
});

test('runtime roles preserve explicit migrate and follow boundaries', async () => {
  for (const [role, expected] of [['follower', ['sync', '--follow', '--json']], ['check', ['status', '--json']], ['migrate', ['migrate', '--json']]]) {
    const calls = [];
    await runRuntime([role], {env: {POSTGRES_PASSWORD: 'pass'}, main: async args => { calls.push(args); }});
    assert.deepEqual(calls, [expected]);
  }
  await assert.rejects(runRuntime(['up']), {code: 'INVALID_RUNTIME_ROLE'});
});

const now = Date.parse('2026-10-22T06:00:00Z');
const cached = {checkpoint: {status: 'ready'}, source: {status: 'available', checkedAt: new Date(now - 30000).toISOString()}};
test('cached health rejects stale, future, unavailable, unknown and closed gates', () => {
  assert.equal(healthReady(cached, {now}), true);
  assert.equal(healthReady(cached, {now, maxAgeSeconds: 30}), true);
  assert.equal(healthReady(cached, {now, maxAgeSeconds: 29}), false);
  for (const checkedAt of [null, 'invalid', new Date(now + 1).toISOString(), new Date(now - 60001).toISOString()]) {
    assert.equal(healthReady({...cached, source: {...cached.source, checkedAt}}, {now}), false);
  }
  for (const status of ['blocked', 'reconciling', undefined]) assert.equal(healthReady({...cached, checkpoint: {status}}, {now}), false);
  for (const status of ['unavailable', 'unknown', undefined]) assert.equal(healthReady({...cached, source: {...cached.source, status}}, {now}), false);
  for (const maxAgeSeconds of [0, -1, 1.5, NaN, 3601]) assert.equal(healthReady(cached, {now, maxAgeSeconds}), false);
  assert.equal(healthReady(null, {now}), false);
});

test('health request only uses authenticated loopback cached status and bounded timeout', async () => {
  const token = 'a'.repeat(32), calls = [];
  assert.equal(await checkHealth({now, env: {CHEF_API_TOKEN: token}, fetch: async (url, options) => {
    calls.push({url, options}); return new Response(JSON.stringify(cached), {status: 200});
  }}), true);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'http://127.0.0.1:39370/status');
  assert.equal(calls[0].options.headers.authorization, `Bearer ${token}`);
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(await checkHealth({env: {}, fetch: () => { throw Error('must not call'); }}), false);
  assert.equal(await checkHealth({env: {CHEF_API_TOKEN: token}, fetch: async () => new Response(null, {status: 401})}), false);
});

test('deployment image and overlays exclude API key mounts and automatic migration', async () => {
  const asset = name => readFile(new URL(`../../../examples/chef-deployment/${name}`, import.meta.url), 'utf8');
  const [docker, runtime, shielded, ignored] = await Promise.all(['Dockerfile', 'compose.runtime.yaml', 'compose.shielded.yaml', '.dockerignore'].map(asset));
  assert.match(docker, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.match(docker, /pnpm exec tsc --noEmit/); assert.doesNotMatch(docker, /RUN[^\n]*codegen|COPY \. \./);
  assert.match(docker, /USER 1000:1000/); assert.match(docker, /node install-scanner\.mjs --dir \/opt\/zeer-scanner/);
  assert.match(runtime, /read_only: true/); assert.match(runtime, /cap_drop: \[ALL\]/);
  assert.match(runtime, /127\.0\.0\.1:\$\{CHEF_API_PORT:-39370\}:39370/); assert.doesNotMatch(runtime, /^\s*env_file:|docker\.sock/m);
  const api = shielded.slice(shielded.indexOf('\n  api:'));
  assert.doesNotMatch(api, /volumes:|ZEER_VIEWING_KEY_FILE|\/run\/secrets/);
  assert.match(shielded, /create_host_path: false/);
  for (const pattern of ['**/.env', '**/.env.*', '**/private', '**/*key*', '**/*ufvk*', '**/backups', '**/node_modules']) assert.ok(ignored.includes(pattern));
});
