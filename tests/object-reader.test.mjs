import test from 'node:test';
import assert from 'node:assert/strict';
import {activeWorkspace} from './helpers/active-workspace.mjs';
test('job navigation and run summaries enforce scope and never return raw execution records',async()=>{
 const f=await activeWorkspace('object-readers');try{
 const job=(await f.request('workspace.catalogue',{kind:'jobs'})).items[0];assert.ok(job);
 const scope={candidateId:job.candidate_id,jobId:job.id};
 assert.equal((await f.request('job.read',scope)).job.company,'Synthetic Company');
 const related=await f.request('job.objects',{...scope,kind:'conversations'});assert.ok(related.items.some(x=>x.id===f.conversation.id));
 await assert.rejects(f.request('job.objects',{...scope,candidateId:'foreign',kind:'artifacts'}),{code:'object_unavailable'});
 const run=(await f.request('workspace.catalogue',{kind:'runs'})).items[0];assert.ok(run);
 const summary=await f.request('run.read',{...scope,runId:run.id});assert.equal(summary.automaticReplay,false);
 const data=JSON.stringify(summary);for(const key of ['args_json','result_json','context_manifest_json','error_json','prompt'])assert.equal(data.includes(key),false);
 await assert.rejects(f.request('run.read',{...scope,jobId:null,runId:run.id}),{code:'object_unavailable'});
 f.store.createIngestion().db.prepare('UPDATE Conversation SET deleted_at=? WHERE id=?').run(new Date().toISOString(),f.conversation.id);
 await assert.rejects(f.request('run.read',{...scope,runId:run.id}),{code:'object_unavailable'});
 assert.equal((await f.request('workspace.catalogue',{kind:'runs'})).items.length,0);
 }finally{f.store.close();}
});
