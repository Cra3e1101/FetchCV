import path from 'node:path';
import {mkdir,writeFile,readFile,readdir,stat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {downloadArtifact,initializeProxy} from '@electron/get';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
// Preserve the builder's existing NSIS versions and pins. Only staging changes:
// extract into a fresh final directory, never rename a populated tool directory.
export async function stageNsis(root,zipTool,archives){
  if(Object.keys(process.env).some(key=>/^(https?|all)_proxy$/i.test(key))){
    // @electron/get v5 uses fetch, not Got; fail if its optional proxy runtime is unavailable.
    await import('undici');initializeProxy();
  }
  const specifications=[
    ['nsis-3.0.4.1','9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa','ELECTRON_BUILDER_NSIS_DIR'],
    ['nsis-resources-3.4.1','593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103','ELECTRON_BUILDER_NSIS_RESOURCES_DIR'],
  ];
  const records=[];
  for(const [name,expected,variable] of specifications){
    const url=`https://github.com/electron-userland/electron-builder-binaries/releases/download/${name}/${name}.7z`;
    const downloaded=archives ? await realpath(archives[name]) : await downloadArtifact({version:'9.9.9',isGeneric:true,artifactName:`${name}.7z`,
      cacheRoot:path.join(root,'tool-downloads'),checksums:{[`${name}.7z`]:expected},
      mirrorOptions:{resolveAssetURL:async()=>url},
      downloadOptions:{signal:AbortSignal.timeout(120000)}});
    const relative=path.relative(archives?await realpath(path.dirname(root)):root,downloaded);
    if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('download escaped approved root');
    const bytes=await readFile(downloaded);
    if(digest(bytes)!==expected)throw Error(`tool archive checksum mismatch: ${name}`);
    const archive=path.join(root,`${name}.7z`),directory=path.join(root,name);
    await writeFile(archive,bytes,{flag:'wx'});await mkdir(directory);
    if(digest(await readFile(zipTool))!=='223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3')throw Error('7zip changed before extraction');
    const result=spawnSync(zipTool,['x','-bd',archive,`-o${directory}`,'-y'],{encoding:'utf8',windowsHide:true,timeout:120000});
    await writeFile(path.join(root,`${name}-extraction.json`),JSON.stringify({status:result.status,error:result.error?.message,stdout:result.stdout,stderr:result.stderr},null,2),{flag:'wx'});
    if(result.status!==0)throw Error(`tool extraction failed: ${name}`);
    const files=[];
    async function inventory(dir){
      for(const entry of await readdir(dir,{withFileTypes:true})){
        const file=path.join(dir,entry.name);
        if(entry.isDirectory())await inventory(file);
        else if(entry.isFile())files.push({path:path.relative(directory,file),sha256:digest(await readFile(file))});
        else throw Error('unexpected toolset entry');
      }
    }
    await inventory(directory);if(!files.length)throw Error('empty toolset');
    for(const required of name==='nsis-3.0.4.1'?['Bin/makensis.exe','elevate.exe']:['plugins']){
      const info=await stat(path.join(directory,required));
      if(required==='plugins'?!info.isDirectory():!info.isFile())throw Error(`missing toolset entry: ${required}`);
    }
    process.env[variable]=directory;
    records.push({name,url,archiveSha256:expected,archiveInput:downloaded,mode:archives?'hash-verified-local-archive':'download',directory,files});
  }
  await writeFile(path.join(root,'nsis-staging.json'),JSON.stringify({method:'direct extraction into new directories; no rename or prior cache',records},null,2),{flag:'wx'});
  return records;
}
