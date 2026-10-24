import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const data=JSON.parse(await readFile(new URL('../static/benchmarks/2026-10-23-prep-compact.json',import.meta.url),'utf8'));
const rows=data.measurements;
assert.equal(rows.length,48);
assert.equal(new Set(rows.map(r=>`${r.repeat}:${r.scenario}`)).size,48);
assert.equal(rows.reduce((n,r)=>n+r.count,0),2592262);
for(const row of rows){assert.deepEqual(row.statusCodes,{OK:row.count});assert.equal(row.count,row.ok);assert.match(row.rawSha256,/^[0-9a-f]{64}$/);}
const expectedCounts={GetLightdInfo:1000,GetLatestBlock:1000,GetBlock:1000,'range-100':1000,'range-1000':300,'range-10000':100,'range-100000':10,'full-wallet-download':411};
for(const row of rows)if(row.scenario in expectedCounts)assert.equal(row.count,expectedCounts[row.scenario]);
const median=values=>[...values].sort((a,b)=>a-b)[1];
assert.equal(median(rows.filter(r=>r.scenario==='full-wallet-download').map(r=>r.totalSeconds)),32.282220139);
assert.equal(median(rows.filter(r=>r.scenario==='range1000-c128').map(r=>r.blocksPerSecond)),229087.4276303252);
assert.equal(data.correctness.fullDownloadBlocks,4102798);
assert.equal(data.correctness.seededHeights,2000);
assert.equal(data.correctness.status,'PASS');
console.log('Compact summary: 48 measurements, 2,592,262 OK requests; counts and published aggregates PASS. Raw per-request logs are retained separately.');

const experiment=JSON.parse(await readFile(new URL('../static/benchmarks/2026-10-24-prep-buffered.json',import.meta.url),'utf8'));
const runs=experiment.measurements;
assert.equal(runs.length,57);
assert.equal(runs.filter(r=>r.variant==='candidate').length,48);
assert.equal(runs.filter(r=>r.variant==='baseline').length,9);
assert.equal(runs.reduce((n,r)=>n+r.count,0),4606704);
for(const r of runs){assert.equal(r.count,r.ok);assert.deepEqual(r.statusCodes,{OK:r.count});assert.match(r.rawSha256,/^[0-9a-f]{64}$/);}
const selected=(variant,scenario)=>runs.filter(r=>r.variant===variant&&r.scenario===scenario);
const stat=(variant,scenario,key)=>median(selected(variant,scenario).map(r=>r[key]));
const before=stat('baseline','full-wallet-download','totalSeconds'),after=stat('candidate','full-wallet-download','totalSeconds');
assert.equal(before,22.920196623);assert.equal(after,21.18648312);
const peak=variant=>Math.max(...runs.filter(r=>r.variant===variant).map(r=>r.sampledPeakAnonBytes));
const gates={downloadMedianAtLeast10PercentLower:after<=before*.9,
 everyPairedDownloadImproved:[1,2,3].every(i=>selected('candidate','full-wallet-download').find(r=>r.repeat===i).totalSeconds<selected('baseline','full-wallet-download').find(r=>r.repeat===i).totalSeconds),
 range128Throughput:stat('candidate','range1000-c128','blocksPerSecond')>=stat('baseline','range1000-c128','blocksPerSecond')*.95,
 range128P95:stat('candidate','range1000-c128','p95Seconds')<=stat('baseline','range1000-c128','p95Seconds')*1.05,
 block128P95:stat('candidate','block-c128','p95Seconds')<=stat('baseline','block-c128','p95Seconds')*1.10,
 anonymousMemory:peak('candidate')<=peak('baseline')*1.15+16*1024**2,allRequestsOK:true};
assert.deepEqual(experiment.acceptance.gates,gates);
assert.equal(experiment.acceptance.status,'REJECTED');
assert.equal(gates.downloadMedianAtLeast10PercentLower,false);
assert.equal(experiment.correctness.candidate.fullDownloadDigest,experiment.correctness.baseline.fullDownloadDigest);
console.log('Buffered experiment: 57 measurements, 4,606,704 OK requests; predeclared promotion gate remains REJECTED.');

const diagnostic=JSON.parse(await readFile(new URL('../static/benchmarks/2026-10-24-prep-consumer.json',import.meta.url),'utf8'));
assert.equal(diagnostic.defaultChanged,false);
assert.equal(diagnostic.screeningSamples.length,6);
assert.equal(diagnostic.consumerSamples.length,12);
const pilotMedian=(variant,key)=>median(diagnostic.screeningSamples.filter(r=>r.variant===variant).map(r=>r[key]));
assert.equal(pilotMedian('baseline','totalSeconds'),30.9338001);
assert.equal(pilotMedian('candidate','totalSeconds'),29.963266271);
assert.equal(diagnostic.batchScreening.status,'REJECTED');
assert.equal(diagnostic.batchScreening.everyPairImproves,false);
assert.ok(pilotMedian('candidate','totalSeconds')>pilotMedian('baseline','totalSeconds')*.9);
for(const group of diagnostic.consumerGroups){
 const samples=diagnostic.consumerSamples.filter(r=>r.variant===group.engine&&r.consumer===group.consumer);
 assert.equal(samples.length,3);
 assert.equal(median(samples.map(r=>r.totalSeconds)),group.medianSeconds);
 assert.equal(median(samples.map(r=>r.clientCpuSeconds)),group.medianClientCpuSeconds);
 for(const r of samples)assert.match(r.rawSha256,/^[0-9a-f]{64}$/);
}
assert.equal(diagnostic.consumerGroups.find(g=>g.engine==='buffered'&&g.consumer==='typed').medianSeconds,13.993732029);
console.log('Transport/client diagnostic: rejected 6-sample batch screening and 12 consumer samples verified; no default change.');

const application=JSON.parse(await readFile(new URL('../static/benchmarks/2026-10-24-prep-application.json',import.meta.url),'utf8'));
assert.equal(application.defaultChanged,false);
assert.equal(application.environment.sdk,'0.6.1');
assert.equal(application.measurements.length,6);
assert.equal(new Set(application.measurements.map(r=>`${r.variant}:${r.repeat}`)).size,6);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
const middle=values=>{const v=[...values].sort((a,b)=>a-b);return (v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2;};
for(const group of application.groups){
 const samples=application.measurements.filter(r=>r.variant===group.variant);
 assert.equal(samples.length,3);
 for(const key of ['wallSeconds','cliSeconds','fetchSeconds','handlerIncludingEntityIoSeconds','transactionOverheadSeconds','readerCpuSeconds'])close(middle(samples.map(r=>r[key])),group[key]);
 const queries=application.querySamples.filter(r=>r.variant===group.variant).flatMap(r=>r.samples);
 assert.equal(queries.length,group.graphqlSamples);
 assert.ok(queries.every(r=>r.ok&&r.seconds>=0));
 const sorted=queries.map(r=>r.seconds).sort((a,b)=>a-b);
 close(middle(sorted),group.pooledGraphqlMedianSeconds);
 close(sorted[Math.ceil(sorted.length*.95)-1],group.pooledGraphqlP95Seconds);
}
assert.equal(application.querySamples.flatMap(r=>r.samples).length,160);
for(const row of application.measurements){
 assert.equal(row.blocks,512);assert.equal(row.transactions,621);assert.equal(row.prepRequests,98);
 assert.equal(row.graphqlErrors,0);assert.equal(row.restartIdentical,true);
 assert.equal(row.entityDigest,application.correctness.expectedDigest);
}
assert.equal(application.correctness.status,'PASS');
assert.equal(application.correctness.newBlocks,314);
assert.equal(application.correctness.final.height-application.correctness.initial.height,314);
assert.equal(Object.values(application.correctness.entityCounts).reduce((a,b)=>a+b),1076);
assert.deepEqual(application.correctness.coverage,{id:'chain',startHeight:4525000,lastHeight:4525511,processedBlocks:512,unresolvedInputs:12,unattributedOutputs:2});
assert.equal(application.correctness.resolvedOutputs,13);
assert.equal(application.correctness.pagination.checks.length,6);
for(const p of application.correctness.pagination.checks){assert.equal(p.pages,14);assert.equal(p.items,514);assert.equal(p.orderedAndComplete,true);assert.equal(p.nestedSummariesMatch,true);assert.equal(p.serverRestarted,true);}
assert.equal(application.measurements.filter(r=>r.variant==='buffered'&&r.cliSeconds>application.measurements.find(d=>d.variant==='direct'&&d.repeat===r.repeat).cliSeconds).length,2);
assert.equal(application.environment.memoryLimitIsCgroup,false);
assert.deepEqual(application.durability,{fsync:'on',synchronous_commit:'on',full_page_writes:'on'});
assert.equal(application.monitor.ingestionPublicationOverlappedTimedSync,true);
for(const a of application.artifacts)assert.match(a.sha256,/^[0-9a-f]{64}$/);
console.log('Chef application study: 6 matching runs, 160 successful concurrent queries, 84 complete pagination reads, 314 ingested blocks; no default promotion.');
