import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractFile,listPackage} from '@electron/asar';

const project=process.cwd(),stable='D:/hesan/Desktop/VSCODES/FetchCV_M1_work/20260910-235136';
const labels=['m4c-app-01','m4c-utility-01','m4c-utility-02','m4b-approved-copy-01','m4b-older-schema-01','m4b-approved-copy-02','m4c-restore-01','m4d-app-reader-01','m4d-workspace-ui-01','m4d-workspace-ui-02',
  ...Array.from({length:9},(_,i)=>`m4c-package-${String(i+1).padStart(2,'0')}`),'m4c-packaged-ui-01','m4d-reader-02','m4d-reader-03','m4d-workspace-ui-03','m4c-cutover-01','m4c-cutover-02','m4c-cutover-03','m4c-project-01','m4c-node-all-02','m4c-node-all-03','m4c-packaged-ui-02','m4c-utility-03','m4c-app-recovery-01'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJSON=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const inside=(root,file)=>{const relative=path.relative(root,file);return relative && relative!=='..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);};
const runs=[];
for(const label of labels){
  const exitFile=path.join(project,'.m1-evidence',`${label}-node-exit.json`),exitBytes=await readFile(exitFile),result=JSON.parse(exitBytes);
  const rows=(await readFile(path.join(project,'.m1-evidence',`${label}-node-deletions.jsonl`),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const deleted=rows.filter(row=>row.status==='deleted'),blocked=rows.filter(row=>row.status==='blocked');
  runs.push({label,exitFile,exitSha256:sha(exitBytes),verdict:result.run_verdict,durationMs:result.durationMs,
    deletedAPIRecords:deleted.length,distinctDeletedPaths:new Set(deleted.map(row=>row.path.toLowerCase())).size,deletedPaths:deleted.map(row=>({operation:row.operation,path:row.path})),
    outsideDeleted:deleted.filter(row=>!inside(result.tempRoot,row.path)),blocked,watcherViolation:result.watcherViolation});
}
const packaged=await readJSON(path.join(stable,'m4c-package-09/package-report.json'));
const entries=listPackage(packaged.asar).map(name=>name.replaceAll('\\','/'));
const forbidden=entries.filter(name=>/\.(?:db|sqlite3?|secret|env)$/i.test(name)||/^\/(?:artifacts|test use|backend\/data|node_modules)\//i.test(name));
const patterns=[['private_key_block',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/\r\n=]{64,}/],['openai_project_key',/sk-proj-[A-Za-z0-9_-]{32,}/],['github_token',/gh[pousr]_[A-Za-z0-9]{30,}/]];
const hits=[];let scannedFiles=0;
for(const name of entries.filter(name=>/\.(?:mjs|cjs|js|json|html|css|txt)$/i.test(name))){
  const text=extractFile(packaged.asar,path.normalize(name.slice(1))).toString('utf8');scannedFiles++;
  for(const [kind,pattern] of patterns)if(pattern.test(text))hits.push({file:name,kind});
}
const source=path.join(project,'backend/data/fetchcv.db');
const report={version:1,createdAt:new Date().toISOString(),runs,source:{path:source,sha256:sha(await readFile(source))},
  projectCutover:await readJSON(path.join(stable,'m4c-project-01/project-cutover-result.json')),
  sourceLease:await readJSON(path.join(project,'.m1-evidence/m4c-project-01-source-lease.json')),
  packaged:{...packaged,asarSha256Actual:sha(await readFile(packaged.asar))},
  packagedRuntime:await readJSON(path.join(stable,'m4c-packaged-ui-02/packaged-report.json')),
  artifactScan:{asarEntries:entries.length,scannedTextFiles:scannedFiles,forbiddenPaths:forbidden,hits,coverage:'ASAR text and path heuristics only; not a proof against all secrets or a scan of private recovery data'},
  deletionCoverage:'API receipts may count one path multiple times; native SQLite/Electron/build operations are not exhaustively intercepted',
  historicalSamples:'authorized source is empty; nonempty real-history equality not verified',m4FullyAccepted:false};
if(runs.some(run=>run.outsideDeleted.length) || forbidden.length || hits.length || report.source.sha256!==report.sourceLease.sourceBefore || report.packaged.asarSha256Actual!==packaged.asarSha256)throw Error('summary invariant failed; no success report written');
const destination=path.join(project,'.m1-evidence/m4-validation-20260922.json');
await writeFile(destination,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({destination,runs:runs.length,successful:runs.filter(run=>run.verdict.success).length,scannedFiles,secretPatternHits:hits.length,outsideDeleted:0,m4FullyAccepted:false}));
