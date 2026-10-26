import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const x=JSON.parse(await readFile(new URL('../static/benchmarks/2026-10-27-prep-catalog-recovery-testnet.json',import.meta.url),'utf8'));
const median=a=>(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;
const close=(a,b)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-9);
assert.equal(x.status,'PASS');
assert.equal(x.initial.catalogSegments,30000);
assert.equal(x.initial.catalogBytes,15532924);
assert.equal(x.limits.maxCatalogSegments,30000);
assert.equal(x.limits.maxCatalogBytes,16*1024**2);
assert.equal(x.limits.catalogLimitsRaised,false);
assert.equal(x.installedWriter.artifact.buildCommit,'63331816537545f0d059d61a2f453fcabeb6a1b8');
assert.equal(x.installedWriter.actualRunningExecutableSha256,x.installedWriter.sha256);
assert.equal(x.installedWriter.artifact.sourceState,'clean');
assert.equal(x.legacyWriter.normalizedMatchingNativeFiles.length,40);
assert.deepEqual(x.legacyWriter.mismatches,[]);
assert.equal(x.unreferencedBefore.count,79);
assert.equal(Object.values(x.unreferencedBefore.classifications).reduce((n,v)=>n+v,0),79);
assert.equal(x.unreferencedBefore.allPreservedAndManifestsUnchanged,true);
const p=x.prefixVerification;
assert.equal(p.status,'PASS');
assert.equal(p.old_total_blocks,x.initial.head-x.initial.startHeight+1);
assert.equal(p.unchanged_blocks+p.changed_blocks,p.old_total_blocks);
assert.equal(p.old_head_hash,x.initial.headHash);
assert.ok(p.changed_blocks>0&&p.replacement_groups>0&&p.old_encoded_segment_bytes_hashed>0);
assert.equal(x.startup.layoutRefresh.old_snapshot_identical,true);
assert.equal(x.startup.layoutRefresh.refreshed_projection_identical,true);
assert.equal(x.startup.layoutRefresh.stale_cursor_status,409);
for(const before of x.startup.oldLayoutSnapshotProbe.cases){
  const after=x.startup.layoutRefresh.cases.find(v=>v.name===before.name);
  assert.equal(after.data_sha256,before.data_sha256);
  assert.equal(before.seconds.length,5);assert.equal(after.seconds.length,5);
}
let successes=0,capacity=0,invalidations=0;
const digests=new Map();
for(const phase of x.concurrentPhases){
  assert.equal(Object.values(phase.metadataStatuses).reduce((n,v)=>n+v,0),phase.metadataSamples);
  assert.equal(phase.metadataObservations.length,phase.metadataSamples);
  const metadataStatuses={};
  for(const row of phase.metadataObservations)metadataStatuses[String(row.http)]=(metadataStatuses[String(row.http)]??0)+1;
  assert.deepEqual(metadataStatuses,phase.metadataStatuses);
  assert.equal(phase.metadataObservations.filter(v=>v.ready===true).length,phase.readySamples);
  assert.equal(phase.metadataObservations.filter(v=>v.consumerStatus==='ready').length,phase.consumerReadySamples);
  for(const [name,group]of Object.entries(phase.queriesByCase)){
    const rows=phase.querySamples.filter(v=>v.case===name),ok=rows.filter(v=>v.http===200);
    assert.equal(rows.length,group.requests);
    const statuses={};for(const row of rows)statuses[String(row.http)]=(statuses[String(row.http)]??0)+1;
    assert.deepEqual(statuses,group.statuses);
    const a=ok.map(v=>v.seconds).sort((a,b)=>a-b);
    assert.equal(group.successfulLatency.samples,a.length);
    if(a.length){close(group.successfulLatency.medianSeconds,median(a));close(group.successfulLatency.p95Seconds,a[Math.ceil(a.length*.95)-1]);close(group.successfulLatency.minSeconds,a[0]);close(group.successfulLatency.maxSeconds,a.at(-1));}
    for(const row of ok){const previous=digests.get(name);if(previous)assert.equal(row.dataSha256,previous);else digests.set(name,row.dataSha256);}
    successes+=ok.length;capacity+=rows.filter(v=>v.http===429).length;invalidations+=rows.filter(v=>v.http===409).length;
  }
}
assert.equal(successes,178);assert.equal(capacity,9);assert.equal(invalidations,3);
const f=x.final;
assert.equal(f.status,'PASS');assert.equal(f.prep.ready,true);
assert.ok(f.prep.indexed_height>x.initial.head);
assert.ok(f.atUnix-f.prep.source_observed_at>=0&&f.atUnix-f.prep.source_observed_at<120);
assert.equal(f.consumer.checkpoint.status,'ready');assert.equal(f.consumer.source.status,'available');
assert.ok(f.consumer.checkpoint.height>x.initial.consumerHeight);
assert.equal(f.graphQL.status,'ready');
assert.equal(f.sourceHashChecks[String(f.graphQL.height)],f.graphQL.hash);
assert.equal(f.sourceHashChecks[String(x.initial.head)],x.initial.headHash);
assert.ok(Object.keys(f.sourceHashChecks).length>=5);
assert.equal(f.consumerContainerIdsAndStartsUnchanged,true);assert.equal(f.anchorUnchanged,true);
assert.equal(f.readerPidUnchanged,true);assert.equal(f.consumerContainersRestarted,false);
assert.equal(f.keysOrProjectChanged,false);assert.equal(f.filesDeleted,false);
assert.ok(f.catalog.segments<30000&&f.catalog.bytes<x.initial.catalogBytes);
assert.ok(f.catalog.segments<x.limits.followSegmentHighWater&&f.catalog.bytes<x.limits.followByteHighWater);
assert.ok(f.archiveBytes+256*1024**2<f.archiveBudgetBytes);
assert.equal(f.guard.status,'PASS');assert.equal(f.guard.cpuLimit,3);assert.equal(f.guard.memoryMiB,8192);assert.equal(f.guard.diskBudgetGiB,60);
assert.ok(f.guard.zeerBytes<59*1024**3);
for(const resource of Object.values(f.resources)){assert.equal(Number(resource.memoryEvents.oom),0);assert.equal(Number(resource.memoryEvents.oom_kill),0);}
assert.equal(x.initialPrefixVerification.old_total_blocks,p.old_total_blocks);
assert.ok(p.captured_epoch>=x.initialPrefixVerification.captured_epoch);
assert.equal(x.postMaintenanceQueries.status,'PASS');
assert.equal(x.postMaintenanceQueries.samples.length,16);
assert.deepEqual(x.postMaintenanceQueries.statuses,{'200':15,'429':1});
for(const name of digests.keys()){
  const rows=x.postMaintenanceQueries.samples.filter(v=>v.case===name&&v.http===200);
  assert.equal(rows.length,3);for(const row of rows)assert.equal(row.dataSha256,digests.get(name));
}
console.log('PASS: unchanged caps, 4,544,784-block final prefix, 190 recovery + 16 steady query attempts, fresh source, unchanged consumers and restored soft-threshold headroom');
