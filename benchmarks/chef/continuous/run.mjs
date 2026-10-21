import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {PrepClient} from '@zeer-dev/prep-client';
import {writeReport} from './report.mjs';
import {verifyProjection} from './oracle.mjs';

process.umask(0o077);const root=process.cwd(),out=resolve('result');await fs.mkdir(out,{recursive:false,mode:0o700});
const config={project:`cont_${randomUUID().replaceAll('-','').slice(0,20)}`,port:49420};
const prep=new PrepClient({url:process.env.PREP_URL,token:process.env.PREP_API_TOKEN,timeoutMs:15000});
const meta=await prep.getHeight();assert.equal(meta.network,'testnet');assert.ok(meta.ready);config.from=meta.indexed_height-1199;config.initial_tip=meta.indexed_height;assert.ok(config.from>4500000);
await fs.writeFile('study.json',JSON.stringify(config));
const proof={format:'zeer-continuous-study-v1',status:'RUNNING',started_at_utc:new Date().toISOString(),network:'testnet',workload:'12 synthetic public application observations per real block; no decrypted receipts',viewing_key_loaded:false,chef_version:'0.2.0',config,duration_goal_seconds:3600,events:[],counts:{},resources:[],samples:[],faults:[]};
const count=key=>proof.counts[key]=(proof.counts[key]??0)+1;
const children=new Map(),pending=[];let failure,expectedExit=new Set(),serverReady=false,writerHeight=null;
const database=join(out,'consumer.sqlite');
function local(){try{const db=new DatabaseSync(database,{readOnly:true});try{db.exec('BEGIN');const state=JSON.parse(db.prepare('SELECT payload FROM state WHERE singleton=1').get().payload),rows=db.prepare('SELECT count(*) AS count,max(height) AS height FROM entities').get();db.exec('COMMIT');return {...rows,...state};}finally{db.close();}}catch(error){if(error.code!=='ERR_SQLITE_ERROR'&&error.code!=='ENOENT')throw error;return null;}}
function launch(role){
 const args=role==='consumer'?['consume.mjs','--mode','continuous','--follow','--db',database,'--from',String(config.from),'--project',config.project,'--entity','BlockObservation','--fields','id,blockHeight,blockHash,observationIndex,value','--window-blocks','200','--page-size','100','--max-rows','5000','--max-total-rows','100000','--interval-seconds','1','--max-pages','50']:['worker.mjs',role];
 const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,CHEF_URL:`http://127.0.0.1:${config.port}`},stdio:['ignore','pipe','pipe']});children.set(role,child);let buffer='';
 child.on('error',()=>{failure??='CHILD_SPAWN_FAILED';});
 child.once('exit',(code,signal)=>{proof.events.push({role,event:'exit',code,signal,at:new Date().toISOString(),expected:expectedExit.has(child.pid)});if(!expectedExit.has(child.pid))failure??='UNEXPECTED_CHILD_EXIT';});
 child.stderr.on('data',()=>count(role+':stderr_chunks'));
 child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>65536){failure??='CHILD_FRAME_LIMIT';return;}for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const event=JSON.parse(line);count(`${role}:${event.reason??event.state??event.event}`);if(role==='producer'&&event.event==='sync')writerHeight=event.height;if(role==='api'&&event.event==='ready')serverReady=true;if(event.event==='http')count(`http:${event.path}:${event.status}`);if(event.event==='source_error'||event.event==='failure')proof.events.push({role,...event,at:new Date().toISOString()});}catch{failure??='CHILD_PROTOCOL_ERROR';}}});
 return child;
}
async function stop(role,signal='SIGTERM'){
 const child=children.get(role);if(!child)return;expectedExit.add(child.pid);children.delete(role);
 if(child.exitCode!==null||child.signalCode!==null)return;
 const exited=new Promise(r=>child.once('exit',r));child.kill(signal);await Promise.race([exited,delay(5000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await Promise.race([exited,delay(3000)]);}
}
async function fault(role,pause,signal='SIGTERM'){
 const before=local();await stop(role,signal);const stopped=local();if(role==='api')serverReady=false;
 const event={role,pause_seconds:pause,signal,started_at:new Date().toISOString(),rows_before:before?.count,rows_after_stop:stopped?.count};proof.faults.push(event);
 await delay(pause*1000);const during=local();event.rows_during=during?.count;
 // Only the killed consumer promises an unchanged projection during its pause.
 if(role==='consumer')assert.equal(during?.count,stopped?.count);
 launch(role);event.restarted_at=new Date().toISOString();event.completed=true;
}
async function resources(){
 const sample={at:new Date().toISOString(),parent_rss:process.memoryUsage().rss,children:{},files_bytes:0};
 for(const [role,child]of children){try{const status=await fs.readFile(`/proc/${child.pid}/status`,'utf8');sample.children[role]={rss_bytes:Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]??0)*1024};}catch{}}
 for(const suffix of ['','-wal','-shm'])sample.files_bytes+=await fs.stat(database+suffix).then(v=>v.size,()=>0);
 assert.ok(sample.files_bytes<=128*1024*1024,'LOCAL_STORAGE_LIMIT');proof.resources.push(sample);
}
const overall=Date.now();const timeout=setTimeout(()=>{failure??='INDEPENDENT_DEADLINE';},4200000);
try{
 const installed=JSON.parse(await fs.readFile('node_modules/@zeer-dev/chef/package.json','utf8'));assert.equal(installed.version,'0.2.0');assert.equal((await fs.lstat('node_modules/@zeer-dev/chef')).isSymbolicLink(),false);
 launch('producer');
 while(writerHeight===null){assert.ok(!failure,failure);assert.ok(Date.now()-overall<600000,'BOOTSTRAP_DEADLINE');await delay(500);}
 launch('api');
 while(!serverReady||writerHeight<config.initial_tip){assert.ok(!failure,failure);assert.ok(Date.now()-overall<600000,'BOOTSTRAP_DEADLINE');await delay(1000);}
 launch('consumer');
 while(!(local()?.complete?.caughtUp&&local().count>=14400)){assert.ok(!failure,failure);assert.ok(Date.now()-overall<600000,'BOOTSTRAP_DEADLINE');await delay(1000);}
 proof.bootstrap_seconds=(Date.now()-overall)/1000;proof.soak_started_at_utc=new Date().toISOString();const start=Date.now();await writeReport(out,proof);
 const scheduled=[{at:600,role:'consumer',pause:3,signal:'SIGKILL'},{at:1200,role:'api',pause:10},{at:1800,role:'producer',pause:45},{at:2700,role:'producer',pause:3,signal:'SIGKILL'}];
 let nextFault=0,nextResource=0;
 while(Date.now()-start<3600000){
  assert.ok(!failure,failure);const elapsed=(Date.now()-start)/1000;
  if(nextFault<scheduled.length&&elapsed>=scheduled[nextFault].at){const f=scheduled[nextFault++];await fault(f.role,f.pause,f.signal);}
  if(elapsed>=nextResource){await resources();const current=local();let height;try{height=await prep.getHeight();}catch(error){proof.events.push({event:'monitor_source_error',status:error.status??0,at:new Date().toISOString()});}proof.samples.push({elapsed_seconds:elapsed,prep_height:height?.indexed_height??null,writer_height:writerHeight,consumer_height:current?.complete?.to,rows:current?.count,source_status:current?.complete?.checkpoint.status});await writeReport(out,proof);nextResource+=20;}
  await delay(1000);
 }
 proof.soak_elapsed_seconds=(Date.now()-start)/1000;
 await stop('producer');
 const finalStatus=await fetch(`http://127.0.0.1:${config.port}/status`,{headers:{authorization:`Bearer ${process.env.CHEF_API_TOKEN}`},signal:AbortSignal.timeout(5000)}).then(r=>r.json());assert.equal(finalStatus.checkpoint.status,'ready');writerHeight=finalStatus.checkpoint.height;
 const finish=Date.now()+20000;while(local()?.complete?.to!==writerHeight){assert.ok(!failure,failure);assert.ok(Date.now()<finish,'FINAL_CATCH_UP_TIMEOUT');await delay(500);}
 await stop('consumer');
 const db=new DatabaseSync(database,{readOnly:true});let rows,state;
 try{state=JSON.parse(db.prepare('SELECT payload FROM state WHERE singleton=1').get().payload);rows=db.prepare('SELECT payload FROM entities ORDER BY height,id COLLATE BINARY').all().map(r=>JSON.parse(r.payload));}finally{db.close();}
 const headers=[];let next=config.from;
 while(next<=state.complete.to){const page=await prep.get({from_block:next,to_block:state.complete.to+1,limit:512,field_selection:{block:['height','hash','previous_hash','time'],transaction:[]}});headers.push(...page.data.blocks);assert.ok(page.next_block>next);next=page.next_block;}
 assert.equal(headers.length,state.complete.to-config.from+1);assert.ok(headers.length>=1200);assert.equal(rows.length,headers.length*12);
 const projectionHash=verifyProjection({headers,rows,from:config.from,checkpoint:state.complete.checkpoint});
 proof.final={blocks:headers.length,rows:rows.length,duplicate_ids:0,checkpoint:state.complete.checkpoint,sealed_through:state.complete.sealedThrough,source_equal:true,projection_sha256:projectionHash,headers};
 assert.equal(proof.faults.length,4);assert.ok(proof.faults.every(f=>f.completed));assert.ok(proof.counts['consumer:SOURCE_OBSERVATION_STALE']>0);
 proof.status='PASS';
}catch(error){proof.status='FAIL';proof.failure=/^[A-Z0-9_]+$/.test(error.message??'')?error.message:'STUDY_FAILED';process.exitCode=1;}
finally{
 await Promise.allSettled([...children.keys()].map(role=>stop(role)));proof.completed_at_utc=new Date().toISOString();
 const metricFailure=code=>{proof.status='FAIL';proof.terminal_metric_errors??=[];proof.terminal_metric_errors.push(code);process.exitCode=1;};
 try{await resources();}catch{metricFailure('RESOURCE_COLLECTION_FAILED');}
 const sql=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:5000,statement_timeout:5000});
 try{await sql.connect();proof.database_bytes=Number((await sql.query('SELECT pg_database_size(current_database()) AS size')).rows[0].size);}catch{metricFailure('DATABASE_METRIC_UNAVAILABLE');}finally{await Promise.race([sql.end().catch(()=>{}),delay(2000)]);}
 try{await writeReport(out,proof);}catch{metricFailure('TERMINAL_SNAPSHOT_UNAVAILABLE');}
 try{await fs.writeFile(join(out,'result.json'),JSON.stringify(proof,null,2)+'\n');}catch{metricFailure('TERMINAL_FILE_UNAVAILABLE');}
 clearTimeout(timeout);console.log(JSON.stringify({status:proof.status,failure:proof.failure,terminal_metric_errors:proof.terminal_metric_errors,elapsed_seconds:proof.soak_elapsed_seconds,final:proof.final?{blocks:proof.final.blocks,rows:proof.final.rows,source_equal:proof.final.source_equal}:undefined}));
}
