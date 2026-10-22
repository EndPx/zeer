import {spawn} from 'node:child_process';
import {readFile,lstat,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export class RuntimeControlError extends Error {constructor(code){super(code);this.code=code;}}
const actions=new Set(['build','migrate','check','up','stop','logs','status']);
export async function composeArguments(directory=process.cwd(),env=process.env) {
 const files=['compose.yaml','compose.runtime.yaml'];
 try{await access(join(directory,'compose.shielded.yaml'));files.push('compose.shielded.yaml');}catch(error){if(error.code!=='ENOENT')throw new RuntimeControlError('COMPOSE_FILES_UNAVAILABLE');}
 if(env.CHEF_COMPOSE_OVERRIDE)files.push(env.CHEF_COMPOSE_OVERRIDE);
 const args=['compose'];
 for(const name of files){const file=resolve(directory,name),info=await lstat(file).catch(()=>{throw new RuntimeControlError('COMPOSE_FILES_UNAVAILABLE');});if(!info.isFile()||info.isSymbolicLink())throw new RuntimeControlError('COMPOSE_FILES_UNAVAILABLE');args.push('-f',file);}
 return args;
}
function redacted(text) {
 const values=['POSTGRES_PASSWORD','DATABASE_URL','CHEF_API_TOKEN','PREP_API_TOKEN'].map(name=>process.env[name]).filter(Boolean);
 for(const value of values)text=text.replaceAll(value,'[REDACTED]');
 return text;
}
export async function execute(program,args,{directory,signal,timeoutMs=240000}={}) {
 return await new Promise((yes,no)=>{
  const child=spawn(program,args,{cwd:directory,windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  let output='',failed=false,finished=false;
  const kill=signal=>{
   if(!child.pid)return;
   if(process.platform==='win32'){
    const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    killer.on('error',()=>child.kill('SIGKILL'));
   }else{try{process.kill(-child.pid,signal);}catch{child.kill(signal);}}
  };
  let forced;
  const stop=()=>{if(failed)return;failed=true;kill('SIGTERM');forced=setTimeout(()=>{if(!finished)kill('SIGKILL');},8000);forced.unref();};
  const timer=setTimeout(stop,timeoutMs);
  const abort=stop;
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const accept=chunk=>{if(output.length+chunk.length>2*1024*1024){stop();kill('SIGKILL');return;}output+=chunk.toString('utf8');};
  child.stdout.on('data',accept);child.stderr.on('data',accept);
  child.once('error',()=>{failed=true;});
  child.once('close',code=>{finished=true;clearTimeout(timer);clearTimeout(forced);signal?.removeEventListener('abort',abort);process.stdout.write(redacted(output));code===0&&!failed?yes():no(new RuntimeControlError('RUNTIME_COMMAND_FAILED'));});
 });
}
export async function main(args=process.argv.slice(2),options={}) {
 if(args.length===1&&args[0]==='--help'){console.log('node --env-file=.env runtime-control.mjs <build|migrate|check|up|stop|logs|status>\nBuild uses the installed project compiler and retained pnpm-lock.yaml. Migrate is explicit. Up never builds or migrates. Stop retains PostgreSQL and its volume.');return;}
 if(args.length!==1||!actions.has(args[0]))throw new RuntimeControlError('INVALID_RUNTIME_ACTION');
 const action=args[0],directory=resolve(options.directory??process.cwd()),run=options.run??execute;
 const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
 try {
  const compose=await composeArguments(directory);
  if(action==='build') {
   const lock=await lstat(join(directory,'pnpm-lock.yaml')).catch(()=>{throw new RuntimeControlError('PNPM_LOCKFILE_REQUIRED');});if(!lock.isFile()||lock.isSymbolicLink())throw new RuntimeControlError('PNPM_LOCKFILE_REQUIRED');
   const require=createRequire(join(directory,'package.json'));
   const cli=join(directory,'node_modules/@zeer-dev/chef/dist/cli.js');
   await access(cli).catch(()=>{throw new RuntimeControlError('PROJECT_DEPENDENCIES_REQUIRED');});
   const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
   if(!manifest.dependencies?.['@zeer-dev/chef'])throw new RuntimeControlError('PROJECT_DEPENDENCIES_REQUIRED');
   await run(process.execPath,[cli,'codegen','--config',join(directory,'chef.config.ts'),'--json'],{directory,signal:controller.signal});
   let compiler;try{compiler=join(dirname(require.resolve('typescript/package.json')),'bin','tsc');}catch{throw new RuntimeControlError('PROJECT_TYPESCRIPT_REQUIRED');}
   await run(process.execPath,[compiler,'--noEmit','--project',join(directory,'tsconfig.json')],{directory,signal:controller.signal});
  }
  const commands={build:['build','follower','api'],migrate:['run','--rm','migrate'],check:['run','--rm','check'],up:['up','-d','--no-build','follower','api'],stop:['stop','follower','api'],logs:['logs','--tail','100','follower','api'],status:['ps']};
  await run('docker',[...compose,...commands[action]],{directory,signal:controller.signal,timeoutMs:action==='build'?600000:240000});
  console.log(JSON.stringify({command:'runtime',action,status:'complete',...(action==='stop'?{database_retained:true}:{})}));
 }finally{process.off('SIGINT',abort);process.off('SIGTERM',abort);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({error:{code:error instanceof RuntimeControlError?error.code:'RUNTIME_COMMAND_FAILED'},help:'Check the retained lockfile, Docker service, project configuration and explicit migration. No volume reset is performed.'}));process.exitCode=1;});
