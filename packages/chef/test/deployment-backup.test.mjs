import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { main } from '../../../examples/chef-deployment/backup.mjs';

const expected = { project: 'payments', network: 'testnet', fingerprint: 'a'.repeat(64), model: 'b'.repeat(64), configSha256: 'c'.repeat(64), schemaSha256: 'd'.repeat(64) };
const secret = 'SECRET_DSN_PASSWORD_UFVK_NOT_FOR_OUTPUT';
const archive = Buffer.from('PGDMP\x01\x0e\0' + secret);
async function fixture(t, scenario = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'chef-backup-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await Promise.all(['compose.yaml','compose.runtime.yaml'].map(name=>writeFile(join(cwd,name),'services: {}\n')));
  const entry = join(cwd, 'docker.mjs'), log = join(cwd, 'calls.ndjson'), events = [];
  await writeFile(entry, `import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2), scenario=${JSON.stringify(scenario)}, secret=${JSON.stringify(secret)};
appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
process.stderr.write(secret);
const tool=args[args.indexOf('postgres')+1];
if(scenario.hang && tool==='pg_dump'){setInterval(()=>{},1000);}
else if(tool==='psql'){
 const sql=args.at(-1);
 if(sql.includes('pg_database')) process.stdout.write(scenario.exists?'1\\n':'');
 else {const state=${JSON.stringify({fingerprint: expected.fingerprint, model: expected.model, network: expected.network})};
 if(scenario.sourceMismatch || (scenario.restoredMismatch && args[args.indexOf('--dbname')+1]!=='chef'))state.fingerprint='e'.repeat(64);
 process.stdout.write(JSON.stringify(state)+'\\n');}
}else if(tool==='pg_dump'){
 process.stdout.write(Buffer.from(${JSON.stringify([...archive])}));
 if(scenario.dumpFail)process.exitCode=2;
}else if(tool==='pg_restore'){
 process.stdin.resume();process.stdin.on('end',()=>{if(scenario.restoreFail)process.exitCode=3;});
}else if(tool!=='createdb')process.exitCode=9;
`);
  const deps = { cwd, identity: async () => expected, write: event => events.push(event),
    env: { ...process.env, POSTGRES_PASSWORD: secret },
    spawn: (command, args, options) => { assert.equal(command, 'docker'); return spawn(process.execPath, [entry, ...args], options); }, timeoutMs: 3000 };
  const calls = async () => { try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch (error) { if(error.code==='ENOENT')return []; throw error; } };
  return { cwd, events, deps, calls, file: join(cwd, 'receipt.dump') };
}
async function backup(f) { assert.equal(await main(['backup', '--file', f.file], f.deps), 0, JSON.stringify(f.events)); }

test('runtime and recovery select the same optional Compose override', async t => {
  const f = await fixture(t), override = join(f.cwd,'operator.yaml');
  await writeFile(override,'name: isolated_project\nservices: {}\n');
  f.deps.env.CHEF_COMPOSE_OVERRIDE = override;
  await backup(f);
  for (const args of await f.calls()) {
    assert.deepEqual(args.slice(0,7),['compose','-f',join(f.cwd,'compose.yaml'),'-f',join(f.cwd,'compose.runtime.yaml'),'-f',override]);
  }
});

test('deployment backup streams a namespace-only custom archive and restores only into a fresh DB', { timeout: 10000 }, async t => {
  const f = await fixture(t); await backup(f);
  assert.deepEqual(await readFile(f.file), archive);
  const manifest = JSON.parse(await readFile(f.file + '.json', 'utf8'));
  assert.equal(manifest.sha256, createHash('sha256').update(archive).digest('hex'));
  assert.equal(manifest.bytes, archive.length);
  assert.equal(manifest.fingerprint, expected.fingerprint);
  if (process.platform !== 'win32') assert.equal((await stat(f.file)).mode & 0o777, 0o600);
  assert.equal(await main(['restore', '--file', f.file, '--database', 'restored_payments'], f.deps), 0);
  const calls = await f.calls();
  const dump = calls.find(args => args[args.indexOf('postgres')+1] === 'pg_dump');
  assert.ok(dump.includes('--schema')); assert.ok(dump.includes('chef_payments'));
  assert.equal(calls.filter(args => args[args.indexOf('postgres')+1] === 'createdb').length, 1);
  assert.ok(calls.every(args => !args.includes('--clean') && !args.includes('--create') && !args.includes('dropdb')));
  assert.ok(!JSON.stringify(f.events).includes(secret));
  assert.ok(!JSON.stringify(calls).includes(secret));
  await assert.rejects(readFile(f.file + '.incomplete.json'), { code: 'ENOENT' });
  await assert.rejects(readFile(f.file + '.restore-restored_payments.incomplete.json'), { code: 'ENOENT' });
});

test('backup never overwrites an existing archive or metadata sidecar', async t => {
  for (const suffix of ['', '.json', '.incomplete.json']) {
    const f = await fixture(t); await writeFile(f.file + suffix, 'keep');
    assert.equal(await main(['backup', '--file', f.file], f.deps), 1);
    assert.equal(await readFile(f.file + suffix, 'utf8'), 'keep'); assert.equal((await f.calls()).length, 0);
  }
});

test('failed dump retains an explicitly incomplete artifact without success metadata or dump output', async t => {
  const f = await fixture(t, { dumpFail: true });
  assert.equal(await main(['backup', '--file', f.file], f.deps), 1);
  assert.equal(JSON.parse(await readFile(f.file + '.incomplete.json', 'utf8')).status, 'incomplete');
  await assert.rejects(readFile(f.file + '.json'), { code: 'ENOENT' });
  assert.equal(f.events.at(-1).artifact, 'incomplete');
  assert.ok(!JSON.stringify(f.events).includes(secret));
});

test('restore rejects checksum, missing metadata and changed project identity before starting Docker', async t => {
  for (const change of ['missing', 'hash', 'identity', 'size']) {
    const f = await fixture(t); await backup(f); const before = (await f.calls()).length;
    if (change === 'missing') await rm(f.file + '.json');
    else if (change === 'hash') await writeFile(f.file, Buffer.from(archive.toString().replace('SECRET', 'ALTERD')));
    else {
      const info = JSON.parse(await readFile(f.file + '.json', 'utf8'));
      if (change === 'identity') info.configSha256 = 'e'.repeat(64); else info.bytes += 1;
      await writeFile(f.file + '.json', JSON.stringify(info));
    }
    assert.equal(await main(['restore', '--file', f.file, '--database', 'new_target'], f.deps), 1);
    assert.equal((await f.calls()).length, before);
  }
});

test('restore refuses current, default, invalid and existing databases without creating or dropping anything', async t => {
  for (const target of ['chef', 'other', 'bad-name', 'template1']) {
    const f = await fixture(t, { exists: true }); await backup(f); const before = (await f.calls()).length;
    f.deps.env.CHEF_DATABASE_NAME = target === 'other' ? 'other' : 'chef';
    assert.equal(await main(['restore', '--file', f.file, '--database', target], f.deps), 1);
    const added = (await f.calls()).slice(before);
    assert.ok(added.every(args => args[args.indexOf('postgres')+1] === 'psql'));
    assert.ok(!added.some(args => args[args.indexOf('postgres')+1] === 'createdb'));
  }
});

test('failed restore labels its partial fresh database and never deletes the original or target', async t => {
  const f = await fixture(t, { restoreFail: true }); await backup(f);
  assert.equal(await main(['restore', '--file', f.file, '--database', 'failed_restore'], f.deps), 1);
  assert.equal(f.events.at(-1).targetCreated, true);
  assert.equal(f.events.at(-1).originalDatabase, 'unchanged');
  assert.equal(JSON.parse(await readFile(f.file + '.restore-failed_restore.incomplete.json', 'utf8')).database, 'failed_restore');
  assert.ok((await f.calls()).every(args => !args.includes('dropdb')));
  assert.ok(!JSON.stringify(f.events).includes(secret));
});

test('backup rejects an incompatible source namespace; restore rejects incompatible restored state and incomplete archives', async t => {
  const source = await fixture(t, { sourceMismatch: true });
  assert.equal(await main(['backup', '--file', source.file], source.deps), 1);
  assert.equal(source.events.at(-1).code, 'DATABASE_IDENTITY_MISMATCH');
  assert.equal((await source.calls()).length, 1);
  await assert.rejects(readFile(source.file), { code: 'ENOENT' });
  const restored = await fixture(t, { restoredMismatch: true }); await backup(restored);
  assert.equal(await main(['restore', '--file', restored.file, '--database', 'new_database'], restored.deps), 1);
  assert.equal(restored.events.at(-1).code, 'DATABASE_IDENTITY_MISMATCH');
  assert.equal(restored.events.at(-1).targetCreated, true);
  const incomplete = await fixture(t); await backup(incomplete);
  await writeFile(incomplete.file + '.incomplete.json', '{}');
  const before = (await incomplete.calls()).length;
  assert.equal(await main(['restore', '--file', incomplete.file, '--database', 'new_database'], incomplete.deps), 1);
  assert.equal((await incomplete.calls()).length, before);
});

test('backup bounds child execution and archive size while retaining its incomplete label', { timeout: 10000 }, async t => {
  const hang = await fixture(t, { hang: true }); hang.deps.timeoutMs = 150;
  assert.equal(await main(['backup', '--file', hang.file], hang.deps), 1);
  assert.equal(hang.events.at(-1).code, 'DATABASE_COMMAND_TIMEOUT');
  const large = await fixture(t); large.deps.maxBytes = 10;
  assert.equal(await main(['backup', '--file', large.file], large.deps), 1);
  assert.equal(large.events.at(-1).artifact, 'incomplete');
});

test('cancelling backup terminates its owned child and retains an incomplete artifact', { timeout: 10000 }, async t => {
  const f = await fixture(t, { hang: true });
  const controller = new AbortController(); f.deps.signal = controller.signal;
  const job = main(['backup', '--file', f.file], f.deps);
  const deadline = Date.now() + 5000;
  while (!(await f.calls()).some(args => args[args.indexOf('postgres')+1] === 'pg_dump')) {
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 20));
  }
  controller.abort(); assert.equal(await job, 1);
  assert.equal(f.events.at(-1).code, 'DATABASE_COMMAND_ABORTED');
  assert.equal(f.events.at(-1).artifact, 'incomplete');
});

test('archive symlinks are refused and never followed', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); await backup(f);
  const linked = join(f.cwd, 'linked.dump'); await symlink(f.file, linked);
  await writeFile(linked + '.json', await readFile(f.file + '.json'));
  const before = (await f.calls()).length;
  assert.equal(await main(['restore', '--file', linked, '--database', 'new_target'], f.deps), 1);
  assert.equal((await f.calls()).length, before);
});
