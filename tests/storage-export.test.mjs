import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir,readFile,writeFile,cp } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { storageFixture } from './helpers/storage-fixture.mjs';
import { prepareWorkspaceCopy } from '../packages/storage/prepare-workspace.mjs';
import { exportWorkspace } from '../packages/storage/workspace-export.mjs';
import { BlobStore,contentHash } from '../packages/storage/blob-store.mjs';
import { WorkspaceManifestWriter,readWorkspaceManifest } from '../packages/storage/workspace-manifest.mjs';
import { verifyWorkspaceExport } from '../packages/storage/verify-workspace-export.mjs';
import { restoreWorkspace } from '../packages/storage/restore-workspace.mjs';
import { ApplicationStore } from '../packages/storage/application-store.mjs';

test('recovery bundle includes post-migration WAL writes and exact blobs without rewriting V1',async()=>{
  const {db:unused,dir,source}=await storageFixture('workspace-export'); unused.close();
  const recoveryRoot=path.join(dir,'recovery'),destinationRoot=path.join(dir,'copies');
  await mkdir(recoveryRoot); await mkdir(destinationRoot);
  const original=await readFile(source);
  const migrated=await prepareWorkspaceCopy({source,recoveryRoot,destinationRoot,name:'migrated'});
  const database=migrated.archivePath,blobRoot=path.join(path.dirname(database),'blobs');
  const writer=new DatabaseSync(database); writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
  const workspaceId=writer.prepare('SELECT id FROM Workspace').get().id;
  const manifestWriter=await WorkspaceManifestWriter.acquire(path.dirname(database));
  try {
    await manifestWriter.publish({workspaceId,database:'archive.db',blobRoot:'blobs',expectedGeneration:0});
    assert.equal((await readWorkspaceManifest(path.dirname(database))).workspaceId,workspaceId);
  } finally {manifestWriter.close();}
  writer.prepare('UPDATE Workspace SET name=?,revision=revision+1').run('合成迁移后新写入😀');
  const hash=await new BlobStore(blobRoot).put(Buffer.from('new synthetic attachment'));
  try {
    const result=await exportWorkspace({database,blobRoot,recoveryRoot,name:'exported',workspaceId});
    assert.equal(result.v1ImportSupported,false); assert.equal(result.containsPrivateData,true);
    assert.equal((await verifyWorkspaceExport({directory:result.directory,workspaceId})).valid,true);
    const restoredWorkspace=await restoreWorkspace({bundleRoot:result.directory,destinationRoot:recoveryRoot,name:'restored-workspace',workspaceId});
    assert.deepEqual(await readFile(path.join(restoredWorkspace.root,'restore-source-bundle.json')),await readFile(path.join(result.directory,'bundle.json')));
    await assert.rejects(readFile(path.join(restoredWorkspace.root,'bundle.json')),{code:'ENOENT'});
    const appStore=await ApplicationStore.open(restoredWorkspace.root);
    const request=(method,payload={})=>({v:1,id:crypto.randomUUID(),workspaceId,method,payload});
    let appendRequest,appendReceipt;
    try {
      assert.equal((await appStore.dispatch(request('workspace.info'))).name,'合成迁移后新写入😀');
      const conversation=(await appStore.dispatch(request('workspace.catalogue',{kind:'conversations'}))).items[0];
      const scope={candidateId:conversation.candidate_id,jobId:conversation.job_id,conversationId:conversation.id};
      const history=await appStore.dispatch(request('history.read',scope));
      appendRequest=request('conversation.append',{...scope,expectedSequence:history.messages.at(-1).sequence,text:'APP write recovered from a second export'});
      appendReceipt=await appStore.dispatch(appendRequest);
    }
    finally {appStore.close();}
    const afterWrites=await exportWorkspace({database:path.join(restoredWorkspace.root,'workspace.db'),blobRoot:path.join(restoredWorkspace.root,'blobs'),recoveryRoot,name:'after-app-writes',workspaceId});
    const secondRestore=await restoreWorkspace({bundleRoot:afterWrites.directory,destinationRoot:recoveryRoot,name:'after-app-restore',workspaceId});
    const secondApp=await ApplicationStore.open(secondRestore.root);
    try{
      assert.deepEqual(await secondApp.dispatch(appendRequest),appendReceipt,'restored receipt prevents duplicate append');
      const {candidateId,jobId,conversationId}=appendRequest.payload;
      const history=await secondApp.dispatch(request('history.read',{candidateId,jobId,conversationId}));
      assert.equal(history.messages.filter(message=>message.content.parts[0]?.text===appendRequest.payload.text).length,1);
    }finally{secondApp.close();}
    await assert.rejects(restoreWorkspace({bundleRoot:result.directory,destinationRoot:recoveryRoot,name:'restored-workspace',workspaceId}),{code:'EEXIST'});
    await assert.rejects(verifyWorkspaceExport({directory:result.directory,workspaceId:'wrong-workspace'}),/invalid recovery bundle/);
    const restored=new DatabaseSync(path.join(result.directory,'workspace.db'),{readOnly:true});
    try {
      assert.equal(restored.prepare('SELECT name FROM Workspace').get().name,'合成迁移后新写入😀');
      for(const [table,count] of Object.entries(result.counts)) assert.equal(restored.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n,count);
    } finally {restored.close();}
    for(const file of result.files) assert.equal(contentHash(await readFile(path.join(result.directory,file.path))),file.sha256);
    assert.equal((await new BlobStore(path.join(result.directory,'blobs')).read(hash)).toString(),'new synthetic attachment');
    const table=result.files.find(file=>file.table==='Workspace');
    assert.equal(JSON.parse(await readFile(path.join(result.directory,table.path),'utf8')).name,'合成迁移后新写入😀');
    // Tampering with JSONL and its claimed hash must still disagree with the
    // SQLite snapshot; no deletion or modification of the original V1 source.
    const tampered=path.join(recoveryRoot,'tampered-copy');
    await cp(result.directory,tampered,{recursive:true,errorOnExist:true,force:false});
    const receiptPath=path.join(tampered,'bundle.json');
    const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
    await writeFile(path.join(tampered,table.path),'{}\n');
    receipt.files.find(file=>file.table==='Workspace').sha256=contentHash('{}\n');
    await writeFile(receiptPath,JSON.stringify(receipt));
    await assert.rejects(verifyWorkspaceExport({directory:tampered,workspaceId}),/invalid recovery bundle/);
    await assert.rejects(exportWorkspace({database,blobRoot,recoveryRoot,name:'exported',workspaceId}),{code:'EEXIST'});
    await writeFile(path.join(blobRoot,hash),'deliberately corrupt synthetic object');
    await assert.rejects(exportWorkspace({database,blobRoot,recoveryRoot,name:'failed-export',workspaceId}),/blob integrity mismatch/);
    await assert.rejects(readFile(path.join(recoveryRoot,'failed-export','bundle.json')),{code:'ENOENT'});
    assert.deepEqual(await readFile(source),original);
  } finally {writer.close();}
});
