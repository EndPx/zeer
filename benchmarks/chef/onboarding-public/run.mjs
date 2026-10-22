// Run only in a disposable outside-checkout directory prepared by prepare.mjs.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,realpath,chmod} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {RequestBudget,auditFetch} from './transport.mjs';
const [rootInput,clientsInput]=process.argv.slice(2),clients=Number(clientsInput);
assert(rootInput&&[1,3].includes(clients),'Usage: node run.mjs PREPARED_ROOT 1|3');
assert(process.env.DATABASE_URL,'Use a dedicated disposable PostgreSQL database');
const root=await realpath(rootInput),prepared=JSON.parse(await readFile(join(root,'prepared.json'),'utf8'));
const sourceDir=dirname(fileURLToPath(import.meta.url));
const phase=join(root,`phase-${clients}`);await mkdir(phase,{mode:0o700});
const seedCli=join(root,'node_modules/@zeer-dev/chef/dist/cli.js');
const {PrepClient}=await import(pathToFileURL(join(root,'node_modules/@zeer-dev/prep-client/src/index.js')).href);
const requireFromChef=createRequire(pathToFileURL(await realpath(seedCli)));
const {default:pg}=await import(pathToFileURL(requireFromChef.resolve('pg')).href);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,query_timeout:5000});
const proof={format:'zeer-public-onboarding-v1',status:'RUNNING',clients,started_at_utc:new Date().toISOString(),candidate_sha256:prepared.candidate_sha256,chef_version:prepared.chef_version,
 profile:'vanilla CLI follow, default 5-second polling, 1.5-second staggered starts; observational fetch wrapper, no shared pacing/retry/semaphore',
 limits:{public_attempts:120,work_seconds:105,total_seconds:120,range_blocks:8},public_origin:'https://zeer.endpx.cloud/api/prep',viewing_key_loaded:false,projects:[],local_http:[],commands:[]};
const budget=new RequestBudget({maxRequests:120,durationMs:105000});
const meterToken=randomBytes(24).toString('hex');const children=new Set();let control,watchdog;
const started=performance.now(),deadline=()=>{assert.ok(performance.now()-started<105000,'PUBLIC_PHASE_DEADLINE');};
const envBase={PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG??'C.UTF-8',DATABASE_URL:process.env.DATABASE_URL,PREP_URL:proof.public_origin,PREP_API_TOKEN:'',NPM_CONFIG_USERCONFIG:join(root,'empty-user.npmrc'),NPM_CONFIG_GLOBALCONFIG:join(root,'empty-global.npmrc')};
const redact=text=>{for(const secret of [process.env.DATABASE_URL,meterToken,...proof.projects.map(p=>p.token)].filter(Boolean))text=text.replaceAll(secret,'[REDACTED]');return text;};
async function writeProof(){const copy=structuredClone(proof);for(const p of copy.projects)delete p.token;await writeFile(join(phase,'result.json'),JSON.stringify(copy,null,2)+'\n',{mode:0o600});}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await Promise.race([child.done,delay(5000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await child.done;}}
function launch(args,{cwd=root,env=envBase,kind='command'}={}){
 deadline();const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child);
 const record={kind,project:proof.projects.find(p=>p.directory===cwd)?.name??null,started_seconds:(performance.now()-started)/1000,events:[]};proof.commands.push(record);
 let out='',err='',pending='';child.stdout.on('data',b=>{out+=b;pending+=b;if(out.length>2*1024*1024){child.kill('SIGKILL');return;}for(;;){const i=pending.indexOf('\n');if(i<0)break;const line=pending.slice(0,i);pending=pending.slice(i+1);try{child.latest=JSON.parse(line);}catch{}}});child.stderr.on('data',b=>{err+=b;if(err.length>128*1024)child.kill('SIGKILL');});
 child.done=new Promise((res,rej)=>{child.once('error',rej);child.once('exit',(code,signal)=>{children.delete(child);record.exit_code=code;record.signal=signal;record.elapsed_seconds=(performance.now()-started)/1000-record.started_seconds;record.events=out.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return {diagnostic:'NON_JSON_STDOUT'};}});record.stderr=redact(err);res(record);});});return child;
}
async function command(args,options){const child=launch(args,options);const record=await child.done;assert.equal(record.exit_code,0,`COMMAND_FAILED_${record.kind}`);return record;}
async function install(directory){
 const manifestPath=join(directory,'package.json'),m=JSON.parse(await readFile(manifestPath,'utf8'));m.dependencies['@zeer-dev/chef']=`file:${prepared.candidate_path}`;await writeFile(manifestPath,JSON.stringify(m,null,2)+'\n');
 const child=spawn('pnpm',['install','--offline','--ignore-scripts','--store-dir',join(root,'store')],{cwd:directory,env:envBase,stdio:['ignore','pipe','pipe']});children.add(child);let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 child.done=new Promise((r,j)=>{child.once('error',j);child.once('exit',(code,signal)=>{children.delete(child);proof.commands.push({kind:'pnpm-offline-install',exit_code:code,signal});code===0?r():j(new Error('PROJECT_INSTALL_FAILED'));});});
 try{await child.done;}finally{await writeFile(join(directory,'install.log'),redact(output),{mode:0o600});}
 const resolved=await realpath(join(directory,'node_modules/@zeer-dev/chef')),base=await realpath(join(directory,'node_modules')),rel=relative(base,resolved);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'WORKSPACE_DEPENDENCY_FORBIDDEN');
 return {resolved_package_inside_project_node_modules:true,dependency_source:'accepted candidate tarball; transitive dependencies pre-fetched from registry'};
}
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function local(p,path,query){
 const r=await fetch(`http://127.0.0.1:${p.port}${path}`,{method:query?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(5000),headers:{authorization:`Bearer ${p.token}`,...(query?{'content-type':'application/json'}:{})},...(query?{body:JSON.stringify({query})}:{})});
 const body=await r.json();proof.local_http.push({project:p.name,path,status:r.status,seconds:(performance.now()-started)/1000});return {status:r.status,body};
}
async function waitReady(p,minHeight){for(;;){deadline();assert.equal(p.writer.exitCode,null,'FOLLOWER_EXITED_EARLY');try{const r=await local(p,'/status');if(r.status===200&&r.body.checkpoint.status==='ready'&&r.body.checkpoint.height>=minHeight&&p.writer.latest?.state==='caught_up')return r.body;}catch(error){proof.local_http.push({project:p.name,path:'/status',error:error.name});}await delay(500);}}
async function graphRows(p){const query=`query { BlockSummaryList(first: 100, range: {height: {gte: ${proof.range.from}, lte: ${proof.range.to}}}, orderBy: [{height: ASC}, {id: ASC}]) { items {id height hash time transactionCount} nextCursor } _meta {height hash status generation revision} }`;
 const r=await local(p,'/graphql',query);assert.equal(r.status,200);assert.equal(r.body.errors,undefined);assert.equal(r.body.data.BlockSummaryList.nextCursor,null);return r.body.data;
}
function childEnv(p){return {...envBase,CHEF_API_TOKEN:p.token,ZEER_PUBLIC_METER_URL:proof.coordinator,ZEER_PUBLIC_METER_TOKEN:meterToken,ZEER_PUBLIC_CLIENT:p.name};}
function cliArgs(p,...args){return ['--import',join(sourceDir,'probe.mjs'),'--env-file=.env',join(p.directory,'node_modules/@zeer-dev/chef/dist/cli.js'),...args];}
async function retryOracle(run,label){for(let attempt=0;attempt<8;attempt++){try{return await run();}catch(error){proof.oracle_waits??=[];proof.oracle_waits.push({label,attempt:attempt+1,code:error.code??error.name,status:error.status??0});if(!([429,500,502,503,504].includes(error.status)||error.code==='TRANSPORT_ERROR'))throw error;deadline();await delay(5000);}}throw new Error('ORACLE_RETRY_LIMIT');}
try{
 control=createServer(async(req,res)=>{try{
  if(req.headers.authorization!==`Bearer ${meterToken}`)throw new Error('UNAUTHORIZED');let bytes=0,text='';for await(const b of req){bytes+=b.length;if(bytes>2048)throw new Error('METER_BODY_LIMIT');text+=b;}const value=JSON.parse(text);let result;
  if(req.url==='/lease'){assert.equal(typeof value.client,'string');assert(['\/api/prep/height','/api/prep/query'].includes(value.path));result={id:await budget.acquire(value.client,value.path)};}
  else if(req.url==='/finish'){budget.finish(value.id,{status:value.status,bytes:value.bytes??0,retry_after:value.retry_after??null,...(value.error?{error:value.error}:{})});result={ok:true};}else throw new Error('UNKNOWN_METER_PATH');
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
 }catch(error){res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
 await new Promise(r=>control.listen(0,'127.0.0.1',r));proof.coordinator=`http://127.0.0.1:${control.address().port}`;
 watchdog=setTimeout(()=>{for(const child of children)child.kill('SIGKILL');},105000);
 const prep=new PrepClient({url:proof.public_origin,fetch:auditFetch({origin:proof.public_origin,coordinator:proof.coordinator,token:meterToken,client:'independent-oracle'}),timeoutMs:10000});
 const head=await retryOracle(()=>prep.getHeight(),'initial-height');assert(head.ready&&head.network==='testnet'&&head.payload_kind==='full-v1'&&head.indexed_height>=4000000);proof.initial_source=head;
 proof.range={from:head.indexed_height-7,to:head.indexed_height};
 for(let i=0;i<clients;i++){
  const name=`pub_${randomBytes(8).toString('hex')}`,directory=join(phase,name),p={name,directory,token:randomBytes(24).toString('hex'),port:await freePort()};proof.projects.push(p);
  const existing=await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[`chef_${name}`]);assert.equal(existing.rows.length,0);
  await command([seedCli,'init','--template','public','--dir',directory,'--project',name,'--start-height',String(proof.range.from),'--prep-url',proof.public_origin,'--json'],{kind:'init'});
  p.install=await install(directory);
  await writeFile(join(directory,'.env'),`PREP_URL=${proof.public_origin}\nPREP_API_TOKEN=\nDATABASE_URL=${process.env.DATABASE_URL}\nCHEF_API_TOKEN=${p.token}\nCHEF_URL=http://127.0.0.1:${p.port}/graphql\n`,{mode:0o600});await chmod(join(directory,'.env'),0o600);
  await command(cliArgs(p,'codegen','--json'),{cwd:directory,env:childEnv(p),kind:'codegen'});
  await command([join(directory,'node_modules/typescript/bin/tsc'),'--noEmit'],{cwd:directory,env:childEnv(p),kind:'strict-typecheck'});
  await command(cliArgs(p,'migrate','--json'),{cwd:directory,env:childEnv(p),kind:'migrate'});
 }
 for(const p of proof.projects){p.api=launch(cliArgs(p,'serve','--port',String(p.port),'--json'),{cwd:p.directory,env:childEnv(p),kind:'serve'});p.writer=launch(cliArgs(p,'sync','--follow','--json'),{cwd:p.directory,env:childEnv(p),kind:'follow-initial'});await delay(1500);}
 await Promise.all(proof.projects.map(async p=>{p.initial_checkpoint=await waitReady(p,proof.range.to);await stop(p.writer);p.first=await graphRows(p);}));
 for(const p of proof.projects){p.writer=launch(cliArgs(p,'sync','--follow','--json'),{cwd:p.directory,env:childEnv(p),kind:'follow-restart'});await delay(1500);}
 await delay(5500);
 await Promise.all(proof.projects.map(async p=>{p.restart_checkpoint=await waitReady(p,proof.range.to);await stop(p.writer);p.second=await graphRows(p);assert.deepEqual(p.second.BlockSummaryList.items,p.first.BlockSummaryList.items);p.restart_unchanged=true;await command(['--env-file=.env','query.mjs'],{cwd:p.directory,env:childEnv(p),kind:'packaged-query'});}));
 const page=await retryOracle(()=>prep.get({from_block:proof.range.from,to_block:proof.range.to+1,limit:8,field_selection:{block:['height','hash','previous_hash','time'],transaction:['txid','block_height','index','version','locktime']}}),'complete-range');
 assert.equal(page.next_block,proof.range.to+1);assert.equal(page.data.blocks.length,8);
 const headers=page.data.blocks;assert(headers.every((b,i)=>b.height===proof.range.from+i&&(i===0||b.previous_hash===headers[i-1].hash)));
 const txids=new Set();for(const tx of page.data.transactions){assert(!txids.has(tx.txid));txids.add(tx.txid);assert(tx.block_height>=proof.range.from&&tx.block_height<=proof.range.to);}
 const expected=headers.map(b=>({id:String(b.height),height:b.height,hash:b.hash,time:String(b.time),transactionCount:page.data.transactions.filter(tx=>tx.block_height===b.height).length}));
 for(const p of proof.projects){assert.deepEqual(p.second.BlockSummaryList.items,expected);p.complete_source_equal=true;p.rows=expected.length;}
 proof.oracle={headers,transactions:page.data.transactions,expected,epoch:page.epoch,complete_source_equal:true,projection_sha256:createHash('sha256').update(JSON.stringify(expected)).digest('hex')};
 proof.final_source=await retryOracle(()=>prep.getHeight(),'final-height');proof.status='PASS';
}catch(error){proof.status='FAIL';proof.failure={code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'ACCEPTANCE_ASSERTION_FAILED',name:error.name};}
finally{
 clearTimeout(watchdog);for(const child of [...children])await stop(child).catch(()=>{});
 for(const p of proof.projects){delete p.api;delete p.writer;try{const name=`chef_${p.name}`;const marker=await pool.query(`SELECT version FROM "${name}".chef_owned_namespace WHERE singleton=true`);assert(marker.rows.length===1);await pool.query(`DROP SCHEMA "${name}" CASCADE`);p.owned_namespace_removed=true;}catch(error){p.cleanup_error=error.name;proof.status='FAIL';}}
 await pool.end();if(control){control.closeAllConnections();await new Promise(r=>control.close(r));}
 proof.public_attempts=budget.attempts;proof.transport_peak_active=budget.peakActive;proof.elapsed_seconds=(performance.now()-started)/1000;
 proof.status_counts=Object.fromEntries([...new Set(budget.attempts.map(r=>String(r.status??'unfinished')))].map(s=>[s,budget.attempts.filter(r=>String(r.status??'unfinished')===s).length]));
 if(proof.elapsed_seconds>120||budget.attempts.length>120||budget.active!==0){proof.status='FAIL';proof.bound_or_transport_failure=true;}
 for(const p of proof.projects){delete p.token;await writeFile(join(p.directory,'.env'),'# Acceptance credentials removed after all child processes stopped.\n',{mode:0o600});}
 delete proof.coordinator;await writeProof();console.log(JSON.stringify({status:proof.status,clients,elapsed_seconds:proof.elapsed_seconds,public_attempts:budget.attempts.length,status_counts:proof.status_counts,failure:proof.failure}));
}
if(proof.status!=='PASS')process.exitCode=1;
