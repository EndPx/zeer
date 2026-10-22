import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {main, composeArguments, execute} from '../../../examples/chef-deployment/runtime-control.mjs';

async function project(t) {
  const directory = await mkdtemp(join(tmpdir(), 'chef-runtime-control-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await Promise.all(['compose.yaml', 'compose.runtime.yaml'].map(name => writeFile(join(directory, name), 'services: {}\n')));
  return directory;
}

test('runtime operations keep migration explicit and stop preserves the database', async t => {
  const directory = await project(t);
  for (const [action, expected] of Object.entries({
    migrate: ['run', '--rm', 'migrate'], check: ['run', '--rm', 'check'],
    up: ['up', '-d', '--no-build', 'follower', 'api'], stop: ['stop', 'follower', 'api'],
    logs: ['logs', '--tail', '100', 'follower', 'api'], status: ['ps'],
  })) {
    const calls = [];
    await main([action], {directory, run: async (program, args, options) => calls.push({program, args, options})});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].program, 'docker');
    assert.deepEqual(calls[0].args, ['compose', '-f', join(directory, 'compose.yaml'), '-f', join(directory, 'compose.runtime.yaml'), ...expected]);
    assert.equal(calls[0].options.directory, directory);
    assert.ok(calls[0].options.signal instanceof AbortSignal);
  }
  await assert.rejects(main(['down'], {directory}), {code: 'INVALID_RUNTIME_ACTION'});
});

test('shielded overlay is included only when present and symlink overrides fail closed', async t => {
  const directory = await project(t);
  await writeFile(join(directory, 'compose.shielded.yaml'), 'services: {}\n');
  assert.deepEqual((await composeArguments(directory)).slice(-2), ['-f', join(directory, 'compose.shielded.yaml')]);
  if (process.platform !== 'win32') {
    await rm(join(directory, 'compose.shielded.yaml'));
    await symlink(join(directory, 'compose.yaml'), join(directory, 'compose.shielded.yaml'));
    await assert.rejects(composeArguments(directory), {code: 'COMPOSE_FILES_UNAVAILABLE'});
  }
});

test('build refuses an unlocked project before executing commands', async t => {
  const directory = await project(t);
  let called = false;
  await assert.rejects(main(['build'], {directory, run: async () => { called = true; }}), {code: 'PNPM_LOCKFILE_REQUIRED'});
  assert.equal(called, false);
});

test('build generates types and checks the project before invoking Docker', async t => {
  const directory = await project(t);
  const sdk = join(directory, 'node_modules/@zeer-dev/chef/dist');
  const compiler = join(directory, 'node_modules/typescript');
  await mkdir(sdk, {recursive: true}); await mkdir(join(compiler, 'bin'), {recursive: true});
  await writeFile(join(sdk, 'cli.js'), '');
  await writeFile(join(compiler, 'package.json'), JSON.stringify({name: 'typescript', version: '7.0.2'}));
  await writeFile(join(directory, 'package.json'), JSON.stringify({dependencies: {'@zeer-dev/chef': '0.5.0'}}));
  await writeFile(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const calls = [];
  await main(['build'], {directory, run: async (program, args) => calls.push({program, args})});
  assert.deepEqual(calls.map(call => call.program), [process.execPath, process.execPath, 'docker']);
  assert.deepEqual(calls[0].args, [join(sdk, 'cli.js'), 'codegen', '--config', join(directory, 'chef.config.ts'), '--json']);
  assert.deepEqual(calls[1].args, [join(compiler, 'bin', 'tsc'), '--noEmit', '--project', join(directory, 'tsconfig.json')]);
  assert.deepEqual(calls[2].args.slice(-3), ['build', 'follower', 'api']);
  const stopped = [];
  await assert.rejects(main(['build'], {directory, run: async (program) => {stopped.push(program); throw Error('invalid model');}}), /invalid model/);
  assert.deepEqual(stopped, [process.execPath]);
});

test('command deadline terminates owned descendants holding its output pipe', {timeout: 15000}, async t => {
  const directory = await project(t), childFile = join(directory,'child.mjs'), pids = join(directory,'pids.json');
  await writeFile(childFile, `import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid]));
setInterval(()=>{},1000);
`);
  t.after(async () => {try{for(const pid of JSON.parse(await readFile(pids,'utf8'))){try{process.kill(pid,'SIGKILL');}catch{}}}catch{}});
  const started=Date.now();
  await assert.rejects(execute(process.execPath,[childFile,pids],{directory,timeoutMs:1500}),{code:'RUNTIME_COMMAND_FAILED'});
  assert.ok(Date.now()-started<10000,'deadline must not leave inherited output open');
  const ids=JSON.parse(await readFile(pids,'utf8'));
  for(const pid of ids){
    let running=true;try{process.kill(pid,0);}catch(error){assert.equal(error.code,'ESRCH');running=false;}
    if(running&&process.platform==='linux'){
      try{running=!/^State:\s+Z/m.test(await readFile(`/proc/${pid}/status`,'utf8'));}
      catch(error){if(error.code==='ENOENT')running=false;else throw error;}
    }
    assert.equal(running,false,`owned process ${pid} survived`);
  }
});
