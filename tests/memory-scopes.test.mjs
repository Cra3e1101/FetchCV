import test from 'node:test';
import assert from 'node:assert/strict';
import {activeWorkspace} from './helpers/active-workspace.mjs';
import {MemoryStore} from '../packages/knowledge/memory.mjs';

async function confirmed(f,scope,text,{kind='preference',predicate='layout'}={}){
  const conversation=await f.request('conversation.create',{...scope,title:'Synthetic memory scope'});
  const message=await f.request('conversation.append',{...scope,conversationId:conversation.id,expectedSequence:0,text});
  const proposed=await f.request('memory.propose',{...scope,messageId:message.messageId,start:0,end:[...text].length,kind,subject:'resume',predicate});
  const memory=await f.request('memory.decide',{...scope,memoryId:proposed.id,expectedRevision:1,decision:'confirmed'});
  return {memory,message,conversation};
}

test('display preferences inherit job over candidate over workspace without broadening constraint scope',async()=>{
  const f=await activeWorkspace('memory-scope-hierarchy');
  try{
    const job={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},candidate={candidateId:job.candidateId};
    const global=await confirmed(f,{},'工作区默认用简洁排版');await confirmed(f,{},'此工作区的约束',{kind:'constraint'});
    assert.deepEqual((await f.request('memory.list',job)).items.map(x=>x.id),[global.memory.id]);
    const personal=await confirmed(f,candidate,'此履历用紧凑排版');
    await confirmed(f,candidate,'个人层级约束需保持原作用域',{kind:'constraint'});
    assert.deepEqual((await f.request('memory.list',job)).items.map(x=>x.id),[personal.memory.id]);
    assert.ok((await f.request('memory.list',{})).items.some(x=>x.id===global.memory.id));
    const snapshot=await f.request('memory.list',job);
    const particular=await confirmed(f,job,'此岗位用单栏排版');
    assert.deepEqual((await f.request('memory.list',job)).items.map(x=>x.id),[particular.memory.id]);
    assert.deepEqual((await f.request('memory.list',candidate)).items.filter(x=>x.kind==='preference').map(x=>x.id),[personal.memory.id]);
    const paged=[];let afterId='';
    do{const page=await f.request('memory.list',{...job,limit:1,...(afterId?{afterId}:{})});paged.push(...page.items);afterId=page.nextId;}while(afterId);
    assert.deepEqual(paged.map(x=>x.id),[particular.memory.id],'a shadowed preference cannot reappear on later pages');
    const memory=new MemoryStore(f.store.createIngestion().db,f.workspaceId);
    assert.throws(()=>memory.validateSnapshot(job,snapshot),{code:'context_memory_stale'});
    await assert.rejects(f.request('memory.list',{candidateId:'missing'}),{code:'candidate_unavailable'});
    await f.request('memory.decide',{...job,memoryId:particular.memory.id,expectedRevision:2,decision:'revoked'});
    assert.deepEqual((await f.request('memory.list',job)).items.map(x=>x.id),[personal.memory.id]);
  }finally{f.store.close();}
});

test('an empty or partial memory snapshot expires when a new visible preference is confirmed',async()=>{
  const f=await activeWorkspace('memory-snapshot-addition');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
    const memory=new MemoryStore(f.store.createIngestion().db,f.workspaceId);
    const empty=memory.list(scope);assert.equal(empty.items.length,0);
    await confirmed(f,{},'先用一页简历');
    assert.throws(()=>memory.validateSnapshot(scope,empty),{code:'context_memory_stale'});
    const before=memory.list(scope);
    await confirmed(f,scope,'使用中文描述',{predicate:'language'});
    assert.throws(()=>memory.validateSnapshot(scope,before),{code:'context_memory_stale'});
    memory.validateSnapshot(scope,memory.list(scope));
  }finally{f.store.close();}
});

for(const parent of ['Candidate','Job','Workspace'])test(`${parent} tombstone stops inherited memory use and audits each affected row once`,async()=>{
  const f=await activeWorkspace(`memory-tombstone-${parent.toLowerCase()}`);
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},item=await confirmed(f,scope,'此记忆不能跨越已撤回的实体');
    const db=f.store.createIngestion().db,id={Candidate:scope.candidateId,Job:scope.jobId,Workspace:f.workspaceId}[parent];
    db.prepare(`UPDATE ${parent} SET deleted_at=? WHERE id=?`).run(new Date().toISOString(),id);
    assert.equal(db.prepare('SELECT status FROM Memory WHERE id=?').get(item.memory.id).status,'revoked');
    assert.equal(db.prepare("SELECT count(*) n FROM Event WHERE type='memory.disabled' AND entity_id=?").get(item.memory.id).n,1);
    db.prepare(`UPDATE ${parent} SET deleted_at=NULL WHERE id=?`).run(id);
    assert.equal((await f.request('memory.list',scope)).items.length,0,'restoring a source does not silently re-confirm memory');
  }finally{f.store.close();}
});

test('source tombstones disable memory in the same transaction and free its active slot',async()=>{
  const f=await activeWorkspace('memory-source-lifecycle');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
    const first=await confirmed(f,scope,'旧偏好只留作历史');
    const db=f.store.createIngestion().db;db.prepare('UPDATE Message SET deleted_at=? WHERE id=?').run(new Date().toISOString(),first.message.messageId);
    const row=db.prepare('SELECT * FROM Memory WHERE id=?').get(first.memory.id);
    assert.equal(row.status,'revoked');assert.equal(row.disabled_reason,'source_unavailable');assert.ok(row.disabled_at);
    assert.equal(db.prepare("SELECT count(*) n FROM Event WHERE type='memory.disabled'").get().n,1);
    assert.equal((await f.request('memory.list',scope)).items.length,0);
    const replacement=await confirmed(f,scope,'新的偏好有新的原消息');
    assert.equal(replacement.memory.status,'active');
    db.prepare('UPDATE Conversation SET deleted_at=? WHERE id=?').run(new Date().toISOString(),replacement.conversation.id);
    assert.equal(db.prepare('SELECT status FROM Memory WHERE id=?').get(replacement.memory.id).status,'revoked');
    assert.equal((await f.request('memory.list',scope)).items.length,0);
  }finally{f.store.close();}
});
