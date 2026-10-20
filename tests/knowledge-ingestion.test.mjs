import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {activeWorkspace} from './helpers/active-workspace.mjs';

test('protocol-1 jobs retain the accepted parser patch revision and reject unknown patches',async()=>{
  const f=await activeWorkspace('parser-patch-revision');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},ingestion=f.store.createIngestion();
    for(const revision of ['local-structured-1','local-structured-1.1','local-structured-1.2','local-structured-999']){
      const captured=await f.request('source.import',{...scope,title:revision,format:'txt',contentBase64:Buffer.from('synthetic revision check').toString('base64')});
      const parse=async bytes=>{const text=bytes.toString();return {schemaVersion:1,parserId:'fetchcv-local',parserRevision:revision,offsetUnit:'unicode_codepoint',format:'txt',source_text:text,quality:{status:'ready'},blocks:[{type:'text',text,charStart:0,charEnd:[...text].length,headingPath:[]}]};};
      if(revision==='local-structured-999')await assert.rejects(ingestion.process(captured.jobId,parse),{code:'invalid_parser_result'});
      else{
        const result=await ingestion.process(captured.jobId,parse);
        assert.equal(ingestion.db.prepare('SELECT parser_revision FROM Document WHERE id=?').get(result.documentId).parser_revision,revision);
      }
    }
  }finally{f.store.close();}
});

test('APP captures once, commits immutable parsed versions and fences cancelled or revoked tasks',async()=>{
  const f=await activeWorkspace('knowledge-ingestion');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
    const command={v:1,id:randomUUID(),workspaceId:f.workspaceId,method:'source.import',payload:{...scope,title:'Synthetic SQL',format:'txt',contentBase64:Buffer.from('SQL😀 2026').toString('base64')}};
    const captured=await f.store.dispatch(command);
    assert.deepEqual(await f.store.dispatch(command),captured);
    await assert.rejects(f.store.dispatch({...command,payload:{...command.payload,title:'Changed'}}),{code:'invocation_conflict'});
    const ingestion=f.store.createIngestion();
    let attempts=0;
    const parser=async bytes=>{
      attempts++;const text=bytes.toString();return {schemaVersion:1,parserId:'fetchcv-local',parserRevision:'local-structured-1',offsetUnit:'unicode_codepoint',format:'txt',source_text:text,quality:{status:'ready'},blocks:[{type:'text',text,charStart:0,charEnd:[...text].length,headingPath:[],originRef:{type:'text'},quality:{}}]};
    };
    const parsed=await ingestion.process(captured.jobId,parser);
    assert.equal(parsed.state,'completed');assert.notEqual(parsed.documentId,captured.documentId);
    assert.equal((await f.request('document.read',{...scope,documentId:parsed.documentId})).text,'SQL😀 2026');
    assert.deepEqual(await ingestion.process(captured.jobId,parser),parsed);assert.equal(attempts,1);
    await assert.rejects(f.request('source.status',{...scope,candidateId:'foreign',sourceId:captured.sourceId}),{code:'source_unavailable'});
    const update=await f.request('source.import',{...scope,title:'Synthetic SQL',sourceId:captured.sourceId,expectedRevision:1,format:'txt',contentBase64:Buffer.from('SQL 2027').toString('base64')});
    let release;const hold=new Promise(resolve=>{release=resolve;});
    const pending=ingestion.process(update.jobId,async bytes=>{await hold;return parser(bytes);});
    await f.request('source.revoke',{...scope,sourceId:captured.sourceId,expectedRevision:2});release();
    await assert.rejects(pending,{code:'ingest_lease_lost'});
    await assert.rejects(f.request('document.read',{...scope,documentId:parsed.documentId}),{code:'document_unavailable'});
    const cancelled=await f.request('source.import',{...scope,title:'Cancelled',format:'txt',contentBase64:Buffer.from('cancel input').toString('base64')});
    await f.request('ingest.cancel',{...scope,ingestId:cancelled.jobId,sourceId:cancelled.sourceId});
    await assert.rejects(ingestion.process(cancelled.jobId,parser),{code:'ingest_not_pending'});
  }finally{f.store.close();}
});
