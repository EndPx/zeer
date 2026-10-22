// Run outside the checkout with an installed candidate and disposable PostgreSQL.
// Private crypto acceptance uses public unfunded fixture data, never a live key.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {createServer as httpServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {cleanup,removeFile,stopped} from './resources.mjs';
const execute=promisify(execFile),bootstrap=resolve('node_modules/@zeer-dev/chef');
const expected=process.env.ZEER_EXPECTED_CHEF_VERSION??'0.4.0',candidate=process.env.ZEER_CANDIDATE_TARBALL;
assert.equal(JSON.parse(await fs.readFile(join(bootstrap,'package.json'),'utf8')).version,expected);
const packagePath=relative(await fs.realpath('node_modules'),await fs.realpath(bootstrap));assert.ok(packagePath&&!isAbsolute(packagePath)&&!packagePath.split(/[\\/]/).includes('..'));
const require=createRequire(pathToFileURL(join(bootstrap,'package.json'))),{Client}=require('pg');
const fixture=JSON.parse(await fs.readFile(process.env.ZEER_PUBLIC_FIXTURE,'utf8'));assert.match(fixture.warning,/PUBLIC UNFUNDED/);
const scanner=process.env.ZEER_SCANNER_EXECUTABLE;assert.ok(isAbsolute(scanner));
const root=resolve(process.env.ZEER_DEV_ACCEPTANCE_ROOT??'dev-doctor-acceptance');await fs.mkdir(root,{recursive:false,mode:0o700});
const proof={status:'RUNNING',chef_version:expected,workspace_link:false,candidate_tarball:!!candidate,live_network_receipt:false,operator_viewing_key_loaded:false,templates:[],commands:[]};
const q=fixture.request,block={height:q.height,hash:'a'.repeat(64),previous_hash:'b'.repeat(64),time:1700000000};
let outage=false,requests=0;
const source=httpServer(async(req,res)=>{
 requests++;res.setHeader('content-type','application/json');
 if(outage){res.statusCode=503;res.end('{"error":{"code":"SOURCE_UNAVAILABLE"}}');return;}
 if(req.url==='/height'){res.end(JSON.stringify({network:'testnet',payload_kind:'full-v1',ready:true,archive_height:q.height,indexed_height:q.height,start_block:q.height,epoch:'1',revision:'1',source_height:q.height,source_observed_at:Math.floor(Date.now()/1000),lag_blocks:0,source_mode:'follower'}));return;}
 if(req.url==='/query'){let text='';for await(const chunk of req){text+=chunk;if(text.length>16384){req.destroy();return;}}const query=JSON.parse(text);
  const tx={txid:q.txid,block_height:q.height,index:0,version:6,locktime:0,raw:q.raw};
  res.end(JSON.stringify({network:'testnet',epoch:'1',revision:'1',archive_height:q.height,from_block:query.from_block,to_block:query.to_block,next_block:query.to_block,cursor:null,data:{blocks:[block],transactions:query.field_selection.transaction.length?[Object.fromEntries(query.field_selection.transaction.map(name=>[name,tx[name]]))]:[]}}));return;
 }res.statusCode=404;res.end('{}');
});
await new Promise(r=>source.listen(0,'127.0.0.1',r));
const cleanEnv={...process.env,PREP_URL:'http://127.0.0.1:'+source.address().port,PREP_API_TOKEN:''};
const children=new Set();let failure;
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;const done=new Promise(r=>child.once('close',r));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),12000);await done;clearTimeout(timer);children.delete(child);assert.equal(child.exitCode,0,'DEV_CANCEL_FAILED');}
async function until(check){const end=Date.now()+45000;while(Date.now()<end){if(await check())return;await delay(200);}assert.fail('DEV_ACCEPTANCE_DEADLINE');}

async function command(program,args,cwd,env=cleanEnv,code=0){
 let result;try{result=await execute(program,args,{cwd,env,timeout:120000,maxBuffer:1024*1024});}catch(error){result=error;}
 const log=`command-${proof.commands.length}.log`;await fs.writeFile(join(root,log),result.stdout+result.stderr,{mode:0o600});proof.commands.push({program:program===process.execPath?'node':'pnpm',exit_code:result.code??0,log});const exitCode=result instanceof Error?(typeof result.code==='number'?result.code:1):0;proof.commands.at(-1).exit_code=exitCode;assert.equal(exitCode,code,'GENERATED_COMMAND_FAILED');return result;
}
try{
 for(const template of ['blank','public','shielded']){
  const project='dev_'+randomUUID().replaceAll('-','').slice(0,20),path=join(root,template),entry={template,project};let api,passed=false,key,templateFailure;
  try{
   await command(process.execPath,[join(bootstrap,'dist/cli.js'),'init','--template',template,'--dir',path,'--project',project,'--start-height',String(fixture.request.height),'--json'],root);
   if(candidate){const manifest=JSON.parse(await fs.readFile(join(path,'package.json'),'utf8'));assert.equal(manifest.dependencies['@zeer-dev/chef'],expected);manifest.dependencies['@zeer-dev/chef']='file:'+resolve(candidate);await fs.writeFile(join(path,'package.json'),JSON.stringify(manifest,null,2)+'\n');}
   await command('/usr/bin/pnpm',['install','--ignore-scripts'],path);
   const env={...cleanEnv,ZEER_SCANNER_EXECUTABLE:scanner,ZEER_ACCOUNT_ID:'inbox'};
   let envText=await fs.readFile(join(path,'.env'),'utf8');
   for(const name of ['DATABASE_URL','CHEF_API_TOKEN','PREP_URL']){assert.ok(env[name]&&!/[\r\n]/.test(env[name]));envText=envText.replace(new RegExp(`^${name}=.*$`,'m'),`${name}=${env[name]}`);}
   if(template==='shielded'){
    key=join(root,project+'.ufvk');await fs.writeFile(key,fixture.ufvk,{mode:0o600,flag:'wx'});
    const inspect=JSON.parse((await command(scanner,['inspect-key','--account','inbox','--key-file',key],root)).stdout);
    env.ZEER_VIEWING_KEY_FILE=key;env.ZEER_KEY_FINGERPRINT=inspect.key_fingerprint;
    for(const name of ['ZEER_SCANNER_EXECUTABLE','ZEER_VIEWING_KEY_FILE','ZEER_KEY_FINGERPRINT'])envText=envText.replace(new RegExp(`^${name}=.*$`,'m'),`${name}=${env[name]}`);
   }
   await fs.writeFile(join(path,'.env'),envText,{mode:0o600});
   const cli=join(path,'node_modules/@zeer-dev/chef/dist/cli.js');
   if(template==='blank'){
    await command('/usr/bin/pnpm',['run','typecheck'],path,env);entry.empty_typecheck=true;
    const rejected=await command(process.execPath,[cli,'codegen'],path,env,1);assert.match(rejected.stderr,/EMPTY_SCHEMA_ADD_ENTITY/);entry.empty_codegen_actionable=true;
    assert.equal((await fs.readFile(join(path,'schema.graphql'),'utf8')).replace(/#[^\n]*/g,'').trim(),'');
    await fs.writeFile(join(path,'schema.graphql'),'type Observation { id: ID! height: Int! @index hash: String! }\n');
    await fs.writeFile(join(path,'handlers.ts'),'import {defineIndexer} from "@zeer-dev/chef";\nimport type {ChefEntities} from "./chef.generated.ts";\nexport default defineIndexer<ChefEntities>({async block({block,context}){await context.entities.set("Observation",{id:String(block.height),height:block.height,hash:block.hash});}});\n');
   }
   await command('/usr/bin/pnpm',['run','codegen'],path,env);await command('/usr/bin/pnpm',['run','typecheck'],path,env);entry.codegen=true;entry.typecheck=true;
   for(const name of ['DATABASE_URL','CHEF_API_TOKEN','PREP_URL','PREP_API_TOKEN','ZEER_SCANNER_EXECUTABLE','ZEER_VIEWING_KEY_FILE','ZEER_KEY_FINGERPRINT','ZEER_ACCOUNT_ID']){if(env[name]!==undefined)process.env[name]=env[name];else delete process.env[name];}
   const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const origin=`http://127.0.0.1:${port}`;
   const doctor=await command(process.execPath,['--env-file=.env',cli,'doctor','--port',String(port),'--json'],path,env,1);
   const diagnosis=JSON.parse(doctor.stdout);assert.deepEqual(diagnosis.checks.filter(c=>c.status==='fail').map(c=>c.code),['MIGRATION_REQUIRED']);entry.fresh_doctor_actionable=true;
   const noMigrate=await command(process.execPath,['--env-file=.env',cli,'dev','--port',String(port),'--json'],path,env,1);assert.match(noMigrate.stderr,/DEV_PREFLIGHT_FAILED/);entry.implicit_migration_refused=true;
   const headers={authorization:`Bearer ${env.CHEF_API_TOKEN}`};
   function launch(migrate=false){const c=spawn(process.execPath,['--env-file=.env',cli,'dev','--port',String(port),'--poll-seconds','1','--json',...(migrate?['--migrate']:[])],{cwd:path,env,stdio:['ignore','pipe','pipe']});children.add(c);c.events=[];let pending='';c.stdout.on('data',b=>{pending+=b;for(;;){const i=pending.indexOf('\n');if(i<0)break;const line=pending.slice(0,i);pending=pending.slice(i+1);try{c.events.push(JSON.parse(line));}catch{}}});c.stderr.resume();return c;}
   async function ready(){assert.equal(api.exitCode,null,'DEV_EXITED_EARLY');try{const r=await fetch(origin+'/status',{headers,signal:AbortSignal.timeout(1000)});if(!r.ok)return false;const v=await r.json();return v.checkpoint?.status==='ready'&&v.checkpoint.height===q.height;}catch{return false;}}
   api=launch(true);await until(ready);entry.dev_migrate_follow_api=true;
   assert.ok(api.events.some(e=>e.status==='typechecked'));assert.ok(api.events.some(e=>e.status==='api_listening'));
   outage=true;await until(async()=>{try{return (await fetch(origin+'/graphql',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({query:'{ _meta { height } }'}),signal:AbortSignal.timeout(1000)})).status===503;}catch{return false;}});entry.source_loss_gates_reads=true;outage=false;await until(ready);entry.source_recovery=true;
   await stop(api);await until(async()=>{try{await fetch(origin+'/status',{headers,signal:AbortSignal.timeout(300)});return false;}catch{return true;}});entry.api_port_released=true;
   api=launch();await until(ready);entry.dev_restart=true;
   const query=template==='blank'?'query { ObservationList(first:10){items{id height hash}} _meta{height hash status} }':await fs.readFile(join(path,'query.graphql'),'utf8');
   const response=await fetch(origin+'/graphql',{method:'POST',headers:{authorization:`Bearer ${env.CHEF_API_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(10000)}),result=await response.json();assert.equal(response.status,200);assert.equal(result.errors,undefined);entry.migrate_sync_api=true;
   if(template==='blank')assert.deepEqual(result.data.ObservationList.items,[{id:String(q.height),height:q.height,hash:block.hash}]);
   else{
    const queried=JSON.parse((await command('/usr/bin/pnpm',['run','--silent','query'],path,{...env,CHEF_URL:origin})).stdout);
    if(template==='public'){assert.deepEqual(queried.data.BlockSummaryList.items,[{id:String(q.height),height:q.height,hash:block.hash,time:String(block.time),transactionCount:1}]);}
    else{
     assert.equal(queried.data.ReadableNoteList.items.length,6);entry.memo_query_notes=6;
     for(let i=0;i<2;i++){
      const consumed=await command(process.execPath,['--env-file=.env','consume.mjs','--mode','continuous','--db','private/inbox.sqlite','--from',String(q.height),'--project',project],path,{...env,CHEF_URL:origin});const last=JSON.parse(consumed.stdout.trim().split('\n').at(-1));assert.equal(last.state,i===0?'complete':'unchanged');
     }
     const {ContinuousConsumer}=await import(pathToFileURL(join(path,'consumer.mjs')).href);const consumer=new ContinuousConsumer({file:join(path,'private/inbox.sqlite'),url:origin,token:env.CHEF_API_TOKEN,project,from:q.height});try{assert.deepEqual(consumer.rows().map(r=>[r.pool,r.outputIndex,r.valueZat,r.scope]).sort(),fixture.expected.toSorted());entry.consumer_restart_unchanged=true;}finally{consumer.close();}
    }
   }
   await stop(api);entry.graceful_shutdown=true;
   const readyDoctor=JSON.parse((await command(process.execPath,['--env-file=.env',cli,'doctor','--port',String(port),'--json'],path,env)).stdout);assert.equal(readyDoctor.ready,true);entry.final_doctor_ready=true;
   passed=true;entry.passed=true;
  }catch(error){templateFailure=error;}finally{
   templateFailure=await cleanup([
    ()=>stop(api),()=>removeFile(join(path,'.env')),async()=>{if(key)await removeFile(key);},
    async()=>{if(passed&&stopped(api)){const sql=new Client({connectionString:cleanEnv.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:5000});try{await sql.connect();assert.match(project,/^dev_[a-f0-9]{20}$/);await sql.query(`DROP SCHEMA "chef_${project}" CASCADE`);entry.owned_namespace_removed=true;}finally{await sql.end();}}},
   ],templateFailure);
   proof.templates.push(entry);
  }
  if(templateFailure)throw templateFailure;
 }
 proof.status='PASS';
 }catch(error){failure=error;}finally{
 failure=await cleanup([...children].map(child=>()=>stop(child)).concat([async()=>{source.closeAllConnections();await new Promise(r=>source.close(r));}]),failure);
 if(failure)proof.status='FAIL';proof.fixture_http_requests=requests;
 await fs.writeFile('dev-doctor-proof.json',JSON.stringify(proof,null,2)+'\n',{mode:0o600});
}
if(failure)throw failure;
console.log(JSON.stringify(proof));
