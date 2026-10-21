import fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

export function safeFailure(error,stage){
 const safe=(value,pattern)=>typeof value==='string'&&pattern.test(value)?value:undefined;
 return {stage,code:safe(error?.code,/^[A-Z_0-9]+$/)??'UNKNOWN',name:safe(error?.name,/^[A-Za-z]+$/)??'Error',syscall:safe(error?.syscall,/^[a-z]+$/),...(Number.isSafeInteger(error?.errcode)?{sqliteCode:error.errcode}:{})};
}

// The last complete report remains visible until its successor is synced and
// renamed. A report is diagnostic evidence, never the consumer's checkpoint.
export async function writeReport(directory,value,{operations=fs,pause=delay,onRetry=()=>{}}={}){
 const names=(await operations.readdir(directory)).filter(snapshotName);
 if(names.length>=64)throw Object.assign(new Error('REPORT_RETENTION_LIMIT'),{code:'REPORT_RETENTION_LIMIT'});
 const body=JSON.stringify(value,null,2);if(Buffer.byteLength(body)>4*1024*1024)throw Object.assign(new Error('REPORT_SIZE_LIMIT'),{code:'REPORT_SIZE_LIMIT'});
 const temporary=join(directory,`.report-${randomUUID()}.tmp`),target=join(directory,`report-${process.hrtime.bigint().toString().padStart(20,'0')}-${randomUUID()}.json`);
 let stage='report_open';
 try{
  for(let attempt=0;;attempt++){
   let handle;
   try{
    stage='report_open';handle=await operations.open(temporary,'wx',0o600);
    stage='report_write';await handle.writeFile(body);
    stage='report_sync';await handle.sync();await handle.close();handle=null;
    stage='report_rename';await operations.rename(temporary,target);break;
   }catch(error){
    await handle?.close().catch(()=>{});await operations.unlink(temporary).catch(()=>{});
    if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt===4)throw error;
    onRetry({...safeFailure(error,stage),attempt});await pause(50*2**attempt);
   }
  }
 }catch(error){
  const failure=new Error('REPORT_WRITE_FAILED',{cause:error});failure.code='REPORT_WRITE_FAILED';failure.diagnostic=safeFailure(error,stage);throw failure;
 }finally{await operations.unlink(temporary).catch(()=>{});}
 // Readers can keep old immutable snapshots open. Cleanup failures never undo a
 // published successor; the hard retention bound prevents unlimited accumulation.
 const published=(await operations.readdir(directory)).filter(snapshotName).sort();
 for(const name of published.slice(0,-4))await operations.unlink(join(directory,name)).catch(error=>onRetry({...safeFailure(error,'report_gc'),attempt:0}));
}

const snapshotName=name=>/^report-[0-9]{20}-[a-f0-9-]{36}\.json$/.test(name);
export async function readLatestReport(directory,{operations=fs,pause=delay}={}){
 for(let attempt=0;attempt<4;attempt++){
  const name=(await operations.readdir(directory)).filter(snapshotName).sort().at(-1);
  if(!name)throw Object.assign(new Error('REPORT_UNAVAILABLE'),{code:'REPORT_UNAVAILABLE'});
  try{return JSON.parse(await operations.readFile(join(directory,name),'utf8'));}
  catch(error){if(error.code!=='ENOENT'||attempt===3)throw error;await pause(20);}
 }
}
