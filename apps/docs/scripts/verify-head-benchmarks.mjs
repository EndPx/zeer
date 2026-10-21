import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {digest, summarize} from '../../../benchmarks/chef/head/common.mjs';

const base = new URL('../static/benchmarks/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, base), 'utf8'));
const evidence = await read('2026-10-21-chef-head-testnet.json');
assert.equal(evidence.sdk_version, '0.1.3');
assert.equal(evidence.studies.length, 3);
let sdk;
for (const study of evidence.studies) {
  const r = study.report, ref = study.reference;
  assert.equal(r.status, 'PASS');
  assert.equal(r.rows.length, 12);
  assert.deepEqual(summarize(r.rows, r.profiles), r.summary);
  for (const phase of r.phases) {
    const rows = r.rows.filter(row => row.phase === phase.phase);
    assert.equal(rows.length, 6);
    assert.equal(rows[0].height, phase.from_block);
    assert.equal(rows.at(-1).height, phase.to_block);
    for (const row of rows) {
      assert.ok(BigInt(row.source_lower_ns) <= BigInt(row.source_ns));
      for (const assignment of phase.assignments) {
        const p = row.profiles.find(p => p.actor === assignment.actor);
        assert.equal(p.poll_seconds, assignment.poll_seconds);
        assert.ok(p.checkpoint.height >= row.height);
        if (p.checkpoint.height === row.height) assert.equal(p.checkpoint.hash, row.hash);
        assert.ok(BigInt(p.commit_ns) <= BigInt(p.graphql_ns));
      }
    }
  }
  assert.notEqual(r.phases[0].assignments[0].poll_seconds, r.phases[1].assignments[0].poll_seconds);
  const verify = r.verification;
  assert.equal(verify.passed, true);
  assert.equal(digest(ref.entities), verify.sha256);
  for (const [entity, rows] of Object.entries(ref.entities)) assert.equal(rows.length, verify.counts[entity]);
  assert.deepEqual(ref.pools, verify.pools);
  assert.equal(ref.blocks[0].height, verify.from_block);
  assert.equal(ref.blocks.at(-1).height, verify.to_block);
  for (let i = 0; i < ref.blocks.length; i++) {
    const block = ref.blocks[i];
    if (i) { assert.equal(block.height, ref.blocks[i-1].height+1); assert.equal(block.previousHash, ref.blocks[i-1].hash); }
    const summary = ref.entities.BlockSummary.find(row => row.height === block.height);
    assert.equal(summary.hash, block.hash);
    assert.equal(summary.transactionCount, block.transactions.length);
    assert.deepEqual(ref.entities.TransactionMeta.filter(row => row.height === block.height).sort((a,b)=>a.transactionIndex-b.transactionIndex).map(row=>row.id), block.transactions);
  }
  assert.deepEqual(ref.entities.Totals, [{id:'all',blocks:ref.blocks.length,transactions:ref.entities.TransactionMeta.length}]);
  assert.equal(verify.snapshots.length, 3);
  for (const snapshot of verify.snapshots) {
    assert.equal(snapshot.sha256, verify.sha256);
    assert.equal(snapshot.checkpoint.height, verify.to_block);
    assert.equal(snapshot.checkpoint.hash, ref.blocks.at(-1).hash);
  }
  assert.equal(r.restarts.length, 5);
  for (const restart of r.restarts) { assert.equal(restart.passed, true); assert.equal(restart.blocks_reprocessed, 0); }
  const errors = r.probes.filter(p=>p.phase !== null && p.status !== 200);
  assert.ok(errors.every(p=>p.status === 503));
  assert.equal(errors.length, r.acceptance.probe_errors);
  const candidate = r.profiles[1];
  const median = r.summary[candidate].prep_to_graphql.median_seconds <= .8*r.summary[5].prep_to_graphql.median_seconds;
  const tail = r.summary[candidate].source_to_graphql.p95_seconds <= r.summary[5].source_to_graphql.p95_seconds;
  assert.equal(r.acceptance.median_prep_to_graphql, median);
  assert.equal(r.acceptance.source_to_graphql_p95, tail);
  assert.equal(r.acceptance.passed, errors.length === 0 && median && tail);
  assert.equal(r.acceptance.passed, false);
  const source = await read(study.source_file);
  for (const [file, hash] of Object.entries(r.harness_sha256)) {
    assert.equal(source.sha256[file], hash);
    assert.equal(createHash('sha256').update(source.files[file]).digest('hex'), hash);
  }
  if (sdk) assert.deepEqual(r.chef_source_sha256, sdk); else sdk = r.chef_source_sha256;
  console.log(`${study.id}: 12 pairs, source projection, 3 exports, 5 restart checks, source hashes PASS; candidate rejected (${errors.length} read gates)`);
}
