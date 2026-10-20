import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {activeWorkspace} from './helpers/active-workspace.mjs';
test('approved export preserves versions and bound citations while revoked sources lose their quote',async()=>{
 const f=await activeWorkspace('artifact-export');
 try{
  const artifact=(await f.request('workspace.catalogue',{kind:'artifacts'})).items.find(x=>x.kind==='resume');
  const scope={candidateId:artifact.candidate_id,jobId:artifact.job_id};
  const captured=await f.request('source.import',{...scope,title:'ExportProof',format:'txt',contentBase64:Buffer.from('ExportProof 中文😀 12 synthetic cases').toString('base64')});
  await f.store.createIngestion().process(captured.jobId,async bytes=>{const text=bytes.toString();return {schemaVersion:1,parserId:'fetchcv-local',parserRevision:'local-structured-1.2',offsetUnit:'unicode_codepoint',format:'txt',source_text:text,quality:{status:'ready'},blocks:[{type:'text',text,charStart:0,charEnd:[...text].length,headingPath:[]}]};});
  const bridge=f.store.createAgentBridge(),api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
  const start=await api(`conversations/${f.conversation.id}/turns`,{request_id:randomUUID(),content:'Synthetic review',provider:{model:'fixture'}});
  const tool=(name,args,key)=>api(`runs/${start.run_id}/tools/${name}`,{arguments:args,idempotency_key:key,tool_revision:start.tools.find(t=>t.name===name).revision});
  const hit=(await tool('search_knowledge',{query:'ExportProof'},`pi:${start.user.id}:search`)).result.items[0];assert.ok(hit);
  await api(`records/turn/${start.user.id}/requests`,{sequence:1,record:{sequence:1,contextManifest:{revision:'whole-turn-context-2',selectedToolCallIds:['search'],selectedInputIds:[]}}});
  const base=await f.request('artifact.read',{...scope,artifactId:artifact.id});
  const text=`${hit.text}[[cite:${hit.citationId}]]`;
  const proposal=(await tool('propose_artifact',{artifactId:artifact.id,basedOnVersionId:base.versionId,basedOnHash:base.contentHash,text,reason:'Synthetic source-bound review'},randomUUID())).result;
  const target={...scope,artifactId:artifact.id,versionId:proposal.versionId};
  await assert.rejects(f.request('artifact.export',target),{code:'artifact_not_approved'});
  await f.request('approval.decide',{...scope,approvalId:proposal.approvalId,operationHash:proposal.operationHash,decision:'approved'});
  const out=await f.request('artifact.export',target);assert.equal(out.artifact.content.content,text);assert.equal(out.citationReviewRecorded,true);
  assert.equal(out.references.length,1);assert.equal(out.references[0].quote,hit.text);assert.equal(out.references[0].citation.documentId,hit.documentId);assert.equal(out.references[0].documentVersion,hit.version);
  assert.equal((await f.request('artifact.read',{...scope,artifactId:artifact.id,versionId:base.versionId})).contentHash,base.contentHash);
  await assert.rejects(f.request('artifact.export',{...target,candidateId:'foreign'}),{code:'artifact_unavailable'});
  await f.request('source.revoke',{...scope,sourceId:captured.sourceId,expectedRevision:1});
  const revoked=await f.request('artifact.export',target);assert.equal(revoked.references[0].state,'unavailable');assert.equal(revoked.references[0].quote,undefined);
 }finally{f.store.close();}
});
