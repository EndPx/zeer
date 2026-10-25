import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, writeFile, readFile, rm, chmod, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createServer} from 'node:net';
import pg from 'pg';
import {inspectProject} from '../dist/doctor.js';
import {loadProject, projectFingerprint, assertRunnable} from '../dist/project.js';
import {PostgresStore} from '../dist/store.js';

const secret='DOCTOR_SECRET_MUST_NOT_APPEAR';
const checkpoint={height:100,hash:'a'.repeat(64),anchorHash:'b'.repeat(64),status:'ready',undoFloor:0};
const meta={network:'testnet',payload_kind:'full-v1',ready:true,archive_height:100,indexed_height:100,start_block:0,source_height:101,lag_blocks:1,source_observed_at:1000,source_mode:'follower',epoch:'1'};
const client={async get(){assert.fail('Doctor must not fetch transactions');},async getHeight(){return meta;}};
function store(value=checkpoint){return new Proxy({consumptionStatus:undefined,async checkpoint(){return value;}},{get(target,key){if(key in target)return target[key];return()=>assert.fail(`Doctor called mutation/lifecycle method ${String(key)}`);}});}
async function fixture(t,changes={}, text){
  const dir=await mkdtemp(join(tmpdir(),'chef-doctor-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const config={project:'doctor_test',network:'testnet',startHeight:1,schema:'schema.graphql',handlerVersion:'1',...changes};
  const configPath=join(dir,'chef.config.mjs');
  await writeFile(configPath,text??`export default {...${JSON.stringify(config)},indexer:{${changes.shielded?'receipt':'block'}(){}}};\n`);
  await writeFile(join(dir,'schema.graphql'),'type Observation { id: ID! height: Int! }\n');
  const names=['PREP_URL','DATABASE_URL','PREP_API_TOKEN','CHEF_API_TOKEN','ZEER_SCANNER_EXECUTABLE','ZEER_VIEWING_KEY_FILE'];
  const old=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  Object.assign(process.env,{PREP_URL:'http://localhost:1',DATABASE_URL:`postgresql://local:${secret}@localhost/db`,PREP_API_TOKEN:secret,CHEF_API_TOKEN:secret});
  t.after(()=>{for(const name of names)if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];});
  const options={configPath,host:'127.0.0.1',port:49379,store:store(),client};
  return {dir,configPath,config,options};
}
function code(report,name){return report.checks.find(item=>item.name===name)?.code;}
function safe(report){assert.equal(JSON.stringify(report).includes(secret),false);}

test('shared loader preserves the pre-extraction namespace fingerprint and defaults',async t=>{
  const f=await fixture(t);const project=await loadProject(f.configPath);
  const bytes=await readFile(f.configPath);
  const expected=createHash('sha256').update(bytes).update('\0').update(JSON.stringify({schema:project.model.fingerprint,project:'doctor_test',network:'testnet',startHeight:1,reorgWindow:100,handlerVersion:'1',prepUrl:'https://prep.example/path/'})).digest('hex');
  assert.equal(projectFingerprint(project,'https://prep.example/path'),expected);assert.equal(project.reorgWindow,100);
  const shielded={accountId:'inbox',keyFingerprint:'f'.repeat(64)};const p={...project,config:{...project.config,shielded}};
  const shieldExpected=createHash('sha256').update(bytes).update('\0').update(JSON.stringify({schema:project.model.fingerprint,project:'doctor_test',network:'testnet',startHeight:1,reorgWindow:100,handlerVersion:'1',prepUrl:'https://prep.example/path/',shielded:{protocol:1,accountId:'inbox',keyFingerprint:'f'.repeat(64)}})).digest('hex');
  assert.equal(projectFingerprint(p,'https://prep.example/path/'),shieldExpected);
});
test('Doctor is readonly, omits credentials, and releases its temporary port probe',async t=>{
  const f=await fixture(t);const before=await readFile(f.configPath);const report=await inspectProject(f.options);
  assert.equal(report.ready,true);assert.equal(report.status,'ready');assert.equal(report.source.chefPrepLagBlocks,0);safe(report);
  assert.equal(code(report,'scanner'),'SCANNER_NOT_CONFIGURED');assert.deepEqual(await readFile(f.configPath),before);
  const server=createServer();await new Promise((r,j)=>server.once('error',j).listen(f.options.port,f.options.host,r));await new Promise(r=>server.close(r));
});

test('Doctor combines source freshness with one readonly consumption snapshot and safe actions',async t=>{
  const f=await fixture(t);
  const state={checkpoint,generation:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',revision:'42',lastCommitAt:'2026-10-25T00:00:00.000Z'};
  const report=await inspectProject({...f.options,store:{async consumptionStatus(){return state;},checkpoint(){assert.fail('Use the same consumption snapshot');}}});
  assert.equal(report.ready,true);assert.equal(report.artifact.packageName,'@zeer-dev/chef');
  assert.equal(report.diagnostic.lastCommitAt,state.lastCommitAt);assert.equal(report.diagnostic.dataRevision,'42');
  assert.equal(report.diagnostic.projectGeneration,state.generation);assert.equal(report.diagnostic.sourceObservedAt,meta.source_observed_at);
  assert.ok(report.diagnostic.sourceObservationAgeSeconds>0);assert.equal(report.diagnostic.action.category,'none');safe(report);
  const unavailable=await inspectProject({...f.options,client:{async getHeight(){throw {code:'28P01',message:secret};}}});
  assert.equal(unavailable.checks.find(c=>c.name==='source').action.category,'fix_authentication');safe(unavailable);
});
test('invalid or blank project explicitly skips dependent checks without touching services',async t=>{
  const f=await fixture(t,{},'export default {project:"blank",network:"testnet",startHeight:0,schema:"schema.graphql",handlerVersion:"1",indexer:{}};');
  const p=await loadProject(f.configPath);assert.throws(()=>assertRunnable(p),{code:'INDEXER_HANDLER_REQUIRED'});
  const report=await inspectProject(f.options);assert.equal(report.ready,false);assert.equal(code(report,'project'),'INDEXER_HANDLER_REQUIRED');assert.ok(report.checks.slice(1).every(c=>c.status==='skipped'));safe(report);
});
test('missing migration is distinct from blocked, incompatible and raw database errors',async t=>{
  const f=await fixture(t);
  for(const [error,expected] of [[{code:'42P01'},'MIGRATION_REQUIRED'],[new Error('Chef project identity mismatch; use a new project namespace'),'PROJECT_IDENTITY_MISMATCH'],[new Error(secret),'CHEF_COMMAND_FAILED']]){
    const report=await inspectProject({...f.options,store:{async checkpoint(){throw error;}}});assert.equal(code(report,'database'),expected);assert.equal(report.ready,false);safe(report);
  }
  const blocked=await inspectProject({...f.options,store:store({...checkpoint,status:'blocked'})});assert.equal(code(blocked,'database'),'REBUILD_REQUIRED');
  const reconciling=await inspectProject({...f.options,store:store({...checkpoint,status:'reconciling',reconcileKind:'source'})});assert.equal(reconciling.ready,true);assert.equal(code(reconciling,'read_gate'),'RECONCILIATION_REQUIRED');
});
test('source mismatch, missing history, unavailable source and occupied API port are actionable',async t=>{
  const f=await fixture(t);
  for(const [source,expected]of [[{...meta,network:'mainnet'},'SOURCE_NETWORK_OR_KIND_MISMATCH'],[{...meta,start_block:2},'SOURCE_HISTORY_UNAVAILABLE'],[{...meta,ready:false},'SOURCE_UNAVAILABLE']]){
    const report=await inspectProject({...f.options,client:{...client,async getHeight(){return source;}}});assert.equal(code(report,'source'),expected);safe(report);
  }
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const report=await inspectProject({...f.options,port:server.address().port});assert.equal(code(report,'listen'),'DOCTOR_PORT_UNAVAILABLE');assert.equal(report.ready,false);
});
test('missing environment and API token are reported independently without printing values',async t=>{
  const f=await fixture(t);delete process.env.DATABASE_URL;delete process.env.CHEF_API_TOKEN;
  const report=await inspectProject(f.options);assert.equal(code(report,'environment'),'PREP_URL_AND_DATABASE_URL_REQUIRED');assert.equal(code(report,'api_token'),'CHEF_API_TOKEN_REQUIRED_MIN_16_BYTES');assert.equal(report.checks.find(c=>c.name==='database').status,'skipped');safe(report);
});
test('Doctor bounds an unresponsive injected database check',async t=>{
  const f=await fixture(t);const start=performance.now();const report=await inspectProject({...f.options,store:{checkpoint:()=>new Promise(()=>{})}});
  assert.equal(code(report,'database'),'DOCTOR_CHECK_TIMEOUT');assert.ok(performance.now()-start<7000);safe(report);
});
test('private Doctor checks only local native capabilities and key identity',{skip:!process.env.ZEER_SCANNER_TEST_EXECUTABLE},async t=>{
  const native=JSON.parse(await readFile(new URL('../../../crates/zeer-scanner/tests/fixtures/shielded.json',import.meta.url),'utf8'));
  const keyFingerprint=createHash('sha256').update(native.ufvk).digest('hex');
  const f=await fixture(t,{shielded:{accountId:native.account_id,keyFingerprint}});
  const key=join(f.dir,'ufvk.txt');await writeFile(key,native.ufvk,{mode:0o600});
  process.env.ZEER_SCANNER_EXECUTABLE=resolve(process.env.ZEER_SCANNER_TEST_EXECUTABLE);process.env.ZEER_VIEWING_KEY_FILE=key;
  const report=await inspectProject(f.options);assert.equal(report.ready,true);assert.equal(code(report,'scanner'),'OK');assert.ok(!JSON.stringify(report).includes(native.ufvk));assert.ok(!JSON.stringify(report).includes(keyFingerprint));
  const p=await loadProject(f.configPath);p.config.shielded.keyFingerprint='0'.repeat(64);
  const mismatch=await inspectProject({...f.options,project:p});assert.equal(code(mismatch,'scanner'),'INVALID_SCANNER_IDENTITY');
  if(process.platform!=='win32'){
    await chmod(key,0o644);assert.equal(code(await inspectProject(f.options),'scanner'),'DOCTOR_KEY_FILE_PERMISSIONS');
    await chmod(key,0o600);const link=join(f.dir,'linked.txt');await symlink(key,link);process.env.ZEER_VIEWING_KEY_FILE=link;
    assert.equal(code(await inspectProject(f.options),'scanner'),'DOCTOR_KEY_FILE_INVALID');
  }
});
test('PostgreSQL Doctor preserves namespace state and refuses unmarked namespaces',{skip:!process.env.CHEF_TEST_DATABASE_URL},async t=>{
  const f=await fixture(t,{project:`t_${randomUUID().replaceAll('-','').slice(0,24)}`});
  process.env.DATABASE_URL=process.env.CHEF_TEST_DATABASE_URL;
  const p=await loadProject(f.configPath),db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const namespace=`chef_${p.config.project}`;
  const s=new PostgresStore(process.env.DATABASE_URL,{...p.config,model:p.model,reorgWindow:p.reorgWindow,fingerprint:projectFingerprint(p,process.env.PREP_URL)});
  t.after(async()=>{await s.close();await db.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);await db.end();});
  const options={...f.options,store:undefined};
  assert.equal(code(await inspectProject(options),'database'),'MIGRATION_REQUIRED');
  assert.equal((await db.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[namespace])).rowCount,0);
  await db.query(`CREATE SCHEMA "${namespace}"`);
  assert.equal(code(await inspectProject(options),'database'),'DOCTOR_UNMARKED_NAMESPACE');
  await db.query(`DROP SCHEMA "${namespace}"`);await s.migrate();
  const before=(await db.query(`SELECT row_to_json(s) AS state FROM "${namespace}".state s`)).rows;
  assert.equal((await inspectProject(options)).ready,true);
  const after=(await db.query(`SELECT row_to_json(s) AS state FROM "${namespace}".state s`)).rows;assert.deepEqual(after,before);
});
