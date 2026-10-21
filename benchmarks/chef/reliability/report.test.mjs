import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeReport,readLatestReport,safeFailure} from './report.mjs';
async function fixture(){const root=await fs.mkdtemp(join(tmpdir(),'zeer-report-'));await writeReport(root,{revision:1});return root;}
test('transient replacement failure retains the complete report and retries only a complete successor',async()=>{
 const root=await fixture(),events=[];let attempts=0;
 await writeReport(root,{revision:2},{pause:async()=>{},onRetry:event=>events.push(event),operations:{...fs,rename:async(...args)=>{
  assert.equal((await readLatestReport(root)).revision,1);
  if(++attempts<=2)throw Object.assign(new Error('private payload must not be logged'),{code:'EBUSY',syscall:'rename'});return fs.rename(...args);
 }}});
 assert.equal((await readLatestReport(root)).revision,2);assert.equal(events.length,2);assert.ok(events.every(e=>e.stage==='report_rename'&&!JSON.stringify(e).includes('private payload')));
 assert.equal((await fs.readdir(root)).filter(name=>name.endsWith('.tmp')).length,0);
});
test('disk-full and exhausted replacement errors preserve the previous report with actionable safe diagnostics',async()=>{
 for(const code of ['ENOSPC','EACCES']){
  const root=await fixture();let attempts=0;
  const operations={...fs,...(code==='ENOSPC'?{open:async()=>{attempts++;throw Object.assign(new Error('SECRET'),{code,syscall:'open'});}}:{rename:async()=>{attempts++;throw Object.assign(new Error('SECRET'),{code,syscall:'rename'});}})};
  await assert.rejects(writeReport(root,{revision:2},{operations,pause:async()=>{}}),error=>{assert.equal(error.code,'REPORT_WRITE_FAILED');assert.equal(error.diagnostic.code,code);assert.ok(!JSON.stringify(error.diagnostic).includes('SECRET'));return true;});
  assert.equal(attempts,code==='ENOSPC'?1:5);assert.equal((await readLatestReport(root)).revision,1);assert.equal((await fs.readdir(root)).length,1);
 }
});
test('actual concurrent readers see complete JSON during atomic replacement',async()=>{
 const root=await fixture();let stop=false,reads=0;const reader=(async()=>{while(!stop){const value=await readLatestReport(root);assert.ok(Number.isInteger(value.revision));reads++;}})();
 try{for(let revision=2;revision<=40;revision++)await writeReport(root,{revision,padding:'x'.repeat(4096)});}finally{stop=true;await reader;}
 assert.ok(reads>0);assert.equal((await readLatestReport(root)).revision,40);assert.ok((await fs.readdir(root)).length<=5);
});
test('safe errors expose stage and codes without messages, paths, query text or note fields',()=>{
 assert.deepEqual(safeFailure({name:'Error',code:'ERR_SQLITE_ERROR',errcode:8,message:'seed and note content',path:'private'},'consumer_commit'),{stage:'consumer_commit',code:'ERR_SQLITE_ERROR',name:'Error',syscall:undefined,sqliteCode:8});
});
