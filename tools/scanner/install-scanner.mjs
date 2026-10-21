#!/usr/bin/env node
// No dependencies, key handling, shell execution or package installation.
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const release={tag:'scanner-v0.1.0-testnet.1',scanner_version:'0.1.0',protocol_version:1,chef_versions:['0.2.0'],target:'x86_64-unknown-linux-gnu',asset:'zeer-scanner-linux-x64',bytes:1750872,sha256:'1a24bcc9f066466ec9dab902b21d8619c8a4a5fffdd1a2c2d8fc099b3fa6b00c'};
class InstallError extends Error {constructor(code){super(code);this.code=code;}}
const check=(value,code)=>{if(!value)throw new InstallError(code);};
export function verifyBytes(bytes,expected=release){check(bytes.length===expected.bytes,'SCANNER_SIZE_MISMATCH');check(createHash('sha256').update(bytes).digest('hex')===expected.sha256,'SCANNER_CHECKSUM_MISMATCH');}
export const ownerOnly=(info,uid,mask=0o077)=>info.uid===uid&&(info.mode&mask)===0;
export function validateCapabilities(value){
 check(value?.protocol_version===release.protocol_version,'SCANNER_PROTOCOL_MISMATCH');
 check(value.scanner_version===release.scanner_version&&value.network==='testnet'&&value.watch_only===true&&value.stateless===true&&value.key_file_required===true&&value.max_frame_bytes===4100000&&JSON.stringify(value.pools)===JSON.stringify(['sapling','orchard','ironwood']),'SCANNER_CAPABILITIES_MISMATCH');
 return value;
}
async function download(){
 let url=`https://github.com/EndPx/zeer/releases/download/${release.tag}/${release.asset}`;
 const signal=AbortSignal.timeout(120000);
 for(let redirect=0;redirect<4;redirect++){
  const parsed=new URL(url);check(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&['github.com','release-assets.githubusercontent.com'].includes(parsed.hostname),'UNTRUSTED_DOWNLOAD_URL');
  const response=await fetch(url,{redirect:'manual',signal});
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();check(location,'DOWNLOAD_REDIRECT_INVALID');url=new URL(location,url).href;continue;}
  check(response.status===200,'SCANNER_DOWNLOAD_FAILED');const chunks=[];let size=0;
  const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>release.bytes){await reader.cancel();throw new InstallError('SCANNER_SIZE_MISMATCH');}chunks.push(value);}}finally{reader.releaseLock();}
  return Buffer.concat(chunks);
 }
 throw new InstallError('DOWNLOAD_REDIRECT_LIMIT');
}
async function capabilities(file){
 return await new Promise((yes,no)=>{
  const child=spawn(file,['capabilities'],{windowsHide:true,shell:false,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let output='',failed=false;
  const timer=setTimeout(()=>{failed=true;child.kill('SIGKILL');},5000);child.stderr.resume();
  child.stdout.on('data',v=>{output+=v;if(output.length>16384){failed=true;child.kill('SIGKILL');}});
  child.once('error',()=>{clearTimeout(timer);no(new InstallError('SCANNER_EXECUTION_FAILED'));});
  child.once('exit',code=>{clearTimeout(timer);try{check(!failed&&code===0,'SCANNER_EXECUTION_FAILED');yes(validateCapabilities(JSON.parse(output)));}catch(error){no(error instanceof InstallError?error:new InstallError('SCANNER_INVALID_CAPABILITIES'));}});
 });
}
export async function main(args=process.argv.slice(2)){
 if(args.length===1&&args[0]==='--help'){console.log('node install-scanner.mjs [--dir DIRECTORY] [--file DOWNLOADED_BINARY]\nLinux/WSL2 x64 with glibc and Node24.14+. Verifies pinned SHA-256 before execution, then keyless capabilities. Installs in a versioned directory; never reads a viewing key. Unsupported platforms can build from source.');return;}
 const [major,minor]=process.versions.node.split('.').map(Number);check(major>24||major===24&&minor>=14,'NODE_24_14_OR_NEWER_REQUIRED');
 check(process.platform==='linux'&&process.arch==='x64','UNSUPPORTED_PLATFORM_USE_SOURCE_BUILD');check(process.report.getReport().header.glibcVersionRuntime,'GLIBC_LINUX_REQUIRED');
 const flags=new Map();for(let i=0;i<args.length;i++){const key=args[i],value=args[++i];check(['--dir','--file'].includes(key)&&!flags.has(key)&&value&&!value.startsWith('--'),'INVALID_ARGUMENTS');flags.set(key,value);}
 const base=resolve(flags.get('--dir')??join(homedir(),'.local','share','zeer'));await fs.mkdir(base,{recursive:true,mode:0o700});
 const baseInfo=await fs.lstat(base);check(baseInfo.isDirectory()&&!baseInfo.isSymbolicLink()&&ownerOnly(baseInfo,process.getuid(),0o022),'INVALID_INSTALL_DIRECTORY');
 const version=join(base,release.tag);try{await fs.mkdir(version,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const directory=await fs.lstat(version);check(directory.isDirectory()&&!directory.isSymbolicLink()&&ownerOnly(directory,process.getuid()),'INSTALL_DIRECTORY_MUST_BE_OWNER_ONLY');
 const target=join(version,'zeer-scanner'),present=await fs.lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(present){check(present.isFile()&&!present.isSymbolicLink()&&present.size===release.bytes&&ownerOnly(present,process.getuid()),'INVALID_EXISTING_SCANNER');verifyBytes(await fs.readFile(target));}
 else{
  let bytes;
  if(flags.has('--file')){const file=resolve(flags.get('--file')),info=await fs.lstat(file);check(info.isFile()&&!info.isSymbolicLink()&&info.size===release.bytes,'SCANNER_SIZE_MISMATCH');bytes=await fs.readFile(file);}else bytes=await download();
  verifyBytes(bytes);const temporary=join(version,`.download-${randomUUID()}`);
  try{await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o700});await fs.link(temporary,target);}finally{await fs.unlink(temporary).catch(()=>{});}
 }
 await capabilities(target);console.log(JSON.stringify({installed:true,executable:target,release:release.tag,sha256:release.sha256,protocol_version:release.protocol_version,viewing_key_loaded:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({error:{code:error instanceof InstallError?error.code:'SCANNER_INSTALL_FAILED'}}));process.exitCode=1;});
