import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {activeWorkspace} from './helpers/active-workspace.mjs';
import {exportWorkspace} from '../packages/storage/workspace-export.mjs';
import {restoreWorkspace} from '../packages/storage/restore-workspace.mjs';
import {verifyWorkspaceExport} from '../packages/storage/verify-workspace-export.mjs';
import {ApplicationStore} from '../packages/storage/application-store.mjs';
import {WorkspaceManifestWriter} from '../packages/storage/workspace-manifest.mjs';

// Synthetic IR isolates storage/retrieval from the separately tested parsers.
const parse=async bytes=>{const text=bytes.toString();return {schemaVersion:1,parserId:'fetchcv-local',parserRevision:'local-structured-1',format:'txt',offsetUnit:'unicode_codepoint',source_text:text,
  quality:{status:'ready'},blocks:[{type:'text',text,charStart:0,charEnd:[...text].length,headingPath:[],originRef:{type:'text'}}]};};
test('source versions, scoped Chinese retrieval, confirmed memory and FTS survive protected export/restore',async()=>{
  const f=await activeWorkspace('knowledge-roundtrip'),c=f.conversation,scope={candidateId:c.candidate_id,jobId:c.job_id},ingestion=f.store.createIngestion();
  const samples=[['星河营销','提升转化率 17%，预算 3 万元。'],['海岚仓储','库存准确率 98%，复核 52 批。'],['青禾研发','只读缓存，延迟 12 毫秒。']];
  const receipts=[],measurements=[];
  try{
    for(const [name,text]of samples){
      const captured=await f.request('source.import',{...scope,title:name,format:'txt',contentBase64:Buffer.from(name+'：'+text).toString('base64')});
      receipts.push({...captured,...await ingestion.process(captured.jobId,parse)});
    }
    // Higher-density matches in a different scope must not crowd out authorized results.
    for(let i=0;i<5;i++){
      const captured=await f.request('source.import',{title:'foreign '+i,format:'txt',contentBase64:Buffer.from('星河营销 '.repeat(20)).toString('base64')});
      await ingestion.process(captured.jobId,parse);
    }
    for(const [i,[query]]of samples.entries()){
      const start=performance.now(),result=await f.request('knowledge.search',{...scope,query,limit:1});
      measurements.push({query,milliseconds:performance.now()-start,top1Correct:result.items[0]?.sourceId===receipts[i].sourceId});
      assert.equal(result.items[0].sourceId,receipts[i].sourceId);
      assert.equal((await f.request('citation.resolve',{...scope,citation:result.items[0].citation})).text,result.items[0].text);
    }
    const beforeTime=new Date().toISOString();await new Promise(resolve=>setTimeout(resolve,5));
    const changed=await f.request('source.import',{...scope,sourceId:receipts[0].sourceId,expectedRevision:1,title:'星河营销',format:'txt',contentBase64:Buffer.from('星河营销：2026 新版本，22%。').toString('base64')});
    await ingestion.process(changed.jobId,parse);
    assert.match((await f.request('knowledge.search',{...scope,query:'星河营销',limit:1})).items[0].text,/22%/);
    assert.match((await f.request('knowledge.search',{...scope,query:'星河营销',limit:1,asOf:beforeTime})).items[0].text,/17%/);
    const history=await f.request('history.read',{...scope,conversationId:c.id});
    const m=await f.request('conversation.append',{...scope,conversationId:c.id,expectedSequence:history.messages.at(-1).sequence,text:'简历一页'});
    const candidate=await f.request('memory.propose',{...scope,messageId:m.messageId,start:0,end:4,kind:'preference',subject:'resume',predicate:'length'});
    await f.request('memory.decide',{...scope,memoryId:candidate.id,expectedRevision:1,decision:'confirmed'});
    const duplicateConversation=await f.request('conversation.create',{...scope,title:'Separate source for the same preference'});
    const duplicate=await f.request('conversation.append',{...scope,conversationId:duplicateConversation.id,expectedSequence:0,text:'简历一页'});
    const merged=await f.request('memory.propose',{...scope,messageId:duplicate.messageId,start:0,end:4,kind:'preference',subject:'resume',predicate:'length'});
    assert.equal(merged.id,candidate.id);assert.equal(merged.sourceCount,2);
    const factCitation=(await f.request('knowledge.search',{...scope,query:'星河营销',limit:1})).items[0].citation;
    const fact=await f.request('fact.confirm',{...scope,citation:factCitation});
    const recoveryRoot=path.join(f.root,'knowledge-recovery');await mkdir(recoveryRoot);f.store.close();
    const owner=await WorkspaceManifestWriter.acquire(f.root);let bundle;
    try{bundle=await exportWorkspace({database:f.copy.archivePath,blobRoot:path.join(f.root,'blobs'),recoveryRoot,name:'bundle',workspaceId:f.workspaceId});}finally{owner.close();}
    assert.equal((await verifyWorkspaceExport({directory:bundle.directory,workspaceId:f.workspaceId})).valid,true);
    const restored=await restoreWorkspace({bundleRoot:bundle.directory,destinationRoot:recoveryRoot,name:'restored',workspaceId:f.workspaceId});
    const store=await ApplicationStore.open(restored.root),request=(method,payload)=>store.dispatch({v:1,id:randomUUID(),workspaceId:f.workspaceId,method,payload});
    try{
      assert.equal((await request('memory.list',scope)).items[0].value,'简历一页');
      assert.equal((await request('memory.list',scope)).factReferences[0].knowledgeId,fact.knowledgeId);
      assert.equal((await request('memory.source',{...scope,memoryId:candidate.id})).sources.length,2);
      assert.match((await request('knowledge.search',{...scope,query:'星河营销',limit:1})).items[0].text,/22%/);
      await request('source.revoke',{...scope,sourceId:changed.sourceId,expectedRevision:2});
      assert.equal((await request('memory.list',scope)).factReferences.length,0);
      const unavailable=(await request('memory.list',{...scope,includeInactive:true})).factReferences[0];
      assert.equal(unavailable.evidenceUnavailable,true);assert.equal(unavailable.value,undefined);
      assert.equal(store.createIngestion().db.prepare('SELECT status FROM KnowledgeItem WHERE id=?').get(fact.knowledgeId).status,'disabled');
      assert.equal((await request('knowledge.search',{...scope,query:'星河营销',asOf:beforeTime})).items.length,0);
    }finally{store.close();}
    await writeFile(path.join(process.env.M1_ALLOWED_DELETE_ROOT,'knowledge-pilot.json'),JSON.stringify({syntheticOnly:true,humanSealedBenchmark:false,sources:8,queries:3,measurements,restorePassed:true},null,2),{flag:'wx'});
  }finally{f.store.close();}
});

test('APP blocks provider dispatch after cited evidence is withdrawn',async()=>{
  const f=await activeWorkspace('context-evidence'),bridge=f.store.createAgentBridge(),c=f.conversation,scope={candidateId:c.candidate_id,jobId:c.job_id};
  const api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
  try{
    const start=await api(`conversations/${c.id}/turns`,{request_id:randomUUID(),content:'Synthetic search',provider:{model:'fixture'}});
    const definition=start.tools.find(t=>t.name==='search_knowledge');
    const call={arguments:{query:'Synthetic'},idempotency_key:randomUUID(),tool_revision:definition.revision};
    const result=await api(`runs/${start.run_id}/tools/search_knowledge`,call);
    assert.ok(result.result.items.length);bridge.validateEvidenceForRequest(start.run_id);
    const db=new DatabaseSync(f.copy.archivePath),row=db.prepare('SELECT revision FROM Source WHERE id=?').get(result.result.items[0].sourceId);db.close();
    await f.request('source.revoke',{...scope,sourceId:result.result.items[0].sourceId,expectedRevision:row.revision});
    await assert.rejects(api(`runs/${start.run_id}/tools/search_knowledge`,call),{code:'citation_unavailable'});
    await assert.rejects(api(`records/turn/${start.user.id}/requests`,{sequence:1,record:{sequence:1}}),{code:'citation_unavailable'});
    const check=new DatabaseSync(f.copy.archivePath,{readOnly:true});assert.equal(check.prepare("SELECT count(*) n FROM Event WHERE run_id=? AND type='agent.provider.request'").get(start.run_id).n,0);check.close();
  }finally{f.store.close();}
});

test('APP rechecks a consumed confirmed memory before the next model dispatch',async()=>{
  const f=await activeWorkspace('context-memory'),bridge=f.store.createAgentBridge(),c=f.conversation,scope={candidateId:c.candidate_id,jobId:c.job_id};
  const api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
  try{
    const text='记住：简历保持一页',start=await api(`conversations/${c.id}/turns`,{request_id:randomUUID(),content:text,provider:{model:'fixture'}});
    const m=await f.request('memory.propose',{...scope,messageId:start.user.id,start:0,end:[...text].length,kind:'preference',subject:'resume',predicate:'length'});
    await f.request('memory.decide',{...scope,memoryId:m.id,expectedRevision:1,decision:'confirmed'});
    const read=start.tools.find(t=>t.name==='read_memory');
    const response=await api(`runs/${start.run_id}/tools/read_memory`,{arguments:{},idempotency_key:randomUUID(),tool_revision:read.revision});
    assert.equal(response.result.items[0].id,m.id);bridge.validateEvidenceForRequest(start.run_id);
    await f.request('memory.decide',{...scope,memoryId:m.id,expectedRevision:2,decision:'revoked'});
    await assert.rejects(api(`records/turn/${start.user.id}/requests`,{sequence:1,record:{sequence:1}}),{code:'context_memory_stale'});
  }finally{f.store.close();}
});

test('dispatch validates selected calls; dropping a revoked result does not poison new context or other caches',async()=>{
  const f=await activeWorkspace('context-selected'),bridge=f.store.createAgentBridge(),c=f.conversation,scope={candidateId:c.candidate_id,jobId:c.job_id};
  const api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
  try{
    const start=await api(`conversations/${c.id}/turns`,{request_id:randomUUID(),content:'Synthetic search',provider:{model:'fixture'}});
    const tool=(name,id,args={})=>api(`runs/${start.run_id}/tools/${name}`,{arguments:args,idempotency_key:`pi:${start.user.id}:${id}`,tool_revision:start.tools.find(t=>t.name===name).revision});
    const found=(await tool('search_knowledge','search',{query:'Synthetic'})).result;
    const history=await tool('read_conversation','history');
    const db=new DatabaseSync(f.copy.archivePath),row=db.prepare('SELECT revision FROM Source WHERE id=?').get(found.items[0].sourceId);db.close();
    await f.request('source.revoke',{...scope,sourceId:found.items[0].sourceId,expectedRevision:row.revision});
    const record=ids=>({sequence:1,record:{sequence:1,contextManifest:{revision:'whole-turn-context-2',selectedToolCallIds:ids,selectedInputIds:[]}}});
    await assert.rejects(api(`records/turn/${start.user.id}/requests`,record(['search'])),{code:'citation_unavailable'});
    assert.deepEqual(await tool('read_conversation','history'),history);
    assert.equal((await api(`records/turn/${start.user.id}/requests`,record([]))).sequence,1);
  }finally{f.store.close();}
});

test('a pending memory proposal cannot reuse a withdrawn source through cache or model dispatch',async()=>{
  const f=await activeWorkspace('context-memory-proposal'),bridge=f.store.createAgentBridge(),c=f.conversation,scope={candidateId:c.candidate_id,jobId:c.job_id};
  const api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
  try{
    const history=await f.request('history.read',{...scope,conversationId:c.id});
    const source=await f.request('conversation.append',{...scope,conversationId:c.id,expectedSequence:history.messages.at(-1).sequence,text:'简历保持一页'});
    const start=await api(`conversations/${c.id}/turns`,{request_id:randomUUID(),content:'提取候选',provider:{model:'fixture'}});
    const call={arguments:{messageId:source.messageId,start:0,end:6,kind:'preference',subject:'resume',predicate:'length'},idempotency_key:`pi:${start.user.id}:proposal`,tool_revision:start.tools.find(t=>t.name==='propose_memory').revision};
    const url=`runs/${start.run_id}/tools/propose_memory`;
    const proposal=await api(url,call);assert.equal(proposal.result.status,'pending');assert.deepEqual(await api(url,call),proposal);
    const db=new DatabaseSync(f.copy.archivePath);db.prepare('UPDATE Message SET deleted_at=? WHERE id=?').run(new Date().toISOString(),source.messageId);db.close();
    await assert.rejects(api(url,call),{code:'memory_evidence_unavailable'});
    await assert.rejects(api(`records/turn/${start.user.id}/requests`,{sequence:1,record:{sequence:1,contextManifest:{revision:'whole-turn-context-2',selectedToolCallIds:['proposal'],selectedInputIds:[]}}}),{code:'memory_evidence_unavailable'});
  }finally{f.store.close();}
});

test('withdrawn attachments and quoted messages are checked at dispatch, even without tool calls',async()=>{
  for(const kind of ['attachment','quote','catalogue']){
    const f=await activeWorkspace('context-input-'+kind),bridge=f.store.createAgentBridge(),c=f.conversation,scope={candidateId:c.candidate_id,jobId:c.job_id};
    const api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
    try{
      const doc=(await f.request('knowledge.search',{...scope,query:'Synthetic',limit:1})).items[0];assert.ok(doc);
      const history=await f.request('history.read',{...scope,conversationId:c.id});
      const sourceMessage=history.messages.find(m=>m.content.parts.some(p=>p.type==='text'&&p.text));
      const extra=kind==='attachment'?{attachment_paths:[`document:${doc.documentId}`]}:kind==='quote'?{quoted_message_id:sourceMessage.id,quoted_text:sourceMessage.content.parts.find(p=>p.type==='text').text}:{};
      const start=await api(`conversations/${c.id}/turns`,{request_id:randomUUID(),content:'核对原文',provider:{model:'fixture'},...extra});
      if(kind==='catalogue')await api(`runs/${start.run_id}/tools/inspect_application_workspace`,{arguments:{},idempotency_key:`pi:${start.user.id}:catalogue`,tool_revision:start.tools.find(t=>t.name==='inspect_application_workspace').revision});
      const db=new DatabaseSync(f.copy.archivePath);
      if(kind==='quote')db.prepare('UPDATE Message SET deleted_at=? WHERE id=?').run(new Date().toISOString(),sourceMessage.id);
      else {const row=db.prepare('SELECT revision FROM Source WHERE id=?').get(doc.sourceId);await f.request('source.revoke',{...scope,sourceId:doc.sourceId,expectedRevision:row.revision});}
      db.close();
      await assert.rejects(api(`records/turn/${start.user.id}/requests`,{sequence:1,record:{sequence:1,contextManifest:{revision:'whole-turn-context-2',selectedToolCallIds:kind==='catalogue'?['catalogue']:[],selectedInputIds:[]}}}),{code:'context_evidence_stale'});
    }finally{f.store.close();}
  }
});
