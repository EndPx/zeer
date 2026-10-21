import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {RangeConsumer} from './consumer.mjs';

async function fixture(t,overrides={}){
  const directory=await mkdtemp(join(tmpdir(),'zeer-consumer-'));
  const handles=[];
  t.after(async()=>{for(const h of handles)try{h.close();}catch{}assert.ok(directory.startsWith(join(tmpdir(),'zeer-consumer-')));await rm(directory,{recursive:true,force:true});});
  const state={revision:'1',generation:'generation-one',height:42,available:true,stale:false,fail:false,
    rows:[{id:'z',blockHeight:40,amount:'9007199254740993123'},{id:'a',blockHeight:41,amount:'2'},{id:'m',blockHeight:42,amount:'3'}]};
  const queries=[];
  const status=()=>({project:'receipts',generation:state.generation,revision:state.revision,checkpoint:{height:state.height,hash:'a'.repeat(64),status:'ready'},source:{status:state.available?'available':'unavailable',checkedAt:new Date(Date.now()-(state.stale?120000:0)).toISOString(),prepIndexedHeight:state.height,sourceObservedHeight:state.height,sourceObservedAt:Math.floor(Date.now()/1000)}});
  const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  const fetchImpl=async(url,options)=>{
    if(url.endsWith('/status'))return respond(status());
    if(state.fail)return respond({errors:[{message:'not ready'}]},503);
    const q=JSON.parse(options.body);queries.push(q);
    const after=q.variables.after;
    if(after&&after.split(':')[0]!==state.revision)return respond({errors:[{extensions:{code:'CURSOR_INVALIDATED'}}]},409);
    const offset=after?Number(after.split(':')[1]):0;
    const first=Number(q.query.match(/first:(\d+)/)[1]);
    const items=state.rows.slice(offset,offset+first),end=offset+items.length;
    return respond({data:{ReceiptList:{items,nextCursor:end<state.rows.length?`${state.revision}:${end}`:null},_meta:{project:'receipts',generation:state.generation,revision:state.revision,height:state.height,hash:'a'.repeat(64),status:'ready'}}});
  };
  const options={file:join(directory,'receipts.sqlite'),url:'http://127.0.0.1:39999',token:'reference-test-token-1234',project:'receipts',from:40,entity:'Receipt',fields:['id','blockHeight','amount'],pageSize:2,fetchImpl,...overrides};
  const open=changes=>{const h=new RangeConsumer({...options,...changes});handles.push(h);return h;};
  return {open,state,queries,options,directory};
}

test('staged pages survive reopening and become visible only after complete traversal',async t=>{
  const f=await fixture(t);let consumer=f.open();
  assert.equal((await consumer.step({maxPages:1})).state,'paused');assert.deepEqual(consumer.rows(),[]);
  assert.equal(consumer.state().scan.after,'1:2');consumer.close();
  consumer=f.open();assert.equal((await consumer.step()).state,'complete');
  assert.deepEqual(consumer.rows(),f.state.rows);assert.equal((await consumer.step()).state,'unchanged');
  assert.equal(consumer.rows()[0].amount,'9007199254740993123');
});

test('cursor invalidation discards staging and a full reorg sweep removes orphaned receipts',async t=>{
  const f=await fixture(t);let consumer=f.open();await consumer.step();
  const original=consumer.rows();
  f.state.revision='2';f.state.rows=[{id:'b',blockHeight:40,amount:'9'},{id:'c',blockHeight:41,amount:'7'},{id:'d',blockHeight:42,amount:'8'}];
  assert.equal((await consumer.step({maxPages:1})).state,'paused');assert.deepEqual(consumer.rows(),original);consumer.close();
  f.state.revision='3';f.state.height=41;f.state.rows=[{id:'new',blockHeight:40,amount:'11'}];
  consumer=f.open();const retry=await consumer.step();assert.deepEqual(retry,{state:'restarting',reason:'CURSOR_INVALIDATED'});
  assert.equal(consumer.state().scan,null);assert.deepEqual(consumer.rows(),original);
  assert.equal((await consumer.step()).state,'complete');assert.deepEqual(consumer.rows(),f.state.rows);
  assert.match(f.queries.at(-1).query,/lte:42/,'Reconcile the previous coverage even after a shorter branch');
  f.state.revision='4';f.state.rows=[];assert.equal((await consumer.step()).state,'complete');assert.deepEqual(consumer.rows(),[]);
});

test('unavailable, stale and failed reads preserve completed rows and cursor progress',async t=>{
  const f=await fixture(t);const consumer=f.open();await consumer.step();const original=consumer.state();
  for(const [field,reason] of [['available','SOURCE_UNKNOWN_OR_UNAVAILABLE'],['stale','SOURCE_OBSERVATION_STALE'],['fail','HTTP_503']]){
    f.state.revision='2';f.state[field]=field==='available'?false:true;
    assert.deepEqual(await consumer.step(),{state:'waiting',reason});
    assert.deepEqual(consumer.rows(),f.state.rows);assert.equal(consumer.state().complete.revision,original.complete.revision);
    f.state[field]=field==='available'?true:false;
  }
});

test('local generation and configuration changes require explicit operator recovery',async t=>{
  const f=await fixture(t);const consumer=f.open();await consumer.step();
  f.state.generation='replacement-project';await assert.rejects(consumer.step(),{code:'PROJECT_GENERATION_CHANGED'});
  assert.throws(()=>f.open({project:'other'}),{code:'CONSUMER_IDENTITY_MISMATCH'});
});

test('row budgets roll back the page and arbitrary existing SQLite databases are refused',async t=>{
  const f=await fixture(t,{maxRows:1});const consumer=f.open();
  await assert.rejects(consumer.step(),{code:'ROW_LIMIT'});assert.deepEqual(consumer.rows(),[]);assert.equal(consumer.state().scan.pages,0);
  const file=join(f.directory,'unrelated.sqlite'),other=new DatabaseSync(file);other.exec('CREATE TABLE valuable(value TEXT)');other.close();
  assert.throws(()=>f.open({file}),{code:'UNMARKED_DATABASE'});
  const check=new DatabaseSync(file);assert.deepEqual(check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name),['valuable']);check.close();
});

test('a competing consumer cannot commit a page fetched against stale local progress',async t=>{
  const f=await fixture(t);let release,entered;
  const pending=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const slow=f.open({fetchImpl:async(url,options)=>{if(url.endsWith('/graphql')){entered();await pending;}return f.options.fetchImpl(url,options);}});
  const fast=f.open();const result=slow.step();await started;
  await fast.step();release();await assert.rejects(result,{code:'CONSUMER_BUSY'});
  assert.deepEqual(fast.rows(),f.state.rows);
});

test('source availability is checked again before final promotion',async t=>{
  const f=await fixture(t);let changed=false;
  const consumer=f.open({fetchImpl:async(url,options)=>{
    const response=await f.options.fetchImpl(url,options);
    if(url.endsWith('/graphql')&&!JSON.parse(options.body).variables.after&&!changed){f.state.available=false;changed=true;}
    return response;
  }});
  // The first page may stage, but the final page cannot publish after source loss.
  assert.deepEqual(await consumer.step(),{state:'waiting',reason:'SOURCE_UNKNOWN_OR_UNAVAILABLE'});
  assert.deepEqual(consumer.rows(),[]);
  f.state.available=true;assert.equal((await consumer.step()).state,'complete');assert.equal(consumer.rows().length,3);
  assert.throws(()=>f.open({file:join(f.directory,'insecure.sqlite'),url:'http://example.com'}),{code:'HTTPS_OR_LOOPBACK_REQUIRED'});
});
