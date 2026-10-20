import {build as viteBuild} from 'vite';
import react from '@vitejs/plugin-react';
import {build as esbuild} from 'esbuild';
import {build,Platform,Arch} from 'electron-builder';
import {listPackage} from '@electron/asar';
import {mkdir,cp,readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {getPath7za} from 'app-builder-lib/out/toolsets/7zip.js';
import {stageNsis} from './stage-nsis.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT,project=process.cwd();
if(!root || !path.isAbsolute(root))throw Error('guarded run root required');
// Never reuse previously extracted native tools: a valid cached archive does
// not prove that its extracted executables have remained unchanged.
const cache=path.join(root,'builder-cache');await mkdir(cache);
const offline=process.argv.includes('--offline-verified-tools');
if(offline){
  const archive=await readFile(path.resolve(root,'../m4a-packaged-01/builder-cache/7zip@1.0.0/7zip-win-x64.tar.gz'));
  if(createHash('sha256').update(archive).digest('hex')!=='be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3')throw Error('7zip archive hash mismatch');
  await mkdir(path.join(cache,'7zip@1.0.0'));
  await writeFile(path.join(cache,'7zip@1.0.0/7zip-win-x64.tar.gz'),archive,{flag:'wx'});
}
process.env.ELECTRON_BUILDER_CACHE=cache;
for(const key of Object.keys(process.env))if(/^(?:npm_config_|npm_package_config_)?electron_builder_binaries_mirror$/i.test(key))delete process.env[key];
process.env.ELECTRON_BUILDER_BINARIES_MIRROR='https://github.com/electron-userland/electron-builder-binaries/releases/download/';
delete process.env.ELECTRON_BUILDER_7ZIP_PATH;
const zipTool=await getPath7za();
const zipHash=createHash('sha256').update(await readFile(zipTool)).digest('hex');
if(zipHash!=='223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3')throw Error('fresh 7zip executable hash mismatch; refusing build');
await writeFile(path.join(root,'toolchain-verification.json'),JSON.stringify({cache,zipTool,zipHash,offline,cachePolicy:'new extraction; no previously extracted tools copied; offline archives must match fixed pins'},null,2),{flag:'wx'});
await stageNsis(root,zipTool,offline?{
  'nsis-3.0.4.1':path.resolve(root,'../m58-package-11/builder-cache/nsis-3.0.4.1/nsis-3.0.4.1.7z'),
  'nsis-resources-3.4.1':path.resolve(root,'../m4a-packaged-01/builder-cache/nsis-resources-3.4.1/nsis-resources-3.4.1.7z'),
}:undefined);
// Subprocesses must not inherit npm's per-user cache or log-cleanup target.
const npmCache=path.join(root,'npm-cache'),npmLogs=path.join(root,'npm-logs');
await mkdir(npmCache);await mkdir(npmLogs);
for(const key of Object.keys(process.env))if(/^npm_config_(cache|logs_dir|logs_max|update_notifier)$/i.test(key))delete process.env[key];
Object.assign(process.env,{npm_config_cache:npmCache,npm_config_logs_dir:npmLogs,npm_config_logs_max:'0',npm_config_update_notifier:'false'});
await writeFile(path.join(root,'npm-isolation.json'),JSON.stringify({root,npmCache,npmLogs,logsMax:0,updateNotifier:false},null,2),{flag:'wx'});
const stage=path.join(root,'stage'),runtime=path.join(stage,'build','electron');await mkdir(runtime,{recursive:true});
const pkg=JSON.parse(await readFile('package.json','utf8'));
pkg.scripts['electron:runtime']='node scripts/build-electron-runtime.mjs && node scripts/build-storage-runtime.mjs';
// Two-directory layout: build configuration belongs to the development package.
// Runtime dependencies remain declared; they are collected from projectDir.
const appPackage={...pkg};delete appPackage.build;
await writeFile(path.join(stage,'package.json'),JSON.stringify(appPackage,null,2)+'\n',{flag:'wx'});
for(const name of ['FetchCV_LOGO.png','FetchCV_LOGO.ico'])await cp(path.join(project,name),path.join(stage,name),{errorOnExist:true,force:false});
await viteBuild({configFile:false,root:project,base:'./',plugins:[react()],build:{outDir:path.join(stage,'dist'),emptyOutDir:false}});
const guard=`import {createRequire as __fetchcvCreateRequire} from 'node:module'; const require=__fetchcvCreateRequire(import.meta.url); require(${JSON.stringify(path.join(project,'scripts/m1/guard-node-deletions.cjs'))});`;
for(const name of ['main','storage-worker'])await esbuild({entryPoints:[path.join(project,'electron',`${name}.mjs`)],outfile:path.join(runtime,`${name}.mjs`),bundle:true,platform:'node',format:'esm',target:'node22',external:['electron'],minify:true,treeShaking:true,sourcemap:false,legalComments:'none',banner:{js:guard}});
for(const name of ['preload.cjs','storage-preload.cjs'])await cp(path.join(project,'electron',name),path.join(runtime,name),{errorOnExist:true,force:false});
const parserRuntime=path.join(root,'parser-runtime');
const parserStage=spawnSync(path.join(project,'backend/.venv-m1/Scripts/python.exe'),['-B','-c','import sys;from workers.parser.stage_runtime import stage;stage(*sys.argv[1:])',parserRuntime,path.resolve(root,'../m5-runtime-download-02/python-3.14.7-embed-amd64.zip'),path.join(project,'.m1-work/w3-python-20260911-192209/wheelhouse/pypdf-6.4.1-py3-none-any.whl')],{cwd:project,encoding:'utf8',windowsHide:true});
if(parserStage.status!==0)throw Error('parser runtime staging failed: '+parserStage.stderr);
// Verify the single configured sidecar copy. Do not add a second FileSet:
// electron-builder merges these arrays with package.json instead of replacing.
const sidecarFiles=[],parserFiles=[];
const hashFile=async file=>{const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');};
async function verifySidecar(source,destination,relative='',records=sidecarFiles) {
  for(const entry of await readdir(source,{withFileTypes:true})) {
    const from=path.join(source,entry.name),to=path.join(destination,entry.name),name=path.posix.join(relative,entry.name);
    if(entry.isSymbolicLink())throw Error('sidecar link is not allowed');
    if(entry.isDirectory())await verifySidecar(from,to,name,records);
    else if(entry.isFile()) {
      const before=await hashFile(from);
      if(before!==await hashFile(to) || before!==await hashFile(from))throw Error('sidecar copy hash mismatch');
      records.push({path:name,bytes:(await lstat(to)).size,sha256:before});
    } else throw Error('unexpected sidecar entry');
  }
}
const artifacts=await build({projectDir:project,targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),config:{
  electronVersion:'43.1.1',electronDist:path.join(project,'node_modules/electron/dist'),npmRebuild:false,
  directories:{app:stage,output:path.join(root,'output')},
  extraResources:[{from:parserRuntime,to:'parser-runtime',filter:['**/*']}],
  afterPack:async context=>{await verifySidecar(path.join(project,'backend/dist/fetchcv-api'),path.join(context.appOutDir,'resources/sidecar'));await verifySidecar(parserRuntime,path.join(context.appOutDir,'resources/parser-runtime'),'',parserFiles);},
  win:{...pkg.build.win,icon:path.join(project,'FetchCV_LOGO.ico'),signAndEditExecutable:false},publish:null}});
const asar=path.join(root,'output/win-unpacked/resources/app.asar'),files=listPackage(asar).map(file=>file.replaceAll('\\','/'));
for(const file of ['/build/electron/main.mjs','/build/electron/preload.cjs','/build/electron/storage-worker.mjs','/build/electron/storage-preload.cjs','/dist/index.html','/dist/workspace/index.html'])
  if(!files.includes(file))throw Error(`packaged file missing: ${file}`);
const report={success:true,artifacts,stage,asar,asarSha256:createHash('sha256').update(await readFile(asar)).digest('hex'),files,
  candidatePackage:path.join(stage,'package.json'),sidecarFiles,parserFiles,parserRuntime:'official CPython 3.14.7 embeddable + pypdf 6.4.1, hash-pinned archives, isolated LPAC host',sidecar:'existing build reused and hashes verified; V2 branch does not launch it',instrumentation:'main and utility have explicit test deletion guard banner',releaseCandidate:false};
await writeFile(path.join(root,'package-report.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({success:true,artifacts,asarFiles:files.length}));
