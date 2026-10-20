import assert from 'node:assert/strict';
import path from 'node:path';
import {copyFile,stat,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {retrieve,resolveCitation} from '../../packages/knowledge/retrieval.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT,label=process.argv[2];
assert.ok(root&&path.isAbsolute(root)&&/^m6-history-\d+$/.test(label));
const original=path.resolve(root,'..',label,'scale-skewed/copies/v2/archive.db'),copy=path.join(root,'history-copy.db');
const hash=b=>createHash('sha256').update(b).digest('hex'),inputs=[];
for(const suffix of ['','-wal','-shm']){
  try{await stat(original+suffix);}catch(error){if(suffix&&error.code==='ENOENT')continue;throw error;}
  const before=hash(await readFile(original+suffix));await copyFile(original+suffix,copy+suffix,1);
  assert.equal(hash(await readFile(copy+suffix)),before);inputs.push({path:original+suffix,sha256:before});
}
const db=new DatabaseSync(copy,{readOnly:true}),checked=[];
try{
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const sources=db.prepare("SELECT s.* FROM Source s JOIN Document d ON d.source_id=s.id WHERE s.id LIKE 'scale-source-%' AND d.version=5 AND d.active=1 AND d.state='ready'").all();
  assert.equal(sources.length,50);
  for(const source of sources){
    const scope={workspaceId:source.workspace_id,candidateId:source.candidate_id,jobId:source.job_id};
    const previous=db.prepare("SELECT * FROM Document WHERE source_id=? AND version=3 AND state='ready'").get(source.id);assert.ok(previous);
    const current=retrieve(db,{scope,sourceId:source.id,query:'HistoryNeedle'}),past=retrieve(db,{scope,sourceId:source.id,query:'HistoryNeedle',asOf:previous.captured_at});
    assert.ok(current.hits.length&&past.hits.length);
    for(const [result,version,active,marker]of [[current,5,true,'version 3.'],[past,3,false,'version 2.']]){
      for(const hit of result.hits){
        assert.equal(hit.version,version);assert.equal(hit.sourceId,source.id);assert.ok(hit.text.includes(marker));
        if(!active)assert.equal(hit.documentId,previous.id);
        const resolved=resolveCitation(db,{...scope,citation:hit.citation});assert.equal(resolved.text,hit.text);assert.equal(resolved.current,active);
      }
    }
    checked.push({sourceId:source.id,currentCitations:current.hits.length,historicalCitations:past.hits.length});
  }
}finally{db.close();}
for(const input of inputs)assert.equal(hash(await readFile(input.path)),input.sha256,'saved original must remain unchanged');
await writeFile(path.join(root,'history-citation-report.json'),JSON.stringify({passed:true,inputs,checked,originalUnchanged:true,copyReadOnly:true},null,2),{flag:'wx'});
console.log(JSON.stringify({passed:true,sources:checked.length,currentCitations:checked.reduce((n,r)=>n+r.currentCitations,0),historicalCitations:checked.reduce((n,r)=>n+r.historicalCitations,0)}));
