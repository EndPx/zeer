// Fresh release-starter acceptance using only the explicitly public fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import pg from 'pg';
const execute=promisify(execFile);process.umask(0o077);
const fixture=JSON.parse(await fs.readFile(process.env.ZEER_PUBLIC_FIXTURE,'utf8'));assert.match(fixture.warning,/PUBLIC UNFUNDED/);
const scanner=resolve(process.env.ZEER_SCANNER_EXECUTABLE),project='smoke_'+randomUUID().replaceAll('-','').slice(0,20),key=resolve('private/verification.ufvk'),q=fixture.request;
await fs.mkdir('private',{recursive:true,mode:0o700});await fs.writeFile(key,fixture.ufvk,{flag:'wx',mode:0o600});
let api,passed=false,port,createdEnv=false;
const proof={source:'public-unfunded-cryptographic-fixture-with-synthetic-chain-context',live_network_receipt:false,operator_viewing_key_loaded:false,project,commands:[]};
try{
 const inspected=JSON.parse((await execute(scanner,['inspect-key','--account','inbox','--key-file',key],{timeout:10000})).stdout);
 const env={...process.env,PREP_API_TOKEN:'',PREP_URL:'http://127.0.0.1:1',ZEER_PROJECT:project,ZEER_ACCOUNT_ID:'inbox',ZEER_BIRTHDAY_HEIGHT:String(q.height),ZEER_KEY_FINGERPRINT:inspected.key_fingerprint,ZEER_SCANNER_EXECUTABLE:scanner,ZEER_VIEWING_KEY_FILE:key};process.env.PREP_API_TOKEN='';
 const variables=['DATABASE_URL','CHEF_API_TOKEN','PREP_URL','ZEER_PROJECT','ZEER_ACCOUNT_ID','ZEER_BIRTHDAY_HEIGHT','ZEER_KEY_FINGERPRINT','ZEER_SCANNER_EXECUTABLE','ZEER_VIEWING_KEY_FILE'];
 for(const name of variables){assert.ok(env[name]&&!/[\r\n]/.test(env[name]));process.env[name]=env[name];}
 await fs.writeFile('.env',variables.map(name=>`${name}=${env[name]}`).join('\n')+'\n',{flag:'wx',mode:0o600});
 createdEnv=true;
 const {main}=await import(pathToFileURL(resolve('node_modules/@zeer-dev/chef/dist/cli.js')).href);
 const block={height:q.height,hash:'a'.repeat(64),previous_hash:'b'.repeat(64),time:1700000000};
 const client={getHeight:async()=>({network:'testnet',payload_kind:'full-v1',ready:true,archive_height:q.height,indexed_height:q.height,start_block:q.height,epoch:'1',revision:'1',source_height:q.height,source_observed_at:Math.floor(Date.now()/1000),lag_blocks:0}),get:async query=>({network:'testnet',epoch:'1',from_block:q.height,next_block:q.height+1,data:{blocks:[block],transactions:query.field_selection.transaction.length?[{txid:q.txid,block_height:q.height,index:0,version:6,locktime:0,raw:q.raw}]:[]}})};
 for(const command of ['codegen','migrate','sync'])await main([command,'--config','chef.config.mjs','--json'],{client,write:text=>{const value=JSON.parse(text);proof.commands.push({command:value.command,status:value.status??value.state});}});
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));port=socket.address().port;await new Promise(r=>socket.close(r));
 const cli=resolve('node_modules/@zeer-dev/chef/dist/cli.js');api=spawn(process.execPath,['--env-file=.env',cli,'serve','--config','chef.config.mjs','--listen','127.0.0.1','--port',String(port)],{env,stdio:['ignore','pipe','pipe']});let apiError=false;api.on('error',()=>apiError=true);api.stdout.resume();api.stderr.resume();
 const origin=`http://127.0.0.1:${port}`,deadline=Date.now()+10000;
 while(true){try{const response=await fetch(origin+'/status',{headers:{authorization:`Bearer ${env.CHEF_API_TOKEN}`},signal:AbortSignal.timeout(500)});if(response.ok)break;}catch{}assert.ok(Date.now()<deadline&&api.exitCode===null&&!apiError,'STARTER_API_UNAVAILABLE');await new Promise(r=>setTimeout(r,100));}
 const queried=JSON.parse((await execute(process.execPath,['--env-file=.env','query.mjs'],{env:{...env,CHEF_URL:origin},timeout:10000,maxBuffer:65536})).stdout);assert.equal(queried.data.ReadableNoteList.items.length,6);proof.included_memo_query_passed=true;
 for(let i=0;i<2;i++){
  const result=await execute(process.execPath,['--env-file=.env','consume.mjs','--mode','continuous','--db','private/inbox.sqlite','--from',String(q.height),'--project',project],{env:{...env,CHEF_URL:origin},timeout:15000,maxBuffer:65536});
  const last=JSON.parse(result.stdout.trim().split('\n').at(-1));assert.equal(last.state,i===0?'complete':'unchanged');
 }
 const {ContinuousConsumer}=await import(pathToFileURL(resolve('consumer.mjs')).href);
 const consumer=new ContinuousConsumer({file:resolve('private/inbox.sqlite'),url:origin,token:env.CHEF_API_TOKEN,project,from:q.height});
 try{const rows=consumer.rows();assert.equal(rows.length,6);assert.deepEqual(rows.map(r=>[r.pool,r.outputIndex,r.valueZat,r.scope]).sort(),fixture.expected.toSorted());proof.notes=rows.length;proof.consumer_restart_unchanged=true;proof.duplicate_ids=rows.length-new Set(rows.map(r=>r.id)).size;}finally{consumer.close();}
 proof.chef_version=JSON.parse(await fs.readFile('node_modules/@zeer-dev/chef/package.json','utf8')).version;assert.equal(proof.chef_version,'0.2.0');
 const packageRelative=relative(await fs.realpath('node_modules'),await fs.realpath('node_modules/@zeer-dev/chef'));assert.ok(packageRelative&&!isAbsolute(packageRelative)&&!packageRelative.split(/[\\/]/).includes('..'));proof.package_symlink=(await fs.lstat('node_modules/@zeer-dev/chef')).isSymbolicLink();proof.workspace_link=false;passed=true;proof.passed=true;
}finally{
 if(api&&api.exitCode===null){const ended=new Promise(r=>api.once('exit',r));api.kill('SIGTERM');await Promise.race([ended,new Promise(r=>setTimeout(r,5000))]);if(api.exitCode===null)api.kill('SIGKILL');}
 if(createdEnv)await fs.unlink('.env').catch(()=>{});await fs.unlink(key).catch(()=>{});
 if(passed){const sql=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:5000});try{await sql.connect();assert.match(project,/^smoke_[a-f0-9]{20}$/);await sql.query(`DROP SCHEMA "chef_${project}" CASCADE`);proof.owned_namespace_removed=true;}finally{await sql.end();}}
 await fs.writeFile('starter-proof.json',JSON.stringify(proof,null,2)+'\n');
}
console.log(JSON.stringify(proof));
