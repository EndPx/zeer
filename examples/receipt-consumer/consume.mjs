import {RangeConsumer,ConsumerError} from './consumer.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const args=process.argv.slice(2),flags=new Map();
const allowed=new Set(['--db','--from','--to','--project','--rounds','--interval-seconds','--deadline-seconds','--max-pages']);
try{
  for(let i=0;i<args.length;i++){
    const key=args[i],value=args[++i];
    if(!allowed.has(key)||flags.has(key)||value===undefined||value.startsWith('--'))throw new ConsumerError('INVALID_ARGUMENTS');
    flags.set(key,value);
  }
  const number=(key,fallback,min,max)=>{
    const text=flags.get(key)??String(fallback);
    if(!/^(0|[1-9][0-9]*)$/.test(text)||Number(text)<min||Number(text)>max)throw new ConsumerError('INVALID_ARGUMENTS');
    return Number(text);
  };
  if(!flags.has('--db')||!flags.has('--from')||!flags.has('--project'))throw new ConsumerError('USE_DB_FROM_PROJECT_FLAGS');
  const rounds=number('--rounds',1,1,3600),interval=number('--interval-seconds',2,1,30),deadline=number('--deadline-seconds',300,1,3600);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new ConsumerError('DEADLINE_EXCEEDED')),deadline*1000);
  const stop=()=>controller.abort(new ConsumerError('STOPPED'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);process.umask(0o077);
  let consumer;
  try{
    consumer=new RangeConsumer({file:flags.get('--db'),url:process.env.CHEF_URL??'http://127.0.0.1:39370',token:process.env.CHEF_API_TOKEN,
      project:flags.get('--project'),from:number('--from',undefined,0,2147483647),...(flags.has('--to')?{to:number('--to',undefined,0,2147483647)}:{}),
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
  const code=error instanceof ConsumerError?error.code:error?.name==='AbortError'?'STOPPED':'CONSUMER_FAILED';
  process.stderr.write(JSON.stringify({error:{code}})+'\n');process.exitCode=1;
}
