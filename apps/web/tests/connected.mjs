// Adapter tests use an explicitly synthetic local upstream, not chain evidence.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
const token='LOCAL_ADAPTER_TEST_TOKEN_NOT_FOR_DEPLOYMENT';
let mode='ok',calls=0,lastBody;
const upstream=createServer(async(req,res)=>{
 assert.equal(req.headers.authorization,`Bearer ${token}`);calls++;
 let body='';for await(const chunk of req) body+=chunk;lastBody=body?JSON.parse(body):null;
 if(mode==='hold')await delay(600);
 if(mode==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1:1/forbidden'});res.end();return;}
 if(mode==='unauthorized'){res.writeHead(401);res.end(token);return;}
 if(mode==='reorg'){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'REORG',message:token}}));return;}
 res.setHeader('Content-Type','application/json');
 if(mode==='large'){res.end(JSON.stringify({network:'testnet',blob:'x'.repeat(8500000)}));return;}
 if(req.url==='/height')res.end(JSON.stringify({network:mode==='mainnet'?'mainnet':'testnet',start_block:1000,indexed_height:1002,archive_height:1002,source_mode:'historical_snapshot',source_height:null,ready:true}));
 else if(req.url==='/graphql')res.end(JSON.stringify({data:{_meta:{height:1002,status:'ready'}}}));
 else res.end(JSON.stringify({network:mode==='mainnet'?'mainnet':'testnet',data:{blocks:[]},next_block:1003,cursor:null}));
});
await new Promise(r=>upstream.listen(39479,'127.0.0.1',r));
const server=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3107'],{cwd:resolve('apps/web'),env:{...process.env,ZEER_PREP_URL:'http://127.0.0.1:39479',ZEER_CHEF_URL:'http://127.0.0.1:39479',ZEER_PREP_TOKEN:token,ZEER_CHEF_TOKEN:token,ZEER_CHEF_DEMO:JSON.stringify({project:'hackathon_testnet_20261020',fromBlock:4510000,toBlock:4519999})},stdio:'ignore'});
const closed=new Promise(r=>server.on('exit',r));
const query=()=>fetch('http://127.0.0.1:3107/api/prep',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from_block:1000,to_block:1003})});
try{
 for(let i=0;i<80;i++){try{await fetch('http://127.0.0.1:3107');break;}catch{await delay(200);}}
 let r=await query();assert.equal(r.status,200);assert.equal((await r.json()).network,'testnet');
 const wide={from_block:0,to_block:1000000,limit:100,transaction_filter:{txids:['a'.repeat(64)]},cursor:'opaque-test-cursor'};
 r=await fetch('http://127.0.0.1:3107/api/prep',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(wide)});assert.equal(r.status,200);assert.deepEqual(lastBody,wide);
 const adaptive={...wide,limit:1000000,scan_mode:'adaptive'};
 r=await fetch('http://127.0.0.1:3107/api/prep',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(adaptive)});assert.equal(r.status,200);assert.deepEqual(lastBody,adaptive);
 for(const invalid of [{...adaptive,limit:1000001},{...adaptive,scan_mode:'unlimited'}]) {
  r=await fetch('http://127.0.0.1:3107/api/prep',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(invalid)});assert.equal(r.status,400);
 }
 const status=await(await fetch('http://127.0.0.1:3107/api/status')).json();assert.equal(status.prep.available,true);assert.equal(status.chef.data.height,1002);
 const html=await(await fetch('http://127.0.0.1:3107/app/prep')).text();assert.ok(!html.includes(token));
 const inspected=await(await fetch('http://127.0.0.1:3107/app/prep?example=headers&from=1000&to=1001')).text();
 assert.match(inspected,/Linked range: blocks 1,000–1,000 inclusive/);assert.match(inspected,/to_block/);
 const unbounded=await(await fetch('http://127.0.0.1:3107/app/prep?example=headers&from=1000')).text();
 assert.ok(!unbounded.includes('Linked range: blocks'));assert.match(unbounded,/Prep captures the latest indexed block/);
 const chefRequest=query=>fetch('http://127.0.0.1:3107/api/chef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
 const beforeInvalid=calls;
 r=await chefRequest('{ BlockSummaryList(first:3) { items { heigth } } }');assert.equal(r.status,400);assert.match((await r.json()).error,/heigth.*height/s);assert.equal(calls,beforeInvalid);
 r=await chefRequest('query {\n BlockSummaryList(');assert.equal(r.status,400);assert.match((await r.json()).error,/line 2, column/);assert.equal(calls,beforeInvalid);
 mode='mainnet';assert.equal((await query()).status,502);
 mode='unauthorized';r=await query();assert.equal(r.status,502);assert.ok(!(await r.text()).includes(token));
 mode='redirect';assert.equal((await query()).status,503);
 mode='large';assert.equal((await query()).status,413);
 mode='reorg';r=await fetch('http://127.0.0.1:3107/api/prep/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from_block:1000,to_block:1003})});assert.equal(r.status,409);const reorg=await r.json();assert.equal(reorg.error.code,'REORG');assert.ok(!JSON.stringify(reorg).includes(token));
 mode='hold';const burst=await Promise.all([query(),query(),query()]);assert.ok(burst.some(r=>r.status===429));
 console.log(JSON.stringify({status:'PASS',scope:'Synthetic local adapter tests',checks:['forwarded auth','status mapping','no token in HTML','wrong network rejected','upstream auth failure sanitized','redirect rejected','response size cap','concurrency cap'],calls}));
}finally{server.kill();await closed;await new Promise(r=>upstream.close(r));}
