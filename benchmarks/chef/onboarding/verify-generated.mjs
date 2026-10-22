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
const execute=promisify(execFile),bootstrap=resolve('node_modules/@zeer-dev/chef');
const expected=process.env.ZEER_EXPECTED_CHEF_VERSION??'0.3.0',candidate=process.env.ZEER_CANDIDATE_TARBALL;
assert.equal(JSON.parse(await fs.readFile(join(bootstrap,'package.json'),'utf8')).version,expected);
const packagePath=relative(await fs.realpath('node_modules'),await fs.realpath(bootstrap));assert.ok(packagePath&&!isAbsolute(packagePath)&&!packagePath.split(/[\\/]/).includes('..'));
const require=createRequire(pathToFileURL(join(bootstrap,'package.json'))),{Client}=require('pg');
const fixture=JSON.parse(await fs.readFile(process.env.ZEER_PUBLIC_FIXTURE,'utf8'));assert.match(fixture.warning,/PUBLIC UNFUNDED/);
const scanner=process.env.ZEER_SCANNER_EXECUTABLE;assert.ok(isAbsolute(scanner));
const root=resolve('generated-acceptance');await fs.mkdir(root,{recursive:false,mode:0o700});
const proof={status:'RUNNING',chef_version:expected,workspace_link:false,candidate_tarball:!!candidate,live_network_receipt:false,operator_viewing_key_loaded:false,templates:[],commands:[]};
const cleanEnv={...process.env,PREP_URL:'http://127.0.0.1:1',PREP_API_TOKEN:''};
async function command(program,args,cwd,env=cleanEnv,code=0){
 let result;try{result=await execute(program,args,{cwd,env,timeout:120000,maxBuffer:1024*1024});}catch(error){result=error;}
 const log=`command-${proof.commands.length}.log`;await fs.writeFile(join(root,log),result.stdout+result.stderr,{mode:0o600});proof.commands.push({program:program===process.execPath?'node':'pnpm',exit_code:result.code??0,log});assert.equal(result.code??0,code,'GENERATED_COMMAND_FAILED');return result;
}
try{
 for(const template of ['blank','public','shielded']){
  const project='init_'+randomUUID().replaceAll('-','').slice(0,20),path=join(root,template),entry={template,project};let api,passed=false,key;
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
   const {main}=await import(pathToFileURL(cli).href),q=fixture.request,block={height:q.height,hash:'a'.repeat(64),previous_hash:'b'.repeat(64),time:1700000000};
   const client={getHeight:async()=>({network:'testnet',payload_kind:'full-v1',ready:true,archive_height:q.height,indexed_height:q.height,start_block:q.height,epoch:'1',revision:'1',source_height:q.height,source_observed_at:Math.floor(Date.now()/1000),lag_blocks:0}),get:async query=>({network:'testnet',epoch:'1',from_block:q.height,next_block:q.height+1,data:{blocks:[block],transactions:query.field_selection.transaction.length?[{txid:q.txid,block_height:q.height,index:0,version:6,locktime:0,...(query.field_selection.transaction.includes('raw')?{raw:q.raw}:{})}]:[]}})};
   for(const cmd of ['migrate','sync'])await main([cmd,'--config',join(path,'chef.config.ts'),'--json'],{client,write(){}});
   const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const origin=`http://127.0.0.1:${port}`;
   api=spawn(process.execPath,['--env-file=.env',cli,'serve','--config','chef.config.ts','--port',String(port)],{cwd:path,env,stdio:['ignore','pipe','pipe']});api.stdout.resume();api.stderr.resume();
   const deadline=Date.now()+10000;while(true){try{if((await fetch(origin+'/status',{headers:{authorization:`Bearer ${env.CHEF_API_TOKEN}`},signal:AbortSignal.timeout(500)})).ok)break;}catch{}assert.ok(Date.now()<deadline&&api.exitCode===null,'GENERATED_API_UNAVAILABLE');await new Promise(r=>setTimeout(r,100));}
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
   passed=true;entry.passed=true;
  }finally{
   if(api&&api.exitCode===null){const exit=new Promise(r=>api.once('exit',r));api.kill('SIGTERM');await Promise.race([exit,new Promise(r=>setTimeout(r,5000))]);if(api.exitCode===null)api.kill('SIGKILL');}
   await fs.unlink(join(path,'.env')).catch(()=>{});if(key)await fs.unlink(key).catch(()=>{});
   if(passed){const sql=new Client({connectionString:cleanEnv.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:5000});try{await sql.connect();assert.match(project,/^init_[a-f0-9]{20}$/);await sql.query(`DROP SCHEMA "chef_${project}" CASCADE`);entry.owned_namespace_removed=true;}finally{await sql.end();}}
   proof.templates.push(entry);
  }
 }
 proof.status='PASS';
}finally{await fs.writeFile('generated-proof.json',JSON.stringify(proof,null,2)+'\n',{mode:0o600});}
console.log(JSON.stringify(proof));
