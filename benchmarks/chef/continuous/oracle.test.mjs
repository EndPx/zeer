import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyProjection} from './oracle.mjs';
const header={height:7,hash:'a'.repeat(64),previous_hash:'b'.repeat(64)},checkpoint={height:7,hash:header.hash};
const rows=()=>Array.from({length:12},(_,i)=>({id:`7:${i}`,blockHeight:7,blockHash:header.hash,observationIndex:i,value:String(84+i)})).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
test('exact expected row set rejects an out-of-domain replacement even at the correct total count',()=>{
 verifyProjection({headers:[header],rows:rows(),from:7,checkpoint});const bad=rows();bad[0]={id:'7:12',blockHeight:7,blockHash:header.hash,observationIndex:12,value:'96'};
 assert.throws(()=>verifyProjection({headers:[header],rows:bad,from:7,checkpoint}));
});
test('missing or repeated source heights cannot supply a complete reference',()=>{
 assert.throws(()=>verifyProjection({headers:[{...header,height:8}],rows:rows(),from:7,checkpoint}));
 assert.throws(()=>verifyProjection({headers:[header,header],rows:[...rows(),...rows()],from:7,checkpoint:{height:8,hash:header.hash}}));
});
