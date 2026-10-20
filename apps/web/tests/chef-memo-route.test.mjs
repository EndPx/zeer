import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {parse,visit,Kind,GraphQLError} from 'graphql';
import {demoQueryError,memoQuery,memoQueryError} from '../src/lib/chef-demo-validation.ts';
import {parseChefDemo} from '../src/lib/chef-demo.ts';
import {parseChefMemoDemo} from '../src/lib/chef-memo-demo.ts';

// Execute the actual Next handler with injected IO, so source transitions can be
// tested deterministically without a node, database or viewing key.
const source=stripTypeScriptTypes((await readFile(new URL('../src/app/api/chef/route.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export async function POST','async function POST'));
const factory=new Function('parse','visit','Kind','GraphQLError','demoQueryError','memoQuery','memoQueryError','parseChefDemo','parseChefMemoDemo','ApiError','input','upstream','failure','process',source+'\nreturn POST;');
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const demo={txid:'a'.repeat(64),blockHash:'b'.repeat(64),blockHeight:100,pool:'ironwood',project:'demo_memo_test'};
const query='{ ReadableNoteList(first:10){items{txid memoText valueZat}} _meta{height status} }';
function harness({before={},after={},configured=true,queryResult={data:{ReadableNoteList:{items:[]}}}}={}){
 const calls=[];let observations=0;
 const upstream=async(service,route,body)=>{
  calls.push({service,route,body});
  if(service==='prep')return {network:'testnet',txid:demo.txid,status:'mined',block_height:100,block_hash:demo.blockHash,confirmations:observations?8:7,observed_at:observations?2:1,...(observations++?after:before)};
  return queryResult;
 };
 const post=factory(parse,visit,Kind,GraphQLError,demoQueryError,memoQuery,memoQueryError,parseChefDemo,parseChefMemoDemo,ApiError,r=>r.json(),upstream,e=>Response.json({error:e.message},{status:e.status??500}),{env:{ZEER_CHEF_DEMO:JSON.stringify({project:'hosted_genesis_testnet_v2',fromBlock:0,toBlock:null}),...(configured?{ZEER_CHEF_MEMO_DEMO:JSON.stringify(demo)}:{})}});
 const request=body=>post(new Request('https://example.test/api/chef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
 return {calls,request};
}
test('memo query reads the isolated reader and returns the final source observation',async()=>{
 const h=harness();const response=await h.request({query});assert.equal(response.status,200);
 assert.deepEqual(h.calls.map(c=>c.service),['prep','chefMemo','prep']);
 const data=await response.json();assert.equal(data.extensions.source.confirmations,8);assert.equal(data.extensions.source.observedAt,2);
});
test('source identity changes during GraphQL read withhold the published receipt',async()=>{
 for(const after of [{status:'not_observed'},{status:'pending'},{block_hash:'c'.repeat(64)},{block_height:101},{txid:'d'.repeat(64)}]){
  const h=harness({after,queryResult:{data:{ReadableNoteList:{items:[{memoText:'must not leak stale success'}]}}}});
  const response=await h.request({query});assert.equal(response.status,409);assert.equal((await response.json()).data,undefined);assert.equal(h.calls.length,3);
 }
});
test('mismatched source or disconnected demo never queries the receipt reader',async()=>{
 const mismatch=harness({before:{block_hash:'c'.repeat(64)}});assert.equal((await mismatch.request({query})).status,409);assert.equal(mismatch.calls.length,1);
 const missing=harness({configured:false});assert.equal((await missing.request({query})).status,503);assert.equal(missing.calls.length,0);
});
test('block queries retain their backend while mixed schemas and key-bearing requests fail',async()=>{
 const h=harness();assert.equal((await h.request({query:'{_meta{height}}'})).status,200);assert.deepEqual(h.calls.map(c=>c.service),['chef']);
 for(const body of [{query,viewingKey:'not-accepted'},{query:'{ReadableNoteList{items{id}} BlockSummaryById(id:"0"){id}}'},{query:'mutation { remove }'}]){
  const rejected=harness();assert.equal((await rejected.request(body)).status,400);assert.equal(rejected.calls.length,0);
 }
});
