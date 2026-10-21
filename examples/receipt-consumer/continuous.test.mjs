import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ContinuousConsumer} from './consumer.mjs';

async function fixture(t,{blocks=1500,perBlock=12,...overrides}={}){
 const directory=await mkdtemp(join(tmpdir(),'zeer-continuous-')),handles=[];
 t.after(async()=>{for(const h of handles)try{h.close();}catch{}await rm(directory,{recursive:true,force:true});});
 const state={height:blocks-1,floor:Math.max(-1,blocks-65),generation:'generation-one',revision:'1',available:true,rows:Array.from({length:blocks},(_,height)=>Array.from({length:perBlock},(_,i)=>({id:`${height}:${i}`,blockHeight:height,amount:'9007199254740993123'}))).flat()};
 const status=()=>({project:'receipts',generation:state.generation,revision:state.revision,checkpoint:{height:state.height,hash:'a'.repeat(64),undoFloor:state.floor,status:'ready'},source:{status:state.available?'available':'unavailable',checkedAt:new Date().toISOString(),prepIndexedHeight:state.height,sourceObservedHeight:state.height,sourceObservedAt:Math.floor(Date.now()/1000)}});
 const respond=(body,code=200)=>new Response(JSON.stringify(body),{status:code});
 const fetchImpl=async(url,options)=>{
  if(url.endsWith('/status'))return respond(status());
  const q=JSON.parse(options.body),after=q.variables.after;
  if(after&&after.split('/')[0]!==state.revision)return respond({errors:[{extensions:{code:'CURSOR_INVALIDATED'}}]},409);
  const from=Number(q.query.match(/gte:(\d+)/)[1]),to=Number(q.query.match(/lte:(\d+)/)[1]),first=Number(q.query.match(/first:(\d+)/)[1]);
  const rows=state.rows.filter(r=>r.blockHeight>=from&&r.blockHeight<=to).sort((a,b)=>a.blockHeight-b.blockHeight||Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
  const offset=after?Number(after.split('/')[1]):0,items=rows.slice(offset,offset+first),end=offset+items.length;
  return respond({data:{ReceiptList:{items,nextCursor:end<rows.length?`${state.revision}/${end}`:null},_meta:{project:'receipts',generation:state.generation,revision:state.revision,height:state.height,hash:'a'.repeat(64),status:'ready'}}});
 };
 const options={file:join(directory,'consumer.sqlite'),url:'http://127.0.0.1:39999',token:'continuous-fixture-token',project:'receipts',from:0,entity:'Receipt',fields:['id','blockHeight','amount'],maxRange:128,pageSize:100,fetchImpl,...overrides};
 const open=changes=>{const c=new ContinuousConsumer({...options,...changes});handles.push(c);return c;};
 async function catchUp(c){for(let i=0;i<100;i++){const result=await c.step();if(result.state==='unchanged'||result.caughtUp)return result;}throw Error('DID_NOT_CATCH_UP');}
 return {state,open,catchUp,options};
}
test('more than1000blocks and10000rows persist across windows and process reopen',async t=>{
 const f=await fixture(t);let c=f.open();await c.step();assert.equal(c.count(),128*12);c.close();c=f.open();await f.catchUp(c);
 assert.equal(c.count(),18000);assert.equal(c.state().complete.to,1499);assert.equal(c.state().complete.sealedThrough,1435);assert.equal((await c.step()).state,'unchanged');
 assert.equal(c.rows()[0].amount,'9007199254740993123');
 f.state.height=1500;f.state.floor=1436;f.state.revision='2';f.state.rows.push({id:'live',blockHeight:1500,amount:'1'});await f.catchUp(c);assert.equal(c.count(),18001);
});
test('a shorter branch reconciles the whole mutable tail and same ID re-inclusion',async t=>{
 const f=await fixture(t);const c=f.open();await f.catchUp(c);const reused=f.state.rows.find(r=>r.blockHeight===1490).id;
 f.state.height=1460;f.state.revision='2';f.state.rows=f.state.rows.filter(r=>r.blockHeight<=1450);f.state.rows.push({id:reused,blockHeight:1460,amount:'7'});
 await f.catchUp(c);assert.equal(c.count(),1451*12+1);assert.equal(c.rows().find(r=>r.id===reused).blockHeight,1460);assert.equal(c.state().complete.to,1460);
});
test('partial tail, invalid cursor and failed source never replace completed history',async t=>{
 const f=await fixture(t);let c=f.open();await f.catchUp(c);const before=c.rows();
 f.state.revision='2';f.state.rows=f.state.rows.filter(r=>r.blockHeight<1470);assert.equal((await c.step({maxPages:1})).state,'paused');c.close();
 c=f.open();f.state.revision='3';assert.equal((await c.step()).reason,'CURSOR_INVALIDATED');assert.deepEqual(c.rows(),before);
 f.state.available=false;assert.equal((await c.step()).reason,'SOURCE_UNKNOWN_OR_UNAVAILABLE');assert.deepEqual(c.rows(),before);
 f.state.available=true;await f.catchUp(c);assert.equal(c.count(),1470*12);
});
test('unknown/decreased horizon, changed generation and deep recovery stop explicitly',async t=>{
 for(const [field,value,code]of [['floor',undefined,'RECOVERY_HORIZON_REQUIRED'],['floor',1200,'RECOVERY_HORIZON_DECREASED'],['generation','replacement','PROJECT_GENERATION_CHANGED']]){
  const f=await fixture(t);const c=f.open();await f.catchUp(c);const count=c.count();f.state[field]=value;await assert.rejects(c.step(),{code});assert.equal(c.count(),count);
 }
 const f=await fixture(t,{blocks:100,maxRange:10});const c=f.open();await assert.rejects(f.catchUp(c),{code:'RECOVERY_WINDOW_EXCEEDS_BUDGET'});
});
test('total row budget rolls back a completed window and mutable aggregates are rejected',async t=>{
 const f=await fixture(t,{maxRows:2000,maxTotalRows:2000});const c=f.open();await c.step();assert.equal(c.count(),1536);
 await assert.rejects(c.step(),{code:'TOTAL_ROW_LIMIT'});assert.equal(c.count(),1536);
 const g=await fixture(t);const d=g.open();await g.catchUp(d);g.state.revision='2';g.state.rows.push({id:'0:0',blockHeight:1499,amount:'9'});
 await assert.rejects(d.step(),{code:'ENTITY_OUTSIDE_RECONCILED_RANGE'});assert.equal(d.count(),18000);
});
test('a normal commit between the last page and final status restarts without losing rows',async t=>{
 const f=await fixture(t,{blocks:100});const c=f.open();await f.catchUp(c);const before=c.rows();f.state.revision='2';let changed=false;
 c.fetch=async(url,options)=>{const response=await f.options.fetchImpl(url,options);if(url.endsWith('/graphql')&&!changed&&(await response.clone().json()).data?.ReceiptList.nextCursor===null){changed=true;f.state.height++;f.state.floor++;f.state.revision='3';}return response;};
 assert.equal((await c.step()).reason,'REVISION_CHANGED');assert.deepEqual(c.rows(),before);c.fetch=f.options.fetchImpl;await f.catchUp(c);
 assert.deepEqual(c.rows(),before);assert.equal(c.state().complete.to,100);
});
