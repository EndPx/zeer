// Only instrumentation: timestamps after ordinary public Prep reads and commit acknowledgements.
import {PrepClient} from '@zeer-dev/prep-client';
import {PostgresStore} from '@zeer-dev/chef';
import {now} from './common.mjs';
const {main}=await import(new URL('./cli.js',import.meta.resolve('@zeer-dev/chef')));
const emit=value=>{if(process.connected)process.send({...value,clock_ns:now()});};
const command=process.argv[2],config=process.argv[3],extra=process.argv.slice(4);
if(command==='sync') {
  const original=PostgresStore.prototype.applyBatch;
  PostgresStore.prototype.applyBatch=async function(blocks,handler) {
    const result=await original.call(this,blocks,handler);
    const time=now();emit({kind:'commit',at_ns:time,blocks:blocks.map(b=>({height:b.height,hash:b.hash}))});return result;
  };
}
const prep=new PrepClient({url:process.env.PREP_URL,...(process.env.PREP_API_TOKEN?{token:process.env.PREP_API_TOKEN}:{})});
async function requested(operation,call){const start=now();try{const value=await call();emit({kind:'prep_request',operation,started_ns:start,at_ns:now(),status:200});return value;}
  catch(error){emit({kind:'prep_request',operation,started_ns:start,at_ns:now(),status:Number.isInteger(error.status)?error.status:0,code:typeof error.code==='string'?error.code:'TRANSPORT_ERROR'});throw error;}}
const client={
  getHeight:(...args)=>requested('height',()=>prep.getHeight(...args)),
  get:async(...args)=>{const page=await requested('query',()=>prep.get(...args)),time=now();emit({kind:'prep',at_ns:time,blocks:page.data.blocks.map(b=>({height:b.height,hash:b.hash}))});return page;},
};
try {
  await main([command,'--config',config,'--json',...extra],{client,write:text=>emit({kind:'cli',value:JSON.parse(text)})});
  emit({kind:'done'});process.disconnect();
} catch(error) {
  emit({kind:'failure',status:Number.isInteger(error.status)?error.status:null,code:typeof error.code==='string'&&/^[A-Z_0-9]+$/.test(error.code)?error.code:'WORKER_FAILED'});
  process.exitCode=1;if(process.connected)process.disconnect();
}
