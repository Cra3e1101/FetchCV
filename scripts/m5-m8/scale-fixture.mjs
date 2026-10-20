import assert from 'node:assert/strict';
import {activeWorkspace} from '../../tests/helpers/active-workspace.mjs';
import {BlobStore,contentHash} from '../../packages/storage/blob-store.mjs';
import path from 'node:path';

// Only the freshly created, guarded synthetic workspace is expanded. Original
// legacy rows remain untouched; no real materials or user database are opened.
export async function scaleFixture(distribution){
  assert.ok(['uniform','skewed'].includes(distribution));
  const f=await activeWorkspace(`scale-${distribution}`),db=f.store.createIngestion().db;
  try{
    const blobs=new BlobStore(path.join(f.root,'blobs'));
    const templates=Object.fromEntries(['Candidate','Job','Conversation','AgentRun','Message','Source','Document','Block'].map(table=>[table,db.prepare(`SELECT * FROM ${table} LIMIT 1`).get()]));
    templates.Source=db.prepare("SELECT * FROM Source WHERE kind='interview'").get();
    templates.Document=db.prepare('SELECT * FROM Document WHERE source_id=? AND active=1').get(templates.Source.id);
    templates.Block=db.prepare('SELECT * FROM Block WHERE document_id=?').get(templates.Document.id);
    const inserts=new Map();
    function add(table,overrides){
      const row={...templates[table],...overrides};
      if(!inserts.has(table)){const keys=Object.keys(row);inserts.set(table,{keys,statement:db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?')})`)});}
      const {keys,statement}=inserts.get(table);statement.run(...keys.map(key=>row[key]));return row;
    }
    db.exec('BEGIN IMMEDIATE');
    try{
      const candidates=db.prepare('SELECT * FROM Candidate ORDER BY id').all();
      for(let i=candidates.length;i<50;i++)candidates.push(add('Candidate',{id:`scale-candidate-${i}`,name:`Synthetic candidate ${i}`}));
      const jobs=db.prepare('SELECT * FROM Job ORDER BY id').all();
      for(let i=jobs.length;i<500;i++)jobs.push(add('Job',{id:`scale-job-${i}`,candidate_id:candidates[i%50].id,company:`Synthetic company ${i}`,jd_source_id:null}));
      const conversations=new Map(db.prepare('SELECT * FROM Conversation').all().map(row=>[row.job_id,row]));
      const runs=new Map(db.prepare('SELECT * FROM AgentRun').all().map(row=>[row.conversation_id,row]));
      for(const job of jobs){
        if(!conversations.has(job.id))conversations.set(job.id,add('Conversation',{id:`scale-conversation-${job.id}`,job_id:job.id,candidate_id:job.candidate_id}));
        const conversation=conversations.get(job.id);
        if(!runs.has(conversation.id))runs.set(conversation.id,add('AgentRun',{id:`scale-run-${job.id}`,conversation_id:conversation.id,state:'completed'}));
      }
      const sequences=new Map(db.prepare('SELECT conversation_id,max(sequence) n FROM Message GROUP BY conversation_id').all().map(row=>[row.conversation_id,row.n]));
      const messageCount=db.prepare('SELECT count(*) n FROM Message').get().n;
      for(let i=messageCount;i<20000;i++){
        const job=jobs[distribution==='skewed'?0:i%500],conversation=conversations.get(job.id),id=`scale-message-${i}`;
        const sequence=(sequences.get(conversation.id)||0)+1;sequences.set(conversation.id,sequence);
        const body=JSON.stringify({schemaVersion:1,parts:[{type:'text',text:`Synthetic ${i} 仅用于规模测量，非用户履历。`} ]});
        add('Message',{id,logical_message_id:id,conversation_id:conversation.id,run_id:runs.get(conversation.id).id,sequence,content_json:body,content_hash:contentHash(body),delivery_status:'completed'});
      }
      const sourceCount=db.prepare('SELECT count(*) n FROM Source').get().n;
      const targetCandidate=jobs[0].candidate_id;
      for(let i=sourceCount;i<5000;i++){
        const candidateId=distribution==='skewed'?targetCandidate:candidates[i%50].id;
        const sourceId=`scale-source-${i}`,documentId=`scale-document-${i}`;
        // 5% long sources; unique identifiers prevent dedup from shrinking the
        // corpus into a single text. Chinese, English and numeric terms coexist.
        const text=`Synthetic 检索资料 ${i} candidate ${candidateId} 编号 ${i}. `+('权限 测试 SQL 分析。'.repeat(i%20===0?100:5));
        const textHash=await blobs.put(Buffer.from(text));
        add('Source',{id:sourceId,candidate_id:candidateId,job_id:null,identity_key:contentHash(sourceId),original_uri:`https://example.test/scale/${i}`,title:`Synthetic scale ${i}`,access_state:'available',metadata_json:'{"synthetic":true}'});
        add('Document',{id:documentId,source_id:sourceId,blob_hash:textHash,text_hash:textHash,text_blob_hash:textHash,version:1,active:1,ir_blob_hash:null,quality_json:JSON.stringify({status:'ready',synthetic:true,textLength:[...text].length,offsetUnit:'unicode_codepoint'})});
        add('Block',{id:`scale-block-${i}`,document_id:documentId,text,char_start:0,char_end:[...text].length,origin_json:'{"type":"synthetic-scale"}'});
      }
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      const counts=Object.fromEntries(['Candidate','Job','AgentRun','Message','Source'].map(table=>[table,db.prepare(`SELECT count(*) n FROM ${table}`).get().n]));
      assert.deepEqual(counts,{Candidate:50,Job:500,AgentRun:500,Message:20000,Source:5000});
      db.exec('COMMIT');
      const scope={candidateId:jobs[0].candidate_id,jobId:jobs[0].id};
      return {...f,scope,counts,distribution,
        sourceDistribution:db.prepare('SELECT candidate_id,count(*) n FROM Source GROUP BY candidate_id ORDER BY n DESC').all(),
        messageDistribution:db.prepare('SELECT conversation_id,count(*) n FROM Message GROUP BY conversation_id ORDER BY n DESC').all()};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }catch(error){f.store.close();throw error;}
}
