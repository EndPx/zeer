import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'graphql';
import {demoQueryError} from '../src/lib/chef-demo-validation.ts';
import {chefExampleQuery,chefExampleCursor,chefResponseEmpty} from '../src/lib/chef-pagination.ts';
const project='hackathon_testnet_20261020';
const response=cursor=>({data:{BlockSummaryList:{items:[{height:4510000}],nextCursor:cursor}}});
test('known demo schema explains a field typo while custom schemas remain authoritative',()=>{
 const document=parse('{ BlockSummaryList(first:3) { items { heigth } } }');
 assert.match(demoQueryError(document,project),/heigth.*height.*Restore the example/s);
 assert.equal(demoQueryError(document,'custom_app'),null);
 assert.equal(demoQueryError(document),null);
 for(const q of [chefExampleQuery(),'{ BlockSummaryById(id:"4515166") { id height hash time transactionCount } _meta { height hash anchorHash status } }','{ BlockSummaryList(first:10,where:{height:4515166}) { items { id } nextCursor } }']) assert.equal(demoQueryError(parse(q),project),null);
});
test('example continuation uses an escaped cursor and leaves custom queries alone',()=>{
 const cursor='4510002';
 assert.equal(chefExampleCursor(chefExampleQuery(),response(cursor)),cursor);
 assert.equal(chefExampleCursor(chefExampleQuery(cursor),response('4510005'),cursor),'4510005');
 assert.equal(chefExampleCursor('{ _meta { height } }',response(cursor)),null);
 assert.equal(chefExampleCursor(chefExampleQuery().replace('first: 3','first: 20'),response(cursor)),null);
 assert.equal(chefExampleCursor(chefExampleQuery(cursor)+'\n# edited',response('4510005'),cursor),null);
 const tricky='id"\\\n';assert.doesNotThrow(()=>parse(chefExampleQuery(tricky)));
});
test('missing or malformed continuations never produce a next-page action',()=>{
 for(const r of [undefined,null,{}, {data:null},{errors:[{}]},response(null),response(''),response('x'.repeat(257)),response(123)]) assert.equal(chefExampleCursor(chefExampleQuery(),r),null);
});
test('empty entities get guidance without treating metadata, failures or populated results as empty',()=>{
 assert.equal(chefResponseEmpty({data:{BlockSummaryById:null,_meta:{height:4519999}}}),true);
 assert.equal(chefResponseEmpty({data:{BlockSummaryList:{items:[],nextCursor:null}}}),true);
 for(const data of [null,{}, {data:{_meta:{height:4519999}}},response('4510002'),{errors:[{message:'unavailable'}],data:{BlockSummaryById:null}},{data:{a:null,b:{height:4510000}}}]) assert.equal(chefResponseEmpty(data),false);
});
