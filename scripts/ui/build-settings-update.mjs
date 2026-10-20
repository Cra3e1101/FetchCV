import {build as esbuild} from 'esbuild';
import {build,Platform,Arch} from 'electron-builder';
import {mkdir,cp,readFile,writeFile,statfs} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {getPath7za} from 'app-builder-lib/out/toolsets/7zip.js';
import {stageNsis} from '../m4/stage-nsis.mjs';
const root=process.env.M1_ALLOWED_DELETE_ROOT,project=process.cwd();
if(!root||!path.isAbsolute(root))throw Error('isolated guarded root required');
const disk=await statfs(root);if(disk.bavail*disk.bsize<1.5*1024**3)throw Error('At least 1.5 GiB free required');
const hash=async file=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex')};
async function run(command,args,env=process.env){await new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:project,env,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve():reject(Error(`${command} exit ${code} signal ${signal}`)));});}
const stage=path.join(root,'stage'),runtime=path.join(stage,'build/electron');await mkdir(runtime,{recursive:true});
const pkg=JSON.parse(await readFile('package.json','utf8'));
const appPackage={name:pkg.name,version:'0.4.20-ui.8',description:pkg.description,author:pkg.author,private:true,type:'module',main:pkg.main};
await writeFile(path.join(stage,'package.json'),JSON.stringify(appPackage,null,2));
for(const name of ['FetchCV_LOGO.png','FetchCV_LOGO.ico'])await cp(name,path.join(stage,name),{errorOnExist:true,force:false});
await cp('.m1-work/settings-ui-dist-20261011-02',path.join(stage,'dist'),{recursive:true,errorOnExist:true,force:false});
await cp('src/vendor/openbitfun/LICENSE',path.join(stage,'OPENBITFUN-LICENSE.txt'),{errorOnExist:true,force:false});
const frontendManifest=JSON.parse(await readFile('.m1-evidence/settings-ui-20261011/frontend-manifest.json','utf8').then(s=>s.replace(/^\uFEFF/,'')));
for(const f of frontendManifest){if((await hash(path.join(stage,'dist',f.path))).toLowerCase()!==f.sha256.toLowerCase())throw Error('Reviewed frontend changed: '+f.path)}
const banner="import {createRequire as __fetchcvCreateRequire} from 'node:module'; const require=__fetchcvCreateRequire(import.meta.url);";
for(const name of ['main','storage-worker'])await esbuild({entryPoints:[path.join(project,'electron',`${name}.mjs`)],outfile:path.join(runtime,`${name}.mjs`),bundle:true,platform:'node',format:'esm',target:'node22',external:['electron'],minify:true,treeShaking:true,sourcemap:false,legalComments:'none',banner:{js:banner}});
for(const name of ['preload.cjs','storage-preload.cjs'])await cp(path.join(project,'electron',name),path.join(runtime,name));
const previous=path.resolve(root,'../codex-ui-package-20261011-01');
const receipt=JSON.parse(await readFile(path.join(previous,'package-report.json'),'utf8'));
if(!receipt.success||receipt.version!=='0.4.20-ui.7')throw Error('Expected verified ui.7 runtime');
const parserRuntime=path.join(root,'parser-runtime');
const reused=[];
for(const [directory,records] of [['sidecar-dist/fetchcv-api',receipt.sidecarFiles],['parser-runtime',receipt.parserFiles]]){
 for(const f of records){
  const source=path.resolve(previous,directory,f.path),destination=path.resolve(root,directory,f.path);
  if(!source.startsWith(previous+path.sep)||!destination.startsWith(root+path.sep))throw Error('Resource outside staging roots');
  if(await hash(source)!==f.sha256)throw Error('Previous runtime changed: '+f.path);
  await mkdir(path.dirname(destination),{recursive:true});await cp(source,destination,{errorOnExist:true,force:false});
  if(await hash(destination)!==f.sha256)throw Error('Runtime copy mismatch: '+f.path);
 }
 reused.push({directory,files:records.length});
}
await writeFile(path.join(root,'runtime-reuse.json'),JSON.stringify({sourceVersion:receipt.version,sourceReceipt:path.join(previous,'package-report.json'),reason:'UI-only update; retain previously smoke-tested runtime bytes',resources:reused},null,2));
const cache=path.join(root,'builder-cache');await mkdir(path.join(cache,'7zip@1.0.0'),{recursive:true});
const archive=await readFile(path.resolve(root,'../m4a-packaged-01/builder-cache/7zip@1.0.0/7zip-win-x64.tar.gz'));
if(createHash('sha256').update(archive).digest('hex')!=='be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3')throw Error('7zip archive pin mismatch');
await writeFile(path.join(cache,'7zip@1.0.0/7zip-win-x64.tar.gz'),archive,{flag:'wx'});
process.env.ELECTRON_BUILDER_CACHE=cache;delete process.env.ELECTRON_BUILDER_7ZIP_PATH;
const zipTool=await getPath7za();if(await hash(zipTool)!=='223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3')throw Error('Fresh 7zip hash mismatch');
await writeFile(path.join(root,'toolchain-verification.json'),JSON.stringify({zipTool,sha256:await hash(zipTool)},null,2));
await stageNsis(root,zipTool,{'nsis-3.0.4.1':path.resolve(root,'../m58-package-11/builder-cache/nsis-3.0.4.1/nsis-3.0.4.1.7z'),'nsis-resources-3.4.1':path.resolve(root,'../m4a-packaged-01/builder-cache/nsis-resources-3.4.1/nsis-resources-3.4.1.7z')});
for(const key of Object.keys(process.env))if(/^npm_config_(cache|logs_dir|logs_max|update_notifier)$/i.test(key))delete process.env[key];
Object.assign(process.env,{npm_config_cache:path.join(root,'npm-cache'),npm_config_logs_dir:path.join(root,'npm-logs'),npm_config_logs_max:'0',npm_config_update_notifier:'false'});
const sidecar=path.join(root,'sidecar-dist/fetchcv-api');
await build({projectDir:stage,targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),config:{...pkg.build,electronVersion:'43.1.1',electronDist:path.join(project,'node_modules/electron/dist'),directories:{output:path.join(root,'output')},files:['dist/**/*','build/electron/**/*','FetchCV_LOGO.png','FetchCV_LOGO.ico','OPENBITFUN-LICENSE.txt','package.json'],extraResources:[{from:sidecar,to:'sidecar'},{from:parserRuntime,to:'parser-runtime'}],win:{...pkg.build.win,icon:path.join(project,'FetchCV_LOGO.ico')},publish:null}});
await (await import('./verify-settings-update.mjs')).verifyTrial(root);
