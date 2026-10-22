import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
const run=(args,env={})=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:{...process.env,PREP_URL:'',PREP_API_TOKEN:'',...env},timeout:15000});

test('launcher runs Chef version and per-command help through its actual entry point',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(manifest.dependencies['@zeer-dev/chef'],manifest.version);
 const version=run(['--version']);assert.equal(version.status,0,version.stderr);assert.equal(version.stdout.trim(),manifest.version);
 for(const command of ['init','codegen','migrate','sync','serve','status']){
  const result=run([command,'--help']);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,new RegExp(`zeer ${command}`));
 }
});

test('launcher forwards scaffold choices and preserves no-overwrite and offline behavior',async t=>{
 const root=await mkdtemp(join(tmpdir(),'zeer-launcher-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const template of ['blank','public','shielded']){
  const directory=join(root,template),args=['init','--template',template,'--dir',directory,'--project',`cli_${template}`,'--start-height','42','--json'];
  const result=run(args,{PREP_URL:'https://offline.invalid'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).template,template);
  const config=await readFile(join(directory,'chef.config.ts'),'utf8');assert.match(config,/startHeight: 42/);
  const original=await readFile(join(directory,'.env'),'utf8');assert.equal(result.stdout.includes(original.match(/^CHEF_API_TOKEN=(.+)$/m)[1]),false);
  const repeated=run(args);assert.equal(repeated.status,1);assert.equal(JSON.parse(repeated.stderr).error.code,'PROJECT_DIRECTORY_EXISTS');assert.equal(await readFile(join(directory,'.env'),'utf8'),original);
 }
});

test('Chef errors keep their nonzero exit and never expose third-party error messages',async t=>{
 const root=await mkdtemp(join(tmpdir(),'zeer-launcher-error-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'secret-config.mjs'),secret='DO_NOT_PRINT_PRIVATE_CONFIG_DETAIL';await writeFile(config,`throw new Error(${JSON.stringify(secret)});`);
 const failed=run(['status','--config',config,'--json']);assert.equal(failed.status,1);assert.equal(JSON.parse(failed.stderr).error.code,'CHEF_COMMAND_FAILED');assert.equal((failed.stdout+failed.stderr).includes(secret),false);
 const invalid=run(['init','--template','shielded','--dir',join(root,'absent'),'--project','inbox','--start-height','latest','--json']);assert.equal(invalid.status,1);assert.equal(JSON.parse(invalid.stderr).error.code,'SHIELDED_BIRTHDAY_REQUIRED');
});
