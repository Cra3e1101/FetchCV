import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {activeWorkspace} from './helpers/active-workspace.mjs';
import {ApplicationStore} from '../packages/storage/application-store.mjs';
import {upgradeMemoryLifecycle} from '../packages/knowledge/memory-lifecycle.mjs';
import {upgradeMemoryEvidence} from '../packages/knowledge/memory-evidence.mjs';

for(const version of [1,2,3])test(`opening a Memory v${version} workspace upgrades additively, preserves evidence, and disables unavailable sources`,async()=>{
  const f=await activeWorkspace(`memory-v${version}-migration`);
  const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
  const originals=[];
  for(const text of ['保留有来源的偏好','撤回失去来源的偏好']){
    const c=await f.request('conversation.create',{...scope,title:'Memory v1 fixture'});
    const m=await f.request('conversation.append',{...scope,conversationId:c.id,expectedSequence:0,text});
    originals.push({text,id:randomUUID(),messageId:m.messageId});
  }
  const db=f.store.createIngestion().db;
  db.exec(await readFile(new URL('./helpers/memory-v1.sql',import.meta.url),'utf8'));
  db.exec("CREATE TABLE FeatureSchema(feature TEXT PRIMARY KEY,revision INTEGER NOT NULL,created_at TEXT NOT NULL) STRICT; INSERT INTO FeatureSchema VALUES('memory',1,'2026-09-01T00:00:00.000Z')");
  for(const [i,item] of originals.entries()){
    const message=db.prepare('SELECT * FROM Message WHERE id=?').get(item.messageId);
    item.body=message.content_json;item.hash=message.content_hash;
    db.prepare(`INSERT INTO Memory(id,workspace_id,candidate_id,job_id,kind,subject,predicate,value_json,normalized_hash,status,valid_from,recorded_at,source_message_id,source_hash,char_start,char_end,extractor_revision,confirmed_by)
      VALUES(?,?,?,?,'preference','resume',?,?,?,'active','2020-01-01T00:00:00.000Z','2026-09-01T00:00:00.000Z',?,?,0,?,'quoted-user-1','user')`)
      .run(item.id,f.workspaceId,scope.candidateId,scope.jobId,`length${i}`,JSON.stringify({schemaVersion:1,text:item.text}),`fixture-${i}`,item.messageId,item.hash,[...item.text].length);
  }
  db.prepare('UPDATE Message SET deleted_at=? WHERE id=?').run(new Date().toISOString(),originals[1].messageId);
  const confirmedAt='2026-09-02T00:00:00.000Z';
  if(version===3){
    const sequence=db.prepare('SELECT coalesce(max(sequence),0)+1 n FROM Event WHERE workspace_id=?').get(f.workspaceId).n;
    db.prepare('INSERT INTO Event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),f.workspaceId,null,'memory',originals[0].id,sequence,'memory.confirmed','{}',1,'user',confirmedAt,confirmedAt,confirmedAt);
  }
  if(version===2){upgradeMemoryLifecycle(db,1);db.exec("UPDATE FeatureSchema SET revision=2 WHERE feature='memory'");}
  if(version===3){upgradeMemoryEvidence(db,1);db.exec("UPDATE FeatureSchema SET revision=3 WHERE feature='memory'");}
  f.store.close();
  let reopened;
  try{
    reopened=await ApplicationStore.open(f.root);const upgraded=reopened.createIngestion().db;
    assert.equal(upgraded.prepare("SELECT revision FROM FeatureSchema WHERE feature='memory'").get().revision,4);
    const time=upgraded.prepare('SELECT valid_from,activated_at,time_basis FROM Memory WHERE id=?').get(originals[0].id);
    assert.equal(time.valid_from,'2020-01-01T00:00:00.000Z');assert.equal(time.activated_at,version===3?confirmedAt:null);assert.equal(time.time_basis,'legacy_start_unclassified');
    assert.equal(upgraded.prepare('SELECT count(*) n FROM MemoryEvidence').get().n,2);
    assert.equal(upgraded.prepare('SELECT count(*) n FROM Memory').get().n,2);
    for(const item of originals){const m=upgraded.prepare('SELECT * FROM Message WHERE id=?').get(item.messageId);assert.equal(m.content_json,item.body);assert.equal(m.content_hash,item.hash);}
    assert.equal(upgraded.prepare('SELECT status FROM Memory WHERE id=?').get(originals[0].id).status,'active');
    assert.equal(upgraded.prepare('SELECT disabled_reason FROM Memory WHERE id=?').get(originals[1].id).disabled_reason,'source_unavailable');
    assert.equal(upgraded.prepare("SELECT count(*) n FROM Event WHERE type='memory.disabled'").get().n,1);
    assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(),[]);
    reopened.close();reopened=await ApplicationStore.open(f.root);
    assert.equal(reopened.createIngestion().db.prepare("SELECT count(*) n FROM Event WHERE type='memory.disabled'").get().n,1,'reopen does not replay migration');
    reopened.close();reopened=null;
    const future=new DatabaseSync(f.copy.archivePath);future.exec("UPDATE FeatureSchema SET revision=5 WHERE feature='memory'");future.close();
    await assert.rejects(ApplicationStore.open(f.root),{code:'unsupported_feature_schema'});
  }finally{reopened?.close();}
});
