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
  assert.match(env,/^PREP_URL=https:\/\/invalid.example$/m);
  assert.match(env,new RegExp(`DATABASE_URL=postgresql://chef:${password}@127.0.0.1:39472/chef`));
  assert.equal((await readFile(join(directory,'.env.example'),'utf8')).includes(token),false);
  if(process.platform!=='win32') assert.equal((await lstat(join(directory,'.env'))).mode & 0o777,0o600);
  await assert.rejects(lstat(join(directory,'node_modules')),{code:'ENOENT'});
  assert.match(await readFile(join(directory,'chef.config.ts'),'utf8'),/network: "testnet"/);
  assert.match(await readFile(join(directory,'chef.config.ts'),'utf8'),/sync: \{ pageSize: 1000, batchSize: 32 \}/);
  assert.match(await readFile(join(directory,'chef.config.ts'),'utf8'),/async transactionMetadata\(/);
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

test('blank scaffold has no sample model or application handler',async t=>{
  const parent=await mkdtemp(join(tmpdir(),'zeer-blank-'));
  const directory=join(parent,'blank');const result=await scaffoldProject({directory,project:'blank',startHeight:100,template:'blank'});
  assert.equal(result.template,'blank');
  const schema=await readFile(join(directory,'schema.graphql'),'utf8'),handlers=await readFile(join(directory,'handlers.ts'),'utf8');
  assert.equal(schema.replace(/#[^\n]*/g,'').trim(),'');
  assert.match(handlers,/defineIndexer\(\{\}\)/);assert.doesNotMatch(handlers,/async block|receipt|BlockSummary/);
  assert.doesNotMatch(await readFile(join(directory,'chef.config.ts'),'utf8'),/chef.generated/);
  assert.match((await readFile(join(directory,'README.md'),'utf8')),/Define your model/);
});

test('shielded scaffold packages receipt/query/consumer files and only local key paths',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'zeer-inbox-')),directory=join(parent,'inbox');
  const result=await scaffoldProject({directory,project:'my_inbox',startHeight:4523000,template:'shielded'});
  assert.equal(result.template,'shielded');
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  assert.equal(manifest.scripts['scanner:install'],'node install-scanner.mjs');assert.match(manifest.scripts.consume,/--env-file/);
  assert.match(await readFile(join(directory,'schema.graphql'),'utf8'),/type ReadableNote/);
  assert.match(await readFile(join(directory,'handlers.ts'),'utf8'),/valueZat: BigInt\(receipt.value_zat\)/);
  assert.match(await readFile(join(directory,'consumer.mjs'),'utf8'),/class ContinuousConsumer/);
  assert.match(await readFile(join(directory,'.env'),'utf8'),/^ZEER_VIEWING_KEY_FILE=$/m);
  assert.match(await readFile(join(directory,'.env'),'utf8'),/^ZEER_BIRTHDAY_HEIGHT=4523000$/m);
  assert.match(await readFile(join(directory,'install-scanner.mjs'),'utf8'),/1a24bcc9f066466ec9dab902b21d8619c8a4a5fffdd1a2c2d8fc099b3fa6b00c/);
  assert.ok(result.files.includes('read-transaction.mjs'));
});
