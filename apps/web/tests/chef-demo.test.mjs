import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChefDemo} from '../src/lib/chef-demo.ts';
import {syncMetrics} from '../src/lib/sync-status.ts';
const demo={project:'hackathon_testnet_20261020',fromBlock:4510000,toBlock:4519999};
const make=(height)=>({prep:{configured:true,available:true,data:{start_block:0,indexed_height:4520000}},chef:{configured:true,available:true,data:{height},demo}});
test('demo descriptor validates bounds and returns public fields only',()=>{
 assert.deepEqual(parseChefDemo(JSON.stringify({...demo,secret:'discard'})),demo);
 for(const value of [undefined,'','null','{}','bad',JSON.stringify({...demo,project:'bad/name'}),JSON.stringify({...demo,fromBlock:-1}),JSON.stringify({...demo,toBlock:4500000}),JSON.stringify({...demo,toBlock:1e20})]) assert.equal(parseChefDemo(value),null);
});
test('fixed demo uses its own range, preserves full Prep coverage and actual checkpoint',()=>{
 const partial=syncMetrics(make(4514999));
 assert.equal(partial.count,4520001);assert.equal(partial.chefCount,5000);
 assert.equal(partial.chefTotal,10000);assert.equal(partial.chefPercent,50);assert.equal(partial.chefLag,5000);
 const complete=syncMetrics(make(4519999));assert.equal(complete.chefPercent,100);assert.equal(complete.chefLag,0);
 assert.equal(syncMetrics(make(4509999)).chefPercent,0);
});
test('incompatible or unavailable checkpoints never become demo completion',()=>{
 for(const h of [null,4509998,4520000]) assert.equal(syncMetrics(make(h)).chefPercent,null);
 const noSource=make(4519999);noSource.prep.available=false;
 assert.equal(syncMetrics(noSource).chefPercent,null);
 const noChef=make(4519999);noChef.chef.available=false;
 assert.equal(syncMetrics(noChef).chefPercent,null);
 const shortSource=make(4519999);shortSource.prep.data.indexed_height=4519998;
 assert.equal(syncMetrics(shortSource).chefPercent,null);
});
