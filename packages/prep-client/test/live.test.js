import test from 'node:test';
import assert from 'node:assert/strict';
import {PrepClient} from '../src/index.js';
const id='11'.repeat(32),hash='22'.repeat(32);
const metadata=()=>({txid:id,version:6,size_bytes:100,is_coinbase:false,transaction_type:'shielded',sapling_spend_count:0,sapling_output_count:0,orchard_action_count:2,ironwood_action_count:1});
const pending=()=>({network:'testnet',status:'pending',txid:id,observed_at:1792495000,block_height:null,block_hash:null,confirmations:null,transaction:metadata(),decoded:{version:'6',vin:[],vout:[]}});
const api=value=>new PrepClient({url:'http://localhost',fetch:async()=>new Response(JSON.stringify(value))});
test('live observations distinguish pending, mined and not observed',async()=>{
 assert.equal((await api(pending()).getTransaction(id)).status,'pending');
 const mined={...pending(),status:'mined',block_height:10,block_hash:hash,source_height:12,confirmations:3};
 assert.equal((await api(mined).getTransaction(id)).confirmations,3);
 assert.equal((await api({network:'testnet',status:'not_observed',txid:id,observed_at:1792495000,transaction:null}).getTransaction(id)).transaction,null);
 for(const bad of [{...pending(),confirmations:1},{...mined,confirmations:99},{...pending(),transaction:{...metadata(),is_coinbase:true}},{...pending(),transaction:{...metadata(),ironwood_action_count:-1}}]) await assert.rejects(api(bad).getTransaction(id),{code:'INVALID_LIVE_OBSERVATION'});
 await assert.rejects(api(pending()).getTransaction('bad'),TypeError);
});
test('mempool snapshots are bounded observations with no pending coinbase or duplicate rows',async()=>{
 const value={network:'testnet',observed_at:1792495000,source_total:1,max_rows:20,raced_out:0,has_more:false,transactions:[metadata()]};
 assert.equal((await api(value).getMempool()).transactions.length,1);
 for(const bad of [{...value,source_total:0},{...value,has_more:true},{...value,transactions:[{...metadata(),is_coinbase:true,transaction_type:'coinbase'}]},{...value,source_total:2,transactions:[metadata(),metadata()]}]) await assert.rejects(api(bad).getMempool(),{code:'INVALID_MEMPOOL_OBSERVATION'});
});
