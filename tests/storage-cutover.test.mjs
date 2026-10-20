import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {storageFixture} from './helpers/storage-fixture.mjs';
import {cutoverWorkspace} from '../packages/app/workspace-cutover.mjs';
import {ApplicationStore} from '../packages/storage/application-store.mjs';
import {readWorkspaceManifest} from '../packages/storage/workspace-manifest.mjs';
import {contentHash} from '../packages/storage/blob-store.mjs';

test('cutover snapshots after host stops V1, requires review and publishes before APP writes',async()=>{
  const {db:unused,source,dir}=await storageFixture('cutover');unused.close();
  const recoveryRoot=path.join(dir,'recovery'),destinationRoot=path.join(dir,'copies');await mkdir(recoveryRoot);await mkdir(destinationRoot);
  const writer=new DatabaseSync(source);let stopped=false,released=false,sourceHash;
  const phases=[];
  const result=await cutoverWorkspace({source,recoveryRoot,destinationRoot,name:'final',
    acquireSourceLease:async()=>{
      writer.prepare('UPDATE candidates SET title=? WHERE id=?').run('Last committed before stop','cand_a');writer.close();stopped=true;
      sourceHash=contentHash(await readFile(source));
      return {verify:()=>stopped&&!released,release:async()=>{released=true;}};
    },reviewFinalCopy:async({copy,root})=>{
      assert.equal(await readWorkspaceManifest(root),null);assert.equal(copy.structuralValidationPassed,true);
      const db=new DatabaseSync(copy.archivePath,{readOnly:true});
      try{assert.equal(JSON.parse(db.prepare("SELECT profile_json FROM Candidate WHERE name='Synthetic candidate'").get().profile_json).legacy.title,'Last committed before stop');}finally{db.close();}
      return {approved:true,reviewId:'synthetic-final-copy'};
    },checkpoint:async phase=>{assert.equal(stopped,true);assert.equal(released,false);phases.push(phase);}});
  assert.equal(released,true);assert.equal(contentHash(await readFile(source)),sourceHash);
  assert.deepEqual(phases,['writer-stopped','final-copy-validated','before-publish','staged','published']);
  const app=await ApplicationStore.open(result.root);app.close();
  assert.equal((await readWorkspaceManifest(result.root)).commitId,result.manifest.commitId);
});

test('failed review or lost lease never activates; error after publish never silently rolls back',async()=>{
  const {db:unused,source,dir}=await storageFixture('cutover-failures');unused.close();
  const recoveryRoot=path.join(dir,'recovery'),destinationRoot=path.join(dir,'copies');await mkdir(recoveryRoot);await mkdir(destinationRoot);
  const initial=await readFile(source);
  for(const mode of ['review','lease','after-publish']){
    let stopped=true,released=false;
    await assert.rejects(cutoverWorkspace({source,recoveryRoot,destinationRoot,name:mode,
      acquireSourceLease:async()=>({verify:()=>stopped,release:async()=>{released=true;}}),
      reviewFinalCopy:async()=>({approved:mode!=='review',reviewId:'synthetic'}),
      checkpoint:async phase=>{if(mode==='lease'&&phase==='final-copy-validated')stopped=false;if(mode==='after-publish'&&phase==='published')throw Error('injected report/ack loss');},
    }));
    assert.equal(released,true);
    const pointer=await readWorkspaceManifest(path.join(destinationRoot,mode));
    assert.equal(Boolean(pointer),mode==='after-publish');
    assert.deepEqual(await readFile(source),initial);
  }
  let acquired=false;
  await assert.rejects(cutoverWorkspace({source,recoveryRoot,destinationRoot,name:'no-lease',
    acquireSourceLease:async()=>({verify:()=>false,release:async()=>{acquired=true;}}),reviewFinalCopy:async()=>({approved:true,reviewId:'synthetic'})}),{code:'legacy_writer_not_stopped'});
  assert.equal(acquired,true);await assert.rejects(readFile(path.join(destinationRoot,'no-lease','archive.db')),{code:'ENOENT'});
});
