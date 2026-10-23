import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {mkdir,copyFile,readFile,writeFile,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
process.chdir(here);
const cache=path.join(here,'.cache'),publicDir=path.join(cache,'public');
await mkdir(publicDir,{recursive:true});
const require=createRequire(import.meta.url);
for(const [pkg,font,name] of [['@fontsource-variable/manrope','manrope-latin-wght-normal.woff2','manrope'],['@fontsource/ibm-plex-mono','ibm-plex-mono-latin-400-normal.woff2','mono']]){
 const dir=path.dirname(require.resolve(pkg+'/index.css'));
 await copyFile(path.join(dir,'files',font),path.join(publicDir,name+'.woff2'));
 await copyFile(path.join(dir,'LICENSE'),path.join(publicDir,name+'-OFL.txt'));
}
await copyFile(path.join(root,'apps/web/src/app/icon.svg'),path.join(publicDir,'zeer.svg'));
const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
const stills=process.argv.includes('--stills');
const serveUrl=await bundle({entryPoint:path.join(here,'src/index.tsx'),publicDir});
const targets=[['RepositoryOverview','assets/readme/zeer-overview'],['PrepOverview','apps/docs/static/demos/prep-flow'],['ChefOverview','apps/docs/static/demos/chef-flow']];
const manifest={renderer:'Remotion 4.0.537',frames:144,fps:30,seconds:4.8,gifFps:12,loop:'once',assets:[],scope:'Original explanatory illustrations using verified public sample fields; not fresh execution or benchmark evidence.'};
for(const [id,target] of targets){
 const composition=await selectComposition({serveUrl,id});
 const destination=path.join(root,target);await mkdir(path.dirname(destination),{recursive:true});
 await renderStill({serveUrl,composition,frame:143,output:destination+'.png'});
 if(!stills){
  const video=path.join(cache,id+'.mp4');
  await renderMedia({serveUrl,composition,codec:'h264',outputLocation:video,crf:15,concurrency:3});
  execFileSync(ffmpeg,['-hide_banner','-y','-i',video,'-filter_complex','fps=12,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3','-loop','-1',destination+'.gif'],{stdio:'pipe',maxBuffer:4*1024*1024});
  if((await stat(destination+'.gif')).size>3*1024*1024)throw new Error(id+' GIF exceeds the 3 MiB delivery budget');
 }
 for(const ext of stills?['png']:['gif','png']){
  const file=destination+'.'+ext,bytes=await readFile(file);
  manifest.assets.push({path:path.relative(root,file).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:composition.width,height:composition.height});
 }
 console.log(id+' rendered');
}
await writeFile(path.join(cache,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
