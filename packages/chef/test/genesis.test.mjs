import test from 'node:test';
import assert from 'node:assert/strict';
import {syncStep} from '../dist/runtime.js';
const h=n=>BigInt(n).toString(16).padStart(64,'0');
test('runtime indexes genesis once, resumes, and refuses a changed genesis',async()=>{
 const checkpoint={height:null,hash:null,anchorHash:null,status:'ready'};
 const applied=[];const stored=new Map();let variant=0;
 const store={checkpoint:async()=>({...checkpoint}),markReconciling:async()=>{checkpoint.status='reconciling';},markReady:async()=>{checkpoint.status='ready';},markBlocked:async()=>{checkpoint.status='blocked';},blockHash:async height=>stored.get(height)??null,
  apply:async(block,handler)=>{await handler({});applied.push(block.height);stored.set(block.height,block.hash);Object.assign(checkpoint,{height:block.height,hash:block.hash,anchorHash:h(0),status:'ready'});},
  rollback:async()=>assert.fail('Must not roll back across genesis')};
 const client={getHeight:async()=>({network:'regtest',payload_kind:'full-v1',ready:true,archive_height:1,start_block:0,epoch:'1'}),get:async q=>{
  assert.ok(q.from_block>=0);
  const heights=Array.from({length:Math.min(q.to_block-q.from_block,q.limit)},(_,i)=>i+q.from_block);
  return {from_block:q.from_block,next_block:q.from_block+heights.length,epoch:'1',network:'regtest',data:{blocks:heights.map(height=>({height,hash:h(height+1+variant),previous_hash:height===0?h(0):h(height+variant),time:1000})),transactions:q.field_selection.transaction.length?heights.map(height=>({block_height:height,index:0,txid:h(100+height),version:1,locktime:0,decoded:{}})):[]}};
 }};
 const step=()=>syncStep({client,store,indexer:{},network:'regtest',startHeight:0,reorgWindow:3});
 assert.equal((await step()).blocks,2);assert.deepEqual(applied,[0,1]);
 assert.equal((await step()).blocks,0);assert.deepEqual(applied,[0,1]);
 variant=50;await assert.rejects(step(),/REBUILD_REQUIRED/);assert.equal(checkpoint.status,'blocked');
});
