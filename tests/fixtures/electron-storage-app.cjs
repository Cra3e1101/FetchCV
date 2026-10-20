require(require('node:path').join(process.cwd(),'scripts/m1/guard-node-deletions.cjs'));
const {app,utilityProcess}=require('electron');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const root=process.env.M1_ALLOWED_DELETE_ROOT;
for(const name of ['user-data','session-data']) fs.mkdirSync(path.join(root,name));
app.setPath('userData',path.join(root,'user-data'));app.setPath('sessionData',path.join(root,'session-data'));app.setPath('temp',root);app.disableHardwareAcceleration();
const timer=setTimeout(()=>app.exit(2),60000);
app.whenReady().then(async()=>{
  const {startStorageUtility}=await import('../../electron/storage-client.mjs');
  const {workspaceRoot,workspaceId,scope}=JSON.parse(fs.readFileSync(path.join(root,'input.json'),'utf8'));
  const options={utilityProcess,entry:path.resolve('tests/fixtures/storage-worker-guarded.cjs'),root:workspaceRoot};
  const req=(method,payload={})=>({v:1,id:randomUUID(),workspaceId,method,payload});
  let client=await startStorageUtility(options);
  try {
    const history=await client.request(req('history.read',scope));
    const append=req('conversation.append',{...scope,expectedSequence:history.messages.at(-1).sequence,text:'actual utility synthetic write'});
    const result=await client.request(append);
    await assert.rejects(startStorageUtility(options),/storage_startup_failed|storage_process_exited/);
    await client.terminate();client=await startStorageUtility(options);
    assert.deepEqual(await client.request(append),result);
    assert.equal((await client.request(req('history.read',scope))).messages.at(-1).content.parts[0].text,'actual utility synthetic write');
    await assert.rejects(client.request(req('workspace.info',{database:'outside.db'})),{code:'invalid_payload'});
    fs.writeFileSync(path.join(root,'utility-report.json'),JSON.stringify({success:true,electron:process.versions.electron,packaged:app.isPackaged,restarted:true,singleWriter:true,receiptRecovered:true}),{flag:'wx'});
  } finally {await client.close();}
  clearTimeout(timer);app.exit(0);
}).catch(error=>{console.error(error.stack);clearTimeout(timer);app.exit(1);});
