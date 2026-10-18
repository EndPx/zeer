import test from 'node:test';
import assert from 'node:assert/strict';
import {syncMetrics,percentLabel} from '../src/lib/sync-status.ts';
const now=1792332000000;
const status=(start,head,tip,checkpoint)=>({prep:{configured:true,available:true,data:{start_block:start,indexed_height:head,source_height:tip,source_mode:'follower',ready:true,source_observed_at:now/1000}},chef:{configured:true,available:true,data:{height:checkpoint,status:'ready'}}});
test('a recent window near the tip is not complete history',()=>{
 const m=syncMetrics(status(4515038,4515347,4515356,4515347),now);
 assert.equal(m.count,310); assert.equal(m.total,4515357);
 assert.ok(m.historyPercent<0.01);assert.equal(m.chefPercent,100);
 assert.equal(m.sourceLag,9);assert.equal(m.chefLag,0);
});
test('genesis counts as one block; percentages never round incomplete history to 100',()=>{
 const complete=syncMetrics(status(0,100,100,100),now);assert.equal(complete.count,101);assert.equal(complete.historyPercent,100);
 assert.equal(percentLabel(99.99999),'99.999%');assert.equal(percentLabel(0.00001),'<0.001%');
});
test('unknown, stale, historical and incompatible observations do not invent progress',()=>{
 assert.equal(syncMetrics(null,now).historyPercent,null);
 assert.equal(syncMetrics(status(10,20,30,25),now).chefPercent,null);
 assert.equal(syncMetrics(status(10,20,15,20),now).historyPercent,null);
 assert.equal(syncMetrics(status(10,20,30,20),now+121000).historyPercent,null);
 const historical=status(10,20,30,20);historical.prep.data.source_mode='historical';
 assert.equal(syncMetrics(historical,now).tip,null);
});
