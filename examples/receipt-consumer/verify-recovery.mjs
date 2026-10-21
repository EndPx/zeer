// Controlled-branch acceptance. This script never loads a viewing key or signs.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer as createTcpServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import pg from 'pg';
import {PostgresStore,parseModel,syncStep,createChefServer} from '@zeer-dev/chef';
import {RangeConsumer,ContinuousConsumer} from './consumer.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const project=`ref_${randomUUID().replaceAll('-','').slice(0,22)}`;
const directory=join(root,'private',project);await mkdir(directory,{recursive:true,mode:0o700});
const token=process.env.CHEF_API_TOKEN;assert.ok(typeof token==='string'&&token.length>=16);
assert.ok(process.env.DATABASE_URL);
const mode=process.env.ZEER_CONSUMER_MODE??'range';assert.ok(['range','continuous'].includes(mode));const Consumer=mode==='continuous'?ContinuousConsumer:RangeConsumer;
const proof={source:'controlled-regtest-branches',consumer_mode:mode,live_shielded_latency:false,viewing_key_loaded:false,project,checks:{}};
const h=n=>BigInt(n).toString(16).padStart(64,'0');
let epoch='1',ready=true;
const original=[40,41,42,43].map(height=>({height,hash:h(height+1),previousHash:h(height),time:1700000000+height,txid:h(1000+height)}));
let blocks=original.slice(0,3);
const client={
  async getHeight(){return {network:'regtest',payload_kind:'full-v1',ready,archive_height:blocks.at(-1).height,indexed_height:blocks.at(-1).height,source_height:blocks.at(-1).height+1,source_observed_at:Math.floor(Date.now()/1000),start_block:40,epoch};},
  async get(query){const selected=blocks.filter(b=>b.height>=query.from_block&&b.height<query.to_block).slice(0,query.limit);return {network:'regtest',epoch,from_block:query.from_block,next_block:selected.at(-1).height+1,data:{blocks:selected.map(b=>({height:b.height,hash:b.hash,previous_hash:b.previousHash,time:b.time})),transactions:query.field_selection.transaction.length?selected.map(b=>({block_height:b.height,index:0,txid:b.txid,version:6,locktime:0})):[]}};},
};
const model=parseModel(await readFile(join(root,'schema.graphql'),'utf8'));
const storeOptions={project,fingerprint:'standalone-recovery-v1',model,network:'regtest',startHeight:40,reorgWindow:10};
let store=new PostgresStore(process.env.DATABASE_URL,storeOptions);
const indexer={async transactionMetadata({block,transaction,context}){
  for(let index=0;index<12;index++)await context.entities.set('ReadableNote',{
    id:`${transaction.txid}:${String(index).padStart(2,'0')}`,txid:transaction.txid,pool:'ironwood',outputIndex:index,
    blockHeight:block.height,blockHash:block.hash,valueZat:BigInt(100000+index),receiver:'synthetic-receiver',memoHex:'00'.repeat(512),memoKind:'text',memoText:'controlled fixture',scope:'external',origin:'unknown',coinbase:false,
  });
}};
const step=()=>syncStep({client,store,indexer,network:'regtest',startHeight:40,reorgWindow:10,pageSize:16});
let server,disconnectServer,passed=false;const children=new Set(),http=[];
try{
  await store.migrate();await store.acquire();await step();
  server=createChefServer({store,model,token});server.on('request',(request,response)=>response.once('finish',()=>http.push({path:request.url,status:response.statusCode})));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const envFile=join(directory,'consumer.env');await writeFile(envFile,`CHEF_URL=${origin}\nCHEF_API_TOKEN=${token}\n`,{mode:0o600});
  const database=join(directory,'consumer.sqlite');
  const local=()=>new Consumer({file:database,url:origin,token,project,from:40});
  const snapshot=()=>{const c=local();try{return {state:c.state(),rows:c.rows()};}finally{c.close();}};
  async function run({killAfterPage=false,maxPages=20,rounds=1}={}){
    const child=spawn(process.execPath,['--env-file='+envFile,join(root,'consume.mjs'),'--mode',mode,'--db',database,'--project',project,'--from','40','--max-pages',String(maxPages),'--rounds',String(rounds),'--deadline-seconds','60'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child);
    const events=[];let buffer='',stderr='',killed=false;
    const timeout=setTimeout(()=>child.kill('SIGKILL'),65000);
    child.stdout.on('data',chunk=>{buffer+=chunk;for(;;){const index=buffer.indexOf('\n');if(index<0)break;const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line)continue;const value=JSON.parse(line);events.push(value);if(killAfterPage&&value.event==='page'&&value.state==='staged'&&!killed){killed=true;child.kill('SIGKILL');}}});
    child.stderr.on('data',chunk=>stderr+=chunk);
    const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
    clearTimeout(timeout);children.delete(child);
    if(killAfterPage)assert.ok(killed,'Child must reach a committed staged page before termination');
    else assert.ok(exit.code===0||exit.code===2,'Consumer failed; inspect protected logs');
    await writeFile(join(directory,`child-${proof.process_runs??0}.json`),JSON.stringify({events,exit,killed,stderr}));proof.process_runs=(proof.process_runs??0)+1;
    return {events,exit,killed};
  }
  await run({killAfterPage:true,maxPages:1,rounds:10});
  let state=snapshot();assert.equal(state.rows.length,0);assert.ok(state.state.scan.after.length>256);proof.checks.killed_after_atomic_page=true;
  await run();state=snapshot();assert.equal(state.rows.length,36);assert.equal(new Set(state.rows.map(r=>r.id)).size,36);proof.checks.restart_resumed_opaque_cursor=true;
  await run();assert.deepEqual(snapshot().rows,state.rows);proof.checks.completed_restart_no_duplicates=true;

  blocks=original;await step();await run({killAfterPage:true,maxPages:1,rounds:10});
  const previous=snapshot().rows;assert.equal(previous.length,36);
  epoch='2';blocks=[original[0],{...original[1],hash:h(941),previousHash:original[0].hash,txid:h(9041)},
    {...original[2],hash:h(942),previousHash:h(941),txid:original[1].txid}];
  await step();assert.equal((await store.checkpoint()).status,'ready');
  const restart=await run();assert.ok(restart.events.some(e=>e.reason==='CURSOR_INVALIDATED'));
  assert.deepEqual(snapshot().rows,previous);assert.equal(snapshot().state.scan,null);proof.checks.invalid_cursor_does_not_promote_staging=true;
  await run();const recovered=snapshot();
  assert.equal(recovered.rows.length,36);assert.equal(new Set(recovered.rows.map(r=>r.id)).size,36);
  const expectedIds=new Set(blocks.flatMap(b=>Array.from({length:12},(_,i)=>`${b.txid}:${String(i).padStart(2,'0')}`)));
  assert.deepEqual(new Set(recovered.rows.map(r=>r.id)),expectedIds);
  for(const row of recovered.rows){const b=blocks.find(b=>b.txid===row.txid);assert.equal(row.blockHeight,b.height);assert.equal(row.blockHash,b.hash);assert.equal(row.valueZat,String(100000+row.outputIndex));}
  assert.ok(recovered.rows.filter(r=>r.txid===original[1].txid).every(r=>r.blockHeight===42));
  assert.equal(recovered.rows.some(r=>r.txid===original[2].txid||r.txid===original[3].txid),false);
  proof.checks.orphan_removal_and_reincluded_output_context=true;

  ready=false;await step();const waiting=await run();assert.ok(waiting.events.some(e=>e.reason==='INDEXER_RECONCILING'));
  assert.deepEqual(snapshot().rows,recovered.rows);proof.checks.closed_gate_preserves_last_complete_observation=true;
  ready=true;await step();await run();assert.deepEqual(snapshot().rows,recovered.rows);proof.checks.source_recovery_resumes=true;

  const port=server.address().port;
  server.closeAllConnections();await new Promise(r=>server.close(r));server=undefined;
  const disconnected=await run();assert.ok(disconnected.events.some(e=>e.reason==='TRANSPORT_UNAVAILABLE'));
  assert.deepEqual(snapshot().rows,recovered.rows);proof.checks.closed_http_connection_preserves_rows=true;
  const serve=async()=>{server=createChefServer({store,model,token});server.on('request',(request,response)=>response.once('finish',()=>http.push({path:request.url,status:response.statusCode})));await new Promise(r=>server.listen(port,'127.0.0.1',r));};
  await serve();await run();assert.deepEqual(snapshot().rows,recovered.rows);proof.checks.http_transport_recovery=true;

  // Simulate a wire disconnect only for this owned API's database connection.
  // The shared PostgreSQL service and every other namespace remain untouched.
  server.closeAllConnections();await new Promise(r=>server.close(r));server=undefined;await store.close();
  let refusedConnections=0;disconnectServer=createTcpServer(socket=>{refusedConnections++;socket.destroy();});await new Promise(r=>disconnectServer.listen(0,'127.0.0.1',r));
  const unavailable=new URL(process.env.DATABASE_URL);unavailable.hostname='127.0.0.1';unavailable.port=String(disconnectServer.address().port);
  store=new PostgresStore(unavailable.href,storeOptions);await serve();
  const databaseFailure=await run();assert.ok(refusedConnections>0);assert.ok(databaseFailure.events.some(e=>e.reason==='HTTP_500'||e.reason==='TRANSPORT_UNAVAILABLE'));
  assert.deepEqual(snapshot().rows,recovered.rows);proof.checks.database_wire_disconnect_preserves_rows=true;
  server.closeAllConnections();await new Promise(r=>server.close(r));server=undefined;await store.close();await new Promise(r=>disconnectServer.close(r));disconnectServer=undefined;
  store=new PostgresStore(process.env.DATABASE_URL,storeOptions);await store.migrate();await store.acquire();await step();await serve();await run();assert.deepEqual(snapshot().rows,recovered.rows);proof.checks.database_connection_recovery=true;
  assert.ok(http.some(row=>row.path==='/graphql'&&row.status===409));
  proof.checks.actual_graphql_409_observed=true;
  if(mode==='continuous'){
    for(let height=43;height<=80;height++)blocks.push({height,hash:h(10000+height),previousHash:blocks.at(-1).hash,time:1700000000+height,txid:h(20000+height)});
    epoch='3';while((await store.checkpoint()).height<80)await step();await run();
    const sealed=snapshot();assert.equal(sealed.rows.length,41*12);assert.equal(sealed.state.complete.sealedThrough,70);
    const reused=blocks.find(b=>b.height===79).txid;blocks=blocks.filter(b=>b.height<75);
    for(let height=75;height<=78;height++)blocks.push({height,hash:h(30000+height),previousHash:blocks.at(-1).hash,time:1700000000+height,txid:height===78?reused:h(40000+height)});
    epoch='4';await step();await run();const tail=snapshot();assert.equal(tail.rows.length,39*12);assert.equal(tail.state.complete.to,78);assert.equal(tail.state.complete.sealedThrough,70);
    const expected=new Set(blocks.flatMap(b=>Array.from({length:12},(_,i)=>`${b.txid}:${String(i).padStart(2,'0')}`)));assert.deepEqual(new Set(tail.rows.map(r=>r.id)),expected);
    assert.ok(tail.rows.filter(r=>r.txid===reused).every(r=>r.blockHeight===78&&r.blockHash===h(30078)));
    const beforeRestart=tail.rows;await run();assert.deepEqual(snapshot().rows,beforeRestart);proof.checks.sealed_prefix_and_mutable_reorg_with_postgres=true;
  }
  const finalSnapshot=snapshot();proof.final_count=finalSnapshot.rows.length;proof.final_revision=finalSnapshot.state.complete.revision;
  proof.final_sha256=createHash('sha256').update(JSON.stringify(finalSnapshot.rows)).digest('hex');
  proof.api_requests=http;proof.package_version=JSON.parse(await readFile(join(root,'node_modules/@zeer-dev/chef/package.json'),'utf8')).version;
  const packageRelative=relative(await realpath(join(root,'node_modules')),await realpath(join(root,'node_modules/@zeer-dev/chef')));assert.ok(packageRelative&&!isAbsolute(packageRelative)&&!packageRelative.split(/[\\/]/).includes('..'));
  proof.package_symlink=(await lstat(join(root,'node_modules/@zeer-dev/chef'))).isSymbolicLink();proof.workspace_link=false;assert.equal(proof.package_version,'0.2.0');
  passed=true;proof.passed=true;
}finally{
  for(const child of children)child.kill('SIGKILL');
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  if(disconnectServer)await new Promise(r=>disconnectServer.close(r));
  await store.close();
  if(passed){const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});await db.connect();try{assert.match(project,/^ref_[a-f0-9]{22}$/);await db.query(`DROP SCHEMA "chef_${project}" CASCADE`);proof.owned_fixture_namespace_removed=true;}finally{await db.end();}}
  await writeFile(join(directory,'proof.json'),JSON.stringify(proof,null,2)+'\n');
}
console.log(JSON.stringify({passed:proof.passed,package:proof.package_version,synthetic_reorg:true,process_runs:proof.process_runs,checks:proof.checks,proof:join(directory,'proof.json')}));
