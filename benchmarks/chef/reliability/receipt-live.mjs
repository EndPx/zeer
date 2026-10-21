// Run from a copied, registry-installed receipt-consumer directory. Keys stay local.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {PrepClient} from '@zeer-dev/prep-client';
import {NativeReceiptSource,PostgresStore,parseModel,syncStep,createChefServer,decodeMemo} from '@zeer-dev/chef';
import {writeReport,safeFailure} from './report.mjs';
import {assertObserverReady} from './readiness.mjs';

process.umask(0o077);
const root=process.cwd(),out=resolve(process.env.STUDY_DIRECTORY);await fs.mkdir(out,{recursive:false,mode:0o700});
assert.equal(JSON.parse(await fs.readFile('node_modules/@zeer-dev/chef/package.json','utf8')).version,'0.2.0');
assert.equal((await fs.lstat('node_modules/@zeer-dev/chef')).isSymbolicLink(),false);
const now=()=>process.hrtime.bigint().toString(),seconds=(end,start)=>Number(BigInt(end)-BigInt(start))/1e9;
const prepUrl=process.env.STUDY_PREP_URL??'https://zeer.endpx.cloud/api/prep',endpoint=new URL(prepUrl);
assert.ok((endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash);
const prep=new PrepClient({url:prepUrl,...(process.env.STUDY_PREP_TOKEN?{token:process.env.STUDY_PREP_TOKEN}:{}),timeoutMs:15000});
const meta=await prep.getHeight();assert.equal(meta.network,'testnet');assert.ok(meta.ready);
const from=process.env.STUDY_FROM_HEIGHT?Number(process.env.STUDY_FROM_HEIGHT):meta.indexed_height,project='live_'+randomUUID().replaceAll('-','').slice(0,22);assert.ok(Number.isInteger(from)&&from>=meta.indexed_height-100&&from<=meta.indexed_height);
const account=JSON.parse(await fs.readFile(process.env.ZEER_ACCOUNT_FILE,'utf8'));
const scanner=new NativeReceiptSource({executable:process.env.ZEER_SCANNER_EXECUTABLE,keyFile:process.env.ZEER_VIEWING_KEY_FILE,accountId:account.account_id,keyFingerprint:account.key_fingerprint});
const model=parseModel(await fs.readFile('schema.graphql','utf8'));
const store=new PostgresStore(process.env.DATABASE_URL,{project,fingerprint:'receipt-live-v1',model,network:'testnet',startHeight:from,reorgWindow:100});
const proof={format:'zeer-live-receipt-v1',status:'RUNNING',started_at_utc:new Date().toISOString(),project,from_height:from,sample_goal:6,deadline_seconds:2400,chef_version:'0.2.0',prep_url:prepUrl,producer_poll_seconds:2,consumer_poll_seconds:1,consumer_clock:'parent receipt of child post-SQLite-commit event; upper bound',database_transport:'PostgreSQL on VPS through encrypted SSH tunnel from Windows',viewing_key_remained_local:true,events:[],observations:{},consumer_events:[],errors:[],api_statuses:{},resource:{peak_parent_rss_bytes:0,peak_scanner_rss_not_measured:true}};
const rows=proof.observations,entry=txid=>rows[txid]??=( {txid} );
const client={getHeight:(...args)=>prep.getHeight(...args),get:async(...args)=>{const start=now();const page=await prep.get(...args),at=now();for(const tx of page.data.transactions??[]){const r=entry(tx.txid);r.prep_ns??=at;r.prep_request_ns??=start;r.height??=tx.block_height;}return page;}};
const originalScan=scanner.scan.bind(scanner);scanner.scan=async(input,signal)=>{const start=now();const receipts=await originalScan(input,signal);const at=now();const r=entry(input.transaction.txid);r.decrypt_start_ns??=start;r.decrypt_ns??=at;r.hash=input.block.hash;return receipts;};
const originalApply=store.applyBatch.bind(store);store.applyBatch=async(blocks,handler)=>{await originalApply(blocks,handler);const at=now();for(const r of Object.values(rows))if(blocks.some(b=>b.height===r.height)&&r.handler_end_ns&&!r.commit_ns)r.commit_ns=at;};
const indexer={async receipt({block,receipt,context}){const r=entry(receipt.txid);r.handler_start_ns??=now();await context.entities.set('ReadableNote',{id:receipt.id,txid:receipt.txid,pool:receipt.pool,outputIndex:receipt.output_index,blockHeight:block.height,blockHash:block.hash,valueZat:BigInt(receipt.value_zat),receiver:receipt.receiver,memoHex:receipt.memo_hex,...decodeMemo(receipt.memo_hex),scope:receipt.scope,origin:receipt.origin,coinbase:receipt.is_coinbase});r.handler_end_ns=now();}};
const dbFile=join(out,'consumer.sqlite'),token=process.env.CHEF_API_TOKEN;let server,child,fatal=null,buffer='';
const save=()=>writeReport(out,proof,{onRetry:event=>{proof.storage_retries??=[];proof.storage_retries.push({...event,at_ns:now()});}});
const fail=(code,error)=>{fatal??=code;if(error)proof.failure_detail=safeFailure(error,'consumer_event');};
try{
 await store.migrate();await store.acquire();server=createChefServer({store,model,token});server.on('request',(req,res)=>res.once('finish',()=>{const key=`${req.url}:${res.statusCode}`;proof.api_statuses[key]=(proof.api_statuses[key]??0)+1;}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 child=spawn(process.execPath,['consume.mjs','--db',dbFile,'--from',String(from),'--project',project,'--rounds','3600','--interval-seconds','1','--deadline-seconds','2400'],{cwd:root,env:{...process.env,CHEF_URL:origin},windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.on('error',()=>fail('CONSUMER_SPAWN_FAILED'));child.on('exit',(code,signal)=>{if(!proof.stopping)fail('CONSUMER_EXITED');proof.consumer_exit={code,signal};});
 let errorBuffer='';child.stderr.on('data',chunk=>{proof.consumer_stderr_events=(proof.consumer_stderr_events??0)+1;errorBuffer+=chunk;if(errorBuffer.length>16384){errorBuffer='';return;}for(;;){const end=errorBuffer.indexOf('\n');if(end<0)break;const line=errorBuffer.slice(0,end);errorBuffer=errorBuffer.slice(end+1);try{const value=JSON.parse(line).error;if(value){proof.consumer_errors??=[];proof.consumer_errors.push({stage:'consumer',code:typeof value.code==='string'&&/^[A-Z_0-9]+$/.test(value.code)?value.code:'UNKNOWN',nativeCode:typeof value.nativeCode==='string'&&/^[A-Z_0-9]+$/.test(value.nativeCode)?value.nativeCode:undefined,sqliteCode:Number.isSafeInteger(value.sqliteCode)?value.sqliteCode:undefined});}}catch{ /* Native warnings contain no structured diagnostic. */ }}});
 child.stdout.on('data',chunk=>{try{buffer+=chunk;if(buffer.length>100000)throw Error();for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line)continue;const value=JSON.parse(line),at=now();proof.consumer_events.push({...value,received_ns:at});if(value.event==='page'&&value.state==='complete'){
  const db=new DatabaseSync(dbFile,{readOnly:true});try{db.exec('BEGIN');const snapshot=JSON.parse(db.prepare('SELECT payload FROM state WHERE singleton=1').get().payload);const items=db.prepare('SELECT payload FROM entities').all();db.exec('COMMIT');const storedAt=now();if(snapshot.complete?.revision===value.revision)for(const item of items){const note=JSON.parse(item.payload);if(note.scope==='external'&&/^Zeer live receipt 0[1-6]$/.test(note.memoText??'')){const r=entry(note.txid);r.consumer_ns??=storedAt;r.output_id=note.id;r.output_index=note.outputIndex;r.memo=note.memoText;r.value_zat=note.valueZat;r.pool=note.pool;r.scope=note.scope;r.receiver_sha256=createHash('sha256').update(note.receiver).digest('hex');r.consumer_hash=note.blockHash;r.consumer_height=note.blockHeight;}}}finally{db.close();}
 }}}catch(error){fail('CONSUMER_EVENT_INVALID',error);}});
 const bootstrap=await syncStep({client,store,indexer,receiptSource:scanner,network:'testnet',startHeight:from,reorgWindow:100,pageSize:16,batchSize:1,transactionFilter:{shielded_pools:['sapling','orchard','ironwood']}});proof.events.push({at_ns:now(),bootstrap:true,...bootstrap});
 await delay(500);if(fatal)throw Error(fatal);await assertObserverReady(bootstrap,store,child);await save();
 proof.ready_ns=now();await fs.writeFile(join(out,'ready.json'),JSON.stringify({project,from_height:from,pid:process.pid,origin,ready_ns:proof.ready_ns}));
 console.log(JSON.stringify({state:'ready',project,from_height:from}));
 const start=Date.now(),cpu=process.cpuUsage();
 while(Date.now()-start<2400000){
  if(fatal)throw Error(fatal);if(await fs.stat(join(out,'stop')).then(()=>true,()=>false))break;
  const tick=Date.now();try{const result=await syncStep({client,store,indexer,receiptSource:scanner,network:'testnet',startHeight:from,reorgWindow:100,pageSize:16,batchSize:1,transactionFilter:{shielded_pools:['sapling','orchard','ironwood']}});proof.events.push({at_ns:now(),...result});}
  catch(error){proof.errors.push({at_ns:now(),code:typeof error.code==='string'?error.code:'SYNC_FAILED',status:error.status??0});if(![429,409,500,502,503,504].includes(error.status??0))throw Error('NONRECOVERABLE_SYNC_ERROR');}
  proof.resource.peak_parent_rss_bytes=Math.max(proof.resource.peak_parent_rss_bytes,process.memoryUsage().rss);await save();await delay(Math.max(0,2000-(Date.now()-tick)));
 }
 proof.resource.parent_cpu_seconds=(process.cpuUsage(cpu).user+process.cpuUsage(cpu).system)/1e6;
 const expected=JSON.parse(await fs.readFile(join(out,'expected-operations.json'),'utf8'));
 assert.equal(expected.length,6);assert.deepEqual(expected.map(r=>r.ordinal),[1,2,3,4,5,6]);assert.equal(new Set(expected.map(r=>r.txid)).size,6);
 const selected=expected.map(operation=>{const r=rows[operation.txid];assert.ok(r?.consumer_ns,'LIVE_SAMPLE_GOAL_NOT_MET');assert.equal(r.memo,`Zeer live receipt 0${operation.ordinal}`);r.observation_mode=operation.observation_mode??'live';if(r.observation_mode==='live'){assert.match(operation.broadcast_ns,/^[0-9]+$/);assert.ok(BigInt(operation.broadcast_ns)>BigInt(proof.ready_ns)&&BigInt(r.prep_ns)>=BigInt(operation.broadcast_ns));assert.ok(r.height>from);r.broadcast_ns=operation.broadcast_ns;}return r;});assert.equal(new Set(selected.map(r=>r.height)).size,6);assert.equal(new Set(selected.map(r=>r.receiver_sha256)).size,1);
 for(const r of selected){assert.equal(r.value_zat,'100000');assert.equal(r.pool,'ironwood');assert.equal(r.hash,r.consumer_hash);assert.equal(r.height,r.consumer_height);assert.ok(BigInt(r.prep_ns)<=BigInt(r.decrypt_start_ns)&&BigInt(r.decrypt_ns)<=BigInt(r.handler_start_ns)&&BigInt(r.handler_end_ns)<=BigInt(r.commit_ns));
  const page=await prep.get({from_block:r.height,to_block:r.height+1,field_selection:{block:['height','hash'],transaction:[]}});assert.equal(page.data.blocks[0].hash,r.hash);r.canonical_rechecked_at=new Date().toISOString();
  r.seconds={prep_to_decrypted:seconds(r.decrypt_ns,r.prep_ns),decrypt_service:seconds(r.decrypt_ns,r.decrypt_start_ns),decrypted_to_commit:seconds(r.commit_ns,r.decrypt_ns),commit_to_consumer:seconds(r.consumer_ns,r.commit_ns),prep_to_consumer:seconds(r.consumer_ns,r.prep_ns)};
 }
 proof.selected=selected;proof.live_sample_count=selected.filter(r=>r.observation_mode==='live').length;proof.catch_up_sample_count=selected.length-proof.live_sample_count;proof.original_live_goal_met=proof.live_sample_count===6;proof.receipt_checks_passed=true;proof.status=proof.original_live_goal_met?'PASS':'RECEIPT_CHECKS_PASS_LIVE_GOAL_UNMET';
}catch(error){proof.status='INCOMPLETE';proof.failure=error.message?.match(/^[A-Z_]+$/)?.[0]??'STUDY_FAILED';proof.diagnostic=error.diagnostic??safeFailure(error,'observer');process.stderr.write(JSON.stringify({event:'observer_failure',...proof.diagnostic})+'\n');process.exitCode=1;}
finally{proof.stopping=true;if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([exit,delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await scanner.close();await store.close();proof.completed_at_utc=new Date().toISOString();try{await save();await fs.writeFile(join(out,'raw-private.json'),JSON.stringify(proof,null,2),{flag:'wx',mode:0o600});}catch(error){process.stderr.write(JSON.stringify({event:'terminal_report_unavailable',...(error.diagnostic??safeFailure(error,'terminal_report'))})+'\n');process.exitCode=1;}console.log(JSON.stringify({status:proof.status,samples:Object.values(rows).filter(r=>r.consumer_ns).length,failure:proof.failure}));}
