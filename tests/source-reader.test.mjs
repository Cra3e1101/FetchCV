import test from 'node:test';
import assert from 'node:assert/strict';
import {activeWorkspace} from './helpers/active-workspace.mjs';

test('citation reader uses authorized source scope for candidate-wide evidence and rejects revoked evidence',async()=>{
  const f=await activeWorkspace('source-reader');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
    const captured=await f.request('source.import',{candidateId:scope.candidateId,title:'ReaderShared',format:'txt',contentBase64:Buffer.from('ReaderShared 中文😀 fact').toString('base64')});
    await f.store.createIngestion().process(captured.jobId,async bytes=>{const text=bytes.toString();return {schemaVersion:1,parserId:'fetchcv-local',parserRevision:'local-structured-1.2',offsetUnit:'unicode_codepoint',format:'txt',source_text:text,quality:{status:'ready'},blocks:[{type:'text',text,charStart:0,charEnd:[...text].length,headingPath:[]}]};});
    const hit=(await f.request('knowledge.search',{...scope,query:'ReaderShared'})).items[0];assert.ok(hit);
    const resolved=await f.request('citation.resolve',{...scope,citation:hit.citation});
    assert.deepEqual(resolved.sourceScope,{candidateId:scope.candidateId,jobId:null});
    const doc=await f.request('document.read',{...resolved.sourceScope,documentId:hit.documentId});
    assert.equal(doc.textHash,hit.citation.textHash);assert.equal(doc.text,resolved.text);
    await assert.rejects(f.request('citation.resolve',{candidateId:'foreign',citation:hit.citation}),{code:'citation_unavailable'});
    await f.request('source.revoke',{...resolved.sourceScope,sourceId:captured.sourceId,expectedRevision:1});
    await assert.rejects(f.request('citation.resolve',{...scope,citation:hit.citation}),{code:'citation_unavailable'});
    await assert.rejects(f.request('document.read',{...resolved.sourceScope,documentId:hit.documentId}),{code:'document_unavailable'});
  }finally{f.store.close();}
});
