import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {storageFixture} from './helpers/storage-fixture.mjs';
import {prepareWorkspaceCopy} from '../packages/storage/prepare-workspace.mjs';
import {WorkspaceManifestWriter} from '../packages/storage/workspace-manifest.mjs';
import {ApplicationStore} from '../packages/storage/application-store.mjs';

test('APP owns storage, recovers interrupted state and retains idempotent writes across restarts',async()=>{
  const {db:unused,source,dir}=await storageFixture('application-store');unused.close();
  const recoveryRoot=path.join(dir,'recovery'),destinationRoot=path.join(dir,'copies');await mkdir(recoveryRoot);await mkdir(destinationRoot);
  const copy=await prepareWorkspaceCopy({source,recoveryRoot,destinationRoot,name:'v2'}),root=path.dirname(copy.archivePath);
  const fixture=new DatabaseSync(copy.archivePath),workspaceId=fixture.prepare('SELECT id FROM Workspace').get().id;
  const conversation=fixture.prepare('SELECT * FROM Conversation').get();
  fixture.exec("UPDATE AgentRun SET state='running',ended_at=NULL; UPDATE Message SET delivery_status='streaming' WHERE role='assistant'"); fixture.close();
  const owner=await WorkspaceManifestWriter.acquire(root);
  try {await owner.publish({workspaceId,database:'archive.db',blobRoot:'blobs',expectedGeneration:0});} finally {owner.close();}
  let store=await ApplicationStore.open(root);
  const request=(method,payload={})=>({v:1,id:randomUUID(),workspaceId,method,payload});
  const scope={conversationId:conversation.id,candidateId:conversation.candidate_id,jobId:conversation.job_id};
  try {
    await assert.rejects(ApplicationStore.open(root),{code:'workspace_writer_busy'});
    const catalogue=await store.dispatch(request('workspace.catalogue',{kind:'artifacts',limit:1}));
    assert.equal(catalogue.items.length,1);assert.ok(catalogue.nextId);
    const artifact=catalogue.items[0],artifactScope={candidateId:artifact.candidate_id,jobId:artifact.job_id,artifactId:artifact.id};
    assert.equal((await store.dispatch(request('artifact.read',artifactScope))).readOnly,true);
    await assert.rejects(store.dispatch(request('artifact.read',{...artifactScope,candidateId:'foreign'})),{code:'artifact_unavailable'});
    await assert.rejects(store.dispatch(request('workspace.catalogue',{kind:'sqlite_schema'})),{code:'invalid_payload'});
    assert.equal((await store.dispatch(request('workspace.catalogue',{kind:'conversations'}))).items.length,1);
    assert.equal((await store.dispatch(request('workspace.catalogue',{kind:'documents'}))).items.length,3);
    const activities=await store.dispatch(request('workspace.catalogue',{kind:'activities'}));assert.equal(activities.items.length,2);
    const legacy=new DatabaseSync(source,{readOnly:true});
    try{for(const item of activities.items){
      const payload={candidateId:item.candidate_id,jobId:item.job_id,eventId:item.id};
      const activity=await store.dispatch(request('activity.read',payload));
      assert.equal(activity.executionAllowed,false);
      const original=legacy.prepare(`SELECT * FROM ${activity.legacyTable} WHERE id=?`).get(activity.legacyId);
      for(const column of legacy.prepare(`PRAGMA table_info(${activity.legacyTable})`).all())
        if(column.type==='JSON' && original[column.name]!=null)original[column.name]=JSON.parse(original[column.name]);
      assert.deepEqual(activity.record,{...original},'all historical approval/application fields retained');
      await assert.rejects(store.dispatch(request('activity.read',{...payload,candidateId:'foreign'})),{code:'activity_unavailable'});
    }}finally{legacy.close();}
    const history=await store.dispatch(request('history.read',scope));
    const append=request('conversation.append',{...scope,expectedSequence:history.messages.at(-1).sequence,text:'合成新消息😀'});
    const result=await store.dispatch(append);
    assert.deepEqual(await store.dispatch(append),result);
    await assert.rejects(store.dispatch({...append,payload:{...append.payload,text:'different'}}),{code:'invocation_conflict'});
    await assert.rejects(store.dispatch(request('conversation.append',{...append.payload,candidateId:'foreign'})),/history is not available/);
    await assert.rejects(store.dispatch(request('workspace.info',{sql:'DELETE FROM Workspace'})),{code:'invalid_payload'});
    store.close();store=await ApplicationStore.open(root);
    assert.deepEqual(await store.dispatch(append),result);
    assert.equal((await store.dispatch(request('history.read',scope))).messages.at(-1).content.parts[0].text,'合成新消息😀');
    const db=new DatabaseSync(copy.archivePath,{readOnly:true});
    try {
      assert.equal(db.prepare('SELECT state FROM AgentRun').get().state,'interrupted');
      assert.equal(db.prepare("SELECT count(*) AS n FROM Message WHERE delivery_status='streaming'").get().n,0);
      assert.equal(db.prepare("SELECT count(*) AS n FROM Event WHERE type='workspace.recovered'").get().n,1);
    } finally {db.close();}
  } finally {store.close();}
});
