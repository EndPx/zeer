import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeCursor,encodeCursor,queryShape,validateSelection,consumptionNames} from '../dist/consumption.js';
import {createChefServer} from '../dist/graphql.js';
import {parseModel} from '../dist/schema.js';
import {syncStep} from '../dist/runtime.js';

test('cursor identity survives restart and rejects generation, revision, shape, checkpoint and signing-key changes',()=>{
  const token='test-cursor-token';
  const state={project:'p',generation:'g',revision:'9007199254740993123',checkpoint:{height:1,hash:'hash',status:'ready'}};
  const shape=queryShape({entity:'Note',where:{b:2,a:1}});
  assert.equal(shape,queryShape({where:{a:1,b:2},entity:'Note'}));
  const cursor=encodeCursor(token,state,shape,{id:'a',value:1});
  assert.deepEqual(decodeCursor(token,cursor,structuredClone(state),shape),{id:'a',value:1});
  for(const modified of [{...state,project:'other'},{...state,generation:'new'},{...state,revision:'9007199254740993124'},{...state,checkpoint:{...state.checkpoint,hash:'fork'}}]) {
    assert.throws(()=>decodeCursor(token,cursor,modified,shape),{code:'CURSOR_INVALIDATED'});
  }
  for(const [key,c,s] of [['another-key',cursor,shape],[token,cursor,'changed'],[token,'a'.repeat(2049),shape],[token,cursor+'.',shape]]) assert.throws(()=>decodeCursor(key,c,state,s),{code:'CURSOR_INVALIDATED'});
});

test('ordered queries admit only indexed required Int fields and valid scalar bounds',()=>{
  const model=parseModel('type Note{id:ID! height:Int! @index optional:Int @index count:Int! amount:BigInt! @index}');
  validateSelection(model,'Note',{field:'height',gte:-2147483648,lte:2147483647},{field:'height',direction:'DESC'});
  for(const field of ['optional','count','amount','unknown']) assert.throws(()=>validateSelection(model,'Note',{field,gte:0}));
  for(const range of [{field:'height'},{field:'height',gte:NaN},{field:'height',lte:2147483648},{field:'height',gte:1,lte:0}]) assert.throws(()=>validateSelection(model,'Note',range));
  assert.throws(()=>validateSelection(model,'Note',undefined,{field:'amount',direction:'ASC'}));
  const legacy=parseModel('type Item{id:ID! height:Int! @index} type ItemOrder{id:ID!} type ItemRange{id:ID!} type ChefIntRange{id:ID!} type ChefOrderDirection{id:ID!}');
  const names=consumptionNames(legacy);assert.equal(names.entities.Item.order,'ItemOrder_1');assert.equal(names.bounds,'ChefIntRange_1');
  const server=createChefServer({store:{},model:legacy,token:'test-long-enough-token'});server.close();
});

test('follower caches existing height observations and clears them on source failure without extra RPC',async()=>{
  const observations=[];let reads=0,fail=false;
  const store={
    checkpoint:async()=>({height:null,hash:null,anchorHash:null,status:'ready'}),
    recordSourceObservation:async o=>observations.push(o),markReconciling:async()=>{},
  };
  const client={getHeight:async()=>{reads++;if(fail)throw new Error('offline');return {network:'testnet',payload_kind:'full-v1',ready:false,archive_height:null,indexed_height:null,source_height:12,source_observed_at:1700000000};}};
  const options={store,client,indexer:{},network:'testnet',startHeight:0,reorgWindow:3};
  assert.equal((await syncStep(options)).state,'source_unavailable');assert.equal(reads,1);
  assert.equal(observations.at(-1).status,'unavailable');
  fail=true;await assert.rejects(syncStep(options),/offline/);assert.equal(reads,2);
  assert.deepEqual(observations.at(-1),{status:'unavailable',prepIndexedHeight:null,sourceObservedHeight:null,sourceObservedAt:null});
});
