import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.WEB_TEST_URL??'http://127.0.0.1:3000';
const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('all pages render, with landing and app separated',async()=>{
 for(const route of ['/','/app','/app/prep','/app/chef']){
  const r=await fetch(base+route);assert.equal(r.status,200);const html=await r.text();
  assert.ok(html.includes(route==='/'?'Zcash data.':'Zcash Testnet'));
  assert.ok(!html.includes('react-grab/dist')&&!html.includes('react-scan/dist'));
 }
});
test('missing upstream is explicit, not a simulated successful query',async()=>{
 const r=await post('/api/prep',{from_block:1000,to_block:1003});assert.equal(r.status,503);assert.match((await r.json()).error,/not connected/);
 const c=await post('/api/chef',{query:'{ _meta { height } }'});assert.equal(c.status,503);
 const status=await(await fetch(base+'/api/status')).json();assert.equal(status.prep.configured,false);assert.equal(status.chef.configured,false);
});
test('requests cannot choose an upstream or exceed bounded ranges',async()=>{
 for(const q of [{from_block:1,to_block:2000},{from_block:1,to_block:1},{from_block:1,to_block:2,url:'http://169.254.169.254'},{from_block:0,to_block:2}])assert.equal((await post('/api/prep',q)).status,400);
 assert.equal((await post('/api/prep',{from_block:1,to_block:2},{Origin:'https://untrusted.example'})).status,403);
 assert.equal((await post('/api/prep',{x:'x'.repeat(17000)})).status,413);
});
test('GraphQL permits only a single read-only query and rejects introspection',async()=>{
 for(const query of ['mutation { remove }','subscription { updated }','{ __schema { types { name } } }','query A { a } query B { b }','{ invalid'])assert.equal((await post('/api/chef',{query})).status,400);
});
