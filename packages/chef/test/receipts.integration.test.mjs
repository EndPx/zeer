import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import pg from 'pg';
import {NativeReceiptSource,PostgresStore,parseModel,syncStep,createChefServer} from '../dist/index.js';
const url=process.env.CHEF_TEST_DATABASE_URL,executable=process.env.ZEER_SCANNER_TEST_EXECUTABLE;
const fixture=JSON.parse(await readFile(new URL('../../../crates/zeer-scanner/tests/fixtures/shielded.json',import.meta.url),'utf8'));
const keyFingerprint=createHash('sha256').update(fixture.ufvk).digest('hex');
const h=n=>BigInt(n).toString(16).padStart(64,'0'),start=fixture.request.height;
const model=parseModel('type PrivateReceipt { id: ID! amount: BigInt! pool: String! height: Int! scope: String! memoHex: String! receiver: String! }');
test('real native decrypt -> PostgreSQL -> authenticated GraphQL survives rollback, restart and reorg',{skip:!url||!executable},async t=>{
 const project=`t_${randomUUID().replaceAll('-','').slice(0,24)}`;const stores=[],sources=[];
 const dir=await mkdtemp(join(tmpdir(),'zeer-receipt-pg-'));const keyFile=join(dir,'ufvk.txt');await writeFile(keyFile,fixture.ufvk,{mode:0o600});
 const open=async()=>{const store=new PostgresStore(url,{project,fingerprint:`native-receipts-v1:${keyFingerprint}`,model,network:'testnet',startHeight:start,reorgWindow:3});stores.push(store);await store.migrate();await store.acquire();return store;};
 const scanner=()=>{const s=new NativeReceiptSource({executable:resolve(executable),keyFile,accountId:'fixture',keyFingerprint});sources.push(s);return s;};
 let epoch='1';let blocks=[{height:start,hash:h(10),previous_hash:h(9),time:1,tx:true},{height:start+1,hash:h(11),previous_hash:h(10),time:2,tx:false}];
 const client={
  async getHeight(){return {network:'testnet',payload_kind:'full-v1',ready:true,archive_height:blocks.at(-1).height,start_block:start,epoch};},
  async get(q){const selected=blocks.filter(b=>b.height>=q.from_block&&b.height<q.to_block).slice(0,q.limit);return {network:'testnet',epoch,from_block:q.from_block,next_block:selected.at(-1).height+1,data:{blocks:selected.map(({tx,...b})=>b),transactions:q.field_selection.transaction.length?selected.filter(b=>b.tx).map(b=>({block_height:b.height,index:0,version:6,locktime:0,txid:fixture.request.txid,raw:fixture.request.raw})):[]}};}
 };
 let fail=true,calls=0;
 const indexer={async receipt({receipt,context}){calls++;await context.entities.set('PrivateReceipt',{id:receipt.id,amount:BigInt(receipt.value_zat),pool:receipt.pool,height:receipt.height,scope:receipt.scope,memoHex:receipt.memo_hex,receiver:receipt.receiver});if(fail)throw Error('intentional post-receipt handler failure');}};
 const step=(store,source,pageSize=1)=>syncStep({client,store,indexer,receiptSource:source,network:'testnet',startHeight:start,reorgWindow:3,pageSize,transactionFilter:{shielded_pools:['sapling','orchard','ironwood']}});
 let server;
 t.after(async()=>{if(server){await new Promise(r=>server.close(r));}for(const s of sources)await s.close();for(const s of stores)await s.close();const db=new pg.Client({connectionString:url});await db.connect();try{assert.match(project,/^t_[0-9a-f]{24}$/);await db.query(`DROP SCHEMA IF EXISTS "chef_${project}" CASCADE`);}finally{await db.end();}await rm(dir,{recursive:true});});
 const store=await open();const source=scanner();await assert.rejects(step(store,source),/intentional post-receipt/);
 assert.equal((await store.checkpoint()).height,null);assert.deepEqual(await store.read(v=>v.list('PrivateReceipt',{first:20})),[]);
 await store.release();await source.close();const restarted=await open();const recovered=scanner();fail=false;
 await step(restarted,recovered);const notes=await restarted.read(v=>v.list('PrivateReceipt',{first:20}));assert.equal(notes.length,6);assert.equal(notes.reduce((sum,n)=>sum+BigInt(n.amount),0n),123456809n);
 server=createChefServer({store:restarted,model,token:'test-private-receipt-token'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const address=`http://127.0.0.1:${server.address().port}/graphql`;
 const query=async(auth=true)=>{const r=await fetch(address,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test-private-receipt-token'}:{})},body:JSON.stringify({query:'{ PrivateReceiptList(first:20) { items { id amount pool scope } } }'})});return {status:r.status,body:await r.json()};};
 assert.equal((await query(false)).status,401);assert.equal((await query()).body.data.PrivateReceiptList.items.length,6);
 await step(restarted,recovered);assert.equal((await restarted.checkpoint()).height,start+1);const committedCalls=calls;
 await new Promise(r=>server.close(r));server=undefined;await restarted.release();await recovered.close();const afterCommit=await open();const third=scanner();assert.equal((await step(afterCommit,third)).state,'caught_up');assert.equal(calls,committedCalls);
 assert.deepEqual(await afterCommit.read(v=>v.list('PrivateReceipt',{first:20})),notes);
 epoch='2';blocks=[{height:start,hash:h(20),previous_hash:h(9),time:3,tx:false},{height:start+1,hash:h(21),previous_hash:h(20),time:4,tx:false}];
 await step(afterCommit,third);assert.equal((await afterCommit.checkpoint()).status,'reconciling');await assert.rejects(afterCommit.read(v=>v.list('PrivateReceipt',{first:20})),/reconciling/);
 await step(afterCommit,third);assert.equal((await afterCommit.checkpoint()).status,'ready');assert.deepEqual(await afterCommit.read(v=>v.list('PrivateReceipt',{first:20})),[]);
});
