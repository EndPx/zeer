import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,lstatSync,openSync,closeSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';

export class ConsumerError extends Error {
  constructor(code){super(code);this.code=code;}
}
const requireValue=(ok,code)=>{if(!ok)throw new ConsumerError(code);};
const integer=value=>Number.isInteger(value)&&value>=0&&value<=2147483647;
const name=value=>typeof value==='string'&&/^[_A-Za-z][_0-9A-Za-z]{0,63}$/.test(value)&&!value.startsWith('__');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const revision=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value);
const compare=(a,b)=>a.height-b.height||Buffer.compare(Buffer.from(a.id),Buffer.from(b.id));
const defaultFields=['id','txid','pool','outputIndex','blockHeight','blockHash','valueZat','receiver','memoHex','memoKind','memoText','scope','origin','coinbase'];

/** A bounded, reversible local projection. Completing a sweep replaces the range. */
export class RangeConsumer {
  constructor({file,url,token,project,from,to,entity='ReadableNote',heightField='blockHeight',fields=defaultFields,pageSize=25,maxRange=1000,maxRows=10000,maxAgeSeconds=30,fetchImpl=fetch,onPage=()=>{}}){
    const endpoint=new URL(url);
    requireValue(/^https?:$/.test(endpoint.protocol)&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash,'INVALID_ENDPOINT');
    requireValue(endpoint.protocol==='https:'||['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname),'HTTPS_OR_LOOPBACK_REQUIRED');
    requireValue(endpoint.pathname==='/'||endpoint.pathname==='','ENDPOINT_MUST_BE_ORIGIN');
    requireValue(typeof token==='string'&&Buffer.byteLength(token)>=16&&Buffer.byteLength(token)<=4096&&!/[\r\n]/.test(token),'INVALID_API_TOKEN');
    requireValue(typeof project==='string'&&/^[a-z][a-z0-9_]{0,31}$/.test(project),'INVALID_PROJECT');
    requireValue(integer(from)&&(to===undefined||integer(to)&&to>=from),'INVALID_RANGE');
    requireValue(integer(maxRange)&&maxRange>=1&&maxRange<=1000&&integer(maxRows)&&maxRows>=1&&maxRows<=100000,'INVALID_BUDGET');
    requireValue(integer(pageSize)&&pageSize>=1&&pageSize<=100&&Number.isFinite(maxAgeSeconds)&&maxAgeSeconds>=1&&maxAgeSeconds<=120,'INVALID_LIMIT');
    requireValue(name(entity)&&name(heightField)&&heightField!=='id'&&Array.isArray(fields)&&fields.length<=24&&fields.every(name),'INVALID_FIELDS');
    fields=[...new Set(['id',heightField,...fields])].sort();
    requireValue(fields.length<=24,'INVALID_FIELDS');
    mkdirSync(dirname(file),{recursive:true,mode:0o700});
    const existing=existsSync(file);
    requireValue(!existing||lstatSync(file).isFile()&&!lstatSync(file).isSymbolicLink(),'INVALID_DATABASE_FILE');
    const fd=openSync(file,'a',0o600);closeSync(fd);
    this.db=new DatabaseSync(file);
    if(existing&&this.db.prepare('PRAGMA application_id').get().application_id!==0x5a454552){this.db.close();throw new ConsumerError('UNMARKED_DATABASE');}
    if(!existing)this.db.exec(`PRAGMA application_id=${0x5a454552}`);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL,identity TEXT NOT NULL,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS staging(id TEXT PRIMARY KEY,height INTEGER NOT NULL,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,height INTEGER NOT NULL,payload TEXT NOT NULL)');
    this.options={url:endpoint.origin,token,project,from,to,entity,heightField,fields,pageSize,maxRange,maxRows,maxAgeSeconds};
    this.fetch=fetchImpl;this.onPage=onPage;this.busy=false;
    const identity=createHash('sha256').update(JSON.stringify({url:endpoint.origin,project,from,to:to??null,entity,heightField,fields,maxRange,maxRows})).digest('hex');
    this.db.prepare('INSERT OR IGNORE INTO state VALUES(1,0,?,?)').run(identity,JSON.stringify({scan:null,complete:null}));
    if(this.db.prepare('SELECT identity FROM state WHERE singleton=1').get().identity!==identity){this.db.close();throw new ConsumerError('CONSUMER_IDENTITY_MISMATCH');}
  }
  state(){const row=this.db.prepare('SELECT version,payload FROM state WHERE singleton=1').get();return {version:row.version,...JSON.parse(row.payload)};}
  update(expected,change){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const current=this.state();requireValue(current.version===expected,'CONSUMER_BUSY');
      const next=change(current);
      this.db.prepare('UPDATE state SET version=version+1,payload=? WHERE singleton=1').run(JSON.stringify({scan:next.scan,complete:next.complete}));
      this.db.exec('COMMIT');return this.state();
    }catch(error){try{this.db.exec('ROLLBACK');}catch{/* SQLite may already have rolled the transaction back. */}throw error;}
  }
  reset(current){return this.update(current.version,state=>{this.db.exec('DELETE FROM staging');return {...state,scan:null};});}
  async request(path,payload,signal){
    const timeout=AbortSignal.timeout(5000);
    let response;
    try{response=await this.fetch(this.options.url+path,{method:payload?'POST':'GET',headers:{authorization:`Bearer ${this.options.token}`,...(payload?{'content-type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout});}
    catch{if(signal?.aborted)throw signal.reason;return {wait:'TRANSPORT_UNAVAILABLE'};}
    let value;
    try{
      const reader=response.body.getReader();let size=0;const chunks=[];
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw new ConsumerError('RESPONSE_TOO_LARGE');}chunks.push(value);}}
      finally{reader.releaseLock();}
      value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch(error){if(error instanceof ConsumerError)throw error;if(signal?.aborted)throw signal.reason;return {wait:'RESPONSE_UNAVAILABLE'};}
    if(response.status===401||response.status===403)throw new ConsumerError('API_UNAUTHORIZED');
    if(response.status===409&&value.errors?.[0]?.extensions?.code==='CURSOR_INVALIDATED')return {invalidated:true};
    if(response.status===429||response.status>=500)return {wait:`HTTP_${response.status}`};
    requireValue(response.status===200,'API_PROTOCOL_ERROR');return {value};
  }
  fresh(status){
    requireValue(status&&status.project===this.options.project,'PROJECT_IDENTITY_CHANGED');
    requireValue(typeof status.generation==='string'&&status.generation.length>0&&revision(status.revision),'INVALID_STATUS');
    const cp=status.checkpoint;
    requireValue(cp&&['ready','reconciling','blocked'].includes(cp.status),'INVALID_STATUS');
    if(cp.status!=='ready')return 'INDEXER_'+cp.status.toUpperCase();
    const source=status.source,now=Date.now(),age=this.options.maxAgeSeconds*1000;
    if(source?.status!=='available'||!integer(source.prepIndexedHeight)||!integer(source.sourceObservedHeight)||!Number.isSafeInteger(source.sourceObservedAt))return 'SOURCE_UNKNOWN_OR_UNAVAILABLE';
    const checked=Date.parse(source.checkedAt),observed=source.sourceObservedAt*1000;
    if(!Number.isFinite(checked)||checked>now+60000||observed>now+60000||now-checked>age||now-observed>age)return 'SOURCE_OBSERVATION_STALE';
    if(!integer(cp.height)||!hash(cp.hash)||cp.height<this.options.from)return 'INDEXER_BEHIND';
    return null;
  }
  async step({maxPages=20,signal}={}){
    requireValue(!this.busy,'CONSUMER_BUSY');requireValue(integer(maxPages)&&maxPages>=1&&maxPages<=100,'INVALID_PAGE_BUDGET');
    this.busy=true;
    try{
      const statusResponse=await this.request('/status',undefined,signal);if(statusResponse.wait)return {state:'waiting',reason:statusResponse.wait};
      requireValue(statusResponse.value,'INVALID_STATUS');const status=statusResponse.value,wait=this.fresh(status);
      if(wait)return {state:'waiting',reason:wait};
      let current=this.state();
      if(current.complete)requireValue(current.complete.generation===status.generation,'PROJECT_GENERATION_CHANGED');
      if(current.scan)requireValue(current.scan.generation===status.generation,'PROJECT_GENERATION_CHANGED');
      if(!current.scan){
        const target=this.options.to??status.checkpoint.height;
        if(target>status.checkpoint.height)return {state:'waiting',reason:'INDEXER_BEHIND'};
        const end=Math.max(target,current.complete?.to??target);
        requireValue(end-this.options.from+1<=this.options.maxRange,'WATCHED_RANGE_LIMIT');
        if(current.complete?.revision===status.revision&&current.complete.to===end)return {state:'unchanged',revision:status.revision};
        current=this.update(current.version,state=>{this.db.exec('DELETE FROM staging');return {...state,scan:{to:end,generation:status.generation,revision:status.revision,checkpoint:status.checkpoint,after:null,last:null,pages:0}};});
      }
      for(let page=0;page<maxPages;page++){
        signal?.throwIfAborted();const scan=current.scan;
        const {entity,heightField,fields,from,pageSize}=this.options;
        const query=`query Page($after:ID){ ${entity}List(first:${pageSize},after:$after,range:{${heightField}:{gte:${from},lte:${scan.to}}},orderBy:[{${heightField}:ASC},{id:ASC}]){items{${fields.join(' ')}}nextCursor} _meta{project generation revision height hash status} }`;
        const response=await this.request('/graphql',{query,variables:{after:scan.after}},signal);
        if(response.wait)return {state:'waiting',reason:response.wait};
        if(response.invalidated){this.reset(current);return {state:'restarting',reason:'CURSOR_INVALIDATED'};}
        const result=response.value;requireValue(result&&!result.errors&&result.data,'INVALID_PAGE');
        const meta=result.data._meta;
        requireValue(meta?.project===this.options.project&&meta.status==='ready'&&meta.generation===scan.generation&&revision(meta.revision)&&integer(meta.height)&&hash(meta.hash),'INVALID_PAGE_METADATA');
        if(meta.revision!==scan.revision||meta.height!==scan.checkpoint.height||meta.hash!==scan.checkpoint.hash){this.reset(current);return {state:'restarting',reason:'REVISION_CHANGED'};}
        const rows=result.data[`${entity}List`];requireValue(rows&&Array.isArray(rows.items)&&rows.items.length<=pageSize,'INVALID_PAGE');
        const after=rows.nextCursor;requireValue(after===null||typeof after==='string'&&after.length>0&&after.length<=2048&&rows.items.length>0&&after!==scan.after,'INVALID_CURSOR');
        if(after===null){
          const latest=await this.request('/status',undefined,signal);if(latest.wait)return {state:'waiting',reason:latest.wait};
          const stale=this.fresh(latest.value);if(stale)return {state:'waiting',reason:stale};
          requireValue(latest.value.generation===scan.generation,'PROJECT_GENERATION_CHANGED');
          if(latest.value.revision!==scan.revision||latest.value.checkpoint.height!==scan.checkpoint.height||latest.value.checkpoint.hash!==scan.checkpoint.hash){this.reset(current);return {state:'restarting',reason:'REVISION_CHANGED'};}
        }
        let last=scan.last;
        for(const row of rows.items){
          requireValue(row&&typeof row.id==='string'&&row.id.length>0&&!row.id.includes('\0')&&Buffer.byteLength(row.id)<=256&&integer(row[heightField])&&row[heightField]>=from&&row[heightField]<=scan.to&&Buffer.byteLength(JSON.stringify(row))<=32768,'INVALID_ENTITY');
          const key={id:row.id,height:row[heightField]};requireValue(last===null||compare(key,last)>0,'INVALID_PAGE_ORDER');last=key;
        }
        current=this.update(current.version,state=>{
          const put=this.db.prepare('INSERT INTO staging VALUES(?,?,?)');
          for(const row of rows.items)put.run(row.id,row[heightField],JSON.stringify(row));
          const count=this.db.prepare('SELECT count(*) AS count FROM staging').get().count;requireValue(count<=this.options.maxRows,'ROW_LIMIT');
          if(after!==null)return {...state,scan:{...scan,after,last,pages:scan.pages+1}};
          // An incomplete scan never mutates the visible projection. Removal and
          // replacement happen atomically only on the final compatible page.
          this.db.prepare('DELETE FROM entities WHERE height>=? AND height<=?').run(from,scan.to);
          this.db.exec('INSERT INTO entities SELECT * FROM staging; DELETE FROM staging');
          return {scan:null,complete:{from,to:scan.to,generation:scan.generation,revision:scan.revision,checkpoint:scan.checkpoint,count,observedAt:new Date().toISOString()}};
        });
        await this.onPage({state:current.scan?'staged':'complete',pages:scan.pages+1,count:rows.items.length,revision:scan.revision});
        if(!current.scan)return {state:'complete',...current.complete};
      }
      return {state:'paused',pages:current.scan.pages};
    }finally{this.busy=false;}
  }
  rows(){return this.db.prepare('SELECT payload FROM entities ORDER BY height,id COLLATE BINARY').all().map(row=>JSON.parse(row.payload));}
  close(){requireValue(!this.busy,'CONSUMER_BUSY');this.db.close();}
}
