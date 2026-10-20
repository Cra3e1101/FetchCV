import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {extractFile,listPackage} from '@electron/asar';

const project=process.cwd(),stable='D:/hesan/Desktop/VSCODES/FetchCV_M1_work/20260910-235136';
const evidence=path.join(project,'.m1-evidence');
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const hashFile=async file=>{const value=createHash('sha256');for await(const bytes of createReadStream(file))value.update(bytes);return value.digest('hex');};
const inside=(root,file)=>{const relative=path.relative(root,file.replace(/^\\\\\?\\/,''));return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);};
async function treeBytes(root){let bytes=0;for(const entry of await readdir(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isSymbolicLink())throw Error('measurement link');if(entry.isDirectory())bytes+=await treeBytes(file);else bytes+=(await lstat(file)).size;}return bytes;}
const names=(await readdir(evidence)).filter(name=>/^m4e-.*-node-exit\.json$/.test(name)).sort(),runs=[];
for(const name of names){
  const label=name.replace(/-node-exit\.json$/,''),exitFile=path.join(evidence,name),result=await json(exitFile);
  const audit=path.join(evidence,`${label}-node-deletions.jsonl`),rows=(await readFile(audit,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const deleted=rows.filter(row=>row.status==='deleted'),blocked=rows.filter(row=>row.status==='blocked');
  const outsideDeleted=deleted.filter(row=>!inside(result.tempRoot,row.path));
  runs.push({label,command:result.command,exitSha256:await hashFile(exitFile),deletionAuditSha256:await hashFile(audit),verdict:result.run_verdict,durationMs:result.durationMs,
    generatedBytes:await treeBytes(result.tempRoot),deletedAPIRecords:deleted.length,distinctDeletedPaths:new Set(deleted.map(row=>row.path.toLowerCase())).size,
    deletedPaths:deleted.map(row=>({operation:row.operation,path:row.path})),outsideDeleted,blocked,watcherViolation:result.watcherViolation});
}
const packaged=await json(path.join(stable,'m4e-package-03/package-report.json'));
const runtime=await json(path.join(stable,'m4e-packaged-ui-02/packaged-report.json'));
const entries=listPackage(packaged.asar).map(name=>name.replaceAll('\\','/'));
const forbidden=entries.filter(name=>/\.(db|sqlite3?|secret|env)$/i.test(name)||/^\/(artifacts|test use|backend\/data|node_modules)\//i.test(name));
const patterns=[['private_key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/\r\n=]{64,}/],['openai_key',/sk-proj-[A-Za-z0-9_-]{32,}/],['github_token',/gh[pousr]_[A-Za-z0-9]{30,}/]];
const hits=[];let scannedTextFiles=0;
for(const name of entries.filter(name=>/\.(mjs|cjs|js|json|html|css|txt)$/i.test(name))){
  const text=extractFile(packaged.asar,path.normalize(name.slice(1))).toString('utf8');scannedTextFiles++;
  for(const [kind,pattern]of patterns)if(pattern.test(text))hits.push({file:name,kind});
}
const sourceSha256=await hashFile(path.join(project,'backend/data/fetchcv.db'));
const git=(...args)=>execFileSync('git',['-c','safe.directory=D:/hesan/Desktop/VSCODES/FetchCV_Windows',...args],{encoding:'utf8',windowsHide:true}).trim();
const sourceFiles=git('diff','--name-only','5a65ccf','HEAD').split('\n').filter(Boolean);
const frozen=[];for(const name of sourceFiles)frozen.push({path:name,sha256:await hashFile(path.join(project,name)),bytes:(await lstat(path.join(project,name))).size});
const report={version:1,createdAt:new Date().toISOString(),sourceCommit:git('rev-parse','HEAD'),sourceFiles:frozen,runs,
  scope:{m4AcceptedFor:'empty project workspace and reversible internal V2 cutover',priorHistory:'user stated old records are no longer needed; historical real-data migration was not verified',appDataAccessed:false,productionDefaultSwitched:false,releaseInstallerReplaced:false},
  source:{path:'backend/data/fetchcv.db',sha256:sourceSha256,actualTables:24,allRowCounts:0,variant:'pre-tool-invocations'},
  packaged,packagedRuntime:runtime,installerBytes:(await lstat(runtime.installer)).size,
  facts:await json(path.join(evidence,'m4e-final-facts.json')),
  artifactScan:{entries:entries.length,scannedTextFiles,forbidden,hits,coverage:'ASAR paths and three credential patterns only; not an exhaustive secret proof'},
  diskApprovalRejection:{initialReason:'auto-review interpreted prior mixed PowerShell table output as 1 byte free',recheckedAtUtc:'2026-09-21T17:31:42.0521152Z',getPSDriveFreeBytes:8205848576,driveInfoAvailableBytes:8205848576,targetExisted:false,resolution:'same build approved after fresh independent measurements and a 2 GiB fail-fast floor'},
  deletionCoverage:'counts are successful JavaScript API receipts, possibly duplicated by recursive wrappers; native SQLite/Chromium/builder deletions are not exhaustively intercepted',
  reclaimedBytes:0,m4AcceptedWithinDeclaredScope:true,originalRealHistoryGatePassed:false};
if(runs.some(run=>!run.verdict.success||run.outsideDeleted.length||run.blocked.length||run.watcherViolation)||forbidden.length||hits.length||sourceSha256!=='11e73ec84150780d7a92fa5fd39e287e639a6164b15ed0bcdeec9c997511a565'||runtime.asarHash!==await hashFile(packaged.asar)||runtime.installerSha256!==await hashFile(runtime.installer))throw Error('acceptance summary invariant failed');
const destination=path.join(evidence,'m4-agent-validation-20260922.json');
await writeFile(destination,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({destination,runs:runs.length,success:true,generatedBytes:runs.reduce((n,r)=>n+r.generatedBytes,0),deletedAPIRecords:runs.reduce((n,r)=>n+r.deletedAPIRecords,0),distinctDeletedPaths:runs.reduce((n,r)=>n+r.distinctDeletedPaths,0),outsideDeleted:0,blocked:0,installerBytes:report.installerBytes,installerSha256:runtime.installerSha256,scannedTextFiles,hits:hits.length}));
