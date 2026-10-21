import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const e=JSON.parse(await readFile(new URL('../static/benchmarks/2026-10-22-chef-continuous-testnet.json',import.meta.url),'utf8'));
assert.equal(e.format,'zeer-continuous-consumer-results-v1');assert.equal(e.status,'PASS');assert.equal(e.chef_version,'0.2.0');assert.equal(e.viewing_key_loaded,false);
const s=e.study;assert.equal(s.status,'PASS');assert.ok(s.soak_elapsed_seconds>=3600);assert.equal(s.duration_goal_seconds,3600);assert.equal(s.viewing_key_loaded,false);assert.equal(s.final.source_equal,true);
assert.equal(s.final.headers.length,s.final.blocks);assert.ok(s.final.blocks>=1200);assert.equal(s.final.rows,s.final.blocks*12);assert.equal(s.final.duplicate_ids,0);
const rows=[];
for(const [index,block]of s.final.headers.entries()){
 assert.equal(block.height,s.config.from+index);if(index)assert.equal(block.previous_hash,s.final.headers[index-1].hash);
 for(let i=0;i<12;i++)rows.push({blockHash:block.hash,blockHeight:block.height,id:`${block.height}:${i}`,observationIndex:i,value:(BigInt(block.height)*12n+BigInt(i)).toString()});
}
rows.sort((a,b)=>a.blockHeight-b.blockHeight||Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),s.final.projection_sha256);
assert.equal(s.final.headers.at(-1).hash,s.final.checkpoint.hash);assert.equal(s.final.checkpoint.status,'ready');
assert.deepEqual(s.faults.map(f=>[f.role,f.pause_seconds,f.signal]),[['consumer',3,'SIGKILL'],['api',10,'SIGTERM'],['producer',45,'SIGTERM'],['producer',3,'SIGKILL']]);assert.ok(s.faults.every(f=>f.completed));
assert.equal(s.faults[0].rows_after_stop,s.faults[0].rows_during);assert.ok(s.counts['consumer:SOURCE_OBSERVATION_STALE']>0);assert.ok(s.counts['consumer:TRANSPORT_UNAVAILABLE']>0);
assert.ok(s.events.filter(event=>event.event==='exit').every(event=>event.expected));assert.equal(e.supervision.systemd_runtime_max_seconds,4500);assert.equal(e.supervision.kill_mode,'control-group');
assert.equal(e.cgroup.stopped,true);assert.equal(e.cgroup.samples.at(-1).memory_events.oom_kill,0);assert.ok(e.summary.kernel_memory_peak_bytes<=e.resource_limits.job_memory_bytes);
assert.equal(e.acceptance.status,'PASS');assert.ok(Object.values(e.acceptance.checks).every(Boolean));assert.equal(e.acceptance.starter.passed,true);assert.equal(e.acceptance.starter.notes,6);assert.equal(e.acceptance.starter.included_memo_query_passed,true);assert.equal(e.acceptance.starter.consumer_restart_unchanged,true);assert.equal(e.acceptance.starter.workspace_link,false);
for(const [mode,count]of [['range',12],['continuous',15]]){const proof=e.acceptance[`recovery_${mode}`];assert.equal(proof.passed,true);assert.equal(proof.consumer_mode,mode);assert.equal(proof.process_runs,count);assert.equal(proof.viewing_key_loaded,false);assert.equal(proof.owned_fixture_namespace_removed,true);assert.ok(Object.values(proof.checks).every(Boolean));}
assert.equal(e.acceptance.recovery_continuous.final_count,468);assert.equal(e.acceptance.recovery_continuous.checks.sealed_prefix_and_mutable_reorg_with_postgres,true);
assert.equal(e.independent_node.status,'PASS');assert.equal(e.independent_node.sample_count,32);for(const header of e.independent_node.observations)assert.deepEqual(header,s.final.headers.find(block=>block.height===header.height));
assert.equal(e.scanner.registry_sdk_fixture.real_network_receipt,false);assert.equal(e.scanner.local_wsl_mined_receipt.operator_key_remained_on_developer_computer,true);assert.equal(e.scanner.local_wsl_mined_receipt.new_transaction_broadcast,false);
for(const [name,hash]of Object.entries(e.source.sha256))assert.equal(createHash('sha256').update(e.source.files[name]).digest('hex'),hash);
console.log(`Continuous consumer:${s.soak_elapsed_seconds}s,${s.final.blocks} real headers/${s.final.rows} synthetic application entities,4 faults,32 independent headers and12+15 PostgreSQL process checks PASS.`);
