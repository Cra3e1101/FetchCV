import test from 'node:test';
import assert from 'node:assert/strict';
import {activeWorkspace} from './helpers/active-workspace.mjs';
import {MemoryStore} from '../packages/knowledge/memory.mjs';

test('personal facts stay in their candidate/job scope and legacy flags do not grant memory authority',async()=>{
  const f=await activeWorkspace('personal-fact-boundaries');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},db=f.store.createIngestion().db;
    const legacy=db.prepare("SELECT * FROM KnowledgeItem WHERE kind='personal_fact'").get();
    assert.equal(JSON.parse(legacy.content_json).confirmationBasis,'legacy_verified_flag');
    assert.equal(JSON.parse(legacy.confidence_json).userConfirmed,false);
    assert.deepEqual((await f.request('memory.list',scope)).factReferences,[]);
    const citation=(await f.request('knowledge.search',{...scope,query:'Synthetic'})).items[0].citation;
    const fact=await f.request('fact.confirm',{...scope,citation});
    const other=db.prepare('SELECT id FROM Candidate WHERE id!=?').get(scope.candidateId).id;
    assert.deepEqual((await f.request('memory.list',{candidateId:other})).factReferences,[]);
    assert.deepEqual((await f.request('memory.list',{candidateId:scope.candidateId})).factReferences,[]);
    await assert.rejects(f.request('fact.confirm',{candidateId:other,jobId:scope.jobId,citation}),{code:'job_unavailable'});
    await assert.rejects(f.request('fact.confirm',{candidateId:other,citation}));
    await assert.rejects(f.request('fact.revoke',{candidateId:other,factReferenceId:fact.id,expectedRevision:fact.revision}),{code:'personal_fact_unavailable'});
    assert.equal((await f.request('memory.list',scope)).factReferences[0].id,fact.id);
    db.prepare('UPDATE Document SET active=0 WHERE id=?').run(citation.documentId);
    assert.equal(db.prepare('SELECT status FROM KnowledgeItem WHERE id=?').get(fact.knowledgeId).status,'disabled');
    assert.deepEqual((await f.request('memory.list',scope)).factReferences,[]);
    const unavailable=(await f.request('memory.list',{...scope,includeInactive:true})).factReferences[0];
    assert.equal(unavailable.evidenceUnavailable,true);
    assert.equal(unavailable.value,undefined);
    await f.request('fact.revoke',{...scope,factReferenceId:fact.id,expectedRevision:fact.revision});
  }finally{f.store.close();}
});

test('reviewed personal fact is stored once and memory holds a revocable version-bound reference',async()=>{
  const f=await activeWorkspace('personal-fact');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
    const search=await f.request('knowledge.search',{...scope,query:'Synthetic'}),citation=search.items[0].citation;
    const db=f.store.createIngestion().db,before=db.prepare('SELECT count(*) n FROM KnowledgeItem').get().n;
    const fact=await f.request('fact.confirm',{...scope,citation});
    await assert.rejects(f.request('fact.confirm',{...scope,citation:{...citation,nonce:1}}),{code:'invalid_citation'});
    assert.equal((await f.request('fact.confirm',{...scope,citation})).id,fact.id);
    assert.equal(db.prepare('SELECT count(*) n FROM KnowledgeItem').get().n,before+1);
    assert.equal(db.prepare('PRAGMA table_info(PersonalFactReference)').all().some(c=>['text','value_json','content_json'].includes(c.name)),false);
    const snapshot=await f.request('memory.list',scope);
    assert.equal(snapshot.factReferences[0].knowledgeId,fact.knowledgeId);
    assert.equal(snapshot.factReferences[0].value,search.items[0].text);
    assert.equal((await f.request('memory.list',{...scope,asOf:'2000-01-01'})).factReferences.length,0);
    await assert.rejects(f.request('fact.confirm',{citation}),{code:'candidate_unavailable'});
    await f.request('fact.revoke',{...scope,factReferenceId:fact.id,expectedRevision:fact.revision});
    assert.equal((await f.request('memory.list',scope)).factReferences.length,0);
    assert.throws(()=>new MemoryStore(db,f.workspaceId).validateSnapshot(scope,snapshot),{code:'context_memory_stale'});
    await assert.rejects(f.request('fact.confirm',{...scope,citation}),{code:'personal_fact_revoked'});
    await assert.rejects(f.request('fact.confirm',{...scope,citation:{...citation,secret:'synthetic-extra-field'}}),{code:'invalid_citation'});
    assert.equal(db.prepare('SELECT status FROM KnowledgeItem WHERE id=?').get(fact.knowledgeId).status,'confirmed','revoking memory does not erase the fact');
  }finally{f.store.close();}
});

test('fact revision changes invalidate remembered facts and cached context',async()=>{
  const f=await activeWorkspace('personal-fact-source');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},db=f.store.createIngestion().db;
    const search=await f.request('knowledge.search',{...scope,query:'Synthetic'});
    const fact=await f.request('fact.confirm',{...scope,citation:search.items[0].citation});
    const snapshot=await f.request('memory.list',scope);
    db.prepare('UPDATE KnowledgeItem SET revision=revision+1 WHERE id=?').run(fact.knowledgeId);
    assert.equal((await f.request('memory.list',scope)).factReferences.length,0);
    assert.throws(()=>new MemoryStore(db,f.workspaceId).validateSnapshot(scope,snapshot),{code:'context_memory_stale'});
    assert.equal(db.prepare('SELECT count(*) n FROM PersonalFactReference').get().n,1);
  }finally{f.store.close();}
});
