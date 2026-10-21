// Independent Windows process-tree deadline for the local live-receipt study.
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
assert.equal(process.platform,'win32');
const out=process.env.STUDY_DIRECTORY;assert.ok(out);
const deadlineSeconds=Number(process.env.STUDY_DEADLINE_SECONDS??2400);assert.ok(Number.isInteger(deadlineSeconds)&&deadlineSeconds>=1&&deadlineSeconds<=2400);
const started=new Date().toISOString();let forced=false;
const child=spawn(process.execPath,['--env-file=.env','receipt-live.mjs'],{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:'inherit'});
const timer=setTimeout(()=>{forced=true;if(child.exitCode===null&&child.signalCode===null){const kill=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.on('error',()=>{process.exitCode=1;});}},deadlineSeconds*1000);
const exit=await new Promise((resolve,reject)=>{child.once('exit',(code,signal)=>resolve({code,signal}));child.once('error',reject);});clearTimeout(timer);
await writeFile(join(out,'supervision.json'),JSON.stringify({started_at_utc:started,finished_at_utc:new Date().toISOString(),deadline_seconds:deadlineSeconds,forced,outcome:forced?'INCOMPLETE_DEADLINE':'EXITED',exit},null,2));
process.exitCode=forced||exit.code!==0?1:0;
