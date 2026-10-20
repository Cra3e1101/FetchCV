import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {activeWorkspace} from './helpers/active-workspace.mjs';
import {contentHash} from '../packages/storage/blob-store.mjs';

test('a fact revoked after the selected memory receipt cannot certify the final answer',async()=>{
  const f=await activeWorkspace('answer-personal-fact-revoked'),c=f.conversation,scope={candidateId:c.candidate_id,jobId:c.job_id};
  const bridge=f.store.createAgentBridge(),api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
  try{
    const citation=(await f.request('knowledge.search',{...scope,query:'Synthetic'})).items[0].citation;
    const confirmed=await f.request('fact.confirm',{...scope,citation});
    const start=await api(`conversations/${c.id}/turns`,{request_id:randomUUID(),content:'引用事实',provider:{model:'fixture'}});
    const facts=(await api(`runs/${start.run_id}/tools/read_memory`,{arguments:{},idempotency_key:`pi:${start.user.id}:facts`,tool_revision:start.tools.find(t=>t.name==='read_memory').revision})).result;
    await api(`records/turn/${start.user.id}/requests`,{sequence:1,record:{sequence:1,contextManifest:{revision:'whole-turn-context-2',selectedToolCallIds:['facts'],selectedInputIds:[]}}});
    await f.request('fact.revoke',{...scope,factReferenceId:confirmed.id,expectedRevision:confirmed.revision});
    const fact=facts.factReferences[0],content=`${fact.value}[[cite:${fact.citationId}]]`;
    const done=await api(`turns/${start.user.id}/complete`,{content});
    const answer=(await f.request('history.read',{...scope,conversationId:c.id})).messages.find(m=>m.id===done.assistant.id);
    assert.equal(answer.citationReview.citations[0].verificationState,'not_in_context');
    assert.ok(answer.citationReview.unverifiedRanges.length>0);
  }finally{f.store.close();}
});

test('selected memory receipts authorize only still-valid personal fact citations',async()=>{
  const f=await activeWorkspace('answer-personal-fact'),c=f.conversation,scope={candidateId:c.candidate_id,jobId:c.job_id};
  const bridge=f.store.createAgentBridge(),api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
  try{
    const citation=(await f.request('knowledge.search',{...scope,query:'Synthetic'})).items[0].citation;
    await f.request('fact.confirm',{...scope,citation});
    const start=await api(`conversations/${c.id}/turns`,{request_id:randomUUID(),content:'引用我确认的事实',provider:{model:'fixture'}});
    const facts=(await api(`runs/${start.run_id}/tools/read_memory`,{arguments:{},idempotency_key:`pi:${start.user.id}:facts`,tool_revision:start.tools.find(t=>t.name==='read_memory').revision})).result;
    const fact=facts.factReferences[0];
    await api(`records/turn/${start.user.id}/requests`,{sequence:1,record:{sequence:1,contextManifest:{revision:'whole-turn-context-2',selectedToolCallIds:['facts'],selectedInputIds:[]}}});
    const done=await api(`turns/${start.user.id}/complete`,{content:`${fact.value}[[cite:${fact.citationId}]]`});
    const answer=(await f.request('history.read',{...scope,conversationId:c.id})).messages.find(m=>m.id===done.assistant.id);
    assert.equal(answer.citationReview.citations[0].verificationState,'exact_quote');
    assert.equal(answer.citationReview.semanticSupport,'not_automatically_verified');
  }finally{f.store.close();}
});

test('final answers bind citations to selected receipts and preserve explicit unsupported ranges',async()=>{
  const f=await activeWorkspace('answer-citations'),bridge=f.store.createAgentBridge(),c=f.conversation;
  const scope={candidateId:c.candidate_id,jobId:c.job_id},api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
  try{
    const start=await api(`conversations/${c.id}/turns`,{request_id:randomUUID(),content:'核对原文',provider:{model:'fixture'}});
    const tool=start.tools.find(t=>t.name==='search_knowledge');
    const found=(await api(`runs/${start.run_id}/tools/search_knowledge`,{arguments:{query:'Synthetic'},idempotency_key:`pi:${start.user.id}:search`,tool_revision:tool.revision})).result;
    const hit=found.items[0];assert.ok(hit.citationId);
    await api(`records/turn/${start.user.id}/requests`,{sequence:1,record:{sequence:1,contextManifest:{revision:'whole-turn-context-2',selectedToolCallIds:['search'],selectedInputIds:[]}}});
    const content=`😀 ${hit.text}[[cite:${hit.citationId}]]\n额外声称业绩 999%。[[cite:${'a'.repeat(64)}]]\n另一个未经支持的断言。[[cite:${hit.citationId}]]`;
    const done=await api(`turns/${start.user.id}/complete`,{content,citationReview:{forged:true}});
    assert.equal(done.state,'completed');
    assert.deepEqual(await api(`turns/${start.user.id}/complete`,{content,citationReview:{forged:true}}),done);
    const history=await f.request('history.read',{...scope,conversationId:c.id});
    const answer=history.messages.find(m=>m.id===done.assistant.id),review=answer.citationReview;
    assert.equal(answer.content.parts[0].text,content,'the model answer is preserved verbatim');
    assert.equal(review.forged,undefined);assert.equal(review.revision,'answer-citations-1');
    assert.equal(review.citations[0].verificationState,'exact_quote');
    assert.equal([...content].slice(review.citations[0].answerStart,review.citations[0].answerEnd).join(''),hit.text);
    assert.equal(review.citations[1].verificationState,'not_in_context');
    assert.equal(review.citations[2].verificationState,'unverified_support','a real citation does not certify an unrelated claim');
    assert.ok(review.unverifiedRanges.some(r=>[...content].slice(r.start,r.end).join('').includes('999')));
    assert.equal(review.semanticSupport,'not_automatically_verified');
    const db=f.store.createIngestion().db,rev=db.prepare('SELECT revision FROM Source WHERE id=?').get(hit.sourceId).revision;
    await f.request('source.revoke',{...scope,sourceId:hit.sourceId,expectedRevision:rev});
    const withdrawn=(await f.request('history.read',{...scope,conversationId:c.id})).messages.find(m=>m.id===done.assistant.id).citationReview;
    assert.equal(withdrawn.citations[0].verificationState,'source_unavailable');
  }finally{f.store.close();}
});

test('legacy client-authored citation metadata cannot certify or break historical answers',async()=>{
  const f=await activeWorkspace('answer-citations-legacy'),bridge=f.store.createAgentBridge(),c=f.conversation;
  try{
    const start=bridge.repo.start({conversationId:c.id,requestId:randomUUID(),content:'legacy input',modelId:'fixture'});
    const content='旧客户端自报已核验';
    const done=bridge.repo.finish(start.runId,{state:'completed',content,metadata:{citationReview:{contentHash:contentHash(content),citations:'malformed client claim'}}});
    const history=await f.request('history.read',{candidateId:c.candidate_id,jobId:c.job_id,conversationId:c.id});
    assert.equal(history.messages.find(m=>m.id===done.assistant.id).citationReview,undefined);
  }finally{f.store.close();}
});

test('a reference read earlier but omitted from final context cannot certify a final answer',async()=>{
  const f=await activeWorkspace('answer-citations-omitted'),bridge=f.store.createAgentBridge(),c=f.conversation;
  const api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
  try{
    const start=await api(`conversations/${c.id}/turns`,{request_id:randomUUID(),content:'核对原文',provider:{model:'fixture'}});
    const found=(await api(`runs/${start.run_id}/tools/search_knowledge`,{arguments:{query:'Synthetic'},idempotency_key:`pi:${start.user.id}:search`,tool_revision:start.tools.find(t=>t.name==='search_knowledge').revision})).result.items[0];
    await api(`records/turn/${start.user.id}/requests`,{sequence:1,record:{sequence:1,contextManifest:{revision:'whole-turn-context-2',selectedToolCallIds:[],selectedInputIds:[]}}});
    const done=await api(`turns/${start.user.id}/complete`,{content:`${found.text}[[cite:${found.citationId}]]`});
    const answer=(await f.request('history.read',{candidateId:c.candidate_id,jobId:c.job_id,conversationId:c.id})).messages.find(m=>m.id===done.assistant.id);
    assert.equal(answer.citationReview.citations[0].verificationState,'not_in_context');
  }finally{f.store.close();}
});
