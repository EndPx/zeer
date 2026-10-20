import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'graphql';
import {chefExamples,chefPresetQuery,chefBlockHeight} from '../src/lib/chef-examples.ts';
import {demoQueryError} from '../src/lib/chef-demo-validation.ts';
import {chefExampleCursor} from '../src/lib/chef-pagination.ts';

test('all judge presets are valid for the actual hosted block-summary schema',()=>{
 const queries=chefExamples.map(e=>chefPresetQuery(e.id,4515166,4522494));
 assert.equal(new Set(queries).size,6);
 for(const query of queries) {
  assert.ok(query);assert.equal(demoQueryError(parse(query),'hosted_genesis_testnet_v2'),null);
 }
 assert.match(chefPresetQuery('genesis'),/id: "0"/);
 assert.match(chefPresetQuery('latest',0,4522494),/id: "4522494"/);
 assert.match(chefPresetQuery('height',123),/height: 123/);
});
test('latest waits for a real checkpoint and numeric filters cannot inject GraphQL',()=>{
 for(const h of [null,-1,1.5,NaN,Infinity,0xffffffff])assert.equal(chefPresetQuery('latest',0,h),null);
 for(const s of ['', '-1','1.5','2e3','0) { hash }','2147483648'])assert.equal(chefBlockHeight(s),null);
 assert.equal(chefBlockHeight('0'),0);assert.equal(chefBlockHeight('4515166'),4515166);
 assert.equal(chefPresetQuery('height',-1),null);
});
test('only the built-in browse preset offers automatic continuation',()=>{
 const result={data:{BlockSummaryList:{items:[{height:1}],nextCursor:'10'}}};
 for(const example of chefExamples)assert.equal(chefExampleCursor(chefPresetQuery(example.id,4515166,4522494),result),example.id==='browse'?'10':null);
});
