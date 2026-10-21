// Public, unfunded cryptographic fixture only. Never use this as a wallet.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {NativeReceiptSource} from '@zeer-dev/chef';
const run=promisify(execFile);process.umask(0o077);
const executable=resolve(process.env.ZEER_SCANNER_EXECUTABLE),fixture=JSON.parse(await fs.readFile(process.env.ZEER_PUBLIC_FIXTURE,'utf8'));
assert.match(fixture.warning,/PUBLIC UNFUNDED/);const directory=await fs.mkdtemp(resolve('fixture-run-'));
let source;
try{
 const key=join(directory,'fixture.ufvk');await fs.writeFile(key,fixture.ufvk,{mode:0o600});
 const profile=JSON.parse((await run(executable,['inspect-key','--key-file',key,'--account','fixture'],{timeout:10000})).stdout);
 source=new NativeReceiptSource({executable,keyFile:key,accountId:'fixture',keyFingerprint:profile.key_fingerprint});
 const q=fixture.request,receipts=await source.scan({block:{height:q.height,hash:'0'.repeat(64),previousHash:'0'.repeat(64),time:0},transaction:{txid:q.txid,raw:q.raw}});
 assert.deepEqual(receipts.map(r=>[r.pool,r.output_index,r.value_zat,r.scope]),fixture.expected);
 assert.equal(new Set(receipts.map(r=>r.id)).size,6);assert.ok(receipts.every(r=>r.origin==='unknown'));
 const installed=JSON.parse(await fs.readFile('node_modules/@zeer-dev/chef/package.json','utf8'));assert.equal(installed.version,'0.2.0');const packageRelative=relative(await fs.realpath('node_modules'),await fs.realpath('node_modules/@zeer-dev/chef'));assert.ok(packageRelative&&!isAbsolute(packageRelative)&&!packageRelative.split(/[\\/]/).includes('..'));
 const proof={passed:true,chef_version:installed.version,workspace_link:false,package_symlink:(await fs.lstat('node_modules/@zeer-dev/chef')).isSymbolicLink(),scanner_sha256:createHash('sha256').update(await fs.readFile(executable)).digest('hex'),fixture:'public-unfunded-placeholder-proofs-never-broadcast',pools:[...new Set(receipts.map(r=>r.pool))],notes:receipts.length,real_network_receipt:false,operator_viewing_key_loaded:false};
 await fs.writeFile('scanner-release-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}finally{await source?.close();await fs.rm(directory,{recursive:true,force:true});}
