import test from 'node:test';
import assert from 'node:assert/strict';
import {RequestBudget,auditFetch} from './transport.mjs';
test('all independent clients share hard cap without pacing or implicit retries',async()=>{
  let time=0;const b=new RequestBudget({maxRequests:3,now:()=>time});
  for(let i=0;i<3;i++){const id=await b.acquire('client'+i,'/height');b.finish(id,{status:200});}
  assert.deepEqual(b.attempts.map(x=>x.started_seconds),[0,0,0]);
  await assert.rejects(b.acquire('fourth','/query'),/BUDGET_EXHAUSTED/);assert.equal(b.active,0);
});
test('expired phase refuses work and duplicate release cannot change concurrency',async()=>{
  let time=0;const b=new RequestBudget({now:()=>time,durationMs:1000});const id=await b.acquire('a','/height');
  b.finish(id,{status:503});assert.throws(()=>b.finish(id,{status:200}),/INVALID_TRANSPORT_LEASE/);
  time=1001;await assert.rejects(b.acquire('a','/height'),/PHASE_DEADLINE/);
});
test('HTTP 429 is delivered unchanged with Retry-After and has no hidden retry',async()=>{
  const calls=[];const fetchImpl=async(url,options)=>{
    calls.push(String(url));
    if(String(url).endsWith('/lease'))return Response.json({id:0});
    if(String(url).endsWith('/finish')){assert.equal(JSON.parse(options.body).status,429);return Response.json({ok:true});}
    return Response.json({error:{code:'RATE_LIMITED'}},{status:429,headers:{'retry-after':'2'}});
  };
  const fetch=auditFetch({fetchImpl,origin:'https://zeer.endpx.cloud/api/prep',coordinator:'http://127.0.0.1:1',token:'test',client:'a'});
  const r=await fetch('https://zeer.endpx.cloud/api/prep/height');assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'2');
  assert.deepEqual(await r.json(),{error:{code:'RATE_LIMITED'}});assert.equal(calls.length,3);
  await assert.rejects(fetch('https://zeer.endpx.cloud/api/prep/height',{headers:{authorization:'secret'}}),/AUTH_HEADER_FORBIDDEN/);
});
