import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeMemo,readShieldedTransaction} from '../dist/read-receipts.js';
import {receiptId} from '../dist/receipts.js';

const txid='12'.repeat(32),hash='34'.repeat(32),previous='56'.repeat(32);
const memo=Buffer.alloc(512);memo.write('Hello from Zeer Chef');
const account='inbox',fingerprint='cd'.repeat(32);
const receipt={id:receiptId(account,fingerprint,txid,'ironwood',1),account_id:account,network:'testnet',txid,height:100,pool:'ironwood',output_index:1,value_zat:'100000',memo_hex:memo.toString('hex'),receiver:'ab'.repeat(43),receiver_type:'orchard',scope:'external',origin:'unknown',is_coinbase:false};
function setup({status='mined',change=false,modifyPage=()=>{},modifyReceipt=()=>{}}={}){
 let observes=0,fetches=0,scans=0;
 const observation={network:'testnet',txid,status,observed_at:1,block_height:100,block_hash:hash,confirmations:7,transaction:{txid,version:6}};
 const page={network:'testnet',epoch:'1',canonicality:'source_observed',from_block:100,to_block:101,next_block:101,cursor:null,data:{blocks:[{height:100,hash,previous_hash:previous,time:1}],transactions:[{txid,block_height:100,index:2,version:6,locktime:0xffffffff,raw:'abcd'}]}};
 modifyPage(page);
 const client={getTransaction:async()=>{observes++;return structuredClone(change&&observes===2?{...observation,status:'pending',block_hash:null}:observation);},get:async query=>{fetches++;assert.deepEqual(query.transaction_filter,{txids:[txid]});return page;}};
 const source={identity:'ef'.repeat(32),accountId:account,keyFingerprint:fingerprint,scan:async input=>{scans++;assert.equal(input.transaction.locktime,0xffffffff);assert.equal(input.transaction.raw,'abcd');const row=structuredClone(receipt);modifyReceipt(row);return [row];}};
 return {client,receiptSource:source,counts:()=>({observes,fetches,scans})};
}
test('memo decoding preserves text, no-memo, binary and invalid UTF-8 distinctions',()=>{
 assert.deepEqual(decodeMemo(memo.toString('hex')),{memoKind:'text',memoText:'Hello from Zeer Chef'});
 assert.deepEqual(decodeMemo('f6'+'00'.repeat(511)),{memoKind:'no_memo',memoText:null});
 assert.deepEqual(decodeMemo('00'.repeat(512)),{memoKind:'empty_text',memoText:''});
 assert.equal(decodeMemo('ff'+'00'.repeat(511)).memoKind,'non_text');
 assert.equal(decodeMemo('c328'+'00'.repeat(510)).memoKind,'invalid_utf8');
 assert.equal(decodeMemo('610062'+'00'.repeat(509)).memoKind,'text_with_nul');
 assert.throws(()=>decodeMemo('aa'),{code:'INVALID_MEMO_BYTES'});
});
test('a single canonical mined transaction yields exact note amount and decoded memo after source recheck',async()=>{
 const state=setup();const result=await readShieldedTransaction({...state,txid});
 assert.equal(result.receipts[0].value_zat,'100000');assert.equal(result.receipts[0].memoText,'Hello from Zeer Chef');
 assert.equal(result.receipts[0].output_index,1);assert.equal(result.observation.confirmations,7);
 assert.deepEqual(result.source,{height:100,hash,epoch:'1',canonicality:'source_observed',observedAt:1});
 assert.deepEqual(state.counts(),{observes:2,fetches:1,scans:1});
});
for(const status of ['pending','not_observed'])test(`${status} does not scan or declare a confirmed receipt`,async()=>{
 const state=setup({status});const result=await readShieldedTransaction({...state,txid});
 assert.equal(result.observation.status,status);assert.deepEqual(result.receipts,[]);assert.equal(state.counts().scans,0);assert.equal(state.counts().fetches,0);
});
test('canonical block mismatch fails before private scanning',async()=>{
 const state=setup({modifyPage:p=>p.data.blocks[0].hash='78'.repeat(32)});
 await assert.rejects(readShieldedTransaction({...state,txid}),{code:'CANONICAL_BLOCK_MISMATCH'});assert.equal(state.counts().scans,0);
});
test('missing or incomplete source payload is never treated as a successful empty deposit',async()=>{
 for(const modifyPage of [p=>p.data.transactions=[],p=>p.cursor='unfinished']){
  const state=setup({modifyPage});await assert.rejects(readShieldedTransaction({...state,txid}),e=>['TRANSACTION_NOT_IN_ARCHIVE','INCOMPLETE_SOURCE_RANGE'].includes(e.code));assert.equal(state.counts().scans,0);
 }
});
test('a source change after decryption rejects the result instead of returning a stale canonical receipt',async()=>{
 const state=setup({change:true});await assert.rejects(readShieldedTransaction({...state,txid}),{code:'SOURCE_CHANGED_DURING_SCAN'});assert.equal(state.counts().scans,1);
});
test('mismatched scanner receipts are rejected and caller cancellation precedes network work',async()=>{
 const state=setup({modifyReceipt:r=>r.txid='ab'.repeat(32)});
 await assert.rejects(readShieldedTransaction({...state,txid}),{code:'INVALID_SCANNER_RESPONSE'});
 const cancelled=setup();await assert.rejects(readShieldedTransaction({...cancelled,txid,signal:AbortSignal.abort()}),{name:'AbortError'});assert.equal(cancelled.counts().observes,0);
});
test('custom adapters cannot bypass account, note identity or exact receipt validation',async()=>{
 for(const mutate of [r=>r.account_id='other',r=>r.id='not-an-id',r=>r.pool='fake',r=>r.output_index=-1,r=>r.value_zat='-999',r=>r.origin='known_sender',r=>r.receiver='bad']){
  const state=setup({modifyReceipt:mutate});await assert.rejects(readShieldedTransaction({...state,txid}),{code:'INVALID_SCANNER_RESPONSE'});
 }
 const state=setup();state.receiptSource.keyFingerprint='bad';await assert.rejects(readShieldedTransaction({...state,txid}),{code:'INVALID_SCANNER_IDENTITY'});assert.equal(state.counts().observes,0);
});
