import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const evidence = JSON.parse(await readFile(new URL('../../apps/docs/static/benchmarks/2026-10-25-chef-operations.json', import.meta.url), 'utf8'));
const median = values => { const a = [...values].sort((a,b) => a-b); return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2; };
const close = (a,b) => assert.ok(Number.isFinite(a) && Math.abs(a-b) < 1e-10, `Aggregate mismatch: ${a} vs ${b}`);
const stages = ['prepToDecryptSeconds','decryptSeconds','decryptToCommitSeconds','commitToConsumerSeconds','prepToConsumerSeconds'];
assert.equal(evidence.status, 'PASS');
assert.equal(evidence.unit, 'seconds');
assert.equal(evidence.runs, 12);
assert.equal(evidence.measurements.length, 12);
assert.equal(evidence.keysUploaded, false);
assert.equal(evidence.newTransactionsBroadcast, false);
assert.equal(evidence.source.after-evidence.source.before, 32);
assert.equal(evidence.verification.backgroundPublishedBlocks, 32);
assert.equal(evidence.verification.temporaryKeyCopyRemoved, true);
assert.equal(evidence.source.to-evidence.source.from+1, 24);
function verifyRun(row) {
  assert.equal(row.blocks, 24); assert.equal(row.transactions, 6);
  assert.equal(row.receiptCount, 12); assert.equal(row.publishedNotes, 6);
  assert.equal(row.selectedTiming.length, 6);
  assert.equal(row.graphql.errors.length, 0); assert.ok(row.graphql.samples > 0);
  assert.equal(row.noOpResumeIdentical, true);
  assert.equal(row.projectionSha256, evidence.projectionSha256);
  for (const key of stages) {
    const a = row.selectedTiming.map(sample => sample[key]).sort((a,b) => a-b);
    assert.ok(a.every(v => Number.isFinite(v) && v >= 0));
    assert.equal(row.stages[key].samples, a.length);
    close(row.stages[key].medianSeconds, median(a));
    close(row.stages[key].p95Seconds, a[Math.ceil(a.length*.95)-1]);
    close(row.stages[key].minSeconds, a[0]); close(row.stages[key].maxSeconds, a.at(-1));
  }
  for (const s of row.selectedTiming) close(s.prepToConsumerSeconds, s.prepToDecryptSeconds+s.decryptToCommitSeconds+s.commitToConsumerSeconds);
}
evidence.measurements.forEach(verifyRun);
assert.equal(evidence.groups.length, 4);
for (const group of evidence.groups) {
  const rows = evidence.measurements.filter(r => r.variant === group.variant && r.profile === group.profile);
  assert.deepEqual(rows.map(r=>r.repeat).sort(), [1,2,3]);
  close(group.medianIndexSeconds, median(rows.map(r=>r.indexedSeconds)));
  close(group.medianPrepRequests, median(rows.map(r=>r.requests)));
  assert.equal(group.querySamples, rows.reduce((n,r)=>n+r.graphql.samples,0));
  for (const key of stages) {
    const a = rows.flatMap(r=>r.selectedTiming.map(s=>s[key])).sort((a,b)=>a-b);
    assert.equal(group.stages[key].samples, 18);
    close(group.stages[key].medianSeconds, median(a));
    close(group.stages[key].p95Seconds, a[Math.ceil(a.length*.95)-1]);
  }
}
assert.equal(evidence.measurements.reduce((n,r)=>n+r.graphql.samples,0), 86);
assert.equal(evidence.resourceCohort.measurements.length, 6);
evidence.resourceCohort.measurements.forEach(verifyRun);
assert.equal(evidence.resourceCohort.temporaryKeyCopyRemoved, true);
assert.equal(evidence.resourceCohort.source.backgroundIngestionProgress, 0);
assert.ok(evidence.controlledRecovery.passed);
assert.equal(evidence.controlledRecovery.entityCount, 1601);
assert.equal(evidence.controlledRecovery.cliProcesses, 8);
assert.ok(Object.values(evidence.controlledRecovery.checks).every(v=>v===true));
assert.equal(evidence.linuxAcceptance.fail, 0); assert.equal(evidence.linuxAcceptance.skipped, 0);
assert.equal(evidence.linuxAcceptance.tests, evidence.linuxAcceptance.pass);
console.log('PASS: 12 timing runs, 4 aggregates, 86 successful queries, 6 separate resource runs and recovery invariants');
