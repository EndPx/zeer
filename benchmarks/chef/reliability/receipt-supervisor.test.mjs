import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('independent deadline terminates a stalled observer and its grandchild',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'zeer-supervisor-'));
 await writeFile(join(directory,'.env'),'');
 await writeFile(join(directory,'receipt-live.mjs'),`import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});writeFileSync('pids.json',JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
 const child=spawn(process.execPath,[fileURLToPath(new URL('./receipt-supervisor.mjs',import.meta.url))],{cwd:directory,env:{...process.env,STUDY_DIRECTORY:directory,STUDY_DEADLINE_SECONDS:'2'},windowsHide:true,stdio:'ignore'});
 const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});assert.equal(code,1);
 const proof=JSON.parse(await readFile(join(directory,'supervision.json'),'utf8'));assert.equal(proof.forced,true);assert.equal(proof.outcome,'INCOMPLETE_DEADLINE');assert.equal(proof.deadline_seconds,2);
 for(const pid of JSON.parse(await readFile(join(directory,'pids.json'),'utf8')))assert.throws(()=>process.kill(pid,0));
});
