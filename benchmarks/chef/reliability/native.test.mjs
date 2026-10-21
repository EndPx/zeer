import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSources} from './native.mjs';

function fake(exit=0){
  let resolve;const entry={ended:false,code:null,signals:[],done:new Promise(r=>resolve=r)};
  entry.child={kill:signal=>{entry.signals.push(signal);entry.code=exit;entry.ended=true;resolve();}};
  return entry;
}
const sources=check=>new NativeSources({check:check??(()=>{}),onFailure:()=>{}});

test('completed shutdown cannot signal a crossover replacement later',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const original=fake(),next=fake(),native=sources();native.servers=[{process:original}];
  await native.close();native.servers[0].process=next;
  t.mock.timers.tick(10001);
  assert.deepEqual(original.signals,['SIGINT']);assert.deepEqual(next.signals,[]);
});

test('shutdown attempts every sibling before reporting a failed child',async()=>{
  const failed=fake(1),healthy=fake(),native=sources();native.servers=[{process:failed},{process:healthy}];
  await assert.rejects(native.close(),/shutdown failed/);
  assert.deepEqual(failed.signals,['SIGINT']);assert.deepEqual(healthy.signals,['SIGINT']);
});

test('background failure is handled at creation and reported through controlled cleanup',async()=>{
  const failures=[],unhandled=[];const listener=error=>unhandled.push(error);process.on('unhandledRejection',listener);
  try{
    const native=new NativeSources({check:()=>{throw new Error('deadline');},onFailure:code=>failures.push(code)});
    const load=native.load({phase:0,from:1,to:2});await new Promise(setImmediate);
    assert.deepEqual(unhandled,[]);assert.deepEqual(failures,['BACKGROUND_LOAD_FAILED']);
    await assert.rejects(load.stop(),/Background load failed/);
  }finally{process.off('unhandledRejection',listener);}
});
