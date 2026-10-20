import test from 'node:test';
import assert from 'node:assert/strict';
import {activeWorkspace} from './helpers/active-workspace.mjs';
import {MemoryStore} from '../packages/knowledge/memory.mjs';
import {randomUUID} from 'node:crypto';

async function proposal(f,text,extra={}){
  const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
  const conversation=await f.request('conversation.create',{...scope,title:'Synthetic repeated memory'});
  const message=await f.request('conversation.append',{...scope,conversationId:conversation.id,expectedSequence:0,text});
  const input={...scope,messageId:message.messageId,start:0,end:[...text].length,kind:'preference',subject:'resume',predicate:'language',...extra};
  return {scope,input,conversation,memory:await f.request('memory.propose',input)};
}

test('equal memory from different messages is one reviewed item with separate immutable sources',async()=>{
  const f=await activeWorkspace('memory-evidence-merge');
  try{
    const first=await proposal(f,'简历使用中文');
    const second=await proposal(f,'简历使用中文');
    assert.equal(second.memory.id,first.memory.id);
    assert.equal(second.memory.status,'pending');assert.equal(second.memory.sourceCount,2);
    assert.equal((await f.request('memory.list',{...first.scope,includeInactive:true})).items.length,1);
    const again=await f.request('memory.propose',second.input);
    assert.equal(again.revision,second.memory.revision,'replaying the same evidence has no side effects');
    await assert.rejects(f.request('memory.decide',{...first.scope,memoryId:first.memory.id,expectedRevision:first.memory.revision,decision:'confirmed'}),{code:'memory_revision_conflict'});
    const active=await f.request('memory.decide',{...first.scope,memoryId:first.memory.id,expectedRevision:again.revision,decision:'confirmed'});
    const source=await f.request('memory.source',{...first.scope,memoryId:active.id});
    assert.equal(source.sources.length,2);
    assert.deepEqual(new Set(source.sources.map(s=>s.messageId)),new Set([first.input.messageId,second.input.messageId]));
    for(const reference of source.sources){
      const original=await f.request('memory.source',{...first.scope,memoryId:active.id,evidenceId:reference.id});
      assert.equal(original.messageId,reference.messageId);assert.equal(original.text,'简历使用中文');
    }
    const memory=new MemoryStore(f.store.createIngestion().db,f.workspaceId),before=memory.list(first.scope);
    const third=await proposal(f,'简历使用中文');assert.equal(third.memory.id,active.id);assert.equal(third.memory.status,'active');
    memory.validateSnapshot(first.scope,before);
    const db=f.store.createIngestion().db;
    db.prepare('UPDATE Message SET deleted_at=? WHERE id=?').run(new Date().toISOString(),second.input.messageId);
    assert.equal((await f.request('memory.list',first.scope)).items.length,0);
    assert.equal(db.prepare('SELECT disabled_reason FROM Memory WHERE id=?').get(active.id).disabled_reason,'source_unavailable');
    assert.equal(db.prepare("SELECT count(*) n FROM Event WHERE type='memory.disabled' AND entity_id=?").get(active.id).n,1);
    await assert.rejects(f.request('memory.source',{...first.scope,memoryId:active.id}),{code:'memory_evidence_unavailable'});
    await assert.rejects(f.request('memory.propose',first.input),{code:'memory_evidence_unavailable'},'primary-source replay must not bypass withdrawal of secondary evidence');
    assert.equal(db.prepare('SELECT count(*) n FROM MemoryEvidence WHERE memory_id=?').get(active.id).n,3,'withdrawal retains provenance');
    const renewed=await proposal(f,'简历使用中文');assert.notEqual(renewed.memory.id,active.id);assert.equal(renewed.memory.status,'pending');
  }finally{f.store.close();}
});

for(const state of ['pending','active'])test(`equivalent evidence appended to ${state} memory does not invalidate unchanged tool observations`,async()=>{
  const f=await activeWorkspace(`memory-evidence-context-${state}`);
  try{
    const first=await proposal(f,'简历使用中文');
    if(state==='active')await f.request('memory.decide',{...first.scope,memoryId:first.memory.id,expectedRevision:1,decision:'confirmed'});
    const conversation=await f.request('conversation.create',{...first.scope,title:'Second occurrence'});
    const second=await f.request('conversation.append',{...first.scope,conversationId:conversation.id,expectedSequence:0,text:'简历使用中文'});
    const bridge=f.store.createAgentBridge(),api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
    const start=await api(`conversations/${f.conversation.id}/turns`,{request_id:randomUUID(),content:'记住我已经说明的偏好',provider:{model:'fixture'}});
    const tool=(name,id,args={})=>api(`runs/${start.run_id}/tools/${name}`,{arguments:args,idempotency_key:`pi:${start.user.id}:${id}`,tool_revision:start.tools.find(t=>t.name===name).revision});
    const args={messageId:first.input.messageId,start:0,end:6,kind:'preference',subject:'resume',predicate:'language'};
    await tool('read_memory','read');
    const original=await tool('propose_memory','one',args);
    const merged=await tool('propose_memory','two',{...args,messageId:second.messageId});
    assert.equal(original.result.id,merged.result.id);
    assert.deepEqual(await tool('propose_memory','one',args),original,'append-only evidence does not poison the first cached observation');
    const record={sequence:1,record:{sequence:1,contextManifest:{revision:'whole-turn-context-2',selectedToolCallIds:['read','one','two'],selectedInputIds:[]}}};
    assert.equal((await api(`records/turn/${start.user.id}/requests`,record)).sequence,1);
    f.store.createIngestion().db.prepare('UPDATE Message SET deleted_at=? WHERE id=?').run(new Date().toISOString(),second.messageId);
    await assert.rejects(tool('propose_memory','one',args),{code:'memory_evidence_unavailable'});
  }finally{f.store.close();}
});

test('memory equivalence is conservative and does not merge conflicts, scopes, validity periods or rejected items',async()=>{
  const f=await activeWorkspace('memory-evidence-boundaries');
  try{
    const first=await proposal(f,'采用 Cafe\u0301 排版');
    const normalized=await proposal(f,'采用 Café 排版');assert.equal(normalized.memory.id,first.memory.id);
    const conflicting=await proposal(f,'不采用 Café 排版');assert.notEqual(conflicting.memory.id,first.memory.id);
    const dated=await proposal(f,'采用 Café 排版',{validFrom:'2027-01-01'});assert.notEqual(dated.memory.id,first.memory.id);
    const otherKey=await proposal(f,'采用 Café 排版',{predicate:'layout'});assert.notEqual(otherKey.memory.id,first.memory.id);
    await f.request('memory.decide',{...first.scope,memoryId:first.memory.id,expectedRevision:normalized.memory.revision,decision:'rejected'});
    const retry=await proposal(f,'采用 Café 排版');assert.notEqual(retry.memory.id,first.memory.id);assert.equal(retry.memory.status,'pending');
    const source=await f.request('memory.source',{...first.scope,memoryId:retry.memory.id});
    await assert.rejects(f.request('memory.source',{...first.scope,memoryId:conflicting.memory.id,evidenceId:source.sources[0].id}),{code:'memory_evidence_unavailable'});
    await assert.rejects(f.request('memory.source',{...first.scope,candidateId:'foreign',memoryId:retry.memory.id}),{code:'memory_unavailable'});
  }finally{f.store.close();}
});

test('memory labels cannot store credentials even when the quoted message is harmless',async()=>{
  const f=await activeWorkspace('memory-label-secret');
  try{
    await assert.rejects(proposal(f,'简历使用中文',{subject:'sk-proj-'+'X'.repeat(32)}),{code:'memory_secret_forbidden'});
    await assert.rejects(proposal(f,'简历使用中文',{predicate:'ghp_'+'X'.repeat(36)}),{code:'memory_secret_forbidden'});
  }finally{f.store.close();}
});

test('an unspecified validity start does not silently merge into an explicitly dated active memory',async()=>{
  const f=await activeWorkspace('memory-evidence-explicit-date');
  try{
    const dated=await proposal(f,'简历使用中文',{validFrom:'2020-01-01'});
    await f.request('memory.decide',{...dated.scope,memoryId:dated.memory.id,expectedRevision:dated.memory.revision,decision:'confirmed'});
    const unspecified=await proposal(f,'简历使用中文');
    assert.notEqual(unspecified.memory.id,dated.memory.id);assert.equal(unspecified.memory.status,'pending');
  }finally{f.store.close();}
});
