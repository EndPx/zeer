import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModel,encodeEntity,decodeEntity,generateTypes} from '../dist/schema.js';
import {createChefServer} from '../dist/graphql.js';

export const relationSchema=`type Tx { id: ID! tags: [String!]! amounts: [BigInt] favorites: [Output] inputs: [Input!]! @derivedFrom(field: "transaction") }
type Input { id: ID! transaction: Tx! @index previous: Output }
type Output { id: ID! addresses: [String!]! valueZat: BigInt! }`;
test('relation schemas preserve exact lists, nullable items, ID references and derived read-only fields',()=>{
 const m=parseModel(relationSchema);
 const row=encodeEntity(m,'Tx',{id:'t',tags:['a'],amounts:[9007199254740993n,null]});
 assert.deepEqual({...row},{id:'t',tags:['a'],amounts:['9007199254740993',null],favorites:null});
 assert.deepEqual(decodeEntity(m,'Tx',row).amounts,[9007199254740993n,null]);
 assert.match(generateTypes(m),/transaction: string;/);assert.doesNotMatch(generateTypes(m),/inputs:/);
 assert.throws(()=>encodeEntity(m,'Tx',{id:'t',tags:[],inputs:[]}),/read-only/);
 assert.throws(()=>encodeEntity(m,'Tx',{id:'t',tags:[null]}));
 assert.throws(()=>encodeEntity(m,'Tx',{id:'t',tags:Array(101).fill('x')}),/100/);
 assert.throws(()=>encodeEntity(m,'Tx',{id:'t',tags:['x'],amounts:[1]}));
 for(const schema of ['type A { id: ID! x: Missing }','type A { id: ID! x: [Int] @derivedFrom(field:"id") }',
 'type A { id: ID! b: [B!]! @derivedFrom(field:"a") } type B { id: ID! a: A! }',
 'type A { id: ID! x: [ID!] @index }']) assert.throws(()=>parseModel(schema));
});

export async function relationFixture(t, extra={}){
 const model=parseModel(relationSchema),rows={Tx:[{id:'t',tags:['demo'],amounts:['9007199254740993',null],favorites:['o',null,'missing']}],Input:[{id:'i',transaction:'t',previous:'o'},{id:'j',transaction:'t',previous:null}],Output:[{id:'o',addresses:['tExample'],valueZat:'100000'}]};
 let reads=0;const checkpoint={height:1,hash:'a'.repeat(64),anchorHash:'b'.repeat(64),status:'ready'};
 const view={checkpoint,consumption:{project:'test',generation:'g',revision:'1',checkpoint,lastCommitAt:null,source:{}},
  get:async(n,id)=>rows[n].find(r=>r.id===id)??null,
  list:async(n,o)=>rows[n].filter(r=>Object.entries(o.where??{}).every(([k,v])=>r[k]===v)&&(!o.position||r.id>o.position.id)).slice(0,o.first)};
 const server=createChefServer({model,token:'relations-test-token-12345',store:{read:async fn=>{reads++;return fn({...view,...extra.view});}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const query=async(q)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/graphql`,{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer relations-test-token-12345'},body:JSON.stringify({query:q})});return {status:r.status,body:await r.json()};};
 return {query,rows,get reads(){return reads;}};
}
test('nested inverse/forward relations and nullable references execute within one read snapshot',async t=>{
 const f=await relationFixture(t);
 const r=await f.query('{ TxById(id:"t") { tags amounts inputs { id transaction { id } previous { valueZat addresses } } } }');
 assert.equal(r.status,200);assert.equal(f.reads,1);
 assert.deepEqual(r.body.data.TxById,{tags:['demo'],amounts:['9007199254740993',null],inputs:[{id:'i',transaction:{id:'t'},previous:{valueZat:'100000',addresses:['tExample']}},{id:'j',transaction:{id:'t'},previous:null}]});
 const filtered=await f.query('{ InputList(first:1,where:{transaction:"t"}) { items { id transaction { id } } nextCursor } }');
 assert.equal(filtered.status,200);assert.ok(filtered.body.data.InputList.nextCursor);
 const cursor=filtered.body.data.InputList.nextCursor;
 assert.deepEqual((await f.query(`{ InputList(first:1,where:{transaction:"t"},after:"${cursor}") { items { id } } }`)).body.data.InputList.items,[{id:'j'}]);
});
test('derived results fail explicitly instead of silently truncating, and cyclic fanout has a budget',async t=>{
 const f=await relationFixture(t);
 const r=await f.query('{ TxById(id:"t") { inputs(first:1) { id } } }');
 assert.equal(r.status,400);assert.equal(r.body.errors[0].extensions.code,'RELATION_LIMIT_EXCEEDED');
 assert.equal(r.body.errors[0].extensions.recovery,'QUERY_CHILD_LIST');
 assert.equal((await f.query('{ TxById(id:"t") { inputs(first:101) { id } } }')).status,400);
 assert.equal((await f.query('{ TxById(id:"t") { inputs { transaction { inputs { transaction { id } } } } } }')).status,400);
});
test('stored relation lists preserve nullable entries and refresh lookups on the next request',async t=>{
 const f=await relationFixture(t);
 let r=await f.query('{ TxById(id:"t") { favorites { id valueZat } } }');
 assert.equal(r.status,200);assert.deepEqual(r.body.data.TxById.favorites,[{id:'o',valueZat:'100000'},null,null]);
 f.rows.Output[0].valueZat='200000';
 r=await f.query('{ TxById(id:"t") { favorites { valueZat } } }');
 assert.equal(r.body.data.TxById.favorites[0].valueZat,'200000');
 assert.equal((await f.query('{ TxList(where:{favorites:["o"]}) { items { id } } }')).status,400);
});
test('wide relation fanout exhausts the request budget before unbounded reads',async t=>{
 let rows,childReads=0;
 const f=await relationFixture(t,{view:{list:async(n,o)=>{if(n==='Input')childReads++;return rows[n].filter(r=>Object.entries(o.where??{}).every(([k,v])=>r[k]===v)).slice(0,o.first);}}});rows=f.rows;
 f.rows.Tx.length=0;f.rows.Input.length=0;
 for(let i=0;i<100;i++){const id=`t${String(i).padStart(3,'0')}`;f.rows.Tx.push({id,tags:[],amounts:null});for(let j=0;j<6;j++)f.rows.Input.push({id:`${id}:${j}`,transaction:id,previous:null});}
 const r=await f.query('{ TxList(first:100) { items { inputs(first:6) { id } } } }');
 assert.equal(r.status,400);assert.equal(r.body.errors[0].extensions.code,'RELATION_LIMIT_EXCEEDED');
 assert.ok(childReads<=Math.floor(500/7),'row budget is reserved before issuing concurrent child reads');
});
