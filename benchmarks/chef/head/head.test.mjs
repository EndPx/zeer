import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedEntities,rank,stats,summarize,digest,privateRpcHost,guardedMessage} from './common.mjs';
import {readDatabaseSnapshot,databaseBudget,closeDatabaseClient} from './database.mjs';
import {createServer} from 'node:net';
const tx=id=>({txid:id.repeat(64),version:6,locktime:0,vin:[{}],vout:[{}],ironwood:{actions:[{}]}});
test('database teardown forcibly destroys a transport that never closes',async()=>{
  let destroyed=false;
  const client={end:()=>new Promise(()=>{}),connection:{stream:{destroy(){destroyed=true;}}}};
  await assert.rejects(closeDatabaseClient(client,performance.now()+30),/Database teardown deadline/);
  assert.equal(destroyed,true);
});
test('a PostgreSQL endpoint that never responds cannot stall verification indefinitely',async()=>{
  assert.throws(()=>databaseBudget(performance.now()-1),/Database snapshot deadline/);
  const sockets=new Set(),server=createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const start=performance.now();
  try{
    await assert.rejects(readDatabaseSnapshot({connectionString:`postgresql://test:test@127.0.0.1:${server.address().port}/test`,project:'head_'+'a'.repeat(22),deadline:performance.now()+100}));
    assert.ok(performance.now()-start<2000,'Snapshot exceeded its bounded connection deadline');
  }finally{for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
});
test('authenticated RPC excludes DNS lookalikes and public addresses',()=>{
  for(const host of ['127.attacker.example','10.attacker.example','192.168.attacker.example','8.8.8.8','172.32.0.1'])assert.equal(privateRpcHost(host),false);
  for(const host of ['127.0.0.1','10.1.2.3','192.168.1.2','172.16.0.2','172.31.255.1'])assert.equal(privateRpcHost(host),true);
});
test('IPC validation failures enter the controlled fatal path instead of escaping',()=>{
  const errors=[],seen=new Map();
  const receive=guardedMessage(value=>{const old=seen.get(value.height);if(old)assert.equal(value.hash,old);seen.set(value.height,value.hash);},code=>errors.push(code));
  receive({height:42,hash:'a'});assert.doesNotThrow(()=>receive({height:42,hash:'b'}));
  assert.deepEqual(errors,['IPC_VALIDATION_FAILED']);assert.equal(seen.get(42),'a');
});
test('reference independently maps every transaction and cumulative totals',()=>{
  const result=expectedEntities([{height:42,hash:'a'.repeat(64),time:100,tx:[tx('c'),tx('d')]}]);
  assert.deepEqual(result.entities.Totals,[{id:'all',blocks:1,transactions:2}]);
  assert.equal(result.entities.BlockSummary[0].transactionCount,2);
  assert.deepEqual(result.entities.TransactionMeta.map(t=>t.transactionIndex),[0,1]);
  assert.equal(result.pools.ironwood,2);
  assert.throws(()=>expectedEntities([{height:42,hash:'a'.repeat(64),time:100,tx:[]},{height:43,hash:'b'.repeat(64),previousblockhash:'c'.repeat(64),time:101,tx:[]}]),/Disconnected/);
});
test('seconds and nearest-rank percentiles preserve slow and negative observations',()=>{
  assert.equal(rank([1,2,100,3],.95),100);
  assert.deepEqual(stats([4,1,2,3]),{samples:4,median_seconds:2.5,p95_seconds:4,min_seconds:1,max_seconds:4});
  const row={hash:'a',source_ns:'1000000000',prep_ns:'3000000000',profiles:[
    {hash:'a',poll_seconds:5,commit_ns:'5000000000',graphql_ns:'6000000000'},
    {hash:'a',poll_seconds:1,commit_ns:'4000000000',graphql_ns:'4500000000'}]};
  assert.equal(summarize([row])['5'].source_to_graphql.median_seconds,5);
  assert.equal(summarize([row]).paired_graphql_improvement.median_seconds,1.5);
  assert.equal(summarize([{...row,source_ns:'3500000000'}]).source_to_prep.median_seconds,-.5);
  assert.throws(()=>summarize([{...row,profiles:[row.profiles[0]]}]),/Unpaired/);
  assert.throws(()=>summarize([{...row,profiles:row.profiles.map(p=>({...p,hash:'b'}))}]),/Different/);
  const two={...row,profiles:row.profiles.map(p=>({...p,poll_seconds:p.poll_seconds===1?2:5}))};
  assert.equal(summarize([two],[5,2])['2'].source_to_graphql.median_seconds,3.5);
});
test('equivalence hashing ignores object key order but detects missing and changed values',()=>{
  assert.equal(digest([{a:1,b:2}]),digest([{b:2,a:1}]));
  assert.notEqual(digest([{a:1}]),digest([{a:2}]));
  assert.notEqual(digest([]),digest([{a:1}]));
});
