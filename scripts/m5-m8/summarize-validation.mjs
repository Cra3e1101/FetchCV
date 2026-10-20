import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {extractFile,listPackage} from '@electron/asar';

const project=process.cwd(),evidence=path.join(project,'.m1-evidence');
const [packageLabel='m58-package-03',runtimeLabel='m58-packaged-ui-03',reportName='m58-validation-20260922-r3.json',regressionLabel='m58-regression-04']=process.argv.slice(2);
if(![packageLabel,runtimeLabel].every(name=>/^m58-[a-z0-9-]+$/.test(name))||!/^m58-validation-[a-z0-9-]+\.json$/.test(reportName))throw Error('invalid evidence selector');
const labels=(await readdir(evidence)).filter(name=>/^m(?:5-|6-|7-|8-|58-).*-node-exit\.json$/.test(name)).map(name=>name.replace(/-node-exit\.json$/,''));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashFile=async file=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');};
const normalize=file=>path.resolve(file.replace(/^\\\\\?\\/,''));
const inside=(root,file)=>{const rel=path.relative(normalize(root),normalize(file));return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
async function measure(directory){
  let bytes=0,files=0,directories=1;const reparsePoints=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const target=path.join(directory,entry.name),stat=await lstat(target);
    if(stat.isSymbolicLink()){reparsePoints.push(target);bytes+=stat.size;continue;}
    if(stat.isDirectory()){const child=await measure(target);bytes+=child.bytes;files+=child.files;directories+=child.directories;reparsePoints.push(...child.reparsePoints);}
    else if(stat.isFile()){bytes+=stat.size;files++;}else throw Error('unknown measured entry');
  }
  return {bytes,files,directories,reparsePoints,complete:true,scope:'all directory entries readable; reparse targets deliberately not followed or double-counted'};
}
const runs=[];
for(const label of labels){
  const prefix=path.join(evidence,label),exitBytes=await readFile(prefix+'-node-exit.json'),exit=JSON.parse(exitBytes);
  const auditBytes=await readFile(prefix+'-node-deletions.jsonl'),rows=auditBytes.toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const deleted=rows.filter(row=>row.status==='deleted'||row.event==='deleted'),blocked=rows.filter(row=>row.status==='blocked'||row.event==='blocked');
  const log=await readFile(prefix+'-node.log','utf8');
  runs.push({label,command:exit.command,root:exit.tempRoot,exitHash:digest(exitBytes),auditHash:digest(auditBytes),durationMs:exit.durationMs,verdict:exit.run_verdict,
    testCounts:Object.fromEntries(['tests','pass','fail','cancelled','skipped'].map(key=>[key,Number(log.match(new RegExp('ℹ '+key+' (\\d+)'))?.[1]??0)])),
    watcherViolation:exit.watcherViolation,deletedAPIRecords:deleted.length,deletedPaths:deleted.map(({path,operation})=>({path,operation})),distinctDeletedPaths:new Set(deleted.map(row=>normalize(row.path).toLowerCase())).size,
    outsideDeleted:deleted.filter(row=>!inside(exit.tempRoot,row.path)),blocked,retainedTree:await measure(exit.tempRoot)});
}
const stable=path.dirname(runs.find(run=>run.label===packageLabel).root);
const packaged=await readJSON(path.join(stable,packageLabel,'package-report.json'));
const packagedRuntime=await readJSON(path.join(stable,runtimeLabel,'packaged-report.json'));
const regression=runs.find(run=>run.label===regressionLabel);
const acceptedLabels=[packageLabel,runtimeLabel,regressionLabel,'m5-container-15'];
if(acceptedLabels.some(label=>!runs.find(run=>run.label===label)?.verdict.success)||packaged.success!==true||packagedRuntime.success!==true||regression.testCounts.fail||regression.testCounts.cancelled)throw Error('selected validation did not pass');
const entries=listPackage(packaged.asar).map(name=>name.replaceAll('\\','/'));
const forbidden=entries.filter(name=>/\.(?:db|sqlite3?|secret|env)$/i.test(name)||/^\/(?:artifacts|test use|backend\/data|node_modules)\//i.test(name));
const patterns=[['private_key_block',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/\r\n=]{64,}/],['openai_project_key',/sk-proj-[A-Za-z0-9_-]{32,}/],['github_token',/gh[pousr]_[A-Za-z0-9]{30,}/]];
const hits=[];let scannedFiles=0;
for(const name of entries.filter(name=>/\.(?:mjs|cjs|js|json|html|css|txt)$/i.test(name))){
  const text=extractFile(packaged.asar,path.normalize(name.slice(1))).toString('utf8');scannedFiles++;
  for(const [kind,pattern]of patterns)if(pattern.test(text))hits.push({file:name,kind});
}
const sourceHash=await hashFile('backend/data/fetchcv.db'),prior=await readJSON(path.join(evidence,'m4-agent-validation-20260922.json'));
const git=(...args)=>execFileSync('git',['-c','safe.directory='+project,...args],{encoding:'utf8',windowsHide:true}).trim();
const changed=git('diff','--name-only','7fcb309','HEAD').split('\n').filter(Boolean);
const sourceFiles=[];for(const name of changed)sourceFiles.push({path:name,bytes:(await lstat(name)).size,sha256:await hashFile(name)});
const report={version:1,createdAt:new Date().toISOString(),sourceCommit:git('rev-parse','HEAD'),sourceFiles,baselineCommit:'7fcb309',
  baselineArchive:'.m1-work/m5-m8-20260922-01/m4-source-baseline.zip',baselineArchiveHash:await hashFile('.m1-work/m5-m8-20260922-01/m4-source-baseline.zip'),
  runs,source:{path:'backend/data/fetchcv.db',sha256:sourceHash,unchangedSinceM4:sourceHash===prior.source.sha256},
  packaged:{...packaged,installerBytes:(await lstat(packagedRuntime.installer)).size,installerHash:await hashFile(packagedRuntime.installer)},packagedRuntime,
  artifactScan:{asarEntries:entries.length,scannedTextFiles:scannedFiles,forbidden,hits,coverage:'ASAR paths and three credential patterns only; no exhaustive secret proof'},
  retainedTestTreesBytes:runs.reduce((total,run)=>total+run.retainedTree.bytes,0),reclaimedBytes:0,
  deletionCoverage:'successful JavaScript API receipts, possibly duplicated; native SQLite/Chromium/builder operations are not exhaustively intercepted',
  acceptedLabels,regression:regression.testCounts,
  gates:{m5OSIsolationPassed:true,parserWiredInProduction:packaged.parserFiles.length>0&&packagedRuntime.parserImportSearchCitationRestartRevoke===true,realUserEnvironmentActivated:false,humanSealedBenchmarkPassed:false,syntheticRoundtripPassed:true,memoryReviewUIPassed:true,contextBudgetAndPackagedPassed:true,m5ToM8FullyAccepted:false}};
if(runs.some(run=>run.outsideDeleted.length)||forbidden.length||hits.length||!report.source.unchangedSinceM4||await hashFile(packaged.asar)!==packaged.asarSha256)throw Error('audit invariant failed');
const destination=path.join(evidence,reportName);await writeFile(destination,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({destination,runs:runs.length,successful:runs.filter(r=>r.verdict.success).length,deletedAPIRecords:runs.reduce((n,r)=>n+r.deletedAPIRecords,0),outsideDeleted:0,blocked:runs.reduce((n,r)=>n+r.blocked.length,0),retainedTestTreesBytes:report.retainedTestTreesBytes,scannedFiles,hits:hits.length,gates:report.gates}));
