import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {digest,summarize} from '../../../benchmarks/chef/head/common.mjs';
const evidence=JSON.parse(await readFile(new URL('../static/benchmarks/2026-10-21-chef-admission-testnet.json',import.meta.url),'utf8'));
const r=evidence.report,ref=evidence.reference;
assert.equal(evidence.sdk_version,'0.2.0');assert.equal(r.status,'PASS');assert.equal(r.rows.length,12);assert.equal(r.poll_seconds,2);
const calculated={};
// Adapt only the profile label: common's aggregation uses poll_seconds as key.
const adapted=r.rows.map(row=>({...row,profiles:row.profiles.map(p=>({...p,poll_seconds:p.variant==='original'?5:2}))}));
const summary=summarize(adapted,[5,2]);calculated.original=summary[5];calculated.queued=summary[2];calculated.source_to_prep=summary.source_to_prep;calculated.paired_graphql_improvement=summary.paired_graphql_improvement;
assert.deepEqual(calculated,r.summary);
for(const phase of r.phases){const rows=r.rows.filter(row=>row.phase===phase.phase);assert.equal(rows.length,6);assert.equal(rows[0].height,phase.from_block);assert.equal(rows.at(-1).height,phase.to_block);
 for(const row of rows)for(const assignment of phase.assignments){const p=row.profiles.find(p=>p.actor===assignment.actor);assert.equal(p.variant,assignment.variant);assert.equal(p.poll_seconds,2);assert.equal(p.hash,row.hash);assert.ok(BigInt(p.commit_ns)<=BigInt(p.graphql_ns));}}
assert.notEqual(r.phases[0].assignments[0].variant,r.phases[1].assignments[0].variant);
assert.equal(digest(ref.entities),r.verification.sha256);assert.equal(r.verification.passed,true);
for(const [name,items]of Object.entries(ref.entities))assert.equal(items.length,r.verification.counts[name]);
for(let i=0;i<ref.blocks.length;i++){const b=ref.blocks[i];if(i){assert.equal(b.height,ref.blocks[i-1].height+1);assert.equal(b.previousHash,ref.blocks[i-1].hash);}const entity=ref.entities.BlockSummary.find(e=>e.height===b.height);assert.equal(entity.hash,b.hash);assert.equal(entity.transactionCount,b.transactions.length);
 assert.deepEqual(ref.entities.TransactionMeta.filter(e=>e.height===b.height).sort((a,b)=>a.transactionIndex-b.transactionIndex).map(e=>e.id),b.transactions);}
assert.deepEqual(ref.entities.Totals,[{id:'all',blocks:ref.blocks.length,transactions:ref.entities.TransactionMeta.length}]);
assert.equal(r.verification.snapshots.length,3);for(const snapshot of r.verification.snapshots)assert.equal(snapshot.sha256,r.verification.sha256);
assert.equal(r.restarts.length,5);for(const restart of r.restarts){assert.equal(restart.passed,true);assert.equal(restart.blocks_reprocessed,0);}
const errors=variant=>r.probes.filter(p=>p.phase!==null&&p.variant===variant&&p.status!==200).length;
const background=variant=>r.background_requests.filter(p=>p.variant===variant&&p.status!==200).length;
assert.equal(r.acceptance.original_probe_errors,errors('original'));assert.equal(r.acceptance.candidate_probe_errors,errors('queued'));
assert.equal(r.acceptance.original_background_errors,background('original'));assert.equal(r.acceptance.candidate_background_errors,background('queued'));
assert.equal(errors('original'),0);assert.equal(errors('queued'),0);assert.equal(background('original'),0);assert.equal(background('queued'),0);
assert.ok(r.summary.queued.source_to_graphql.p95_seconds<=r.summary.original.source_to_graphql.p95_seconds);assert.equal(r.acceptance.passed,true);
for(const [file,hash]of Object.entries(r.harness_sha256)){assert.equal(evidence.source.sha256[file],hash);assert.equal(createHash('sha256').update(evidence.source.files[file]).digest('hex'),hash);}
assert.deepEqual(r.prep_binary_sha256,{original:evidence.control.binary_sha256['prep-original'],queued:evidence.control.binary_sha256['prep-queued']});
assert.equal(evidence.control.binary_sha256['prep-original'],evidence.control.binary_sha256['prep-deployed']);
assert.equal(r.tail_source.confirmations,1);assert.equal(r.tail_source.poll_seconds,2);assert.equal(evidence.setups_without_paired_samples.length,2);
assert.equal(evidence.full_history_rollout_check.status,'STOPPED_AT_READINESS_DEADLINE');assert.equal(evidence.full_history_rollout_check.deadline_seconds,1200);assert.equal(evidence.full_history_rollout_check.full_archive_ready,false);assert.equal(evidence.full_history_rollout_check.public_route_changed,false);assert.equal(evidence.full_history_rollout_check.source_binary_sha256,r.prep_binary_sha256.queued);
console.log('Chef0.2.0 admission:12 pairs, exact source projection,5 restarts, source hashes, zero read errors in both variants PASS');
