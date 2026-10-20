import test from 'node:test';import assert from 'node:assert/strict';import {activeWorkspace} from './helpers/active-workspace.mjs';
test('source versions are immutable scoped history; revoked or deleted owners cannot enumerate them',async()=>{
 const f=await activeWorkspace('doc-versions');try{
 const scope={candidateId:null,jobId:null},first=await f.request('source.import',{...scope,title:'Version fixture',format:'txt',contentBase64:Buffer.from('old text').toString('base64')});
 const second=await f.request('source.import',{...scope,title:'Version fixture',format:'txt',contentBase64:Buffer.from('new text').toString('base64'),sourceId:first.sourceId,expectedRevision:1});
 const page=await f.request('document.versions',{...scope,documentId:second.documentId});assert.deepEqual(page.items.map(x=>[x.version,x.active]),[[1,0],[2,1]]);assert.equal(page.items[0].id,first.documentId);
 const next=await f.request('document.versions',{...scope,documentId:first.documentId,afterVersion:1});assert.deepEqual(next.items.map(x=>x.version),[2]);
 await assert.rejects(f.request('document.versions',{...scope,candidateId:'foreign',documentId:first.documentId}),{code:'document_unavailable'});
 await f.request('source.revoke',{...scope,sourceId:first.sourceId,expectedRevision:second.revision});
 await assert.rejects(f.request('document.versions',{...scope,documentId:first.documentId}),{code:'document_unavailable'});
 }finally{f.store.close();}
});
