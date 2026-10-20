import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {activeWorkspace} from '../../tests/helpers/active-workspace.mjs';
import {createWindowsParser} from '../../packages/knowledge/windows-parser.mjs';
import {IngestScheduler} from '../../packages/app/ingest-scheduler.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root&&path.isAbsolute(root));
await import('./measure-parser-corpus.mjs');assert.ok(!process.exitCode,'corpus generation must pass before APP validation');
const corpus=path.join(root,'parser-corpus'),manifest=JSON.parse(await readFile(path.join(corpus,'manifest.json'),'utf8'));
const runtime=path.join(root,'parser-assets'),python=path.resolve('backend/.venv-m1/Scripts/python.exe');
const stage=spawnSync(python,['-B','-c','import sys;from workers.parser.stage_runtime import stage;stage(*sys.argv[1:])',runtime,
  path.resolve(root,'../m5-runtime-download-02/python-3.14.7-embed-amd64.zip'),path.resolve('.m1-work/w3-python-20260911-192209/wheelhouse/pypdf-6.4.1-py3-none-any.whl')],{encoding:'utf8',windowsHide:true,timeout:60000});
assert.equal(stage.status,0,stage.stderr);
const workRoot=path.join(root,'parser-work');await mkdir(workRoot);
const parse=await createWindowsParser({runtime,workRoot,workspaceRoot:root});
const f=await activeWorkspace('corpus-app'),scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},captures=[];
let scheduler;
try{
  for(const source of manifest.sources){
    const bytes=await readFile(path.join(corpus,source.file));assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256);
    const capture=await f.request('source.import',{...scope,title:source.id,format:source.parserFormat,contentBase64:bytes.toString('base64')});
    captures.push({source,capture});
  }
  scheduler=new IngestScheduler(f.store.createIngestion(),parse);
  const deadline=Date.now()+180000;let complete=0;
  while(complete<captures.length){
    const states=f.store.createIngestion().db.prepare("SELECT state,count(*) n FROM IngestJob WHERE stage='parse' GROUP BY state").all();
    assert.ok(!states.some(s=>['failed','cancelled'].includes(s.state)),JSON.stringify(states));
    complete=states.find(s=>s.state==='completed')?.n||0;
    assert.ok(Date.now()<deadline,`APP parser queue deadline: ${complete}/60`);
    if(complete<captures.length)await new Promise(resolve=>setTimeout(resolve,100));
  }
  const results=[];
  for(const {source,capture}of captures){
    const status=await f.request('source.status',{...scope,sourceId:capture.sourceId});
    const job=status.jobs.find(job=>job.id===capture.jobId);assert.equal(job.state,'completed');
    const doc=await f.request('document.read',{...scope,documentId:job.document_id});
    const stored=f.store.createIngestion().db.prepare('SELECT quality_json,parser_revision FROM Document WHERE id=?').get(job.document_id);
    assert.equal(stored.parser_revision,'local-structured-1.2');
    const quality=JSON.parse(stored.quality_json);
    const recovered=source.facts.filter(fact=>doc.text.includes(fact)).length;
    const scanned=source.format==='scan-pdf';
    assert.equal(quality.status,scanned?'needs_review':'ready');
    assert.equal(recovered,scanned?0:source.facts.length);
    const originals=await readFile(path.join(corpus,source.file));assert.equal(createHash('sha256').update(originals).digest('hex'),source.sha256);
    results.push({id:source.id,format:source.format,sourceId:capture.sourceId,documentId:job.document_id,parserRevision:stored.parser_revision,quality,facts:source.facts.length,recovered});
  }
  const found=await f.request('knowledge.search',{...scope,query:'Record',maxTokens:32000});
  assert.ok(found.items.length);
  const reviewSources=new Set(results.filter(r=>r.quality.status==='needs_review').map(r=>r.sourceId));
  assert.ok(found.items.every(hit=>!reviewSources.has(hit.sourceId)));
  for(const hit of found.items)assert.equal((await f.request('citation.resolve',{...scope,citation:hit.citation})).text,hit.text);
  const report={revision:'synthetic-corpus-app-2',passed:true,results,parsed:60,ready:50,needsReview:10,citationsChecked:found.items.length,
    scope,workspaceRoot:f.root,formalM5ToM8Complete:false,limitations:['synthetic templates; not human annotation','scanned files correctly require review; OCR not executed','citation sample is limited to this search result, not every source']};
  await writeFile(path.join(root,'corpus-app-report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({passed:true,parsed:60,ready:50,needsReview:10,citationsChecked:found.items.length}));
}finally{await scheduler?.close();f.store.close();}
