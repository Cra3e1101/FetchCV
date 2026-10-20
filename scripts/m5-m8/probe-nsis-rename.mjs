import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile,readFile,rename,readdir,stat,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {extractArchive,downloadBuilderToolset} from 'app-builder-lib/out/util/electronGet.js';

const root=process.env.M1_ALLOWED_DELETE_ROOT;
assert.ok(root&&path.isAbsolute(root));
const source=path.resolve(root,'../m58-package-11/builder-cache');
const tool=path.join(source,'7zip@1.0.0/7zip-win-x64-a34pt/bin/7za.exe');
const archive=path.join(source,'nsis-3.0.4.1/nsis-3.0.4.1.7z');
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const report={success:false,root,steps:[],deletionAudit:'see guarded node deletion JSONL; builder may remove newly generated temporary directories'};
try{
  assert.equal(await hash(tool),'223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3');
  assert.equal(await hash(archive),'9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa');
  const synthetic=path.join(root,'synthetic.tmp');await mkdir(path.join(synthetic,'nested'),{recursive:true});
  await writeFile(path.join(synthetic,'nested','probe.txt'),'synthetic rename only',{flag:'wx'});
  await rename(synthetic,path.join(root,'synthetic-final'));
  report.steps.push({name:'synthetic-directory-rename',success:true});
  const extracted=path.join(root,'nsis.tmp');await mkdir(extracted);
  const result=spawnSync(tool,['x','-bd',archive,`-o${extracted}`,'-y'],{encoding:'utf8',windowsHide:true,timeout:120000});
  await writeFile(path.join(root,'extraction.json'),JSON.stringify({status:result.status,error:result.error?.message,stdout:result.stdout,stderr:result.stderr},null,2),{flag:'wx'});
  assert.equal(result.status,0,result.error?.message||result.stderr);
  assert.ok((await readdir(extracted)).length>0);
  report.steps.push({name:'verified-nsis-extraction',success:true});
  // One attempt only; no cleanup, delay/retry, ACL change or protection change.
  await rename(extracted,path.join(root,'nsis-final'));
  assert.ok((await stat(path.join(root,'nsis-final','makensis.exe'))).isFile());
  report.steps.push({name:'immediate-extracted-directory-rename',success:true});
  process.env.ELECTRON_BUILDER_7ZIP_PATH=tool;
  const builderTarget=path.join(root,'builder-target');await mkdir(builderTarget);
  await extractArchive(archive,builderTarget);
  assert.ok((await stat(path.join(builderTarget,'makensis.exe'))).isFile());
  report.steps.push({name:'builder-extractArchive-with-lock-and-rename',success:true});
  const cache=path.join(root,'builder-cache');await mkdir(path.join(cache,'nsis-3.0.4.1'),{recursive:true});
  await copyFile(archive,path.join(cache,'nsis-3.0.4.1','nsis-3.0.4.1.7z'));
  process.env.ELECTRON_BUILDER_CACHE=cache;
  const downloaded=await downloadBuilderToolset({releaseName:'nsis-3.0.4.1',filenameWithExt:'nsis-3.0.4.1.7z',checksums:{'nsis-3.0.4.1.7z':'9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa'}});
  assert.ok((await stat(path.join(downloaded,'makensis.exe'))).isFile());
  report.steps.push({name:'builder-outer-cache-lock-and-extraction',success:true});
  report.success=true;
}catch(error){report.error={message:error.message,code:error.code,syscall:error.syscall,path:error.path,dest:error.dest};process.exitCode=1;}
await writeFile(path.join(root,'rename-report.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify(report));
