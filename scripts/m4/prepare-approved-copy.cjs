require(require('node:path').join(process.cwd(),'scripts/m1/guard-node-deletions.cjs'));
const {app,safeStorage}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
const root=process.env.M1_ALLOWED_DELETE_ROOT,project=path.resolve(process.cwd());
const source=path.join(project,'backend','data','fetchcv.db');
if(!root || !path.isAbsolute(root)) throw Error('approved stable recovery root required');
for(const name of ['user-data','session-data','vault','protected-recovery','copies']) fs.mkdirSync(path.join(root,name));
app.setPath('userData',path.join(root,'user-data'));app.setPath('sessionData',path.join(root,'session-data'));app.setPath('temp',root);app.disableHardwareAcceleration();
const digest=()=>createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const before=digest();
const timer=setTimeout(()=>app.exit(2),120000);
app.whenReady().then(async()=>{
  const {CredentialVault}=await import(pathToFileURL(path.join(project,'packages/storage/credential-vault.mjs')));
  const {prepareWorkspaceCopy}=await import(pathToFileURL(path.join(project,'packages/storage/prepare-workspace.mjs')));
  const result=await prepareWorkspaceCopy({source,recoveryRoot:path.join(root,'protected-recovery'),destinationRoot:path.join(root,'copies'),name:'approved-project-copy',
    allowedFileRoots:[project],legacyVariant:'pre-tool-invocations',credentialVault:new CredentialVault({root:path.join(root,'vault'),protector:safeStorage})});
  const after=digest();if(before!==after) throw Error('source changed during preparation');
  const summary={success:true,account:require('node:os').userInfo().username,source,sourceBefore:before,sourceAfter:after,
    totalRows:result.totalRows,tableCounts:result.tableCounts,sourceTables:result.sourceTables,absentTables:result.absentTables,legacyVariant:result.legacyVariant,credentials:result.credentials,references:result.references,
    exceptionCount:result.exceptions.length,productionSwitched:false,activationAllowed:false,archivePath:result.archivePath};
  fs.writeFileSync(path.join(root,'approved-copy-result.json'),JSON.stringify(summary,null,2),{flag:'wx'});
  console.log(JSON.stringify({success:true,totalRows:result.totalRows,sourceTables:result.sourceTables.length,coveredTables:Object.keys(result.tableCounts).length,sourceUnchanged:true,activated:false}));
  clearTimeout(timer);app.exit(0);
}).catch(error=>{
  fs.writeFileSync(path.join(root,'approved-copy-failure.json'),JSON.stringify({success:false,code:error.code||'preparation_failed',sourceUnchanged:before===digest(),productionSwitched:false}),{flag:'wx'});
  console.error('Approved project copy failed; protected failure record retained.');clearTimeout(timer);app.exit(1);
});
