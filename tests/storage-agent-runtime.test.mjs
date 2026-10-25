import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {storageFixture} from './helpers/storage-fixture.mjs';
import {prepareWorkspaceCopy} from '../packages/storage/prepare-workspace.mjs';
import {WorkspaceManifestWriter} from '../packages/storage/workspace-manifest.mjs';
import {ApplicationStore} from '../packages/storage/application-store.mjs';
import {WorkspaceAgentService} from '../packages/app/workspace-agent-service.mjs';

test('real Pi SDK uses APP storage and local synthetic provider; cancel does not complete or replay',async()=>{
  const {db:old,source,dir}=await storageFixture('app-pi-sdk');old.close();
  const recoveryRoot=path.join(dir,'recovery'),destinationRoot=path.join(dir,'copies');await mkdir(recoveryRoot);await mkdir(destinationRoot);
  const copy=await prepareWorkspaceCopy({source,recoveryRoot,destinationRoot,name:'v2'}),root=path.dirname(copy.archivePath);
  const view=new DatabaseSync(copy.archivePath,{readOnly:true}),workspaceId=view.prepare('SELECT id FROM Workspace').get().id;
  const conversation=view.prepare('SELECT * FROM Conversation').get();
  const artifact=view.prepare("SELECT * FROM Artifact WHERE kind='resume'").get();view.close();
  const writer=await WorkspaceManifestWriter.acquire(root);try{await writer.publish({workspaceId,database:'archive.db',blobRoot:'blobs',expectedGeneration:0});}finally{writer.close();}
  const store=await ApplicationStore.open(root),service=new WorkspaceAgentService(store);
  const base=await store.dispatch({v:1,id:randomUUID(),workspaceId,method:'artifact.read',payload:{artifactId:artifact.id,candidateId:artifact.candidate_id,jobId:artifact.job_id}});
  let count=0,hold=false,notifyArrival;let arrived=new Promise(resolve=>{notifyArrival=resolve;});
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let text='';for await(const part of req)text+=part;
    const body=JSON.parse(text);requests.push(body);notifyArrival();
    if(hold)return; // cancellation must close this outstanding request
    count++;
    const tool=count===1?{name:'read_artifact',arguments:{artifactId:artifact.id}}:count===2?{name:'propose_artifact',arguments:{artifactId:artifact.id,basedOnVersionId:base.versionId,basedOnHash:base.contentHash,text:'Synthetic proposed resume',reason:'Synthetic wording review'}}:null;
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
    const chunk=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:`reply-${count}`,object:'chat.completion.chunk',created:1,model:'gpt-4o-mini',choices:[{index:0,delta,finish_reason}]})}\n\n`);
    chunk({role:'assistant'});
    if(tool){chunk({tool_calls:[{index:0,id:`call-${count}`,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]});chunk({},'tool_calls');}
    else{chunk({content:'Synthetic answer from the real Pi SDK.'});chunk({},'stop');}
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const provider={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'M4-SYNTHETIC-NOT-A-REAL-KEY',model:'gpt-4o-mini',protocol:'openai',providerName:'Synthetic local provider',contextWindow:32768,maxOutputTokens:2048};
  const request=(method,payload)=>({v:1,id:randomUUID(),workspaceId,deadlineMs:Date.now()+30000,method,payload});
  const events=[];
  try{
    const overflowing=request('agent.turn',{conversationId:conversation.id,content:'中'.repeat(4000)});
    const overflow=await service.dispatch(overflowing,'synthetic-window',{...provider,contextWindow:8192},()=>{});
    assert.equal(overflow.error.code,'context_overflow',JSON.stringify(overflow));assert.equal(count,0,'overlarge current input never reaches the provider');
    const userText='读取现有简历并生成待审阅草稿，保留“参与项目”的原始表述。';
    const turn=request('agent.turn',{conversationId:conversation.id,content:userText});
    const result=await service.dispatch(turn,'synthetic-window',provider,event=>events.push(event));
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.result.assistant.content,'Synthetic answer from the real Pi SDK.');
    assert.equal(count,3);assert.ok(events.some(e=>e.name==='done'));
    const instructions=requests[0].messages.find(message=>message.role==='system').content;
    assert.match(instructions,/Simplified Chinese unless the user requests another language/);
    assert.doesNotMatch(instructions,/\p{Script=Han}/u);
    assert(requests[0].messages.some(message=>message.role==='user'&&JSON.stringify(message.content).includes(userText)));
    for(const tool of requests[0].tools)assert.doesNotMatch(tool.function.description,/\p{Script=Han}/u);
    assert.equal(service.providers.size,0,'secret discarded when invocation settles');
    assert.equal(requests.some(body=>JSON.stringify(body).includes(provider.apiKey)),false);
    await assert.rejects(service.dispatch(turn,'synthetic-window',provider,()=>{}),{code:'duplicate_request'});
    const db=new DatabaseSync(copy.archivePath,{readOnly:true});try{
      assert.equal(db.prepare("SELECT count(*) n FROM Event WHERE type='agent.provider.request'").get().n,3);
      const record=JSON.parse(db.prepare("SELECT payload_json FROM Event WHERE type='agent.provider.request' ORDER BY sequence DESC LIMIT 1").get().payload_json).record;
      assert.equal(record.budget.window,32768);assert.equal(record.contextManifest.revision,'whole-turn-context-2');
      assert.deepEqual(record.contextManifest.selectedToolCallIds,['call-1','call-2']);
      assert.equal(db.prepare("SELECT count(*) n FROM Approval WHERE policy_revision='m4-artifact-2' AND decision='pending'").get().n,1);
      assert.equal(db.prepare('SELECT current_version_id FROM Artifact WHERE id=?').get(artifact.id).current_version_id,base.versionId);
      assert.equal(db.prepare('SELECT count(*) n FROM Event WHERE payload_json LIKE ?').get(`%${provider.apiKey}%`).n,0);
    }finally{db.close();}
    hold=true;arrived=new Promise(resolve=>{notifyArrival=resolve;});
    const second=request('agent.turn',{conversationId:conversation.id,content:'Synthetic cancelled request'});
    const running=service.dispatch(second,'synthetic-window',provider,()=>{});await arrived;
    const cancel=request('agent.cancel',{requestId:second.id});
    assert.equal((await service.dispatch(cancel,'foreign-window',null,()=>{})).error.code,'stream_not_found');
    assert.equal((await service.dispatch(cancel,'synthetic-window',null,()=>{})).ok,true);
    const cancelled=await running;assert.equal(cancelled.ok,false);assert.equal(cancelled.error.code,'cancelled');
    arrived=new Promise(resolve=>{notifyArrival=resolve;});
    const task=request('agent.task',{runId:result.result.run_id,kind:'start'});
    const taskStarted=await service.dispatch(task,'synthetic-window',provider,()=>{});
    assert.equal(taskStarted.ok,true,JSON.stringify(taskStarted));await arrived;
    assert.notEqual(taskStarted.result.run_id,result.result.run_id,'explicit continuation owns a new durable run');
    const steer=request('agent.steer',{runId:taskStarted.result.run_id,content:'Synthetic queued supplement'});
    const steered=await service.dispatch(steer,'synthetic-window',null,()=>{});assert.equal(steered.ok,true,JSON.stringify(steered));
    assert.equal((await service.dispatch(request('agent.cancel',{requestId:task.id}),'synthetic-window',null,()=>{})).ok,true);
    await service.close();
    const check=new DatabaseSync(copy.archivePath,{readOnly:true});try{
      assert.equal(check.prepare("SELECT count(*) n FROM AgentRun WHERE runtime_id='pi-app' AND state='cancelled'").get().n,2);
      assert.equal(check.prepare("SELECT count(*) n FROM AgentRun WHERE runtime_id='pi-app' AND state='completed'").get().n,1);
      assert.equal(check.prepare('SELECT delivery_status FROM Message WHERE id=?').get(steered.result.message.id).delivery_status,'cancelled','queued supplement is retained, not silently consumed');
    }finally{check.close();}
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await service.close();store.close();}
});
