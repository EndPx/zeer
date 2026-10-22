/** Counts independent processes against one hard cap; never paces or retries. */
export class RequestBudget {
  constructor({maxRequests=120, durationMs=120000, now=()=>performance.now()}={}) {
    Object.assign(this,{maxRequests,durationMs,now});
    this.started=now();this.active=0;this.peakActive=0;this.attempts=[];
  }
  async acquire(client,path) {
    this.check();
    if(this.attempts.length>=this.maxRequests)throw new Error('PUBLIC_REQUEST_BUDGET_EXHAUSTED');
    const id=this.attempts.length,started=this.now();this.active++;this.peakActive=Math.max(this.peakActive,this.active);
    this.attempts.push({id,client,path,started_seconds:(started-this.started)/1000});return id;
  }
  check(){if(this.now()-this.started>=this.durationMs)throw new Error('PUBLIC_PHASE_DEADLINE');}
  finish(id,result) {
    const row=this.attempts[id];
    if(!row||row.finished_seconds!==undefined)throw new Error('INVALID_TRANSPORT_LEASE');
    Object.assign(row,result,{finished_seconds:(this.now()-this.started)/1000});this.active--;
  }
}

/** Audits real HTTPS calls without substituting responses or adding retries. */
export function auditFetch({fetchImpl=globalThis.fetch,origin,coordinator,token,client}) {
  const base=new URL(origin);const control=new URL(coordinator);
  if(base.protocol!=='https:'||base.hostname!=='zeer.endpx.cloud'||base.pathname!=='/api/prep')throw new Error('PUBLIC_ORIGIN_REQUIRED');
  if(control.protocol!=='http:'||control.hostname!=='127.0.0.1')throw new Error('LOOPBACK_COORDINATOR_REQUIRED');
  async function rpc(path,body) {
    const response=await fetchImpl(new URL(path,control),{method:'POST',redirect:'error',signal:AbortSignal.timeout(310000),headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw new Error(result.error??'TRANSPORT_COORDINATOR_FAILED');return result;
  }
  return async(input,options={})=>{
    const url=new URL(input instanceof Request?input.url:input);
    if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname+'/'))return fetchImpl(input,options);
    if(new Headers(options.headers??(input instanceof Request?input.headers:undefined)).has('authorization'))throw new Error('PUBLIC_AUTH_HEADER_FORBIDDEN');
    if(!['/height','/query'].includes(url.pathname.slice(base.pathname.length)))throw new Error('PUBLIC_PATH_NOT_ALLOWED');
    const {id}=await rpc('/lease',{client,path:url.pathname});let finished=false;
    try {
      options.signal?.throwIfAborted();
      const response=await fetchImpl(input,{...options,redirect:'error'});
      const reader=response.body?.getReader();let bytes=0;const chunks=[];
      if(reader)for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8*1024*1024){await reader.cancel();throw new Error('PUBLIC_RESPONSE_LIMIT');}chunks.push(value);}
      const body=new Uint8Array(bytes);let at=0;for(const value of chunks){body.set(value,at);at+=value.length;}
      await rpc('/finish',{id,status:response.status,bytes,retry_after:response.headers.get('retry-after')});finished=true;
      return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
    }catch(error){if(!finished)await rpc('/finish',{id,status:0,error:error.name==='TimeoutError'?'TIMEOUT':error.name==='AbortError'?'ABORTED':'TRANSPORT_OR_BODY_FAILED'}).catch(()=>{});throw error;}
  };
}
