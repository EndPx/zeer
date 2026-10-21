import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresStore} from '../dist/store.js';
import {parseModel} from '../dist/schema.js';
import {createChefServer} from '../dist/graphql.js';

const url = process.env.CHEF_TEST_DATABASE_URL;
const model = parseModel('type Receipt { id: ID! blockHeight: Int! @index amount: BigInt! memo: String } type Other { id: ID! }');
const token = 'consumption-test-token-0123456789';
const hash = n => BigInt(n).toString(16).padStart(64,'0');
const block = n => ({height:n,hash:hash(n+1),previousHash:hash(n),time:1000+n});
async function fixture(t) {
  const project = `t_${randomUUID().replaceAll('-','').slice(0,24)}`;
  const options = {project,fingerprint:'consumption-v1',network:'regtest',startHeight:0,reorgWindow:10,model};
  const store = new PostgresStore(url,options);
  await store.migrate(); await store.acquire();
  const server = createChefServer({store,model,token});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
    await store.close();
    const client = new pg.Client({connectionString:url}); await client.connect();
    try { assert.match(project,/^t_[0-9a-f]{24}$/); await client.query(`DROP SCHEMA "chef_${project}" CASCADE`); } finally { await client.end(); }
  });
  const request = async (query,variables={})=>{
    const response = await fetch(origin+'/graphql',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query,variables})});
    return {status:response.status,body:await response.json()};
  };
  const status = async (auth=token)=>{
    const response=await fetch(origin+'/status',{headers:{authorization:`Bearer ${auth}`}});
    return {status:response.status,body:await response.json()};
  };
  const insert = async height=>store.apply(block(height),async e=>{
    // Hash-like IDs intentionally oppose height ordering; three entities share each block.
    for (const suffix of ['z','a','m']) await e.set('Receipt',{id:`${2-height}-${suffix}`,blockHeight:height,amount:9007199254740993n,memo:null});
  });
  return {store,options,request,status,insert};
}
const pageQuery = direction => `query($after:ID){ReceiptList(first:2,after:$after,range:{blockHeight:{gte:0,lte:2}},orderBy:[{blockHeight:${direction}},{id:${direction}}]){items{id blockHeight amount}nextCursor}_meta{generation revision height}}`;

test('consumption/PostgreSQL: numeric range keysets cover every tied entity in both directions', {skip:!url}, async t=>{
  const f=await fixture(t); for(let h=0;h<3;h++)await f.insert(h);
  for(const direction of ['ASC','DESC']) {
    let after, rows=[];
    do {
      const result=await f.request(pageQuery(direction),{after});
      assert.equal(result.status,200,JSON.stringify(result.body));
      rows.push(...result.body.data.ReceiptList.items);after=result.body.data.ReceiptList.nextCursor;
    } while(after);
    const expected=[0,1,2].flatMap(h=>['a','m','z'].map(s=>({id:`${2-h}-${s}`,blockHeight:h,amount:'9007199254740993'})));
    if(direction==='DESC')expected.reverse();
    assert.deepEqual(rows,expected); assert.equal(new Set(rows.map(r=>r.id)).size,9);
  }
  for(const args of ['range:{blockHeight:{}}','range:{blockHeight:{gte:2,lte:1}}','range:{blockHeight:{gte:null}}','range:{amount:{gte:1}}','orderBy:[{amount:ASC}]','orderBy:[]','orderBy:[{blockHeight:ASC},{id:DESC}]','orderBy:[{id:ASC},{blockHeight:ASC}]','orderBy:[{id:ASC,blockHeight:ASC}]']) {
    assert.equal((await f.request(`{ReceiptList(${args}){items{id}}}`)).status,400,args);
  }
  const limited=await f.request('{ReceiptList(range:{blockHeight:{gte:1,lte:1}},where:{memo:null}){items{blockHeight}}}');
  assert.deepEqual(limited.body.data.ReceiptList.items,[{blockHeight:1},{blockHeight:1},{blockHeight:1}]);
});

test('consumption/PostgreSQL: cursors reject commits, query changes, tampering and rollback/replay ABA', {skip:!url}, async t=>{
  const f=await fixture(t); await f.insert(0);
  const first=await f.request(pageQuery('ASC')); const cursor=first.body.data.ReceiptList.nextCursor;
  const initial=await f.store.consumptionStatus();
  await f.store.recordSourceObservation({status:'available',prepIndexedHeight:2,sourceObservedHeight:3,sourceObservedAt:1700000000});
  await f.store.apply(block(0),async()=>{throw new Error('no-op must not run handler');});
  assert.equal((await f.store.consumptionStatus()).revision,initial.revision);
  assert.equal((await f.request(pageQuery('ASC'),{after:cursor})).status,200);
  for(const [query,after] of [[pageQuery('DESC'),cursor],[pageQuery('ASC'),cursor.slice(0,-2)+'xx'],['query($after:ID){OtherList(after:$after){items{id}}}',cursor],['query($after:ID){ReceiptList(after:$after,where:{blockHeight:0}){items{id}}}',cursor],[pageQuery('ASC'),'2-a']]) {
    const result=await f.request(query,{after}); assert.equal(result.status,409);
    assert.equal(result.body.errors[0].extensions.code,'CURSOR_INVALIDATED'); assert.equal(result.body.data,undefined);
  }
  await assert.rejects(f.store.apply(block(1),async()=>{throw new Error('failed write');}),/failed write/);
  assert.equal((await f.store.consumptionStatus()).revision,initial.revision);
  await f.insert(1);
  let result=await f.request(pageQuery('ASC'),{after:cursor});assert.equal(result.status,409);
  assert.equal(result.body.errors[0].extensions.revision,'2');
  const before=(await f.request(pageQuery('ASC'))).body.data.ReceiptList.nextCursor;
  await f.store.markReconciling();
  assert.equal((await f.request(pageQuery('ASC'),{after:before})).status,503);
  await f.store.rollback(0,hash(1)); await f.insert(1); await f.store.markReady();
  assert.equal((await f.store.checkpoint()).hash,hash(2));
  assert.equal((await f.store.consumptionStatus()).revision,'4');
  result=await f.request(pageQuery('ASC'),{after:before});assert.equal(result.status,409);
});

test('consumption/PostgreSQL: status stays readable during gates, source loss is explicit and snapshots stay atomic', {skip:!url}, async t=>{
  const f=await fixture(t);const empty=await f.status();
  assert.equal(empty.body.source.status,'unknown');assert.equal(empty.body.lastCommitAt,null);
  assert.equal((await f.status('wrong')).status,401);
  await f.insert(0);const before=await f.store.consumptionStatus(); assert.ok(Date.parse(before.lastCommitAt));
  const read=f.store.read(async view=>{
    const revision=view.consumption.revision;
    await f.insert(1);
    assert.equal(view.consumption.revision,revision);
    assert.equal((await view.list('Receipt',{first:100})).length,3);
    return revision;
  });
  assert.equal(await read,'1');assert.equal((await f.status()).body.revision,'2');
  await f.store.recordSourceObservation({status:'available',prepIndexedHeight:5,sourceObservedHeight:6,sourceObservedAt:1700000000});
  const observed=(await f.status()).body;assert.equal(observed.source.sourceObservedHeight,6);assert.ok(Date.parse(observed.source.checkedAt));
  await f.store.recordSourceObservation({status:'unavailable',prepIndexedHeight:5,sourceObservedHeight:6,sourceObservedAt:1700000000});
  await f.store.markReconciling('source');
  const unavailable=await f.status();assert.equal(unavailable.status,200);assert.equal(unavailable.body.checkpoint.status,'reconciling');
  assert.equal(unavailable.body.source.status,'unavailable');assert.equal(unavailable.body.source.sourceObservedHeight,null);
  assert.equal((await f.request('{ReceiptList{items{id}}}')).status,503);
  await f.store.markBlocked();assert.equal((await f.status()).body.checkpoint.status,'blocked');
});

test('consumption/PostgreSQL: additive legacy migration preserves entities and creates a new cursor generation', {skip:!url}, async t=>{
  const f=await fixture(t);await f.insert(0);
  const first=await f.request(pageQuery('ASC'));const cursor=first.body.data.ReceiptList.nextCursor;
  const old=await f.store.consumptionStatus();
  const client=new pg.Client({connectionString:url});await client.connect();
  try {
    await client.query(`ALTER TABLE "chef_${f.options.project}".state DROP COLUMN generation, DROP COLUMN data_revision, DROP COLUMN last_commit_at, DROP COLUMN source_observation`);
    await assert.rejects(f.store.checkpoint(),/consumption migration required/);
    const other=new PostgresStore(url,f.options);
    try {await assert.rejects(other.migrate(),/Stop the project writer/);} finally {await other.close();}
    await f.store.release();await f.store.migrate();await f.store.acquire();
    const current=await f.store.consumptionStatus();assert.notEqual(current.generation,old.generation);
    assert.equal(current.revision,'0');assert.equal(current.lastCommitAt,null);assert.equal(current.source.status,'unknown');
    assert.equal((await f.store.read(v=>v.list('Receipt',{first:100}))).length,3);
    assert.equal((await f.request(pageQuery('ASC'),{after:cursor})).status,409);
  } finally {await client.end();}
});


test('consumption/PostgreSQL: explicit Int ordering uses the declared numeric JSONB index', {skip:!url}, async t=>{
  const f=await fixture(t);await f.insert(0);
  const client=new pg.Client({connectionString:url});await client.connect();
  try {
    await client.query('BEGIN');await client.query('SET LOCAL enable_seqscan=off');
    const plan=(await client.query(`EXPLAIN (FORMAT JSON) SELECT data FROM "chef_${f.options.project}".entities WHERE entity='Receipt' AND (data -> 'blockHeight') >= '0'::jsonb AND ((data -> 'blockHeight'),id) > ('0'::jsonb,'2-a'::text COLLATE "C") ORDER BY (data -> 'blockHeight') ASC,id ASC LIMIT 3`)).rows[0]['QUERY PLAN'][0].Plan;
    assert.match(JSON.stringify(plan),/chef_qi_/);assert.doesNotMatch(JSON.stringify(plan),/"Node Type":"Sort"/);
    await client.query('ROLLBACK');
  } finally {await client.end();}
});
