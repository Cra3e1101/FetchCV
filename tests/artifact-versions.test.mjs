import test from 'node:test';import assert from 'node:assert/strict';import {activeWorkspace} from './helpers/active-workspace.mjs';
test('artifact versions preserve old content and reject mismatched scope and tombstones',async()=>{
 const f=await activeWorkspace('artifact-versions');
 try{const a=(await f.request('workspace.catalogue',{kind:'artifacts'})).items.find(x=>x.title==='Synthetic resume'),p={artifactId:a.id,candidateId:a.candidate_id,jobId:a.job_id};
  const versions=await f.request('artifact.versions',p);assert.ok(versions.items.length>=2);assert.equal(versions.items.filter(x=>x.current).length,1);
  const old=versions.items.find(x=>!x.current);assert.equal((await f.request('artifact.read',{...p,versionId:old.id})).version,old.version);
  await assert.rejects(f.request('artifact.versions',{...p,candidateId:null}),{code:'artifact_unavailable'});
  f.store.createIngestion().db.prepare('UPDATE Artifact SET deleted_at=? WHERE id=?').run(new Date().toISOString(),a.id);
  await assert.rejects(f.request('artifact.versions',p),{code:'artifact_unavailable'});
 }finally{await f.store.close();}
});
