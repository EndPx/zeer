import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {NativeReceiptSource,receiptId,validateReceipts} from '../dist/receipts.js';
import {syncStep} from '../dist/runtime.js';

const fixture=JSON.parse(await readFile(new URL('../../../crates/zeer-scanner/tests/fixtures/shielded.json',import.meta.url),'utf8'));
const fingerprint=createHash('sha256').update(fixture.ufvk).digest('hex');
const executable=process.env.ZEER_SCANNER_TEST_EXECUTABLE;
const request=()=>({block:{height:fixture.request.height,hash:'aa'.repeat(32),previousHash:'bb'.repeat(32),time:1},transaction:{txid:fixture.request.txid,index:0,version:6,locktime:0,blockHeight:fixture.request.height,raw:fixture.request.raw}});
async function setup(t){
 const dir=await mkdtemp(join(tmpdir(),'zeer-scanner-test-'));const keyFile=join(dir,'ufvk.txt');await writeFile(keyFile,fixture.ufvk,{mode:0o600});
 const sources=[];const open=(overrides={})=>{const source=new NativeReceiptSource({executable:resolve(executable),keyFile,accountId:fixture.account_id,keyFingerprint:fingerprint,...overrides});sources.push(source);return source;};
 t.after(async()=>{for(const source of sources)await source.close();await rm(dir,{recursive:true});});return {open,keyFile};
}
test('receipt identity binds account, key, pool and output position rather than height or memo',()=>{
 const id=receiptId('fixture',fingerprint,fixture.request.txid,'ironwood',0);
 assert.equal(id,receiptId('fixture',fingerprint,fixture.request.txid,'ironwood',0));
 for(const other of [receiptId('other',fingerprint,fixture.request.txid,'ironwood',0),receiptId('fixture','ff'.repeat(32),fixture.request.txid,'ironwood',0),receiptId('fixture',fingerprint,fixture.request.txid,'orchard',0),receiptId('fixture',fingerprint,fixture.request.txid,'ironwood',1)])assert.notEqual(id,other);
 const row={id,network:'testnet',account_id:'fixture',txid:fixture.request.txid,pool:'ironwood',output_index:0,height:fixture.request.height,receiver:'11'.repeat(43),receiver_type:'orchard',memo_hex:'00'.repeat(512),value_zat:'1',scope:'external',origin:'unknown',is_coinbase:false};
 assert.deepEqual(validateReceipts([row],'fixture',fingerprint,row.txid,row.height),[row]);
 for(const changed of [{...row,id:'00'.repeat(32)},{...row,value_zat:'0'},{...row,value_zat:'2100000000000001'},{...row,memo_hex:'00'},{...row,origin:'known_sender'},{...row,scope:'outgoing'},{...row,height:1},{...row,pool:'sprout'}])assert.throws(()=>validateReceipts([changed],'fixture',fingerprint,row.txid,row.height),/INVALID_SCANNER_RESPONSE/);
 assert.throws(()=>validateReceipts([row,row],'fixture',fingerprint,row.txid,row.height),/INVALID_SCANNER_RESPONSE/);
});
test('a failed private scan closes reads and commits no application handler or checkpoint',async()=>{
 let applied=0,handled=0,gate=null;
 const block={height:4200000,hash:'aa'.repeat(32),previous_hash:'bb'.repeat(32),time:1};
 const store={checkpoint:async()=>({height:null,hash:null,anchorHash:null,status:'ready'}),markReconciling:async kind=>{gate=kind;},apply:async()=>{applied++;}};
 const client={getHeight:async()=>({network:'testnet',payload_kind:'full-v1',ready:true,archive_height:block.height,start_block:block.height,epoch:'1'}),get:async()=>({network:'testnet',epoch:'1',from_block:block.height,next_block:block.height+1,data:{blocks:[block],transactions:[{block_height:block.height,index:0,version:6,locktime:0,txid:fixture.request.txid,raw:fixture.request.raw}]}})};
 const receiptSource={accountId:'fixture',keyFingerprint:fingerprint,identity:'11'.repeat(32),scan:async()=>{throw Error('PRIVATE_SCANNER_DETAIL_MUST_NOT_ESCAPE');},close:async()=>{}};
 await assert.rejects(syncStep({client,store,receiptSource,indexer:{receipt(){handled++;}},network:'testnet',startHeight:block.height,reorgWindow:3}),error=>error.code==='SHIELDED_SCAN_UNAVAILABLE'&&!error.message.includes('PRIVATE_SCANNER_DETAIL'));
 assert.equal(gate,'source');assert.equal(applied,0);assert.equal(handled,0);
});
test('receipt scanning cannot silently run under a mainnet or missing-source configuration',async()=>{
 let calls=0;const client={getHeight:async()=>{calls++;throw Error('must not read');}};
 for(const network of ['mainnet','testnet'])await assert.rejects(syncStep({client,store:{},indexer:{receipt(){}},network,startHeight:1,reorgWindow:3}),/TESTNET_RECEIPT_SOURCE_REQUIRED/);
 assert.equal(calls,0);
});
test('a malformed raw page closes the private read gate before starting the scanner',async()=>{
 let scanned=0,applied=0,gate=null;
 const height=4200000,store={checkpoint:async()=>({height:null,hash:null,anchorHash:null,status:'ready'}),markReconciling:async kind=>{gate=kind;},apply:async()=>{applied++;}};
 const client={getHeight:async()=>({network:'testnet',payload_kind:'full-v1',ready:true,archive_height:height,start_block:height,epoch:'1'}),get:async()=>({network:'testnet',epoch:'1',from_block:height,next_block:height+1,data:{blocks:[{height,hash:'aa'.repeat(32),previous_hash:'bb'.repeat(32),time:1}],transactions:[{block_height:height,index:0,version:6,locktime:0,txid:fixture.request.txid}]}})};
 const receiptSource={accountId:'fixture',keyFingerprint:fingerprint,identity:'11'.repeat(32),scan:async()=>{scanned++;return [];},close:async()=>{}};
 await assert.rejects(syncStep({client,store,receiptSource,indexer:{receipt(){}},network:'testnet',startHeight:height,reorgWindow:3}),/INVALID_PREP_TRANSACTION/);
 assert.equal(gate,'source');assert.equal(applied,0);assert.equal(scanned,0);
});
test('native process decrypts all pools and returns identical notes after process restart',{skip:!executable},async t=>{
 const f=await setup(t);const source=f.open();const notes=await source.scan(request());
 assert.deepEqual(notes.map(r=>[r.pool,r.output_index,r.value_zat,r.scope]),fixture.expected);
 assert.equal(notes[1].memo_hex,'ff'.repeat(512));assert.equal(notes[2].scope,'internal');
 await source.close();assert.deepEqual(await f.open().scan(request()),notes);
 const wrong=f.open({keyFingerprint:'00'.repeat(32)});await assert.rejects(wrong.scan(request()),/SCANNER_IDENTITY_MISMATCH/);
});
test('native mismatch, cancellation, unavailable binary and wrong key fail without partial receipts',{skip:!executable},async t=>{
 const f=await setup(t);const bad=request();bad.transaction.txid='ff'.repeat(32);
 await assert.rejects(f.open().scan(bad),/TRANSACTION_ID_MISMATCH/);
 const abort=new AbortController();abort.abort();await assert.rejects(f.open().scan(request(),abort.signal),/SCANNER_REQUEST_FAILED/);
 await assert.rejects(f.open({executable:resolve('not-a-real-zeer-scanner')}).scan(request()),/SCANNER_PROCESS_UNAVAILABLE/);
 const source=f.open();await source.scan(request());source.child.kill();
 await new Promise(r=>source.child.once('exit',r));await assert.rejects(source.scan(request()),/SCANNER_CLOSED_OR_BUSY/);
});
test('native JSONL rejects a truncated request instead of completing a partial scan',{skip:!executable},async t=>{
 const f=await setup(t);const child=spawn(executable,['serve','--key-file',f.keyFile,'--account','fixture'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',error='';child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{error+=b;});
 const exit=new Promise(r=>child.once('exit',r));child.stdin.end(JSON.stringify(fixture.request));assert.equal(await exit,1);
 const frames=out.trim().split('\n').map(JSON.parse);assert.equal(frames.length,1);assert.ok(frames[0].ready);assert.match(error,/INVALID_OR_TRUNCATED_FRAME/);assert.ok(!error.includes(fixture.ufvk));
});
