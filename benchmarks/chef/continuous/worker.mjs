// Run only from an isolated, registry-installed study directory. No viewing key.
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {PostgresStore,parseModel,syncStep,createChefServer} from '@zeer-dev/chef';
import {PrepClient} from '@zeer-dev/prep-client';
const config=JSON.parse(await readFile('study.json','utf8'));
const controller=new AbortController();let server,store;
const stop=()=>controller.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
try{
 const model=parseModel(await readFile('schema.graphql','utf8'));
 store=new PostgresStore(process.env.DATABASE_URL,{project:config.project,fingerprint:'continuous-public-v1',model,network:'testnet',startHeight:config.from,reorgWindow:100});
 if(process.argv[2]==='api'){
  server=createChefServer({store,model,token:process.env.CHEF_API_TOKEN});
  server.on('request',(req,res)=>res.once('finish',()=>emit({event:'http',path:req.url,status:res.statusCode})));
  await new Promise(r=>server.listen(config.port,'127.0.0.1',r));emit({event:'ready',role:'api'});
  await new Promise(r=>controller.signal.addEventListener('abort',r,{once:true}));
 }else{
  await store.migrate();
  await store.acquire();const prep=new PrepClient({url:process.env.PREP_URL,token:process.env.PREP_API_TOKEN,timeoutMs:15000});
  const indexer={async block({block,context}){for(let i=0;i<12;i++)await context.entities.set('BlockObservation',{id:`${block.height}:${i}`,blockHeight:block.height,blockHash:block.hash,observationIndex:i,value:BigInt(block.height)*12n+BigInt(i)});}};
  while(!controller.signal.aborted){
   const start=Date.now();try{
    const result=await syncStep({client:prep,store,indexer,network:'testnet',startHeight:config.from,reorgWindow:100,pageSize:64,batchSize:32,signal:controller.signal});emit({event:'sync',...result});
   }catch(error){if(controller.signal.aborted)break;emit({event:'source_error',code:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'SOURCE_FAILED',status:error.status??0});if(![429,409,500,502,503,504].includes(error.status??0))throw error;}
   await delay(Math.max(0,2000-(Date.now()-start)),undefined,{signal:controller.signal}).catch(()=>{});
  }
 }
}catch(error){if(!controller.signal.aborted){emit({event:'failure',code:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'WORKER_FAILED'});process.exitCode=1;}}
finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await store?.close();}
