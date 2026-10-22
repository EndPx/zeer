import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {randomBytes,createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {installedPrep,cleanup,removeFile,stopped} from './resources.mjs';
const execute=promisify(execFile),bootstrap=resolve('node_modules/@zeer-dev/chef'),require=createRequire(join(bootstrap,'package.json'));
const {Client}=require('pg'),{PrepClient}=await installedPrep();
const source='https://zeer.endpx.cloud/api/prep',prep=new PrepClient({url:source,timeoutMs:10000});
const proof={status:'RUNNING',source,chef_version:'0.4.0',fixture:false,from_version:'0.3.0',viewing_key_loaded:false,blocks:2,commands:[]};
const root=resolve(process.env.ZEER_PUBLIC_DEV_ROOT??'upgrade-dev-acceptance');await fs.mkdir(root,{mode:0o700});
const project='live_dev_'+randomBytes(8).toString('hex'),directory=join(root,'project'),candidate=process.env.ZEER_CANDIDATE_TARBALL;
const env={...process.env,PREP_URL:source,PREP_API_TOKEN:''};let dev,failure;
async function command(args,code=0){let r;try{r=await execute(process.execPath,args,{cwd:directory,env,timeout:90000,maxBuffer:1048576});}catch(e){r=e;}const actual=r instanceof Error?(typeof r.code==='number'?r.code:1):0;proof.commands.push({exit_code:actual});assert.equal(actual,code,'PUBLIC_DEV_COMMAND_FAILED');return r;}
async function stop(){if(!dev||dev.exitCode!==null||dev.signalCode!==null)return;const closed=new Promise(r=>dev.once('close',r));dev.kill('SIGTERM');const timer=setTimeout(()=>dev.kill('SIGKILL'),12000);await closed;clearTimeout(timer);assert.equal(dev.exitCode,0);}
try{
 const head=await prep.getHeight();assert(head.ready&&head.network==='testnet'&&head.payload_kind==='full-v1');const to=head.archive_height,from=to-1;proof.range={from,to};
 await execute(process.execPath,[process.env.ZEER_OLD_CHEF_CLI,'init','--dir',directory,'--project',project,'--start-height',String(from),'--prep-url',source,'--json'],{cwd:root,env,timeout:15000});
 const manifest=JSON.parse(await fs.readFile(join(directory,'package.json')));assert.equal(manifest.dependencies['@zeer-dev/chef'],'0.3.0');
 await execute('/usr/bin/pnpm',['install','--ignore-scripts'],{cwd:directory,env,timeout:120000});
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const origin=`http://127.0.0.1:${port}`;
 await fs.writeFile(join(directory,'.env'),`PREP_URL=${source}\nPREP_API_TOKEN=\nDATABASE_URL=${env.DATABASE_URL}\nCHEF_API_TOKEN=${env.CHEF_API_TOKEN}\nCHEF_URL=${origin}\n`,{mode:0o600});
 const cli=join(directory,'node_modules/@zeer-dev/chef/dist/cli.js');
 const headers={authorization:'Bearer '+env.CHEF_API_TOKEN,'content-type':'application/json'};
 function launch(migrate){const child=spawn(process.execPath,['--env-file=.env',cli,'dev','--port',String(port),'--json',...(migrate?['--migrate']:[])],{cwd:directory,env,stdio:['ignore','pipe','pipe']});child.stdout.resume();child.stderr.resume();return child;}
 async function ready(){const end=Date.now()+60000;while(Date.now()<end){assert.equal(dev.exitCode,null,'PUBLIC_DEV_EXITED');try{const r=await fetch(origin+'/status',{headers,signal:AbortSignal.timeout(1000)}),v=await r.json();if(r.ok&&v.checkpoint.status==='ready'&&v.checkpoint.height>=to)return;}catch{}await delay(500);}assert.fail('PUBLIC_DEV_DEADLINE');}
 const query=`{BlockSummaryList(first:10,range:{height:{gte:${from},lte:${to}}},orderBy:[{height:ASC},{id:ASC}]){items{id height hash time transactionCount}nextCursor}}`;
 async function rows(){const r=await fetch(origin+'/graphql',{method:'POST',headers,body:JSON.stringify({query}),signal:AbortSignal.timeout(5000)}),v=await r.json();assert.equal(r.status,200);assert.equal(v.errors,undefined);return v.data.BlockSummaryList.items;}
 const configBefore=await fs.readFile(join(directory,'chef.config.ts'));
 await command(['--env-file=.env',cli,'migrate','--json']);await command(['--env-file=.env',cli,'sync','--to',String(to),'--json']);
 const db=new Client({connectionString:env.DATABASE_URL});await db.connect();let before;
 try{before=(await db.query(`SELECT fingerprint,generation,height FROM "chef_${project}".state WHERE singleton=true`)).rows[0];}finally{await db.end();}
 assert.equal(Number(before.height),to);proof.previous_version_sync=true;
 manifest.dependencies['@zeer-dev/chef']=candidate?'file:'+resolve(candidate):'0.4.0';await fs.writeFile(join(directory,'package.json'),JSON.stringify(manifest));await execute('/usr/bin/pnpm',['install','--ignore-scripts'],{cwd:directory,env,timeout:120000});
 assert.deepEqual(await fs.readFile(join(directory,'chef.config.ts')),configBefore);
 const doctor=JSON.parse((await command(['--env-file=.env',cli,'doctor','--port',String(port),'--json'])).stdout);assert.equal(doctor.ready,true);proof.new_version_doctor_ready_without_migration=true;
 dev=launch(false);await ready();const first=await rows();await stop();proof.first_start=true;
 const inspect=new Client({connectionString:env.DATABASE_URL});await inspect.connect();try{const after=(await inspect.query(`SELECT fingerprint,generation FROM "chef_${project}".state WHERE singleton=true`)).rows[0];assert.equal(after.fingerprint,before.fingerprint);assert.equal(after.generation,before.generation);proof.namespace_identity_and_generation_preserved=true;}finally{await inspect.end();}
 dev=launch(false);await ready();const second=await rows();await stop();assert.deepEqual(first,second);proof.restart_unchanged=true;
 const oracle=await prep.get({from_block:from,to_block:to+1,limit:2,field_selection:{block:['height','hash','previous_hash','time'],transaction:['txid','block_height','index','version','locktime']}});
 const expected=oracle.data.blocks.map(b=>({id:String(b.height),height:b.height,hash:b.hash,time:String(b.time),transactionCount:oracle.data.transactions.filter(tx=>tx.block_height===b.height).length}));assert.equal(expected.length,2);assert.deepEqual(second,expected);proof.complete_source_equal=true;proof.expected=expected;proof.projection_sha256=createHash('sha256').update(JSON.stringify(expected)).digest('hex');proof.status='PASS';
 }catch(error){failure=error;}finally{
 failure=await cleanup([
  stop,()=>removeFile(join(directory,'.env')),
  async()=>{if(!stopped(dev))return;const sql=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:5000});try{await sql.connect();assert.match(project,/^live_dev_[a-f0-9]{16}$/);await sql.query(`DROP SCHEMA IF EXISTS "chef_${project}" CASCADE`);proof.owned_namespace_removed=true;}finally{await sql.end();}},
 ],failure);
 if(failure)proof.status='FAIL';
 await fs.writeFile(join(root,'proof.json'),JSON.stringify(proof,null,2)+'\n');
}
if(failure)throw failure;
console.log(JSON.stringify(proof));
