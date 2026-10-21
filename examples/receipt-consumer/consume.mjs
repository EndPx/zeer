import {RangeConsumer,ContinuousConsumer,ConsumerError} from './consumer.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const args=process.argv.slice(2),flags=new Map();
const allowed=new Set(['--db','--from','--to','--project','--rounds','--interval-seconds','--deadline-seconds','--max-pages','--mode','--follow','--window-blocks','--max-rows','--max-total-rows','--page-size','--entity','--height-field','--fields']);
try{
  for(let i=0;i<args.length;i++){
    const key=args[i],value=key==='--follow'?'true':args[++i];
    if(!allowed.has(key)||flags.has(key)||value===undefined||value.startsWith('--'))throw new ConsumerError('INVALID_ARGUMENTS');
    flags.set(key,value);
  }
  const number=(key,fallback,min,max)=>{
    const text=flags.get(key)??String(fallback);
    if(!/^(0|[1-9][0-9]*)$/.test(text)||Number(text)<min||Number(text)>max)throw new ConsumerError('INVALID_ARGUMENTS');
    return Number(text);
  };
  if(!flags.has('--db')||!flags.has('--from')||!flags.has('--project'))throw new ConsumerError('USE_DB_FROM_PROJECT_FLAGS');
  const mode=flags.get('--mode')??'range',follow=flags.has('--follow');
  if(!['range','continuous'].includes(mode)||follow&&(mode!=='continuous'||flags.has('--rounds')))throw new ConsumerError('INVALID_MODE');
  const rounds=follow?Infinity:number('--rounds',1,1,100000),interval=number('--interval-seconds',2,1,30),deadline=follow&&!flags.has('--deadline-seconds')?null:number('--deadline-seconds',300,1,86400);
  const controller=new AbortController(),timer=deadline===null?undefined:setTimeout(()=>controller.abort(new ConsumerError('DEADLINE_EXCEEDED')),deadline*1000);
  const stop=()=>controller.abort(new ConsumerError('STOPPED'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);process.umask(0o077);
  let consumer;
  try{
    const Consumer=mode==='continuous'?ContinuousConsumer:RangeConsumer;
    consumer=new Consumer({file:flags.get('--db'),url:process.env.CHEF_URL??'http://127.0.0.1:39370',token:process.env.CHEF_API_TOKEN,
      project:flags.get('--project'),from:number('--from',undefined,0,2147483647),...(flags.has('--to')?{to:number('--to',undefined,0,2147483647)}:{}),
      maxRange:number('--window-blocks',1000,1,1000),maxRows:number('--max-rows',10000,1,100000),maxTotalRows:number('--max-total-rows',100000,1,1000000),pageSize:number('--page-size',25,1,100),
      ...(flags.has('--entity')?{entity:flags.get('--entity')}:{}),...(flags.has('--height-field')?{heightField:flags.get('--height-field')}:{}),...(flags.has('--fields')?{fields:flags.get('--fields').split(',')}:{}),
      onPage:async page=>process.stdout.write(JSON.stringify({event:'page',...page})+'\n')});
    let last;
    for(let round=0;round<rounds;round++){
      controller.signal.throwIfAborted();
      const result=await consumer.step({maxPages:number('--max-pages',20,1,100),signal:controller.signal});last=result;
      process.stdout.write(JSON.stringify(result)+'\n');
      if(round+1<rounds)await delay(interval*1000,undefined,{signal:controller.signal});
    }
    if(!['complete','unchanged'].includes(last?.state))process.exitCode=2;
  }finally{
    clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);consumer?.close();
  }
}catch(error){
  // Never echo network bodies, URLs, keys or private note fields.
  if(error?.name==='AbortError'&&error.cause instanceof ConsumerError)error=error.cause;
  const code=error instanceof ConsumerError?error.code:error?.name==='AbortError'?'STOPPED':'CONSUMER_FAILED';
  const nativeCode=typeof error?.code==='string'&&/^[A-Z_0-9]+$/.test(error.code)?error.code:undefined;
  const sqliteCode=Number.isSafeInteger(error?.errcode)?error.errcode:undefined;
  process.stderr.write(JSON.stringify({error:{code,nativeCode,sqliteCode,stage:'consumer'}})+'\n');process.exitCode=code==='STOPPED'?0:code==='DEADLINE_EXCEEDED'?2:1;
}
