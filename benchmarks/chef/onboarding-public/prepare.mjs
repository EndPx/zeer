// Fresh tarball installation only. This command makes no Prep request.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,realpath,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const [rootInput,candidateInput]=process.argv.slice(2);assert(rootInput&&candidateInput,'Usage: node prepare.mjs NEW_OUTSIDE_ROOT CANDIDATE_TARBALL');
const root=resolve(rootInput),candidate=await realpath(candidateInput);
assert((await stat(candidate)).isFile()&&candidate.endsWith('.tgz'));
await mkdir(root,{mode:0o700});
await writeFile(join(root,'empty-user.npmrc'),'');await writeFile(join(root,'empty-global.npmrc'),'');
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG??'C.UTF-8',NPM_CONFIG_USERCONFIG:join(root,'empty-user.npmrc'),NPM_CONFIG_GLOBALCONFIG:join(root,'empty-global.npmrc')};
await writeFile(join(root,'package.json'),JSON.stringify({name:'zeer-public-onboarding-acceptance',private:true,type:'module',dependencies:{'@zeer-dev/chef':`file:${candidate}`,'@zeer-dev/prep-client':'0.1.0',typescript:'7.0.2'}},null,2)+'\n');
const child=spawn('pnpm',['install','--ignore-scripts','--registry=https://registry.npmjs.org','--store-dir',join(root,'store')],{cwd:root,env,stdio:'inherit',windowsHide:true});
const timeout=setTimeout(()=>child.kill('SIGKILL'),240000);
try{assert.equal(await new Promise((r,j)=>{child.once('error',j);child.once('exit',r);}),0);}finally{clearTimeout(timeout);}
const manifest=JSON.parse(await readFile(join(root,'node_modules/@zeer-dev/chef/package.json'),'utf8'));
await writeFile(join(root,'prepared.json'),JSON.stringify({candidate_path:candidate,candidate_sha256:createHash('sha256').update(await readFile(candidate)).digest('hex'),chef_version:manifest.version,prepared_at_utc:new Date().toISOString(),prep_requests:0},null,2)+'\n');
console.log(JSON.stringify({prepared:true,chef_version:manifest.version,prep_requests:0}));
