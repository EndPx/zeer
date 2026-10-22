import assert from 'node:assert/strict';
import {readFile,realpath,unlink} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function installedPrep(directory=process.cwd()) {
 const base=await realpath(resolve(directory,'node_modules'));
 const pkg=await realpath(resolve(directory,'node_modules/@zeer-dev/prep-client'));
 const rel=relative(base,pkg);
 assert.ok(rel&&!isAbsolute(rel)&&!rel.split(/[\\/]/).includes('..'),'WORKSPACE_CLIENT_FORBIDDEN');
 const manifest=JSON.parse(await readFile(join(pkg,'package.json'),'utf8'));
 assert.equal(manifest.name,'@zeer-dev/prep-client');assert.equal(manifest.version,'0.1.0');
 assert.equal(manifest.exports['.'].import,'./src/index.js');
 return import(pathToFileURL(join(pkg,'src/index.js')).href);
}
export function stopped(child) {return !child||child.exitCode!==null||child.signalCode!==null;}
export async function removeFile(file) {try{await unlink(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
/** Attempt every cleanup step and retain the original failure if there was one. */
export async function cleanup(tasks,failure) {
 for(const task of tasks)try{await task();}catch(error){failure??=error;}
 return failure;
}
