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
