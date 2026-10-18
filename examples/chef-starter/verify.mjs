// Installed-package onboarding acceptance. Never uses monorepo runtime imports.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const args=process.argv.slice(2), flags=new Map();
for(let i=0;i<args.length;i++) {
  assert.ok(['--artifacts','--output','--fixture','--port'].includes(args[i])&&!flags.has(args[i]),'Unknown/repeated flag');
  assert.ok(args[i+1]&&!args[i+1].startsWith('--'),'Missing value');
  flags.set(args[i],args[++i]);
}
for(const f of ['--artifacts','--output','--fixture']) assert.ok(flags.has(f),`${f} required`);
for(const e of ['PREP_URL','PREP_API_TOKEN','DATABASE_URL']) assert.ok(process.env[e],`${e} required`);
assert.equal(process.platform,'linux'); assert.equal(process.arch,'x64');
const artifacts=resolve(flags.get('--artifacts')),output=resolve(flags.get('--output'));
const resultRoot=resolve('benchmarks/results'),rel=relative(resultRoot,output);
assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Use a fresh directory below benchmarks/results');
const port=Number(flags.get('--port')??39473);assert.ok(Number.isInteger(port)&&port>0&&port<65536);
await mkdir(output,{recursive:false});
const parent=await mkdtemp(join(tmpdir(),'zeer-starter-consumer-'));
const bootstrap=join(parent,'bootstrap'),project=join(parent,'application');
await mkdir(bootstrap);await writeFile(join(bootstrap,'package.json'),'{"private":true,"type":"module"}');
await writeFile(join(output,'consumer.json'),JSON.stringify({parent,project,node:process.version,platform:process.platform},null,2));
const started=performance.now();
function run(bin,argv,cwd,label,env=process.env) {
  const r=spawnSync(bin,argv,{cwd,env,encoding:'utf8',timeout:180000});
  // Successful commands emit no credentials. Failed logs remain local-only.
  return Promise.all([writeFile(join(output,label+'.stdout'),r.stdout??''),writeFile(join(output,label+'.stderr'),r.stderr??'')]).then(()=>{
    assert.equal(r.status,0,`${label} failed; retained output in ${output}`);return r.stdout;
  });
}
const tgzs=['zeer-prep-client-0.1.0.tgz','zeer-chef-0.1.0.tgz'].map(n=>join(artifacts,n));
await run('npm',['install','--no-audit','--no-fund',...tgzs],bootstrap,'bootstrap-install');
const fixture=JSON.parse(await readFile(resolve(flags.get('--fixture')),'utf8'));
assert.equal(fixture.network,'testnet');
const expected=fixture.blocks.filter(b=>b.height>=1000&&b.height<=1002);
assert.deepEqual(expected.map(b=>b.height),[1000,1001,1002],'Acceptance fixture must contain testnet blocks 1000..1002');
await run(join(bootstrap,'node_modules/.bin/zeer-chef'),['init','--dir',project,'--project','starter_'+Date.now().toString(36),'--start-height','1000','--json'],bootstrap,'init');
await run('npm',['install','--no-audit','--no-fund',...tgzs],project,'application-install');
const packageRoot=join(project,'node_modules/@zeer/chef');assert.equal(await realpath(packageRoot),packageRoot);
await run('npm',['run','codegen'],project,'codegen');
await run('npm',['run','typecheck'],project,'typecheck');
// The scaffold's generated .env provides its own unique GraphQL token; integration
// endpoints override local Postgres defaults without modifying the generated files.
const text=await readFile(join(project,'.env'),'utf8');
const token=text.match(/^CHEF_API_TOKEN=(.+)$/m)[1];
const env={...process.env,CHEF_API_TOKEN:token};
await run('npm',['run','migrate'],project,'migrate',env);
await run('npm',['run','sync','--','--to','1000','--json'],project,'first-sync',env);
const cli=join(packageRoot,'dist/cli.js');
async function queryCheck(last,label) {
  const child=spawn(process.execPath,['--env-file=.env',cli,'serve','--port',String(port),'--json'],{cwd:project,env,stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const endpoint=`http://127.0.0.1:${port}/graphql`;
  const request=JSON.stringify({query:'{ BlockSummaryList(first: 10) { items { id height hash time transactionCount } nextCursor } _meta { height hash status } }'});
  try {
    let response;
    for(let n=0;n<100;n++) {
      assert.equal(child.exitCode,null,'GraphQL child exited');
      try {response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:request,signal:AbortSignal.timeout(1500)});break;}
      catch {await delay(100);}
    }
    assert.ok(response,'GraphQL did not listen');assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.errors,undefined);
    const rows=expected.filter(b=>b.height<=last).map(b=>({id:String(b.height),height:b.height,hash:b.hash,time:String(b.decoded.time),transactionCount:b.decoded.tx.length}));
    assert.deepEqual(result.data.BlockSummaryList,{items:rows,nextCursor:null});
    assert.equal(result.data._meta.height,last);assert.equal(result.data._meta.hash,rows.at(-1).hash);assert.equal(result.data._meta.status,'ready');
    const unauthorized=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:request});assert.equal(unauthorized.status,401);
    await run('npm',['run','query'],project,label+'-query-command',{...env,CHEF_URL:endpoint});
    await writeFile(join(output,label+'.json'),JSON.stringify(result,null,2));
  } finally {
    child.kill('SIGTERM');
    let timer;
    const outcome=await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),5000);})]);clearTimeout(timer);
    if(!outcome){child.kill('SIGKILL');await exited;}
    await writeFile(join(output,label+'-server.log'),logs);
    assert.ok(outcome&&outcome.code===0,'Server did not stop cleanly');
  }
}
await queryCheck(1000,'first-graphql');
await run('npm',['run','sync','--','--to','1002','--json'],project,'resumed-sync',env);
await queryCheck(1002,'resumed-graphql');
const repeat=await run('npm',['run','sync','--','--to','1002','--json'],project,'repeated-sync',env);
const lines=repeat.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
assert.equal(lines.at(-1).blocks,0,'Repeated sync must not duplicate work');
await run('npm',['run','status','--','--json'],project,'status',env);
const accepted={status:'PASS',network:'testnet',sourceMode:'captured_historical_replay',first:1000,last:1002,
  installedOutsideMonorepo:true,strictTypecheck:true,exactGraphQL:true,unauthenticatedRejected:true,restartResume:true,repeatedSyncBlocks:0,
  elapsedMs:performance.now()-started,consumer:project,scope:'Standalone installed CLI init → own schema/handler → PostgreSQL → GraphQL. Not live tip following or whole-chain coverage.'};
await writeFile(join(output,'acceptance.json'),JSON.stringify(accepted,null,2));
console.log(JSON.stringify(accepted));
