import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {stats} from '../../../benchmarks/chef/head/common.mjs';
const e=JSON.parse(await readFile(new URL('../static/benchmarks/2026-10-21-chef-receipts-testnet.json',import.meta.url),'utf8'));
assert.equal(e.chef_version,'0.2.0');assert.equal(e.original_live_goal_met,false);assert.equal(e.original_live_goal,6);assert.equal(e.runs.length,2);
const [initial,recovery]=e.runs;assert.equal(initial.status,'INCOMPLETE');assert.equal(initial.live_sample_count,1);assert.equal(recovery.status,'RECEIPT_CHECKS_PASS_LIVE_GOAL_UNMET');assert.equal(recovery.live_sample_count,4);assert.equal(recovery.catch_up_sample_count,2);
for(const run of e.runs){assert.equal(run.original_live_goal_met,false);const live=run.selected.filter(r=>r.observation_mode==='live');assert.equal(live.length,run.live_sample_count);
 for(const row of run.selected){assert.equal(row.value_zat,'100000');assert.equal(row.scope,'external');assert.equal(row.pool,'ironwood');const t=row.timestamps;assert.ok(BigInt(t.prep_ns)<=BigInt(t.decrypt_start_ns)&&BigInt(t.decrypt_start_ns)<=BigInt(t.decrypt_ns)&&BigInt(t.decrypt_ns)<=BigInt(t.handler_start_ns)&&BigInt(t.handler_end_ns)<=BigInt(t.commit_ns)&&BigInt(t.commit_ns)<=BigInt(t.consumer_ns));
  for(const [key,end,start]of [['prep_to_decrypted','decrypt_ns','prep_ns'],['decrypt_service','decrypt_ns','decrypt_start_ns'],['decrypted_to_commit','commit_ns','decrypt_ns'],['commit_to_consumer','consumer_ns','commit_ns'],['prep_to_consumer','consumer_ns','prep_ns']])assert.equal(row.seconds[key],Number(BigInt(t[end])-BigInt(t[start]))/1e9);}
 for(const [key,value]of Object.entries(run.live_summary))assert.deepEqual(value,stats(live.map(row=>row.seconds[key])));
 assert.equal(run.supervision.forced,false);assert.ok(run.errors.every(error=>error.status===429));
}
assert.equal(new Set(recovery.selected.map(r=>r.txid)).size,6);assert.equal(new Set(recovery.selected.map(r=>r.height)).size,6);assert.equal(new Set(recovery.selected.map(r=>r.output_identity_sha256)).size,6);
assert.equal(initial.selected[0].txid,recovery.selected[0].txid);assert.equal(recovery.selected[0].observation_mode,'catch_up');assert.equal(recovery.selected[1].observation_mode,'catch_up');
assert.deepEqual(e.operations.map(r=>r.ordinal),[1,2,3,4,5,6]);assert.equal(e.operations.reduce((sum,r)=>sum+BigInt(r.fee_zat),0n),BigInt(e.total_fee_zat));assert.equal(e.total_fee_zat,'60000');
for(const operation of e.operations){const row=recovery.selected.find(r=>r.txid===operation.txid);assert.ok(row);assert.equal(row.memo,operation.memo);assert.equal(row.memo,`Zeer live receipt 0${operation.ordinal}`);}
assert.equal(e.source_canonicality.all_six_mined_canonical_at_source,true);for(const observed of e.source_canonicality.observations){const row=recovery.selected.find(r=>r.txid===observed.txid);assert.equal(row.height,observed.height);assert.equal(row.block_hash,observed.block_hash);assert.ok(observed.confirmations_observed>=1);}
assert.equal(e.restart.passed,true);assert.equal(e.restart.rows,12);assert.equal(e.restart.duplicate_ids,0);assert.equal(e.controlled_recovery.passed,true);assert.equal(e.controlled_recovery.process_runs,8);assert.equal(e.controlled_recovery.viewing_key_loaded,false);
for(const [file,hash]of Object.entries(e.source.sha256))assert.equal(createHash('sha256').update(e.source.files[file]).digest('hex'),hash);
assert.equal(e.registry.version,'0.2.0');assert.equal(e.registry.workspace_link,false);assert.equal(e.viewing_key_remained_local,true);
console.log('Receipts:6 mined notes, restart/dedup PASS; initial1live and recovery4live+2catch-up kept separate; original6-live goal UNMET');
