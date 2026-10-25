import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createChefServer,parseModel,artifactIdentity} from '../dist/index.js';

test('authenticated cached status identifies the serving artifact while the read gate is blocked',async t=>{
 const snapshot={project:'operator_test',generation:'generation',revision:'8',checkpoint:{height:10,hash:'a'.repeat(64),anchorHash:null,status:'blocked'},lastCommitAt:null,source:{status:'unavailable',checkedAt:null,prepIndexedHeight:null,sourceObservedHeight:null,sourceObservedAt:null}};
 let reads=0;
 const server=createChefServer({model:parseModel('type Item{id:ID!}'),token:'operator-status-token',store:{
  async consumptionStatus(){reads++;return structuredClone(snapshot);},
  async read(){assert.fail('Status must bypass entity reads without contacting a source');},
 }});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const url=`http://127.0.0.1:${server.address().port}/status`;
 assert.equal((await fetch(url)).status,401);assert.equal(reads,0);
 const response=await fetch(url,{headers:{authorization:'Bearer operator-status-token'}});
 assert.equal(response.status,200);const value=await response.json();
 assert.deepEqual(value,{...snapshot,artifact:artifactIdentity()});assert.equal(reads,1);
 assert.equal(value.artifact.packageName,'@zeer-dev/chef');
});
