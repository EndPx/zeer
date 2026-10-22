import test from 'node:test';
import assert from 'node:assert/strict';
import {readTransparentOutputs,resolveTransparentInputs,transparentOutputId,lookupTransparentOutputs} from '../dist/transparent.js';
const a='a'.repeat(64),b='b'.repeat(64);
const outputTx={txid:a,decoded:{vout:[{n:'0',value:'0.00100000',scriptPubKey:{addresses:['tRecipient'],hex:'76a9'}}]}};
test('transparent previous outputs resolve exact values/addresses; unknown and coinbase remain distinct',async()=>{
 const outputs=readTransparentOutputs(outputTx);assert.equal(outputs[0].valueZat,'100000');
 const tx={txid:b,decoded:{vin:[{txid:a,vout:'0'},{txid:'c'.repeat(64),vout:1}]}};
 const r=await resolveTransparentInputs(tx,async(id,n)=>outputs.find(o=>o.id===transparentOutputId(id,n))??null);
 assert.equal(r[0].status,'resolved');assert.equal(r[0].previousOutput.valueZat,'100000');assert.deepEqual(r[0].previousOutput.addresses,['tRecipient']);
 assert.equal(r[1].status,'unresolved');assert.equal(r[1].previousOutput,null);
 assert.equal((await resolveTransparentInputs({txid:b,decoded:{vin:[{coinbase:'00'}]}},()=>{throw Error('must not lookup')}))[0].status,'coinbase');
 assert.equal((await resolveTransparentInputs({txid:b,decoded:{vin:[]}},()=>{throw Error('must not lookup')})).length,0);
 const exact=readTransparentOutputs({txid:a,decoded:{vout:[{n:'0',value:'90071992.54740993'}]}});
 assert.equal(exact[0].valueZat,'9007199254740993');assert.deepEqual(exact[0].addresses,[]);
});
test('malformed/double inputs, lookup mismatch, floats and fractional zatoshis fail',async()=>{
 for(const vin of [[{txid:a,vout:0},{txid:a,vout:0}],[{coinbase:'00',txid:a}],[{txid:b,vout:0}]]) await assert.rejects(resolveTransparentInputs({txid:b,decoded:{vin}},async()=>null));
 await assert.rejects(resolveTransparentInputs({txid:b,decoded:{vin:[{txid:a,vout:0}]}},async()=>({...readTransparentOutputs(outputTx)[0],txid:b})),/MISMATCH/);
 for(const value of [0.001,'0.000000001','-1']) assert.throws(()=>readTransparentOutputs({txid:a,decoded:{vout:[{n:'0',value}]}}));
 await assert.rejects(resolveTransparentInputs({txid:b,decoded:{vin:[{txid:a,vout:0}]}},async()=>{throw Error('lookup unavailable')}),/unavailable/);
});
test('bounded Prep prefetch forwards snapshot/signal and does not invent absent outputs',async()=>{
 const at={network:'testnet',archive_start:0,to_block:100,epoch:'1',boundary_hash:a},controller=new AbortController();let called=0;
 const r=await lookupTransparentOutputs({getTransactions:async(q,o)=>{called++;assert.equal(q.at,at);assert.equal(o.signal,controller.signal);return {transactions:[{txid:a,block_height:2,index:1,vout:outputTx.decoded.vout}],missing_txids:[b],snapshot:at};}}, {txids:[a,b],fromBlock:0,toBlock:100,at},{signal:controller.signal});
 assert.equal(called,1);assert.equal(r.outputs.get(`${a}:0`).valueZat,'100000');assert.deepEqual(r.missingTxids,[b]);
 await assert.rejects(lookupTransparentOutputs({}, {txids:[a],fromBlock:0,toBlock:10001}),/BOUNDS/);
});
