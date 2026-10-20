import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'graphql';
import {chefExamples,chefPresetQuery,chefBlockHeight} from '../src/lib/chef-examples.ts';
import {demoQueryError,memoQuery,memoQueryError} from '../src/lib/chef-demo-validation.ts';
import {parseChefMemoDemo,memoPreview} from '../src/lib/chef-memo-demo.ts';
import {chefExampleCursor} from '../src/lib/chef-pagination.ts';

test('all judge presets are valid for the actual hosted block-summary schema',()=>{
 const queries=chefExamples.filter(e=>e.id!=='memos').map(e=>chefPresetQuery(e.id,4515166,4522494));
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
 for(const example of chefExamples.filter(e=>e.id!=='memos'))assert.equal(chefExampleCursor(chefPresetQuery(example.id,4515166,4522494),result),example.id==='browse'?'10':null);
});
test('memo preset needs a real configured ID and validates against the receipt schema',()=>{
 const txid='a'.repeat(64);const query=chefPresetQuery('memos',0,null,txid);assert.ok(query);
 assert.equal(memoQuery(parse(query)),true);assert.equal(memoQueryError(parse(query)),null);
 assert.match(query,new RegExp(txid));assert.match(query,/origin/);assert.match(query,/valueZat/);
 for(const id of [undefined,'short','A'.repeat(64),'"} { secret }'])assert.equal(chefPresetQuery('memos',0,null,id),null);
 assert.equal(memoQuery(parse(chefPresetQuery('genesis'))),false);
 assert.ok(memoQueryError(parse('{ ReadableNoteList { items { sender } } }')));
 assert.ok(memoQueryError(parse('{ ReadableNoteList { items { id } } BlockSummaryById(id:"0"){id} }')));
 assert.equal(chefExampleCursor(query,{data:{ReadableNoteList:{items:[],nextCursor:'foo'}}}),null);
});
test('public memo metadata accepts only a bounded public demo identity',()=>{
 const demo={txid:'a'.repeat(64),blockHeight:4523000,blockHash:'b'.repeat(64),pool:'ironwood',project:'memo_demo_20261021'};
 assert.deepEqual(parseChefMemoDemo(JSON.stringify(demo)),demo);
 for(const bad of [{...demo,viewingKey:'key'},{...demo,blockHeight:-1},{...demo,pool:'unknown'},{...demo,txid:'x'},{...demo,project:'a/b'}])assert.equal(parseChefMemoDemo(JSON.stringify(bad)),null);
 assert.equal(parseChefMemoDemo(),null);
});
test('memo preview comes only from a returned text receipt for the selected transaction',()=>{
 const txid='a'.repeat(64);const note={txid,memoKind:'text',memoText:'Hello from Zeer Chef',valueZat:'100000'};
 const response=note=>({data:{ReadableNoteList:{items:[note]}}});
 assert.deepEqual(memoPreview(response(note),txid),{text:note.memoText,valueZat:'100000'});
 for(const item of [{...note,txid:'b'.repeat(64)},{...note,memoKind:'no_memo',memoText:null},{...note,valueZat:'1e5'}])assert.equal(memoPreview(response(item),txid),null);
 for(const item of [null,{}, {errors:[{}],...response(note)}])assert.equal(memoPreview(item,txid),null);
});
