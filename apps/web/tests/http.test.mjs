import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.WEB_TEST_URL??'http://127.0.0.1:3000';
const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('all pages render, with landing and app separated',async()=>{
 for(const route of ['/','/app','/app/prep','/app/prep?view=transaction','/app/prep?view=mempool','/app/chef']){
  const r=await fetch(base+route);assert.equal(r.status,200);const html=await r.text();
  assert.ok(html.includes(route==='/'?'Zcash data.':'Zcash Testnet'));
  assert.ok(!html.includes('react-grab/dist')&&!html.includes('react-scan/dist'));
 }
});
test('Prep owns inspection and mempool, and old links preserve their transaction ID',async()=>{
 const id='AB'.repeat(32);
 for(const [suffix,target] of [['','/app/prep?view=mempool'],['?txid='+id,'/app/prep?view=transaction&txid='+id.toLowerCase()],['?txid=invalid%26id','/app/prep?view=transaction&txid=invalid%26id']]) {
  const r=await fetch(base+'/app/transactions'+suffix,{redirect:'manual'});
  assert.equal(r.status,307);assert.equal(r.headers.get('location'),target);
 }
 const html=await(await fetch(base+'/app/prep?view=transaction')).text();
 assert.match(html,/Inspect a transaction\./);assert.match(html,/Enter a transaction ID or choose/);
 assert.ok(!html.includes('href="/app/transactions"'));
 assert.match(html,/<a(?=[^>]*href="\/app\/prep\?view=transaction")(?=[^>]*aria-current="page")[^>]*>/);
 const pool=await(await fetch(base+'/app/prep?view=mempool')).text();
 assert.match(pool,/Watch pending transactions\./);
 assert.match(pool,/<a(?=[^>]*href="\/app\/prep\?view=mempool")(?=[^>]*aria-current="page")[^>]*>/);
});
test('missing upstream is explicit, not a simulated successful query',async()=>{
 const r=await post('/api/prep',{from_block:1000,to_block:1003});assert.equal(r.status,503);assert.match((await r.json()).error,/not connected/);
 const live=await post('/api/prep/transaction',{txid:'a'.repeat(64)});assert.equal(live.status,503);
 assert.equal((await fetch(base+'/api/prep/mempool')).status,503);
 const c=await post('/api/chef',{query:'{ _meta { height } }'});assert.equal(c.status,503);
 const status=await(await fetch(base+'/api/status')).json();assert.equal(status.prep.configured,false);assert.equal(status.chef.configured,false);
});
test('requests cannot choose an upstream or exceed page bounds',async()=>{
 for(const q of [{from_block:0,to_block:1000000,limit:1001},{from_block:1,to_block:1},{from_block:1,to_block:2,url:'http://169.254.169.254'},{from_block:-1,to_block:2}])assert.equal((await post('/api/prep',q)).status,400);
 assert.equal((await post('/api/prep',{from_block:1,to_block:2},{Origin:'https://untrusted.example'})).status,403);
 assert.equal((await post('/api/prep',{x:'x'.repeat(17000)})).status,413);
});
test('GraphQL permits only a single read-only query and rejects introspection',async()=>{
 for(const query of ['mutation { remove }','subscription { updated }','{ __schema { types { name } } }','query A { a } query B { b }','{ invalid'])assert.equal((await post('/api/chef',{query})).status,400);
});
test('GraphQL oversized pages have actionable errors',async()=>{
 const r=await post('/api/chef',{query:'{ BlockSummaryList(first: 100000) { items { height } } }'});
 assert.equal(r.status,400);assert.match((await r.json()).error,/nextCursor/);
});
