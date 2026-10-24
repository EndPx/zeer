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
