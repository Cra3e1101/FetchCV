import test from 'node:test';
import assert from 'node:assert/strict';
import {activeWorkspace} from './helpers/active-workspace.mjs';
import {DatabaseSync} from 'node:sqlite';
import {createSearchIndex,searchKnowledge,resolveCitation} from '../packages/knowledge/retrieval.mjs';

test('knowledge search excludes unauthorized, superseded and revoked evidence before limiting and resolves exact citations',async()=>{
  const f=await activeWorkspace('knowledge-search'),db=new DatabaseSync(f.copy.archivePath);
  try{
    const c=f.conversation,scope={workspaceId:f.workspaceId,candidateId:c.candidate_id,jobId:c.job_id};
    await createSearchIndex(db,f.workspaceId);
    const result=searchKnowledge(db,{...scope,query:'Synthetic',limit:3});
    assert.ok(result.items.length>0);assert.equal(result.mode,'fts');
    assert.equal((await f.request('knowledge.search',{candidateId:c.candidate_id,jobId:c.job_id,query:'Synthetic'})).items.length,result.items.length);
    for(const item of result.items){
      const resolved=resolveCitation(db,{...scope,citation:item.citation});
      assert.equal(resolved.text,item.text);assert.equal(resolved.available,true);
      assert.throws(()=>resolveCitation(db,{...scope,candidateId:'foreign',citation:item.citation}),{code:'citation_unavailable'});
    }
    assert.throws(()=>searchKnowledge(db,{...scope,candidateId:'foreign',query:'Synthetic'}),{code:'candidate_unavailable'});
    assert.equal(searchKnowledge(db,{...scope,query:'" OR * NOT (',limit:3}).items.length,0);
    const chosen=result.items[0];
    db.prepare("UPDATE Source SET access_state='revoked',revision=revision+1 WHERE id=?").run(chosen.sourceId);
    assert.throws(()=>resolveCitation(db,{...scope,citation:chosen.citation}),{code:'citation_unavailable'});
    assert.equal(searchKnowledge(db,{...scope,query:'Synthetic'}).items.some(i=>i.sourceId===chosen.sourceId),false);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();f.store.close();}
});
