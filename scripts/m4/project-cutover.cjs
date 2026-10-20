const path=require('node:path');
require(path.join(process.cwd(),'scripts/m1/guard-node-deletions.cjs'));
const {app,safeStorage,utilityProcess}=require('electron');
const fs=require('node:fs');const {pathToFileURL}=require('node:url');const {createHash,randomUUID}=require('node:crypto');
const root=process.env.M1_ALLOWED_DELETE_ROOT,project=process.cwd(),source=path.join(project,'backend/data/fetchcv.db');
const leasePid=Number(process.env.M4_SOURCE_LEASE_PID),expectedHash=process.env.M4_SOURCE_LEASE_HASH;
if(!root || !path.isAbsolute(root) || !Number.isSafeInteger(leasePid) || leasePid<=0 || !/^[a-f0-9]{64}$/.test(expectedHash||''))throw Error('read-only source lease launcher required');
for(const name of ['user-data','session-data','vault','protected-recovery','copies'])fs.mkdirSync(path.join(root,name));
app.setPath('userData',path.join(root,'user-data'));app.setPath('sessionData',path.join(root,'session-data'));app.setPath('temp',root);app.disableHardwareAcceleration();
const hash=()=>createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const verify=()=>{process.kill(leasePid,0);return hash()===expectedHash;};
const load=relative=>import(pathToFileURL(path.join(project,relative)));
const timer=setTimeout(()=>app.exit(2),120000);
let client,activated=false;
app.whenReady().then(async()=>{
  const {cutoverWorkspace}=await load('packages/app/workspace-cutover.mjs');
  const {CredentialVault}=await load('packages/storage/credential-vault.mjs');
  const {startStorageUtility}=await load('electron/storage-client.mjs');
  const phases=[];
  const result=await cutoverWorkspace({source,recoveryRoot:path.join(root,'protected-recovery'),destinationRoot:path.join(root,'copies'),name:'approved-project',
    legacyVariant:'pre-tool-invocations',allowedFileRoots:[],credentialVault:new CredentialVault({root:path.join(root,'vault'),protector:safeStorage}),
    acquireSourceLease:async()=>({verify,release:async()=>{/* The parent retains the real read-only handle until this process exits. */}}),
    reviewFinalCopy:async({copy})=>({approved:copy.structuralValidationPassed===true && copy.totalRows===0 && copy.credentials.entryCount===0 && copy.exceptions.length===0 && copy.references.located===0,
      reviewId:'user-approved-project-empty-copy'}),checkpoint:async phase=>{phases.push(phase);},
  });
  activated=true;
  client=await startStorageUtility({utilityProcess,entry:path.join(project,'tests/fixtures/storage-worker-guarded.cjs'),root:result.root});
  const info=await client.request({v:1,id:randomUUID(),workspaceId:result.workspaceId,method:'workspace.info',payload:{}});
  if(info.id!==result.workspaceId || info.generation!==1)throw Error('activated APP identity mismatch');
  await client.close();client=null;
  if(!verify())throw Error('source changed');
  const report={success:true,scope:'authorized project DB copy only',source,sourceBefore:expectedHash,sourceAfter:hash(),sourceUnchanged:true,
    workspaceRoot:result.root,workspaceId:result.workspaceId,manifest:result.manifest,totalRows:result.copy.totalRows,sourceTables:result.copy.sourceTables,
    absentTables:result.copy.absentTables,credentials:result.copy.credentials,review:result.review,phases,appUtilityValidated:true,
    actualHistoricalSampleEquality:'not_applicable_empty_authorized_database',productionDefaultSwitched:false,appdataAccessed:false};
  fs.writeFileSync(path.join(root,'project-cutover-result.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({success:true,activatedCopy:true,totalRows:result.copy.totalRows,sourceUnchanged:true,appUtilityValidated:true}));
  clearTimeout(timer);app.exit(0);
}).catch(async error=>{
  if(client)await client.close().catch(()=>{});
  fs.writeFileSync(path.join(root,'project-cutover-failure.json'),JSON.stringify({success:false,code:error.code||'cutover_failed',activatedPossibly:activated||fs.existsSync(path.join(root,'copies/approved-project/active-workspace.json')),sourceUnchanged:hash()===expectedHash,noAutomaticRollback:true}),{flag:'wx'});
  console.error('Project copy cutover failed; original and failure evidence retained.');clearTimeout(timer);app.exit(1);
});
