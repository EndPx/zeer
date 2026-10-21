import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
test('an actual CLI deadline interrupting sleep reports deadline rather than successful stop',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'zeer-cli-'));const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({project:'receipts',generation:'one',revision:'1',checkpoint:{status:'reconciling'}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let timer,child;
 try{
  child=spawn(process.execPath,[fileURLToPath(new URL('./consume.mjs',import.meta.url)),'--db',join(directory,'private.sqlite'),'--from','0','--project','receipts','--mode','continuous','--follow','--deadline-seconds','1','--interval-seconds','30'],{env:{...process.env,CHEF_URL:`http://127.0.0.1:${server.address().port}`,CHEF_API_TOKEN:'controlled-cli-token'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);timer=setTimeout(()=>child.kill('SIGKILL'),8000);
  const code=await new Promise((r,j)=>{child.once('exit',r);child.once('error',j);});assert.equal(code,2);assert.match(out,/INDEXER_RECONCILING/);assert.match(err,/DEADLINE_EXCEEDED/);
 }finally{clearTimeout(timer);if(child?.exitCode===null)child.kill('SIGKILL');server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
});
test('operator SIGTERM stops an indefinite follower cleanly',{skip:process.platform==='win32'},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'zeer-cli-stop-'));const server=createServer((req,res)=>res.end(JSON.stringify({project:'receipts',generation:'one',revision:'1',checkpoint:{status:'reconciling'}})));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let child,timer;
 try{
  child=spawn(process.execPath,[fileURLToPath(new URL('./consume.mjs',import.meta.url)),'--db',join(directory,'private.sqlite'),'--from','0','--project','receipts','--mode','continuous','--follow','--interval-seconds','30'],{env:{...process.env,CHEF_URL:`http://127.0.0.1:${server.address().port}`,CHEF_API_TOKEN:'controlled-cli-token'},stdio:['ignore','pipe','pipe']});
  let err='',sent=false;child.stderr.on('data',v=>err+=v);child.stdout.on('data',()=>{if(!sent){sent=true;child.kill('SIGTERM');}});timer=setTimeout(()=>child.kill('SIGKILL'),8000);
  const code=await new Promise((r,j)=>{child.once('exit',r);child.once('error',j);});assert.ok(sent);assert.equal(code,0);assert.match(err,/STOPPED/);
 }finally{clearTimeout(timer);if(child?.exitCode===null)child.kill('SIGKILL');server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
});
