// Same-SDK paired native Prep admission study; polling stays fixed at two seconds.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {PrepClient} from '@zeer-dev/prep-client';
import {readDatabaseSnapshot} from '../head/database.mjs';
import {NativeSources} from './native.mjs';
import {now,seconds,digest,blockReference,expectedEntities,summarize,privateRpcHost,guardedMessage} from '../head/common.mjs';

const flags=new Map();
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--out-dir','--rpc-cookie-file','--samples','--deadline-seconds','--prep-observer-seconds','--candidate-poll-seconds','--prep-original-bin','--prep-candidate-bin','--archive-root'].includes(process.argv[i]));assert.ok(process.argv[i+1]);assert.ok(!flags.has(process.argv[i]));flags.set(process.argv[i],process.argv[i+1]);}
assert.equal(process.platform,'linux');
for(const flag of ['--out-dir','--rpc-cookie-file','--prep-original-bin','--prep-candidate-bin','--archive-root'])assert.ok(flags.has(flag),'Missing required benchmark argument');
const directory=resolve(flags.get('--out-dir')??'');assert.ok(flags.has('--out-dir'));
await mkdir(directory); // Exclusive creation: never reuse or erase an experiment.
const sampleGoal=Number(flags.get('--samples')??12),deadlineSeconds=Number(flags.get('--deadline-seconds')??1500);
const prepPoll=0;assert.equal(Number(flags.get('--prep-observer-seconds')??0),0);
const candidatePoll=2;assert.equal(Number(flags.get('--candidate-poll-seconds')??2),2);
assert.equal(sampleGoal,12);
assert.ok(Number.isInteger(deadlineSeconds)&&deadlineSeconds>=60&&deadlineSeconds<=1800);
const began=now(),deadline=performance.now()+deadlineSeconds*1000;
const token=process.env.CHEF_API_TOKEN;assert.ok(token?.length>=16);
assert.ok(process.env.PREP_API_TOKEN?.length>=16);
const rpcUrl=new URL(process.env.BENCH_RPC_URL);assert.ok(rpcUrl.protocol==='http:'&&!rpcUrl.username&&!rpcUrl.password&&!rpcUrl.search&&!rpcUrl.hash);
assert.ok(privateRpcHost(rpcUrl.hostname),'Literal private IPv4 RPC required');
const cookie=await readFile(flags.get('--rpc-cookie-file'),'utf8');
const authorization='Basic '+Buffer.from(cookie.trim()).toString('base64');
let prep;
const eventFile=join(directory,'events.jsonl');let writes=Promise.resolve();
const event=value=>{writes=writes.then(()=>appendFile(eventFile,JSON.stringify(value)+'\n')).catch(()=>report.errors.push({fatal:true,code:'EVENT_WRITE_FAILED'}));};
const children=new Set(),apis=[],actors=[],source=new Map(),available=new Map(),commits=new Map();
const requests={rpc:0,rpc_body_bytes:0,prep_observer:0,graphql:0};
let activeWindow=null;
const report={format:'zeer-prep-admission-live-v1',status:'RUNNING',started_at_utc:new Date().toISOString(),
  sample_goal:sampleGoal,deadline_seconds:deadlineSeconds,profiles:['original','queued'],poll_seconds:2,rows:[],phases:[],restarts:[],probes:[],errors:[],control_throttles:[],writer_requests:[],read_gates:[],verification_retries:[],
  plan:{native_startup_deadline_seconds:120,source_poll_target_seconds:.25,api_poll_target_seconds:.25,prep_poll_target_seconds:prepPoll,
    source:'First successful local Zebra tip observation; block identity fetched and verified separately.',
    prep:'Earliest writer observation of a matching header in the shared archive; includes polling, admission, transport and decoding.',
    commit:'Writer observes successful applyBatch return after PostgreSQL commit acknowledgement.',
    graphql:'First completed coherent GraphQL response with the expected block hash and transaction count.',
    timing:'Same-host process.hrtime.bigint monotonic timestamps. Observation/polling bounds, not exact publication times. Negative stage observations are preserved.',
    comparison:'Published Chef 0.2.0 and two-second polling are fixed. A separate bounded shadow follower ingests actual node blocks from tip minus32 with full integrity/one confirmation. Original and queued-metadata Prep share that tail archive, schema, database server and cgroup. Binary assignments cross after six future paired blocks; source URLs and project identities stay fixed. Each source receives two simultaneous 16-block background queries every two seconds.',
    acceptance:'All source entities/restarts pass and all12 pairs complete. Queued candidate has no timed GraphQL probe failures, its source-to-GraphQL p95 is no higher, and its background request failures do not exceed the original source. Original-source failures are retained, not used to reject a healthy candidate.',
    failures:'Timed readiness gates and writer/control throttling are retained. Finite verification commands alone may retry 429/503 up to five attempts outside live timing; every retry is recorded.',
    cache:'Native archive-open and indexer bootstrap are excluded from paired timing and recorded separately; shared source/database/OS data are warm, new namespaces, no cache clearing.',
    restart:'One graceful and one SIGKILL stop per actor, after acknowledged committed data; no crash injected inside a SQL transaction.'}};
const save=()=>writeFile(join(directory,'result.json'),JSON.stringify(report,null,2)+'\n');
const sources=new NativeSources({original:resolve(flags.get('--prep-original-bin')),queued:resolve(flags.get('--prep-candidate-bin')),archive:resolve(flags.get('--archive-root')),token:process.env.PREP_API_TOKEN,check:()=>check(),onFailure:code=>report.errors.push({fatal:true,code})});
let activeLoad=null;
function check(){assert.ok(performance.now()<deadline,'Overall deadline exceeded');const failed=report.errors.find(e=>e.fatal);assert.ok(!failed,failed?.code);}
async function rpc(method,params=[]){
  check();requests.rpc++;const start=now();
  const response=await fetch(rpcUrl,{method:'POST',redirect:'error',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(5000)});
  const text=await response.text();requests.rpc_body_bytes+=Buffer.byteLength(text);assert.equal(response.status,200);
  const body=JSON.parse(text);assert.ok(!body.error&&body.id===1,'RPC envelope failed');return {value:body.result,start_ns:start,end_ns:now()};
}
function prepEvent(blocks,time){for(const b of blocks){const old=available.get(b.height);if(old)assert.equal(old.hash,b.hash,'Prep changed observed branch');if(!old||BigInt(time)<BigInt(old.at_ns))available.set(b.height,{hash:b.hash,at_ns:time});}}
function spawn(command,actor,extra=[],recoverable=false){
  const child=fork(fileURLToPath(new URL('../head/worker.mjs',import.meta.url)),[command,actor.config,...extra],{stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,PREP_URL:actor.prepUrl??sources.servers[0].url}});children.add(child);
  const state={child,command,actor,messages:[],ended:false,expectedStop:false,recoverable};
  state.done=new Promise(resolveDone=>child.once('exit',(code,signal)=>{state.ended=true;children.delete(child);state.code=code;state.signal=signal;
    if(!state.expectedStop&&!recoverable&&code!==0)report.errors.push({fatal:true,code:'CHILD_EXIT',command,actor:actor.name,exit_code:code,signal});resolveDone();}));
  child.on('error',()=>report.errors.push({fatal:true,code:'CHILD_SPAWN',command,actor:actor.name}));
  child.on('message',guardedMessage(message=>{
    assert.ok(BigInt(message.clock_ns)>=BigInt(began)&&BigInt(message.clock_ns)<=BigInt(now()),'Child monotonic clock mismatch');
    state.messages.push(message);event({actor:actor.name,command,...message});
    if(message.kind==='failure')report.errors.push({fatal:!recoverable||![429,503].includes(message.status),code:message.code,command,actor:actor.name});
    if(message.kind==='prep_request')report.writer_requests.push({actor:actor.name,phase:activeWindow,poll_seconds:actor.poll??null,variant:actor.variant??null,...message});
    if(message.kind==='prep')prepEvent(message.blocks,message.at_ns);
    if(message.kind==='commit')for(const b of message.blocks)commits.set(`${actor.name}:${b.height}`,{hash:b.hash,at_ns:message.at_ns});
  },code=>report.errors.push({fatal:true,code,command,actor:actor.name})));return state;
}
async function finished(state){await Promise.race([state.done,sleep(120000,undefined,{ref:false}).then(()=>{throw Error('Child command deadline');})]);check();assert.equal(state.code,0);return state.messages.filter(m=>m.kind==='cli').at(-1)?.value;}
async function finite(actor,height){
  for(let attempt=0;attempt<5;attempt++){
    const state=spawn('sync',actor,['--to',String(height)],true);
    await Promise.race([state.done,sleep(120000,undefined,{ref:false}).then(()=>{throw Error('Finite command deadline');})]);check();
    if(state.code===0)return state.messages.filter(m=>m.kind==='cli').at(-1)?.value;
    const failure=state.messages.find(m=>m.kind==='failure');assert.ok([429,503].includes(failure?.status),'Finite command failed');
    report.verification_retries.push({actor:actor.name,height,attempt:attempt+1,code:failure.code,status:failure.status,at_ns:now()});
    await sleep(1000);
  }throw Error('Finite verification retry bound');
}
async function waitFor(predicate,timeout=60000){const end=performance.now()+timeout;while(!predicate()){check();assert.ok(performance.now()<end,'Readiness deadline');await sleep(25);}}
async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function gql(actor,query,variables,allowUnavailable=false){
  requests.graphql++;const start=now();
  const response=await fetch(`http://127.0.0.1:${actor.port}/graphql`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(5000)});
  const body=await response.json(),end=now();
  report.probes.push({actor:actor.name,phase:activeWindow,poll_seconds:actor.poll??null,variant:actor.variant??null,start_ns:start,end_ns:end,seconds:seconds(end,start),status:response.status});
  if(allowUnavailable&&response.status===503){report.read_gates.push({actor:actor.name,phase:activeWindow,poll_seconds:actor.poll,variant:actor.variant,at_ns:end});return {body:null,start_ns:start,end_ns:end};}
  assert.equal(response.status,200,'GraphQL unavailable');assert.ok(!body.errors,'GraphQL error');return {body:body.data,start_ns:start,end_ns:end};
}
async function databaseSnapshot(actor){
  check();return readDatabaseSnapshot({connectionString:process.env.DATABASE_URL,project:actor.project,deadline});
}
async function snapshot(actor){
  const first=(await gql(actor,'{_meta{height hash status}}')).body._meta;assert.equal(first.status,'ready');
  const fields={BlockSummary:'id height hash time transactionCount',TransactionMeta:'id height transactionIndex version locktime',Totals:'id blocks transactions'};
  const entities={};
  for(const [entity,selected]of Object.entries(fields)){
    const rows=[];let after=null;
    for(let page=0;page<100;page++){
      const value=(await gql(actor,`query($after:ID){_meta{height hash status} ${entity}List(first:100,after:$after){items{${selected}} nextCursor}}`,{after})).body;
      assert.deepEqual(value._meta,first,'Unstable verification checkpoint');const result=value[entity+'List'];rows.push(...result.items);
      if(result.nextCursor===null){entities[entity]=rows;break;}assert.ok(result.nextCursor!==after);after=result.nextCursor;
    }
    assert.ok(entities[entity],'Verification page bound');
  }
  return {checkpoint:first,entities,sha256:digest(entities)};
}
async function stop(state,signal='SIGINT'){
  if(state.ended)return;state.expectedStop=true;state.child.kill(signal);
  await Promise.race([state.done,sleep(15000,undefined,{ref:false}).then(()=>{state.child.kill('SIGKILL');throw Error('Child stop deadline');})]);
  if(signal==='SIGINT')assert.equal(state.code,0,'Ungraceful normal stop');
}
const schema='type BlockSummary { id: ID! height: Int! @index hash: String! time: BigInt! transactionCount: Int! }\ntype TransactionMeta { id: ID! height: Int! @index transactionIndex: Int! version: Int! locktime: Int! }\ntype Totals { id: ID! blocks: Int! transactions: Int! }\n';
async function actor(name,start){
  const project='head_'+randomUUID().replaceAll('-','').slice(0,22);const config=join(directory,`${name}.config.ts`);
  await writeFile(config,`import {defineConfig} from '@zeer-dev/chef';
export default defineConfig({project:${JSON.stringify(project)},network:'testnet',startHeight:${start},schema:'./schema.graphql',handlerVersion:'head-v1',reorgWindow:100,sync:{pageSize:1000,batchSize:32},indexer:{
async block({block,context}){await context.entities.set('BlockSummary',{id:String(block.height),height:block.height,hash:block.hash,time:BigInt(block.time),transactionCount:0});const old=await context.entities.get('Totals','all')??{id:'all',blocks:0,transactions:0};await context.entities.set('Totals',{...old,blocks:old.blocks+1});},
async transactionMetadata({transaction,context}){await context.entities.set('TransactionMeta',{id:transaction.txid,height:transaction.blockHeight,transactionIndex:transaction.index,version:transaction.version,locktime:transaction.locktime});const block=await context.entities.get('BlockSummary',String(transaction.blockHeight));await context.entities.set('BlockSummary',{...block,transactionCount:block.transactionCount+1});const total=await context.entities.get('Totals','all');await context.entities.set('Totals',{...total,transactions:total.transactions+1});}
}});\n`);
  const server=sources.servers.find(s=>s.name===name)??sources.servers[0];const value={name,project,config,port:await freePort(),prepUrl:server.url,variant:server.variant};await finished(spawn('migrate',value));
  const api=spawn('serve',value,['--port',String(value.port)]);apis.push(api);
  await waitFor(()=>api.messages.some(m=>m.kind==='cli'&&m.value.status==='listening'));return value;
}

try {
  const hash=raw=>createHash('sha256').update(raw).digest('hex');
  report.harness_sha256=Object.fromEntries(await Promise.all(['run.mjs','native.mjs','../head/worker.mjs','../head/common.mjs','../head/database.mjs'].map(async name=>[name,hash(await readFile(new URL(name,import.meta.url)))])));
  const sdk=new URL(import.meta.resolve('@zeer-dev/chef'));
  report.chef_version=JSON.parse(await readFile(new URL('../package.json',sdk),'utf8')).version;
  assert.equal(report.chef_version,'0.2.0');
  report.prep_binary_sha256=Object.fromEntries(await Promise.all(Object.entries(sources.binaries).map(async([key,path])=>[key,hash(await readFile(path))])));

  report.chef_source_sha256=Object.fromEntries(await Promise.all(['cli.js','runtime.js','store.js','graphql.js'].map(async name=>[name,hash(await readFile(new URL(name,sdk)))])));
  await writeFile(join(directory,'plan.json'),JSON.stringify({sample_goal:sampleGoal,deadline_seconds:deadlineSeconds,chef_version:report.chef_version,harness_sha256:report.harness_sha256,prep_binary_sha256:report.prep_binary_sha256,plan:report.plan},null,2)+'\n',{flag:'wx'});
  await save();
  assert.equal((await rpc('getblockhash',[0])).value,'05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38');
  const tip=(await rpc('getblockcount')).value;assert.ok(tip>1000);const split=cookie.trim().indexOf(':');assert.ok(split>0);
  sources.followConfig={url:rpcUrl.href,user:cookie.trim().slice(0,split),password:cookie.trim().slice(split+1),from:tip-32};
  await sources.open();prep=new PrepClient({url:sources.servers[0].url,token:process.env.PREP_API_TOKEN});
  const meta=await prep.getHeight({timeoutMs:5000});assert.ok(meta.ready&&meta.network==='testnet'&&meta.payload_kind==='full-v1'&&meta.archive_height!==null);
  report.start_height=meta.archive_height;await writeFile(join(directory,'schema.graphql'),schema);
  for(const name of ['a','b'])actors.push(await actor(name,report.start_height));
  report.namespaces=actors.map(a=>({actor:a.name,project:a.project}));
  for(let phase=0;phase<2;phase++){
    if(phase)await sources.assign(phase);
    const assignments=[2,2];actors.forEach((a,i)=>{a.poll=2;a.variant=sources.servers[i].variant;});
    const workers=actors.map((a,i)=>spawn('sync',a,['--follow','--poll-seconds',String(assignments[i])]));
    let caught=false;
    for(let wait=0;wait<120&&!caught;wait++){
      caught=workers.every(state=>state.messages.some(m=>m.kind==='cli'&&m.value.state==='caught_up'&&m.value.checkpoint.height>=report.start_height));
      if(!caught)await sleep(250);check();
    }assert.ok(caught,'Bootstrap catchup failed');
    activeLoad=sources.load({phase,from:report.start_height-16,to:report.start_height,periodSeconds:2});
    const arm=await rpc('getblockcount');const lower=arm.value,upper=lower+sampleGoal/2;
    report.phases.push({phase,from_block:lower+1,to_block:upper,assignments:actors.map((a,i)=>({actor:a.name,poll_seconds:assignments[i],variant:a.variant})),armed_ns:arm.end_ns});
    activeWindow=phase;
    let tip=lower,lastTip=arm.start_ns,lastPrep=0;const visible=new Map();
    while(report.rows.filter(row=>row.phase===phase).length<sampleGoal/2){
      check();const iteration=performance.now(),observation=await rpc('getblockcount');
      assert.ok(observation.value>=tip&&observation.value-tip<=32,'Source rollback or excessive jump');
      for(let h=tip+1;h<=observation.value;h++){
        const block=blockReference((await rpc('getblock',[String(h),1])).value);
        assert.equal(block.height,h);source.set(h,{...block,source_ns:observation.end_ns,source_lower_ns:lastTip,source_request_ns:observation.start_ns});
        event({kind:'source',...source.get(h)});
      }tip=observation.value;lastTip=observation.start_ns;
      if(prepPoll>0&&performance.now()-lastPrep>=prepPoll*1000){
        lastPrep=performance.now();
        try{
          requests.prep_observer++;const height=await prep.getHeight({timeoutMs:5000});assert.equal(height.network,'testnet');
          if(!height.ready)report.control_throttles.push({phase,at_ns:now(),code:'SOURCE_NOT_READY'});
          const pending=[...source.keys()].filter(h=>h>lower&&h<=upper&&!available.has(h)&&h<=height.archive_height);
          if(height.ready&&pending.length){requests.prep_observer++;const page=await prep.get({from_block:Math.min(...pending),to_block:Math.max(...pending)+1,limit:1000,field_selection:{block:['height','hash'],transaction:[]}},{timeoutMs:5000});assert.equal(page.cursor,null);prepEvent(page.data.blocks,now());}
        }catch(error){if(![429,503].includes(error.status))throw error;report.control_throttles.push({phase,at_ns:now(),code:error.code,status:error.status});}
      }
      for(let i=0;i<actors.length;i++){
        const a=actors[i];const h=[...source.keys()].filter(h=>h>lower&&h<=upper&&!visible.has(`${a.name}:${h}`)).sort((a,b)=>a-b)[0];
        const target=h??Math.min(tip,upper);
        const response=await gql(a,'query($id:ID!){_meta{height hash status} BlockSummaryById(id:$id){id height hash time transactionCount} TotalsById(id:"all"){id blocks transactions}}',{id:String(target)},true);
        if(response.body&&h!==undefined&&response.body._meta.height>=h&&response.body.BlockSummaryById){
          const expected=source.get(h),row=response.body.BlockSummaryById;
          assert.equal(response.body._meta.status,'ready');assert.equal(row.hash,expected.hash,'GraphQL branch mismatch');assert.equal(row.transactionCount,expected.transactions.length,'Incomplete entity');
          visible.set(`${a.name}:${h}`,{graphql_ns:response.end_ns,graphql_request_ns:response.start_ns,checkpoint:response.body._meta});
        }
      }
      for(let h=lower+1;h<=Math.min(tip,upper);h++){
        if(report.rows.some(row=>row.height===h))continue;
        const s=source.get(h),p=available.get(h),cs=actors.map(a=>commits.get(`${a.name}:${h}`)),gs=actors.map(a=>visible.get(`${a.name}:${h}`));
        if(!p||cs.some(c=>!c)||gs.some(g=>!g))continue;
        assert.equal(p.hash,s.hash);cs.forEach(c=>assert.equal(c.hash,s.hash));
        const row={phase,height:h,hash:s.hash,source_ns:s.source_ns,source_lower_ns:s.source_lower_ns,source_request_ns:s.source_request_ns,prep_ns:p.at_ns,
          profiles:actors.map((a,i)=>({actor:a.name,poll_seconds:assignments[i],variant:a.variant,hash:cs[i].hash,commit_ns:cs[i].at_ns,...gs[i]}))};
        report.rows.push(row);console.log(JSON.stringify({stage:'live_pair',phase,height:h,paired:report.rows.length,source_to_prep_seconds:seconds(row.prep_ns,row.source_ns),graphql_seconds:row.profiles.map(p=>({variant:p.variant,poll:p.poll_seconds,seconds:seconds(p.graphql_ns,row.source_ns)}))}));await save();
      }
      await sleep(Math.max(0,250-(performance.now()-iteration)));
    }
    activeWindow=null;await activeLoad.stop();activeLoad=null;
    for(let i=0;i<workers.length;i++)await stop(workers[i],(phase+i)%2===0?'SIGINT':'SIGKILL');
    for(const a of actors){
      const before=await databaseSnapshot(a);const resumed=await finite(a,before.checkpoint.height);
      assert.equal(resumed.state,'complete');assert.equal(resumed.blocks,0);assert.equal(resumed.transactions,0);
      const after=await databaseSnapshot(a);assert.deepEqual(after.entities,before.entities,'Restart changed committed entities');assert.deepEqual(after.checkpoint,before.checkpoint,'Restart changed checkpoint');
      assert.equal((await rpc('getblockhash',[before.checkpoint.height])).value,before.checkpoint.hash);
      report.restarts.push({phase,actor:a.name,stop_mode:(phase+actors.indexOf(a))%2===0?'SIGINT':'SIGKILL',height:before.checkpoint.height,sha256:before.sha256,read_status_before:before.read_status,read_status_after:after.read_status,blocks_reprocessed:resumed.blocks,passed:true});
    }
    await save();console.log(JSON.stringify({stage:'phase_complete',phase,restarts:report.restarts.length}));
  }
  const heads=await Promise.all(actors.map(databaseSnapshot));const finalHeight=Math.max(...heads.map(s=>s.checkpoint.height));assert.ok(finalHeight-report.start_height<=200,'Reference range bound');
  for(const a of actors)await finite(a,finalHeight);
  const clean=await actor('clean',report.start_height);actors.push(clean);const replayStart=now();await finite(clean,finalHeight);report.clean_replay_seconds=seconds(now(),replayStart);
  const blocks=[];for(let h=report.start_height;h<=finalHeight;h++)blocks.push((await rpc('getblock',[String(h),2])).value);
  const reference=expectedEntities(blocks);const snapshots=[];
  for(const a of actors){const value=await snapshot(a);assert.equal(value.checkpoint.height,finalHeight);assert.equal(value.checkpoint.hash,blocks.at(-1).hash);assert.deepEqual(value.entities,reference.entities,'Independent reference mismatch');snapshots.push({actor:a.name,sha256:value.sha256,checkpoint:value.checkpoint});}
  assert.equal((await rpc('getblockhash',[report.start_height])).value,blocks[0].hash);assert.equal((await rpc('getblockhash',[finalHeight])).value,blocks.at(-1).hash);
  const before=await snapshot(clean);const noOp=await finite(clean,finalHeight);assert.equal(noOp.blocks,0);assert.deepEqual(await snapshot(clean),before);
  report.restarts.push({actor:'clean',stop_mode:'finite process exit',height:finalHeight,sha256:before.sha256,blocks_reprocessed:0,passed:true});
  report.verification={passed:true,from_block:report.start_height,to_block:finalHeight,counts:Object.fromEntries(Object.entries(reference.entities).map(([k,v])=>[k,v.length])),pools:reference.pools,sha256:digest(reference.entities),snapshots};
  await writeFile(join(directory,'reference.json'),JSON.stringify({blocks:blocks.map(blockReference),...reference},null,2)+'\n');
  report.summary=summarize(report.rows.map(row=>({...row,profiles:row.profiles.map(p=>({...p,poll_seconds:p.variant}))})),['original','queued']);
  report.background_requests=sources.requests;
  const base=report.summary.original,candidate=report.summary.queued;
  report.acceptance={paired_samples:report.rows.length===sampleGoal,exact_entities:true,restarts:true,
    original_probe_errors:report.probes.filter(p=>p.phase!==null&&p.variant==='original'&&p.status!==200).length,
    candidate_probe_errors:report.probes.filter(p=>p.phase!==null&&p.variant==='queued'&&p.status!==200).length,
    original_background_errors:sources.requests.filter(r=>r.variant==='original'&&r.status!==200).length,
    candidate_background_errors:sources.requests.filter(r=>r.variant==='queued'&&r.status!==200).length,
    source_to_graphql_p95:candidate.source_to_graphql.p95_seconds<=base.source_to_graphql.p95_seconds};
  report.acceptance.passed=report.acceptance.paired_samples&&report.acceptance.source_to_graphql_p95&&report.acceptance.candidate_probe_errors===0&&report.acceptance.candidate_background_errors<=report.acceptance.original_background_errors;
  report.status='PASS';
} catch(error){report.status='FAIL';report.failure_code=/^[\w :.-]{1,160}$/.test(error.message??'')?error.message:'HARNESS_FAILED';report.failure_frames=(error.stack??'').split('\n').filter(line=>line.includes('/benchmarks/chef/')).map(line=>line.slice(line.indexOf('/benchmarks/chef/')));console.log(JSON.stringify({stage:'failed',code:report.failure_code,frames:report.failure_frames}));process.exitCode=1;}
finally{
  if(activeLoad)await activeLoad.stop().catch(()=>{});
  for(const child of [...children])child.kill('SIGINT');
  await Promise.race([Promise.all([...children].map(c=>new Promise(r=>c.once('exit',r)))),sleep(10000,undefined,{ref:false})]);
  for(const child of [...children])child.kill('SIGKILL');
  await sources.close().catch(()=>{report.errors.push({fatal:true,code:'SOURCE_CLEANUP_FAILED'});report.status='FAIL';});
  await sources.closeFollower().catch(()=>{report.errors.push({fatal:true,code:'FOLLOWER_CLEANUP_FAILED'});report.status='FAIL';});
  report.background_requests=sources.requests;report.source_startups=sources.startups;report.tail_source=sources.followerInfo;
  report.finished_at_utc=new Date().toISOString();report.elapsed_seconds=seconds(now(),began);report.requests=requests;
  try{const group=(await readFile('/proc/self/cgroup','utf8')).trim().split('::')[1];report.experiment_resources={cpu_stat:await readFile('/sys/fs/cgroup'+group+'/cpu.stat','utf8'),peak_memory_bytes:Number(await readFile('/sys/fs/cgroup'+group+'/memory.peak','utf8'))};}catch{}
  await writes;await save();console.log(JSON.stringify({stage:'finished',status:report.status,pairs:report.rows.length,acceptance:report.acceptance}));
}
