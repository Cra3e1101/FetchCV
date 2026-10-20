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
import {exportWorkspace} from '../packages/storage/workspace-export.mjs';
import {verifyWorkspaceExport} from '../packages/storage/verify-workspace-export.mjs';
import {restoreWorkspace} from '../packages/storage/restore-workspace.mjs';

async function setup(name){
  const {db,source,dir}=await storageFixture(name);db.close();
  const recoveryRoot=path.join(dir,'recovery'),destinationRoot=path.join(dir,'copies');await mkdir(recoveryRoot);await mkdir(destinationRoot);
  const copy=await prepareWorkspaceCopy({source,recoveryRoot,destinationRoot,name:'v2'}),root=path.dirname(copy.archivePath);
  const probe=new DatabaseSync(copy.archivePath,{readOnly:true});
  const workspaceId=probe.prepare('SELECT id FROM Workspace').get().id,conversation=probe.prepare('SELECT * FROM Conversation').get();probe.close();
  const owner=await WorkspaceManifestWriter.acquire(root);try{await owner.publish({workspaceId,database:'archive.db',blobRoot:'blobs',expectedGeneration:0});}finally{owner.close();}
  const store=await ApplicationStore.open(root),bridge=store.createAgentBridge();
  const request=(method,payload)=>store.dispatch({v:1,id:randomUUID(),workspaceId,method,payload});
  const api=(url,body)=>bridge.request('','',`/api/pi/${url}`,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});
  const begin=(body={})=>api(`conversations/${conversation.id}/turns`,{request_id:randomUUID(),content:'合成请求',provider:{model:'test-model'},...body});
  return {store,bridge,request,api,begin,root,copy,workspaceId,conversation};
}

test('APP Pi persistence retains runs, input receipts, tool results and immutable user-approved drafts',async()=>{
  const f=await setup('agent-persistence'),{store,api,begin,request,conversation:c}=f;
  try{
    const scope={candidateId:c.candidate_id,jobId:c.job_id};
    const history=await request('history.read',{...scope,conversationId:c.id});
    await request('conversation.append',{...scope,conversationId:c.id,expectedSequence:history.messages.at(-1).sequence,text:'LOCAL-NOTE-MUST-NOT-REACH-MODEL'});
    const start=await begin();assert.equal(JSON.stringify(start.history).includes('LOCAL-NOTE'),false);
    await assert.rejects(begin(),{code:'conversation_busy'});
    const req={sequence:1,record:{sequence:1,payloadHash:'synthetic'}};
    assert.deepEqual(await api(`records/turn/${start.user.id}/requests`,req),await api(`records/turn/${start.user.id}/requests`,req));
    await assert.rejects(api(`records/turn/${start.user.id}/requests`,{sequence:1,record:{sequence:1,payloadHash:'different'}}),{code:'request_record_conflict'});
    const tool=(name,args,key=randomUUID())=>api(`runs/${start.run_id}/tools/${name}`,{arguments:args,idempotency_key:key,tool_revision:start.tools.find(t=>t.name===name).revision});
    const catalogue=(await tool('inspect_application_workspace',{})).result;
    const artifact=catalogue.artifacts.items.find(a=>a.kind==='resume');assert.ok(artifact);
    const base=(await tool('read_artifact',{artifactId:artifact.id})).result;
    await assert.rejects(tool('read_artifact',{artifactId:'foreign'}),{code:'artifact_unavailable'});
    const draftArgs={artifactId:artifact.id,basedOnVersionId:base.versionId,basedOnHash:base.contentHash,text:'合成审阅稿，无新造经历',reason:'合成措辞修改'};
    const invocation=randomUUID(),proposal=(await tool('propose_artifact',draftArgs,invocation)).result;
    assert.deepEqual((await tool('propose_artifact',draftArgs,invocation)).result,proposal);
    await assert.rejects(tool('propose_artifact',{...draftArgs,text:'different'},invocation),{code:'invocation_conflict'});
    const artifactScope={candidateId:artifact.candidate_id,jobId:artifact.job_id};
    assert.equal((await request('artifact.read',{...artifactScope,artifactId:artifact.id})).versionId,base.versionId,'proposal does not publish');
    await assert.rejects(request('approval.read',{...artifactScope,candidateId:'foreign',approvalId:proposal.approvalId}),{code:'approval_unavailable'});
    const review=await request('approval.read',{...artifactScope,approvalId:proposal.approvalId});assert.equal(review.proposed.content.content,draftArgs.text);
    await assert.rejects(request('approval.decide',{...artifactScope,approvalId:proposal.approvalId,operationHash:'wrong',decision:'approved'}),{code:'approval_operation_mismatch'});
    const decision={...artifactScope,approvalId:proposal.approvalId,operationHash:proposal.operationHash,decision:'approved'};
    assert.deepEqual(await request('approval.decide',decision),await request('approval.decide',decision));
    assert.equal((await request('artifact.read',{...artifactScope,artifactId:artifact.id})).versionId,proposal.versionId);
    assert.equal((await request('artifact.read',{...artifactScope,artifactId:artifact.id,versionId:base.versionId})).contentHash,base.contentHash,'old version immutable');
    const finish={content:'合成回答已保存',usage:{total_tokens:10}};
    assert.deepEqual(await api(`turns/${start.user.id}/complete`,finish),await api(`turns/${start.user.id}/complete`,finish));
    await assert.rejects(tool('read_artifact',{artifactId:artifact.id}),{code:'run_inactive'});
    const saved=await request('history.read',{...scope,conversationId:c.id});assert.equal(saved.messages.at(-1).content.parts[0].text,finish.content);
    const db=new DatabaseSync(f.copy.archivePath,{readOnly:true});try{
      assert.equal(db.prepare("SELECT count(*) n FROM AgentRun WHERE runtime_id='pi-app' AND state='completed'").get().n,1);
      assert.equal(db.prepare("SELECT count(*) n FROM Event WHERE type='agent.provider.request'").get().n,1);
      assert.equal(db.prepare("SELECT count(*) n FROM Approval a JOIN ToolCall t ON t.id=a.tool_call_id WHERE a.policy_revision='m4-artifact-2' AND a.operation_hash=t.operation_hash").get().n,1);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{db.close();}
    store.close();
    const recoveryRoot=path.join(f.root,'agent-recovery-bundles');await mkdir(recoveryRoot);
    const owner=await WorkspaceManifestWriter.acquire(f.root);let bundle;
    try{bundle=await exportWorkspace({database:f.copy.archivePath,blobRoot:path.join(f.root,'blobs'),recoveryRoot,name:'with-agent-writes',workspaceId:f.workspaceId});}finally{owner.close();}
    assert.equal((await verifyWorkspaceExport({directory:bundle.directory,workspaceId:f.workspaceId})).valid,true);
    const restored=await restoreWorkspace({bundleRoot:bundle.directory,destinationRoot:recoveryRoot,name:'restored',workspaceId:f.workspaceId});
    const restoredStore=await ApplicationStore.open(restored.root);
    try{
      const resumedBridge=restoredStore.createAgentBridge();
      const repeated=await resumedBridge.request('','',`/api/pi/turns/${start.user.id}/complete`,{body:JSON.stringify(finish)});
      assert.equal(repeated.assistant.content,finish.content);
      const approved=await restoredStore.dispatch({v:1,id:randomUUID(),workspaceId:f.workspaceId,method:'artifact.read',payload:{...artifactScope,artifactId:artifact.id}});
      assert.equal(approved.versionId,proposal.versionId);assert.equal(approved.content.content,draftArgs.text);
    }finally{restoredStore.close();}
  }finally{store.close();}
});

test('APP refuses raw attachments/false quotes, retains unconsumed input, and fences late completion after restart',async()=>{
  const f=await setup('agent-recovery'),{api,begin}=f;let store=f.store;
  try{
    await assert.rejects(begin({attachment_paths:['C:\\private.txt']}),{code:'attachment_reference_required'});
    await assert.rejects(begin({quoted_message_id:'foreign',quoted_text:'forged'}),{code:'quote_unavailable'});
    const start=await begin(),steered=await api(`runs/${start.run_id}/steer`,{content:'合成补充'});
    await api(`inputs/${steered.message.id}/state`,{state:'unconsumed'});
    await api(`tasks/${start.run_id}/checkpoint`,{sequence:1,phase:'working'});
    await assert.rejects(api(`tasks/${start.run_id}/checkpoint`,{sequence:1,phase:'different'}),{code:'checkpoint_conflict'});
    store.close();store=await ApplicationStore.open(f.root);const bridge=store.createAgentBridge();
    await assert.rejects(bridge.request('','',`/api/pi/turns/${start.user.id}/complete`,{body:JSON.stringify({content:'late'})}),{code:'run_inactive'});
    const db=new DatabaseSync(f.copy.archivePath,{readOnly:true});try{
      assert.equal(db.prepare('SELECT state FROM AgentRun WHERE id=?').get(start.run_id).state,'interrupted');
      assert.equal(db.prepare('SELECT delivery_status FROM Message WHERE id=?').get(steered.message.id).delivery_status,'queued');
    }finally{db.close();}
    const created=await store.dispatch({v:1,id:randomUUID(),workspaceId:f.workspaceId,method:'conversation.create',payload:{title:'无岗位的普通对话'}});
    assert.equal(created.job_id,null);assert.equal(created.candidate_id,null);
  }finally{store.close();}
});

test('approval binds tool operation and refuses stale targets or revived post-restart permissions',async()=>{
  const f=await setup('agent-approval-fencing');let store=f.store;
  try{
    const start=await f.begin();
    const inspection=start.tools.find(t=>t.name==='inspect_application_workspace');
    const catalogue=await f.api(`runs/${start.run_id}/tools/inspect_application_workspace`,{arguments:{},idempotency_key:randomUUID(),tool_revision:inspection.revision});
    const artifact=catalogue.result.artifacts.items.find(a=>a.kind==='resume'),scope={candidateId:artifact.candidate_id,jobId:artifact.job_id};
    const base=await f.request('artifact.read',{...scope,artifactId:artifact.id}),definition=start.tools.find(t=>t.name==='propose_artifact');
    const drafts=[];
    for(const text of ['synthetic version A','synthetic version B'])drafts.push((await f.api(`runs/${start.run_id}/tools/propose_artifact`,{arguments:{artifactId:artifact.id,basedOnVersionId:base.versionId,basedOnHash:base.contentHash,text,reason:'Synthetic comparison'},idempotency_key:randomUUID(),tool_revision:definition.revision})).result);
    const decide=proposal=>({...scope,approvalId:proposal.approvalId,operationHash:proposal.operationHash,decision:'approved'});
    await f.request('approval.decide',decide(drafts[0]));
    await assert.rejects(f.request('approval.decide',decide(drafts[1])),{code:'artifact_revision_conflict'});
    store.close();store=await ApplicationStore.open(f.root);
    await assert.rejects(store.dispatch({v:1,id:randomUUID(),workspaceId:f.workspaceId,method:'approval.decide',payload:decide(drafts[1])}),{code:'approval_expired'});
    const db=new DatabaseSync(f.copy.archivePath,{readOnly:true});try{
      assert.equal(db.prepare('SELECT current_version_id FROM Artifact WHERE id=?').get(artifact.id).current_version_id,drafts[0].versionId);
      assert.equal(db.prepare('SELECT decision FROM Approval WHERE id=?').get(drafts[1].approvalId).decision,'expired');
    }finally{db.close();}
  }finally{store.close();}
});
