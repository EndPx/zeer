import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';

async function bounded(promise,milliseconds){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Native source deadline')),milliseconds);})]);}
  finally{clearTimeout(timer);}
}
async function stopEntry(entry){
  if(!entry||entry.ended)return;
  const child=entry.child;entry.expectedStop=true;child.kill('SIGINT');
  try{await bounded(entry.done,10000);assert.equal(entry.code,0);}
  catch(error){if(!entry.ended){child.kill('SIGKILL');await bounded(entry.done,3000).catch(()=>{});}throw error;}
}

export class NativeSources {
  constructor({original,queued,archive,token,check,onFailure}){Object.assign(this,{binaries:{original,queued},archive,token,check,onFailure});this.servers=[];this.requests=[];this.startups=[];this.phase=null;}
  async open(){
    if(this.followConfig)await this.follow();
    for(const name of ['a','b']){
      const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
      this.servers.push({name,port,url:`http://127.0.0.1:${port}`,child:null});
    }
    await this.assign(0);
  }
  async follow(){
    const {url,user,password,from}=this.followConfig,started=performance.now();
    const entry={ended:false,expectedStop:false};this.follower=entry;
    entry.child=spawn(this.binaries.original,['sync','--source',url,'--network','testnet','--archive',this.archive,'--from',String(from),'--segment-blocks','16','--confirmations','1','--max-reorg-blocks','16','--max-disk-gib','1','--deadline-seconds','60','--allow-insecure','--follow','--compress','--poll-seconds','2'],{env:{...process.env,PREP_SOURCE_USER:user,PREP_SOURCE_PASSWORD:password},stdio:'ignore'});
    entry.done=new Promise(resolve=>{
      let settled=false;
      entry.child.once('exit',(code,signal)=>{if(settled)return;settled=true;entry.code=code;entry.signal=signal;entry.ended=true;if(!entry.expectedStop)this.onFailure('TAIL_FOLLOWER_EXIT');resolve();});
      entry.child.once('error',()=>{if(settled)return;settled=true;entry.code=-1;entry.ended=true;this.onFailure('TAIL_FOLLOWER_SPAWN');resolve();});
    });
    let ready=false;
    while(!ready&&performance.now()-started<60000){
      this.check();
      try{const status=JSON.parse(await readFile(join(this.archive,'status.json'),'utf8'));ready=status.ready===true&&status.indexed_height>=from+16;
        if(ready)this.followerInfo={from,initial_indexed_height:status.indexed_height,bootstrap_seconds:(performance.now()-started)/1000,confirmations:1,poll_seconds:2,max_reorg_blocks:16};
      }catch{}
      if(!ready)await sleep(100);
    }
    assert.ok(ready,'Bounded live-tail bootstrap deadline');
  }
  async closeFollower(){await stopEntry(this.follower);}
  async assign(phase){
    await this.close();
    for(let i=0;i<this.servers.length;i++){
      const server=this.servers[i],variant=(phase+i)%2===0?'original':'queued';server.variant=variant;
      const entry={ended:false,expectedStop:false};server.process=entry;
      entry.child=spawn(this.binaries[variant],['serve-http','--archive',this.archive,'--listen',`127.0.0.1:${server.port}`],{env:{...process.env,PREP_API_TOKEN:this.token},stdio:'ignore'});
      entry.done=new Promise(resolve=>{
        let settled=false;
        entry.child.once('exit',(code,signal)=>{if(settled)return;settled=true;entry.code=code;entry.signal=signal;entry.ended=true;if(!entry.expectedStop)this.onFailure('NATIVE_SOURCE_EXIT');resolve();});
        entry.child.once('error',()=>{if(settled)return;settled=true;entry.code=-1;entry.ended=true;this.onFailure('NATIVE_SOURCE_SPAWN');resolve();});
      });
      const began=performance.now(),until=began+120000;let healthy=false;
      while(!healthy&&performance.now()<until){this.check();try{const response=await fetch(server.url+'/health',{headers:{authorization:'Bearer '+this.token},signal:AbortSignal.timeout(1000)});await response.arrayBuffer();healthy=response.status===200;}catch{}if(!healthy)await sleep(50);}
      this.startups.push({phase,actor:server.name,variant,seconds:(performance.now()-began)/1000,healthy});
      assert.ok(healthy,'Native Prep readiness deadline');
    }
  }
  async close(){
    const results=await Promise.allSettled(this.servers.map(async server=>{
      // Capture this lifecycle. Crossover installs a different entry afterward.
      await stopEntry(server.process);
    }));
    if(results.some(r=>r.status==='rejected'))throw new Error('Native Prep shutdown failed');
  }
  load({phase,from,to,periodSeconds=2}){
    let stop=false,failure=false;const expected=new Map(),controller=new AbortController();
    const promise=(async()=>{
      while(!stop){this.check();const begin=performance.now();
        await Promise.all(this.servers.flatMap(server=>[0,1].map(async lane=>{
          const started=process.hrtime.bigint();let status=0,bytes=0,code;
          try{
            const response=await fetch(server.url+'/query',{method:'POST',headers:{authorization:'Bearer '+this.token,'content-type':'application/json'},body:JSON.stringify({from_block:from,to_block:to,limit:1000,field_selection:{block:['height','hash'],transaction:['txid','block_height','index','version','locktime']}}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5000)])});
            const raw=Buffer.from(await response.arrayBuffer());bytes=raw.length;assert.ok(bytes<=4*1024*1024);status=response.status;const body=JSON.parse(raw);
            if(status===200){assert.equal(body.cursor,null);assert.equal(body.next_block,to);assert.equal(body.data.blocks.length,to-from);
              const digest=createHash('sha256').update(JSON.stringify(body.data)).digest('hex');
              if(expected.has('data'))assert.equal(digest,expected.get('data'),'Background source outputs differ');else expected.set('data',digest);
            }else{assert.ok([429,503].includes(status),'Unexpected background source status');code=body.error?.code;}
          }catch(error){if(status&&![429,503].includes(status))this.onFailure('BACKGROUND_SOURCE_MISMATCH');code=code??'BACKGROUND_REQUEST_FAILED';}
          this.requests.push({phase,actor:server.name,variant:server.variant,lane,status,code,bytes,seconds:Number(process.hrtime.bigint()-started)/1e9});
        })));
        if(!stop)await sleep(Math.max(0,periodSeconds*1000-(performance.now()-begin)));
      }
    })().catch(()=>{failure=true;this.onFailure('BACKGROUND_LOAD_FAILED');});
    return {stop:async()=>{stop=true;try{await bounded(promise,8000);}catch{controller.abort();throw new Error('Background load stop deadline');}if(failure)throw new Error('Background load failed');}};
  }
}
