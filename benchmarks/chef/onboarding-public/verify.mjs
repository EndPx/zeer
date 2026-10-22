import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const artifact=JSON.parse(await readFile(new URL('./2026-10-22-public-onboarding.json',import.meta.url),'utf8'));
assert.equal(artifact.status,'PASS');assert.equal(artifact.published_package,false);
assert.deepEqual(artifact.phases.map(p=>p.study.clients),[1,3]);
for(const {study:s,zebra,supervision} of artifact.phases){
 assert.equal(s.status,'PASS');assert.equal(s.candidate_sha256,artifact.candidate_sha256);
 assert.equal(s.viewing_key_loaded,false);assert.equal(s.public_origin,'https://zeer.endpx.cloud/api/prep');
 assert(s.elapsed_seconds>0&&s.elapsed_seconds<=120);assert(s.public_attempts.length>0&&s.public_attempts.length<=120);
 assert.equal(s.projects.length,s.clients);assert.equal(s.range.to-s.range.from+1,8);
 assert.equal(s.oracle.headers.length,8);assert.equal(s.oracle.complete_source_equal,true);
 const tx=s.oracle.transactions;assert.equal(new Set(tx.map(t=>t.txid)).size,tx.length);
 const expected=s.oracle.headers.map((b,i)=>{assert.equal(b.height,s.range.from+i);if(i)assert.equal(b.previous_hash,s.oracle.headers[i-1].hash);return {id:String(b.height),height:b.height,hash:b.hash,time:String(b.time),transactionCount:tx.filter(t=>t.block_height===b.height).length};});
 assert.deepEqual(s.oracle.expected,expected);assert.equal(s.oracle.projection_sha256,createHash('sha256').update(JSON.stringify(expected)).digest('hex'));
 assert.equal(s.commands.filter(c=>c.kind==='follow-initial').length,s.clients);
 assert.equal(s.commands.filter(c=>c.kind==='follow-restart').length,s.clients);
 for(const p of s.projects){
  assert(p.install.resolved_package_inside_project_node_modules&&p.restart_unchanged&&p.complete_source_equal&&p.owned_namespace_removed);
  assert.deepEqual(p.first.BlockSummaryList.items,expected);assert.deepEqual(p.second.BlockSummaryList.items,expected);
  assert.equal(p.rows,8);assert.equal(p.first._meta.generation,p.second._meta.generation);
  const commands=s.commands.filter(c=>c.project===p.name);for(const kind of ['codegen','strict-typecheck','migrate','serve','follow-initial','follow-restart','packaged-query'])assert(commands.some(c=>c.kind===kind&&c.exit_code===0),kind);
  for(const command of commands.filter(c=>c.kind.startsWith('follow-')))assert(command.events.some(e=>e.state==='caught_up'));
 }
 for(const command of s.commands)assert.equal(command.exit_code,0);
 for(const [i,request]of s.public_attempts.entries()){assert.equal(request.id,i);assert.equal(request.status,200);assert.equal(request.error,undefined);assert(request.finished_seconds>=request.started_seconds);}
 assert.equal(s.transport_peak_active,1);assert.equal(zebra.status,'PASS');assert.equal(zebra.observations.length,8);
 for(let i=0;i<8;i++){const z=zebra.observations[i],b=s.oracle.headers[i];assert.deepEqual(z,{height:b.height,hash:b.hash,time:b.time,transaction_count:expected[i].transactionCount,previous_hash:b.previous_hash});}
 assert.equal(supervision.guard.status,'PASS');assert(supervision.systemd_properties.includes('MemoryMax=1073741824'));assert(supervision.systemd_properties.includes('RuntimeMaxUSec=2min'));
}
assert.equal(artifact.guard_before.status,'PASS');assert.equal(artifact.cleanup.status,'PASS');assert.equal(artifact.cleanup.guard.status,'PASS');
assert.equal(artifact.cleanup.active_connections_before_cleanup,0);assert.equal(artifact.cleanup.runtime_credentials_matched,0);assert(artifact.cleanup.runtime_environment_removed&&artifact.cleanup.generated_environment_credentials_scrubbed);
assert.equal(artifact.setup_attempts.length,2);assert(artifact.setup_attempts.every(x=>x.status==='FAIL_BEFORE_PUBLIC_REQUEST'));
const failed=artifact.preserved_interrupted_stop_attempt;assert.equal(failed.status,'FAIL');assert(failed.public_attempts.some(a=>a.error==='ABORTED'));assert(failed.local_http.some(a=>a.path==='/graphql'&&a.status===503));
assert(failed.commands.some(c=>c.kind==='follow-initial'&&c.events.some(e=>e.state==='stopped'&&e.checkpoint.status==='reconciling')));
for(const source of artifact.sources)assert.equal(source.sha256,createHash('sha256').update(source.source).digest('hex'));
console.log(JSON.stringify({status:'PASS',phases:2,projects:4,public_attempts:artifact.phases.reduce((n,p)=>n+p.study.public_attempts.length,0),eight_block_ranges_equal:true,independent_zebra_checks:16,interrupted_stop_failure_retained:true,scope:'candidate acceptance; no public latency or429recoveryclaim'}));
