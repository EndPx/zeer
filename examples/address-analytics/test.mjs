import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createChefServer, parseModel, encodeEntity} from '@zeer-dev/chef';
import config from './chef.config.ts';

test('address totals count transactions once, preserve exact amounts, and expose incomplete attribution', async t => {
  const tables = new Map();
  const entities = {
    async get(name,id) { return structuredClone(tables.get(name)?.get(id) ?? null); },
    async set(name,row) { if (!tables.has(name)) tables.set(name,new Map()); tables.get(name).set(row.id,structuredClone(row)); },
  };
  const context={entities};
  const a='a'.repeat(64), b='b'.repeat(64);
  const block={height:0,hash:'0'.repeat(64),previousHash:'0'.repeat(64),time:1};
  await config.indexer.block({block,context});
  const output=(n,value,addresses)=>({n,value,scriptPubKey:{addresses}});
  await config.indexer.transaction({block,context,transaction:{txid:a,blockHeight:0,index:0,version:1,locktime:0,decoded:{vin:[{coinbase:'00'}],vout:[output(0,'90071992.54740993',['tA']),output(1,'0.00000002',['tA']),output(2,'1',['tA','tB'])]}}});
  const next={...block,height:1,hash:'1'.repeat(64)};
  await config.indexer.block({block:next,context});
  await config.indexer.transaction({block:next,context,transaction:{txid:b,blockHeight:1,index:0,version:1,locktime:0,decoded:{vin:[{txid:a,vout:0},{txid:a,vout:1},{txid:'c'.repeat(64),vout:0}],vout:[output(0,'0',['tA'])]}}});
  const summary=await entities.get('AddressSummary','tA');
  assert.equal(summary.receivedZat,9007199254740995n);
  assert.equal(summary.spentZat,9007199254740995n);
  assert.equal(summary.incomingTransactions,2); // A zero-value output still counts.
  assert.equal(summary.outgoingTransactions,1); // Two inputs, one transaction.
  assert.equal((await entities.get('Coverage','chain')).unresolvedInputs,1);
  assert.equal((await entities.get('Coverage','chain')).unattributedOutputs,1);
  assert.equal(await entities.get('AddressSummary','tB'),null);
  assert.equal((await entities.get('ObservedOutput',`${a}:0`)).spentBy,b);

  // Execute the documented query through the real Chef GraphQL API.
  const model=parseModel(await readFile(new URL('./schema.graphql',import.meta.url),'utf8'));
  const checkpoint={height:1,hash:next.hash,anchorHash:block.hash,status:'ready'};
  const view={checkpoint,consumption:{project:'test',generation:'1',revision:'1',checkpoint,lastCommitAt:null,source:{status:'unknown',checkedAt:null,prepIndexedHeight:null,sourceObservedHeight:null,sourceObservedAt:null}},
    async get(name,id) { const value=await entities.get(name,id); return value ? encodeEntity(model,name,value) : null; },
    async list(name,options) { return [...(tables.get(name)?.values()??[])].filter(row=>Object.entries(options.where??{}).every(([k,v])=>row[k]===v)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,options.first).map(row=>encodeEntity(model,name,row)); }};
  const token='address-example-test-token';
  const server=createChefServer({model,store:{read:fn=>fn(view)},token});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/graphql`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({query:await readFile(new URL('./query.graphql',import.meta.url),'utf8'),variables:{address:'tA'}})});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.data.AddressSummaryById.receivedZat,'9007199254740995');
  assert.equal(body.data.AddressActivityList.items.length,2);
});
