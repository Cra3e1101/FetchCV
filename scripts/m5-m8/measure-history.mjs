import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {writeFile,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {scaleFixture} from './scale-fixture.mjs';
import {ApplicationStore} from '../../packages/storage/application-store.mjs';
import {retrieve,resolveCitation} from '../../packages/knowledge/retrieval.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root&&path.isAbsolute(root));
const f=await scaleFixture('skewed'),scope={...f.scope,workspaceId:f.workspaceId};f.store.close();
const jsonl=path.join(root,'history-queries.jsonl');await writeFile(jsonl,'',{flag:'wx'});
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return {n:values.length,p50:sorted[Math.ceil(.5*values.length)-1],p95:sorted[Math.ceil(.95*values.length)-1],max:sorted.at(-1)};};
const rows=[];let historical;
for(let round=1;round<=3;round++){
  if(round>1){
    const store=await ApplicationStore.open(f.root);
    try{
      const ingestion=store.createIngestion(),db=ingestion.db;
      const sources=db.prepare("SELECT * FROM Source WHERE candidate_id=? AND job_id IS NULL AND id LIKE 'scale-source-%' ORDER BY id LIMIT 50").all(scope.candidateId);
      assert.equal(sources.length,50);
      for(const source of sources){
        const text=`Synthetic HistoryNeedle source ${source.id} version ${round}. SQL 权限 测试 数字 ${round*10}.`;
        const item=await store.dispatch({v:1,id:randomUUID(),workspaceId:f.workspaceId,method:'source.import',payload:{candidateId:scope.candidateId,jobId:null,
          sourceId:source.id,expectedRevision:source.revision,title:'Synthetic history',format:'txt',contentBase64:Buffer.from(text).toString('base64')}});
        const parsed=await ingestion.process(item.jobId,async()=>({schemaVersion:1,parserId:'fetchcv-local',parserRevision:'local-structured-1',format:'txt',offsetUnit:'unicode_codepoint',source_text:text,
          quality:{status:'ready'},blocks:[{type:'text',text,charStart:0,charEnd:[...text].length,headingPath:[],originRef:{type:'text'}}]}));
        if(round===2&&!historical)historical={sourceId:source.id,documentId:parsed.documentId,asOf:db.prepare('SELECT captured_at FROM Document WHERE id=?').get(parsed.documentId).captured_at,text};
      }
      assert.equal(db.prepare('SELECT count(*) n FROM Source').get().n,5000);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{store.close();}
  }
  const run=query=>JSON.parse(execFileSync(process.execPath,['scripts/m5-m8/measure-first-query.mjs',f.root,scope.candidateId,scope.jobId,query],{encoding:'utf8',windowsHide:true,timeout:120000}));
  const build=run('Synthetic'),queries=[];
  for(let i=0;i<30;i++){
    const result={round,sample:i+1,...run(i%2?'SQL':'Synthetic')};assert.equal(result.generation,build.generation);
    queries.push(result);await appendFile(jsonl,JSON.stringify(result)+'\n');
  }
  const store=await ApplicationStore.open(f.root);let inventory;
  try{
    const db=store.createIngestion().db;
    inventory=Object.fromEntries(['Source','Document','SearchGeneration','SearchChunk'].map(table=>[table,db.prepare(`SELECT count(*) n FROM ${table}`).get().n]));
    assert.equal(inventory.SearchGeneration,round);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    if(round===3){
      const current=retrieve(db,{scope,query:'HistoryNeedle',sourceId:historical.sourceId});
      // Each import adds a captured version and then an immutable parsed version.
      assert.ok(current.hits.length);assert.ok(current.hits.every(hit=>hit.version===5));
      for(const hit of current.hits){const resolved=resolveCitation(db,{...scope,citation:hit.citation});assert.equal(resolved.text,hit.text);assert.equal(resolved.current,true);}
      const past=retrieve(db,{scope,query:'HistoryNeedle',sourceId:historical.sourceId,asOf:historical.asOf});
      assert.ok(past.hits.length);assert.ok(past.hits.every(hit=>hit.documentId===historical.documentId&&hit.version===3));
      for(const hit of past.hits){const resolved=resolveCitation(db,{...scope,citation:hit.citation});assert.equal(resolved.text,hit.text);assert.equal(resolved.current,false);}
    }
  }finally{store.close();}
  const row={round,inventory,buildAndFirstQueryMs:build.queryMs,queryMs:summary(queries.map(q=>q.queryMs)),payloadBytes:summary(queries.map(q=>q.payloadBytes))};
  rows.push(row);console.log(JSON.stringify(row));
}
const report={revision:'history-scale-3',createdAt:new Date().toISOString(),rows,versionsPerUpdatedSource:5,parsedVersionsPerUpdatedSource:3,updatedSources:50,
  citationSampledSources:1,currentAndHistoricalCitationChecks:true,passed:rows.every(r=>r.queryMs.p95<=200&&r.payloadBytes.max<=256*1024),formalM5ToM8Complete:false,
  limitations:['synthetic text parser IR; not a parser-quality measurement','three retained generations, 100 new parsed plus 100 captured document versions; not unbounded history','fresh child query on a ready index, OS cache not flushed; excludes workspace open and Electron IPC/paint','two fixed queries, one scope; not human sealed quality']};
await writeFile(path.join(root,'history-report.json'),JSON.stringify(report,null,2),{flag:'wx'});
if(!report.passed)process.exitCode=2;
