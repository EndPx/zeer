import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, lstat, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scaffoldProject } from '../dist/scaffold.js';

const cli=fileURLToPath(new URL('../dist/cli.js',import.meta.url));
test('init creates a standalone testnet project without contacting services or printing secrets', async () => {
  const parent=await mkdtemp(join(tmpdir(),'zeer-scaffold-'));
  const directory=join(parent,'app');
  const result=spawnSync(process.execPath,[cli,'init','--dir',directory,'--project','my_app','--start-height','1000','--json'],
    {encoding:'utf8',env:{...process.env,PREP_URL:'https://invalid.example',DATABASE_URL:'postgres://invalid.example'}});
  assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);
  assert.equal(output.network,'testnet');
  const env=await readFile(join(directory,'.env'),'utf8');
  const password=env.match(/^POSTGRES_PASSWORD=(.+)$/m)[1],token=env.match(/^CHEF_API_TOKEN=(.+)$/m)[1];
  assert.equal(password.length,48); assert.equal(token.length,64);
  assert.equal(result.stdout.includes(password)||result.stdout.includes(token),false);
  assert.match(env,/^PREP_URL=$/m);
  assert.match(env,new RegExp(`DATABASE_URL=postgresql://chef:${password}@127.0.0.1:39472/chef`));
  assert.equal((await readFile(join(directory,'.env.example'),'utf8')).includes(token),false);
  if(process.platform!=='win32') assert.equal((await lstat(join(directory,'.env'))).mode & 0o777,0o600);
  await assert.rejects(lstat(join(directory,'node_modules')),{code:'ENOENT'});
  assert.match(await readFile(join(directory,'chef.config.ts'),'utf8'),/network: "testnet"/);
  assert.match(await readFile(join(directory,'compose.yaml'),'utf8'),/POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/);
  const second=join(parent,'second');
  await scaffoldProject({directory:second,project:'second',startHeight:0});
  assert.match(await readFile(join(second,'chef.config.ts'),'utf8'),/startHeight: 0/);
  assert.equal((await readFile(join(second,'.env'),'utf8')).includes(token),false);
});

test('init refuses existing files/directories and rejects invalid inputs before writing',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'zeer-no-overwrite-'));
  const directory=join(parent,'existing'); await mkdir(directory);
  await writeFile(join(directory,'important.txt'),'preserve me');
  await assert.rejects(scaffoldProject({directory,project:'good',startHeight:1}),{code:'PROJECT_DIRECTORY_EXISTS'});
  assert.equal(await readFile(join(directory,'important.txt'),'utf8'),'preserve me');
  const path=join(parent,'file'); await writeFile(path,'preserve file');
  await assert.rejects(scaffoldProject({directory:path,project:'good',startHeight:1}),{code:'PROJECT_DIRECTORY_EXISTS'});
  const invalid=join(parent,'invalid');
  await assert.rejects(scaffoldProject({directory:invalid,project:'bad-name',startHeight:1}),{code:'INVALID_PROJECT_NAME'});
  await assert.rejects(scaffoldProject({directory:invalid,project:'good',startHeight:-1}),{code:'INVALID_START_HEIGHT'});
  await assert.rejects(lstat(invalid),{code:'ENOENT'});
  if(process.platform!=='win32') {
    const link=join(parent,'link'); await symlink(directory,link);
    await assert.rejects(scaffoldProject({directory:link,project:'good',startHeight:1}),{code:'PROJECT_DIRECTORY_EXISTS'});
  }
});

test('init reports missing arguments and rejects conflicting flags',()=>{
  for(const args of [['init'],['init','--dir','unused','--project','good','--start-height','-1'],['init','--config','x']]) {
    const r=spawnSync(process.execPath,[cli,...args,'--json'],{encoding:'utf8'});
    assert.equal(r.status,1); assert.ok(JSON.parse(r.stderr).error.code);
  }
});
