import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareProject, preflightDev, superviseDev } from '../dist/dev.js';
import { parseModel } from '../dist/schema.js';

const secret = 'PRIVATE_HANDLER_OUTPUT_DO_NOT_FORWARD';
test('dev refuses an ahead readable checkpoint before API startup, while a durably closed gate may recover', async () => {
  for (const status of ['ready', 'reconciling']) {
    const report = {command:'doctor',ready:true,status:'ready',checks:[],checkpoint:{status,height:100},source:{availability:'available',checkpointAheadOfPrep:true}};
    const promise = preflightDev({inspect:async()=>report,migrate:async()=>assert.fail('no migration'),allowMigration:false,emit(){}});
    if (status==='ready') await assert.rejects(promise,{code:'DEV_RECONCILIATION_REQUIRED'});
    else await promise;
  }
});
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'chef-dev-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function records(path) {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function until(predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await delay(15); }
  assert.fail('Disposable subprocess did not reach its expected lifecycle state');
}
async function supervisor(t, scenario = {}) {
  const path = await directory(t);
  const configPath = join(path, 'scenario.json');
  const log = join(path, 'lifecycle.ndjson');
  const entry = join(path, 'child.mjs');
  await writeFile(configPath, JSON.stringify({ ...scenario, log, secret }));
  await writeFile(entry, `
import { appendFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2), role = args[0] === 'serve' ? 'api' : 'follower';
const config = JSON.parse(readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
function record(event) { appendFileSync(config.log, JSON.stringify({role,pid:process.pid,event})+'\\n'); }
function out(value) { process.stdout.write(JSON.stringify(value)+'\\n'); }
record('started');
process.on('message', message => { if (message?.type === 'zeer-stop') { record('ipc_stop'); if (config.ignoreStopRole !== role) process.exit(0); } });
process.on('SIGTERM', () => { record('signal_stop'); if (config.ignoreStopRole !== role) process.exit(0); });
setInterval(() => {}, 1000);
if (config.descendantRole === role) {
  spawn(process.execPath, ['--input-type=module', '-e',
    "import {appendFileSync} from 'node:fs'; const log="+JSON.stringify(config.log)+"; appendFileSync(log,JSON.stringify({role:'descendant',pid:process.pid,event:'started'})+'\\\\n'); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);"], {stdio:'ignore'});
}
if (role === 'api') {
  if (config.noise) { out({command:'serve',status:'listening',host:'wrong',port:123}); process.stdout.write(config.secret+'\\n'); }
  if (!config.neverReady) setTimeout(() => {
    record('listening');
    out({command:'serve',status:'listening',host:args[args.indexOf('--listen')+1],port:Number(args[args.indexOf('--port')+1])});
    if (config.failRole === role) setTimeout(() => { record('exiting'); process.exit(config.exitCode ?? 1); }, config.failDelay ?? 250);
  }, config.readyDelay ?? 20);
} else {
  if (config.noise) {
    process.stdout.write(config.secret+'\\n');
    process.stderr.write(config.secret+'\\n');
    out({command:'sync',state:'progress',secret:config.secret,checkpoint:{height:7,status:'ready',secret:config.secret},source:{availability:'available',indexedHeight:8,secret:config.secret}});
    process.stdout.write('x'.repeat(70000)+config.secret+'\\n');
    out({command:'sync',state:'caught_up',checkpoint:{height:8,status:'ready'}});
    process.stderr.write(JSON.stringify({error:{code:'WRITER_ALREADY_ACTIVE',details:config.secret},help:config.secret})+'\\n');
  }
  if (config.failRole === role) setTimeout(() => { record('exiting'); process.exit(config.exitCode ?? 1); }, 30);
}
`);
  const controller = new AbortController();
  const events = [];
  const completion = superviseDev({ configPath, entry, host: '127.0.0.1', port: 39370,
    pollSeconds: 1, signal: controller.signal, emit: event => events.push(event),
    startupMs: scenario.startupMs ?? 3000, shutdownMs: 300 });
  // Attach immediately so expected child failures cannot create unhandled rejection noise.
  completion.catch(() => {});
  t.after(async () => { controller.abort(); await completion.catch(() => {}); });
  return { events, completion, controller, log };
}

test('dev waits for the matching API listening event before starting follower, then stops both through IPC', { timeout: 10000 }, async t => {
  const f = await supervisor(t, { noise: true, readyDelay: 150 });
  await until(async () => (await records(f.log)).some(row => row.role === 'api' && row.event === 'started'));
  assert.equal((await records(f.log)).some(row => row.role === 'follower'), false);
  await until(async () => (await records(f.log)).some(row => row.role === 'follower' && row.event === 'started'));
  f.controller.abort();
  await f.completion;
  const lifecycle = await records(f.log);
  assert.ok(lifecycle.findIndex(row => row.event === 'listening') < lifecycle.findIndex(row => row.role === 'follower'));
  for (const role of ['api', 'follower']) assert.ok(lifecycle.some(row => row.role === role && row.event === 'ipc_stop'));
  assert.equal(f.events.at(-1).status, 'stopped');
});

for (const role of ['api', 'follower']) {
  for (const exitCode of [0, 1]) {
    test(`dev rejects ${role} exit ${exitCode} and stops its peer`, { timeout: 10000 }, async t => {
      const f = await supervisor(t, { failRole: role, exitCode });
      await assert.rejects(f.completion, { code: role === 'api' ? 'DEV_API_EXITED' : 'DEV_FOLLOWER_EXITED' });
      const peer = role === 'api' ? 'follower' : 'api';
      assert.ok((await records(f.log)).some(row => row.role === peer && row.event === 'ipc_stop'));
      assert.ok(f.events.some(event => event.status === 'child_failed' && event.role === role));
    });
  }
}

test('dev startup timeout stops API without launching follower', { timeout: 10000 }, async t => {
  const f = await supervisor(t, { neverReady: true, startupMs: 700 });
  await assert.rejects(f.completion, { code: 'DEV_API_START_TIMEOUT' });
  const lifecycle = await records(f.log);
  assert.equal(lifecycle.some(row => row.role === 'follower'), false);
  assert.ok(lifecycle.some(row => row.role === 'api' && row.event === 'ipc_stop'));
});

test('dev sanitizes arbitrary child output, diagnostic details and oversized lines while preserving safe progress', { timeout: 10000 }, async t => {
  const f = await supervisor(t, { noise: true, failRole: 'follower' });
  await assert.rejects(f.completion, { code: 'DEV_FOLLOWER_EXITED' });
  const serialized = JSON.stringify(f.events);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('x'.repeat(100)), false);
  assert.ok(f.events.some(event => event.state === 'progress' && event.checkpoint.height === 7));
  assert.ok(f.events.some(event => event.state === 'caught_up' && event.checkpoint.height === 8));
  assert.ok(f.events.some(event => event.status === 'child_failed' && event.error?.code === 'WRITER_ALREADY_ACTIVE'));
});

test('dev already-aborted signal starts no children', async t => {
  const path = await directory(t), controller = new AbortController(), events = [];
  controller.abort();
  await superviseDev({ configPath: join(path, 'unused'), entry: join(path, 'missing.mjs'), host: '127.0.0.1', port: 39370,
    pollSeconds: 1, signal: controller.signal, emit: event => events.push(event) });
  assert.deepEqual(events, [{ command: 'dev', status: 'stopped' }]);
});

test('dev force-stops an owned peer that ignores the graceful stop request', { timeout: 10000 }, async t => {
  const f = await supervisor(t, { failRole: 'follower', ignoreStopRole: 'api' });
  await assert.rejects(f.completion, { code: 'DEV_FOLLOWER_EXITED' });
  const lifecycle = await records(f.log), api = lifecycle.find(row => row.role === 'api');
  assert.ok(lifecycle.some(row => row.role === 'api' && row.event === 'ipc_stop'));
  assert.throws(() => process.kill(api.pid, 0), { code: 'ESRCH' });
});

test('dev terminates descendants in the failed leader owned process group', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const f = await supervisor(t, { failRole: 'api', descendantRole: 'api', failDelay: 1000 });
  await assert.rejects(f.completion, { code: 'DEV_API_EXITED' });
  const descendant = (await records(f.log)).find(row => row.role === 'descendant');
  assert.ok(descendant, 'fixture descendant must have started before the API exited');
  // Some Linux init implementations briefly retain a killed orphan as a zombie.
  await until(async () => {
    try { process.kill(descendant.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    try { return /\) Z /.test(await readFile(`/proc/${descendant.pid}/stat`, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  });
});

function report(codes = [], ready = codes.length === 0) {
  return { command: 'doctor', ready, status: ready ? 'ready' : 'not_ready',
    checks: codes.map(code => ({ name: 'fixture', status: 'fail', code, help: 'fixture' })) };
}
test('dev migrates only with explicit permission and migration as the sole blocking diagnostic, then checks again', async () => {
  let inspections = 0, migrations = 0;
  const events = [];
  await preflightDev({ allowMigration: true, inspect: async () => ++inspections === 1 ? report(['MIGRATION_REQUIRED']) : report(),
    migrate: async () => { migrations++; }, emit: event => events.push(event) });
  assert.equal(migrations, 1); assert.equal(inspections, 2); assert.equal(events.length, 2);
  for (const [allowMigration, codes] of [[false, ['MIGRATION_REQUIRED']], [true, ['MIGRATION_REQUIRED', 'PROJECT_IDENTITY_MISMATCH']],
    [true, ['REBUILD_REQUIRED']], [true, []]]) {
    let calls = 0;
    await assert.rejects(preflightDev({ allowMigration, inspect: async () => report(codes, false),
      migrate: async () => { calls++; }, emit() {} }), { code: 'DEV_PREFLIGHT_FAILED' });
    assert.equal(calls, 0);
  }
  let calls = 0;
  await preflightDev({ allowMigration: true, inspect: async () => report(), migrate: async () => { calls++; }, emit() {} });
  assert.equal(calls, 0);
  await assert.rejects(preflightDev({ allowMigration: true, inspect: async () => report(['MIGRATION_REQUIRED']),
    migrate: async () => {}, emit() {} }), { code: 'DEV_PREFLIGHT_FAILED' });
});

async function project(t) {
  const path = await directory(t);
  await writeFile(join(path, 'package.json'), '{"type":"module"}');
  return { configPath: join(path, 'chef.config.mjs'), bytes: Buffer.from('fixture'), reorgWindow: 100,
    config: { project: 'dev_fixture', network: 'testnet', startHeight: 1, schema: 'schema.graphql', handlerVersion: '1', indexer: { block() {} } },
    model: parseModel('type Block { id: ID! height: Int! }') };
}
test('dev generates types and explicitly skips TypeScript for a JavaScript-only project', async t => {
  const f = await project(t), events = [];
  await prepareProject(f, event => events.push(event), new AbortController().signal);
  assert.match(await readFile(join(f.configPath, '..', 'chef.generated.ts'), 'utf8'), /interface Block/);
  assert.deepEqual(events.map(event => event.status), ['generated', 'typecheck_skipped']);
  assert.equal(events[1].reason, 'no_tsconfig');
});

test('dev requires a project-local compiler for tsconfig and propagates compiler failure without its output', async t => {
  const f = await project(t), directory = join(f.configPath, '..');
  await writeFile(join(directory, 'tsconfig.json'), '{}');
  await assert.rejects(prepareProject(f, () => {}, new AbortController().signal), { code: 'PROJECT_TYPESCRIPT_REQUIRED' });
  const compiler = join(directory, 'node_modules', 'typescript', 'bin');
  await mkdir(compiler, { recursive: true });
  await writeFile(join(compiler, '..', 'package.json'), '{"name":"typescript","version":"0.0.0","exports":{"./package.json":"./package.json"}}');
  const marker = join(directory, 'compiler-args.json');
  await writeFile(join(compiler, 'tsc'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2))); process.stderr.write(${JSON.stringify(secret)}); process.exit(1);`);
  const events = [];
  await assert.rejects(prepareProject(f, event => events.push(event), new AbortController().signal), { code: 'TYPECHECK_FAILED' });
  assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), ['--noEmit', '--project', join(directory, 'tsconfig.json')]);
  assert.equal(JSON.stringify(events).includes(secret), false);
  await writeFile(join(compiler, 'tsc'), 'process.exit(0);');
  await prepareProject(f, event => events.push(event), new AbortController().signal);
  assert.equal(events.at(-1).status, 'typechecked');
});

test('dev cancellation kills the installed compiler even when it ignores SIGTERM and does not report services started', { timeout: 5000 }, async t => {
  const f = await project(t), directory = join(f.configPath, '..');
  await writeFile(join(directory, 'tsconfig.json'), '{}');
  const compiler = join(directory, 'node_modules', 'typescript', 'bin');
  await mkdir(compiler, { recursive: true });
  await writeFile(join(compiler, '..', 'package.json'), '{"name":"typescript","version":"0.0.0"}');
  const marker = join(directory, 'compiler-ready.json');
  await writeFile(join(compiler, 'tsc'), `
process.on('SIGTERM', () => {});
require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,ready:true}));
setInterval(() => {}, 1000);
`);
  const controller = new AbortController(), events = [];
  let pid;
  const completion = prepareProject(f, event => events.push(event), controller.signal);
  completion.catch(() => {});
  t.after(async () => {
    controller.abort();
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    await completion.catch(() => {});
  });
  await until(async () => {
    try { const state = JSON.parse(await readFile(marker, 'utf8')); pid = state.pid; return state.ready === true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }, 2000);
  controller.abort();
  await assert.rejects(completion, { code: 'TYPECHECK_FAILED' });
  await until(() => {
    try { process.kill(pid, 0); return false; }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  }, 1500);
  pid = undefined;
  assert.deepEqual(events, [{ command: 'dev', status: 'generated' }]);
});
