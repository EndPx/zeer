import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {installedPrep,cleanup,removeFile,stopped} from './resources.mjs';

test('Prep oracle loads from the standalone installation rather than checkout resolution',async t=>{
 const root=await mkdtemp(join(tmpdir(),'zeer-oracle-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const pkg=join(root,'node_modules/@zeer-dev/prep-client');await mkdir(join(pkg,'src'),{recursive:true});
 await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@zeer-dev/prep-client',version:'0.1.0',type:'module',exports:{'.':{import:'./src/index.js'}}}));
 await writeFile(join(pkg,'src/index.js'),'export class PrepClient {static source="standalone-fixture";}');
 assert.equal((await installedPrep(root)).PrepClient.source,'standalone-fixture');
 const linked=join(root,'linked');await mkdir(join(linked,'node_modules/@zeer-dev'),{recursive:true});
 await symlink(pkg,join(linked,'node_modules/@zeer-dev/prep-client'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(installedPrep(linked),/WORKSPACE_CLIENT_FORBIDDEN/);
});

test('a real forced child stop cannot skip credentials, HTTP teardown or failure proof',async t=>{
 const root=await mkdtemp(join(tmpdir(),'zeer-cleanup-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const env=join(root,'.env'),key=join(root,'fixture.ufvk'),proof=join(root,'proof.json');
 await writeFile(env,'TEST_SECRET=local-only');await writeFile(key,'unfunded fixture');
 const server=createServer((req,res)=>res.end('test'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,['-e','process.stdout.write("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore']});
 t.after(()=>{if(!stopped(child))child.kill('SIGKILL');server.close();});await once(child.stdout,'data');
 const original=new Error('original-readiness-failure');
 const failure=await cleanup([
  async()=>{const closed=once(child,'close');child.kill('SIGKILL');await closed;assert.equal(child.exitCode,0,'forced-stop-diagnostic');},
  ()=>removeFile(env),()=>removeFile(key),()=>new Promise(r=>server.close(r)),
 ],original);
 await writeFile(proof,JSON.stringify({status:failure?'FAIL':'PASS'}));
 assert.equal(failure,original);assert.ok(stopped(child));assert.equal(server.listening,false);
 await assert.rejects(readFile(env),{code:'ENOENT'});await assert.rejects(readFile(key),{code:'ENOENT'});
 assert.equal(JSON.parse(await readFile(proof)).status,'FAIL');
 const stopFailure=new Error('stop-failure');assert.equal(await cleanup([async()=>{throw stopFailure;}]),stopFailure);
});
