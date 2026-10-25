// Local watch-only catch-up study. No signing, broadcasts or source mutations.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ContinuousConsumer} from '../../examples/receipt-consumer/consumer.mjs';

const root=resolve(process.env.ZEER_CATCHUP_OUTPUT??'');
assert.ok(process.env.ZEER_CATCHUP_OUTPUT&&process.env.DATABASE_URL&&process.env.ZEER_SCANNER_EXECUTABLE&&process.env.ZEER_VIEWING_KEY_FILE&&process.env.ZEER_ACCOUNT_ID&&process.env.ZEER_KEY_FINGERPRINT);
const endpoint=new URL(process.env.PREP_URL);assert.equal(endpoint.protocol,'http:');assert.equal(endpoint.hostname,'127.0.0.1');
assert.ok(process.env.CHEF_BASELINE_ROOT&&process.env.CHEF_CANDIDATE_ROOT);
await mkdir(root,{recursive:false,mode:0o700});
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const reference=JSON.parse(await readFile(join(repo,'apps/docs/static/benchmarks/2026-10-22-chef-receipts-testnet.json'),'utf8')).selected;
const from=Math.min(...reference.map(r=>r.height)),to=Math.max(...reference.map(r=>r.height));
const selectedIds=new Set(reference.map(r=>r.txid));
const normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])])):typeof v==='bigint'?v.toString():v;
const hash=v=>createHash('sha256').update(JSON.stringify(normalize(v))).digest('hex');
const stamp=()=>Number(process.hrtime.bigint())/1e9;
const stats=values=>{const a=[...values].sort((a,b)=>a-b);assert.ok(a.length);return {samples:a.length,medianSeconds:(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2,p95Seconds:a[Math.ceil(a.length*.95)-1],minSeconds:a[0],maxSeconds:a.at(-1)};};
const variants={baseline:await import(pathToFileURL(join(process.env.CHEF_BASELINE_ROOT,'dist/index.js'))),candidate:await import(pathToFileURL(join(process.env.CHEF_CANDIDATE_ROOT,'dist/index.js')))};
const {PrepClient}=await import(pathToFileURL(join(process.env.CHEF_CANDIDATE_ROOT,'../prep-client/src/index.js'))).catch(async()=>import(pathToFileURL(join(process.env.CHEF_BASELINE_ROOT,'../prep-client/src/index.js'))));
const {default:pg}=await import(pathToFileURL(join(process.env.CHEF_CANDIDATE_ROOT,'../../pg/lib/index.js')));
const schema=await readFile(join(repo,'examples/receipt-consumer/schema.graphql'),'utf8');
const rawClient=new PrepClient({url:endpoint.href});const sourceBefore=await rawClient.getHeight();assert.ok(sourceBefore.ready);
const rows=[];let expectedDigest;const query='{ReadableNoteList(first:100){items{id}}_meta{height status}}';
const requested=(process.env.ZEER_CATCHUP_VARIANTS??'baseline,candidate').split(',');assert.ok(requested.length>=1&&requested.length<=2&&new Set(requested).size===requested.length&&requested.every(v=>v==='baseline'||v==='candidate'));
for(let repeat=1;repeat<=3;repeat++)for(const profile of [{name:'default',pageSize:16,batchSize:1},{name:'batch4',pageSize:16,batchSize:4}])for(const variant of (repeat%2?['baseline','candidate']:['candidate','baseline']).filter(v=>requested.includes(v))){
 const runCpu=process.cpuUsage();
 const sdk=variants[variant],project='rc_'+randomBytes(10).toString('hex'),directory=join(root,`${variant}-${profile.name}-r${repeat}`);await mkdir(directory,{mode:0o700});
 const model=sdk.parseModel(schema),store=new sdk.PostgresStore(process.env.DATABASE_URL,{project,model,network:'testnet',startHeight:from,reorgWindow:100,fingerprint:'receipt-catchup-20261025'});
 let server,consumer,native,polling=true,complete=false;let loops=[];const scanned=new Map(),received=new Map(),selectedTiming=[],queryTimes=[],queryErrors=[],consumerWaits={},phaseCounts={},violations=[],backgroundErrors=[];let requests=0,lastDurable=null;
 const client={async getHeight(...a){requests++;return rawClient.getHeight(...a);},async get(...a){requests++;const page=await rawClient.get(...a);const at=stamp();for(const tx of page.data.transactions)received.set(tx.txid,at);return page;}};
 try{
  await store.migrate();await store.acquire();
  native=new sdk.NativeReceiptSource({executable:process.env.ZEER_SCANNER_EXECUTABLE,keyFile:process.env.ZEER_VIEWING_KEY_FILE,accountId:process.env.ZEER_ACCOUNT_ID,keyFingerprint:process.env.ZEER_KEY_FINGERPRINT});
  const source={identity:native.identity,accountId:native.accountId,keyFingerprint:native.keyFingerprint,async scan(input,signal){const began=stamp();const notes=await native.scan(input,signal);const at=stamp();for(const note of notes)scanned.set(note.id,{height:note.height,txid:note.txid,scope:note.scope,value:note.value_zat,receivedAt:received.get(note.txid),scanStartAt:began,decryptedAt:at,committedAt:null,consumerAt:null});return notes;},close:()=>native.close()};
  for(const name of ['apply','applyBatch'])if(store[name]){const original=store[name].bind(store);store[name]=async(...a)=>{await original(...a);const blocks=Array.isArray(a[0])?a[0]:[a[0]],height=blocks.at(-1).height;lastDurable=height;const at=stamp();for(const note of scanned.values())if(note.committedAt===null&&note.height<=height)note.committedAt=at;};}
  const token=randomBytes(24).toString('hex');server=sdk.createChefServer({store,model,token});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  consumer=new ContinuousConsumer({file:join(directory,'consumer.sqlite'),url,token,project,from,pageSize:25,maxRange:64,maxRows:100,maxTotalRows:1000,maxAgeSeconds:120});
  const gqlLoop=(async()=>{while(polling){const start=stamp();try{const r=await fetch(url+'/graphql',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({query}),signal:AbortSignal.timeout(5000)});const b=await r.json();if(r.status!==200||b.errors)queryErrors.push(r.status);else queryTimes.push(stamp()-start);}catch{queryErrors.push('transport');}await delay(50);}})();
  const consumerLoop=(async()=>{while(polling){const result=await consumer.step();if(result.state==='waiting'||result.state==='restarting')consumerWaits[result.reason]=(consumerWaits[result.reason]??0)+1;const at=stamp();for(const row of consumer.rows()){const note=scanned.get(row.id);if(note&&note.consumerAt===null)note.consumerAt=at;}await delay(100);}})().catch(()=>{backgroundErrors.push('CONSUMER_FAILED');polling=false;});
  loops=[gqlLoop,consumerLoop];
  const indexer={async receipt({block,receipt,context}){const memo=sdk.decodeMemo(receipt.memo_hex);await context.entities.set('ReadableNote',{id:receipt.id,txid:receipt.txid,pool:receipt.pool,outputIndex:receipt.output_index,blockHeight:receipt.height,blockHash:block.hash,valueZat:BigInt(receipt.value_zat),receiver:receipt.receiver,memoHex:receipt.memo_hex,memoKind:memo.memoKind,memoText:memo.memoText,scope:receipt.scope,origin:receipt.origin,coinbase:receipt.is_coinbase});}};
  const started=stamp(),metrics={blocks:0,transactions:0,fetchSeconds:0,handlerSeconds:0,transactionOverheadSeconds:0};
  for(let step=0;step<40;step++){
   const result=await sdk.syncStep({client,store,indexer,receiptSource:source,network:'testnet',startHeight:from,reorgWindow:100,...profile,transactionFilter:{txids:[...selectedIds]},onProgress:event=>{phaseCounts[event.phase]=(phaseCounts[event.phase]??0)+1;if(event.committedHeight!==undefined&&event.committedHeight!==null&&(lastDurable===null||event.committedHeight>lastDurable))violations.push('UNACKNOWLEDGED_HEIGHT');}},to);
   assert.notEqual(result.state,'source_unavailable','SOURCE_UNAVAILABLE_DURING_TIMING');metrics.blocks+=result.blocks;metrics.transactions+=result.transactions;metrics.fetchSeconds+=result.fetchMs/1000;metrics.handlerSeconds+=result.handlerIncludingEntityIoMs/1000;metrics.transactionOverheadSeconds+=result.transactionOverheadMs/1000;
   if(result.state==='caught_up')break;assert.ok(step<39,'STEP_BUDGET');
  }
  const indexedSeconds=stamp()-started;assert.equal((await store.checkpoint()).height,to);assert.equal(metrics.blocks,to-from+1);assert.equal(metrics.transactions,reference.length);
  for(let i=0;i<100&&[...scanned.values()].some(n=>n.consumerAt===null);i++)await delay(100);
  polling=false;await Promise.all([gqlLoop,consumerLoop]);assert.deepEqual(backgroundErrors,[]);
  const stored=await store.read(v=>v.list('ReadableNote',{first:100}));const sourceDigest=hash([...stored].sort((a,b)=>a.id.localeCompare(b.id)));assert.equal(stored.length,scanned.size);assert.ok(stored.length>=reference.length);assert.equal(consumer.count(),stored.length);
  assert.equal(hash([...consumer.rows()].sort((a,b)=>a.id.localeCompare(b.id))),sourceDigest,'CONSUMER_PROJECTION_MISMATCH');
  if(expectedDigest)assert.equal(sourceDigest,expectedDigest,'CANDIDATE_PROJECTION_MISMATCH');else expectedDigest=sourceDigest;
  for(const tx of reference){const found=[...scanned.values()].filter(n=>n.txid===tx.txid&&n.scope==='external'&&n.value==='100000');assert.equal(found.length,1,'PUBLISHED_NOTE_NOT_FOUND');const n=found[0];assert.ok([n.receivedAt,n.scanStartAt,n.decryptedAt,n.committedAt,n.consumerAt].every(Number.isFinite));selectedTiming.push({prepToDecryptSeconds:n.decryptedAt-n.receivedAt,decryptSeconds:n.decryptedAt-n.scanStartAt,decryptToCommitSeconds:n.committedAt-n.decryptedAt,commitToConsumerSeconds:n.consumerAt-n.committedAt,prepToConsumerSeconds:n.consumerAt-n.receivedAt});}
  assert.deepEqual(violations,[]);assert.equal(queryErrors.length,0,'GRAPHQL_READ_FAILURE');
  const after=await sdk.syncStep({client,store,indexer,receiptSource:source,network:'testnet',startHeight:from,reorgWindow:100,...profile,transactionFilter:{txids:[...selectedIds]}},to);assert.equal(after.state,'caught_up');assert.equal(hash((await store.read(v=>v.list('ReadableNote',{first:100}))).sort((a,b)=>a.id.localeCompare(b.id))),sourceDigest);
  const cpu=process.cpuUsage(runCpu),resource={nodeUserCpuSeconds:cpu.user/1e6,nodeSystemCpuSeconds:cpu.system/1e6,nodeRssAtReportBytes:process.memoryUsage().rss,nodeProcessLifetimeMaxRssKiB:process.resourceUsage().maxRSS,scope:'Node process setup,indexing,polling and validation through report; excludes native child,PostgreSQL,Prep and cleanup; maxRSS is process-lifetime high-water'};
  const row={variant,profile:profile.name,repeat,pageSize:profile.pageSize,batchSize:profile.batchSize,indexedSeconds,...metrics,requests,receiptCount:stored.length,publishedNotes:selectedTiming.length,stages:Object.fromEntries(Object.keys(selectedTiming[0]).map(key=>[key,stats(selectedTiming.map(t=>t[key]))])),selectedTiming,graphql:{samples:queryTimes.length,errors:queryErrors,latency:stats(queryTimes)},consumerWaits,phaseCounts,projectionSha256:sourceDigest,noOpResumeIdentical:true,resource};rows.push(row);await writeFile(join(root,'samples.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify({variant,profile:profile.name,repeat,indexedSeconds,notes:stored.length,graphql:queryTimes.length}));complete=true;
 }finally{
  polling=false;await Promise.allSettled(loops);if(consumer&&!consumer.busy)consumer.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(native)await native.close();await store.close();
  if(complete){const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();try{assert.match(project,/^rc_[a-f0-9]{20}$/);await db.query(`DROP SCHEMA "chef_${project}" CASCADE`);}finally{await db.end();}}
 }
}
const sourceAfter=await rawClient.getHeight();assert.ok(sourceAfter.ready);
const summary={status:'PASS',scope:'Historical catch-up of six previously mined owned Ironwood transactions, not future-live detection or mining/confirmation latency.',versions:{baseline:'0.6.1',candidate:'0.7.0-candidate'},source:{from,to,before:sourceBefore.archive_height,after:sourceAfter.archive_height,backgroundIngestionProgress:sourceAfter.archive_height-sourceBefore.archive_height},runs:rows.length,projectionSha256:expectedDigest,measurements:rows,keysUploaded:false,newTransactionsBroadcast:false,unit:'seconds'};
await writeFile(join(root,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({status:'PASS',runs:rows.length,backgroundBlocks:summary.source.backgroundIngestionProgress}));
