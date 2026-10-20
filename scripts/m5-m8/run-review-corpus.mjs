import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {mock} from 'node:test';
import {buildReviewCorpus} from './review-corpus.mjs';
import {activeWorkspace} from '../../tests/helpers/active-workspace.mjs';
import {createWindowsParser} from '../../packages/knowledge/windows-parser.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root&&path.isAbsolute(root));
const runtime=path.join(root,'parser-assets'),workRoot=path.join(root,'parser-work');
const python=path.resolve('backend/.venv-m1/Scripts/python.exe');
const staged=spawnSync(python,['-B','-c','import sys;from workers.parser.stage_runtime import stage;stage(*sys.argv[1:])',runtime,
  path.resolve(root,'../m5-runtime-download-02/python-3.14.7-embed-amd64.zip'),path.resolve('.m1-work/w3-python-20260911-192209/wheelhouse/pypdf-6.4.1-py3-none-any.whl')],{encoding:'utf8',windowsHide:true,timeout:60000});
assert.equal(staged.status,0,staged.stderr);await mkdir(workRoot);
const parse=await createWindowsParser({runtime,workRoot,workspaceRoot:root});
const f=await activeWorkspace('review-corpus-app'),packet=buildReviewCorpus(),bindings=[],candidateIds=new Map();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await writeFile(path.join(root,'input-packet.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
try{
  const ingestion=f.store.createIngestion(),db=ingestion.db;
  for(const logical of new Set(packet.documents.map(d=>d.candidateId))){
    const id=randomUUID();candidateIds.set(logical,id);
    // Explicit fixture-only setup; no production DB or import metadata is altered.
    db.prepare('INSERT INTO Candidate(id,workspace_id,name,profile_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(id,f.workspaceId,logical,'{}','active','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
  }
  for(const doc of packet.documents){
    const candidateId=candidateIds.get(doc.candidateId),bytes=Buffer.from(doc.text);
    assert.equal(hash(bytes),doc.sha256);
    // Freeze Date only inside this synthetic process; leave timers and DB triggers intact.
    const at=new Date(doc.availableFrom).toISOString();
    let captured,parsed;
    mock.timers.enable({apis:['Date'],now:Date.parse(at)});
    try{
      captured=await f.request('source.import',{candidateId,title:doc.id,format:'txt',contentBase64:bytes.toString('base64')});
      parsed=await ingestion.process(captured.jobId,parse);
    }finally{mock.timers.reset();}
    const stored=db.prepare('SELECT parser_revision,text_hash,quality_json FROM Document WHERE id=?').get(parsed.documentId);
    assert.equal(stored.parser_revision,'local-structured-1.2');
    assert.equal(JSON.parse(stored.quality_json).status,'ready');
    const text=(await f.request('document.read',{candidateId,documentId:parsed.documentId})).text;
    assert.equal(text,doc.text);
    assert.equal(db.prepare('SELECT captured_at FROM Document WHERE id=?').get(parsed.documentId).captured_at,at);
    bindings.push({logicalId:doc.id,documentId:parsed.documentId,sourceId:captured.sourceId,candidateId,availableFrom:at,textHash:stored.text_hash});
    if(bindings.length%10===0)console.log(JSON.stringify({imported:bindings.length,total:60}));
  }
  const byId=new Map(bindings.map(b=>[b.documentId,b])),rows=[],calibration=[];let hits=0,citations=0,generation;
  // Exercise future and foreign pinned documents before collecting ordinary rankings.
  for(const logical of candidateIds.keys()){
    const candidateId=candidateIds.get(logical),own=bindings.filter(b=>b.candidateId===candidateId),foreign=bindings.find(b=>b.candidateId!==candidateId);
    const result=await f.request('knowledge.search',{candidateId,query:'虚构',asOf:'2026-01-20T00:00:00.000Z',pinnedIds:[own[0].sourceId,own[1].sourceId,foreign.sourceId]});
    assert.ok(result.items.some(hit=>hit.documentId===own[0].documentId),'non-vacuous historical positive');
    assert.ok(result.items.every(hit=>hit.documentId===own[0].documentId),'future or foreign pinned evidence leaked');
    calibration.push({logical,candidateId,returned:result.items.length,futureExcluded:true,foreignExcluded:true});
  }
  for(const item of packet.items.filter(i=>i.kind==='retrieval')){
    const candidateId=candidateIds.get(item.scope.candidateId),started=performance.now();
    const result=await f.request('knowledge.search',{candidateId,query:item.prompt,asOf:item.asOf,limit:20,maxTokens:32000});
    const elapsedMs=performance.now()-started;
    assert.ok(result.generation,'search must identify its generation');
    generation??=result.generation;assert.equal(result.generation,generation,'index must remain fixed');
    for(const hit of result.items){
      const bound=byId.get(hit.documentId);assert.ok(bound,'unexpected document');
      assert.equal(bound.candidateId,candidateId);assert.ok(bound.availableFrom<=new Date(item.asOf).toISOString());
      const resolved=await f.request('citation.resolve',{candidateId,citation:hit.citation});assert.equal(resolved.text,hit.text);citations++;
    }
    hits+=result.items.length;
    rows.push({queryId:item.id,datasetRevision:packet.revision,revisions:{index:result.generation,config:result.revision,model:'none',prompt:'draft-query-1'},
      documentIds:[...new Set(result.items.map(hit=>hit.documentId))],elapsedMs});
  }
  assert.equal(rows.length,400);assert.ok(hits>0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  const mapped=structuredClone(packet);
  for(const doc of mapped.documents){const binding=bindings.find(b=>b.logicalId===doc.id);doc.logicalId=doc.id;doc.id=binding.documentId;doc.candidateId=binding.candidateId;}
  for(const item of mapped.items)item.scope.candidateId=candidateIds.get(item.scope.candidateId);
  await writeFile(path.join(root,'mapped-packet.json'),JSON.stringify(mapped,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(root,'results.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n',{flag:'wx'});
  const report={success:true,queries:rows.length,documents:bindings.length,candidates:candidateIds.size,hits,citationsResolved:citations,generation,
    calibration,bindings,inputSha256:hash(await readFile(path.join(root,'input-packet.json'))),formalM5ToM8Complete:false,
    limitations:['all fictional unlabelled drafts; no recall/nDCG/semantic precision claimed','Date is mocked during synthetic imports to exercise historical filtering; DB immutability triggers remain intact',
      'TXT through real parser; not a six-format quality benchmark','all proposed splits were executed openly; this is not sealed evaluation','100 memory scenarios are not executed by this retrieval runner']};
  await writeFile(path.join(root,'review-corpus-app-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({success:true,queries:rows.length,documents:bindings.length,hits,citationsResolved:citations}));
}finally{f.store.close();}
