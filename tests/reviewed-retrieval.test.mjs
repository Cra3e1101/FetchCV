import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {evaluateReviewedRetrieval} from '../scripts/m5-m8/reviewed-retrieval.mjs';

// Synthetic branch coverage only, never a human-reviewed evaluation corpus.
function fixture(){
  const documents=['tune','validation','sealed'].map(split=>({id:split,family:split,split,text:'fact',sha256:'a'.repeat(64)}));
  const items=Array.from({length:500},(_,i)=>{
    const kind=i<400?'retrieval':'memory',split=i<200||i>=400?'tune':i<300?'validation':'sealed';
    const decision=kind==='memory'?{remember:false,reason:'synthetic fixture'}:{answerable:true,judgments:[{documentId:split,grade:2,spans:[{start:0,end:4,quote:'fact'}]}]};
    const first={reviewer:'fixture-a',at:'2026-10-05T00:00:00Z',origin:'human',decision};
    return {id:`q${i}`,kind,split,families:[split],slices:['fixture'],scope:{candidateId:'fixture'},asOf:first.at,prompt:'fixture question',annotations:i<80||i>=400&&i<420?[first,{...structuredClone(first),reviewer:'fixture-b'}]:[first]};
  });
  const packet={revision:'fixture-1',documents,items};
  const results=items.filter(i=>i.kind==='retrieval').map(i=>({queryId:i.id,datasetRevision:packet.revision,revisions:{index:'i',config:'c',model:'m',prompt:'p'},documentIds:[i.split]}));
  return {packet,results};
}
test('reviewed scoring refuses missing review coverage and unresolved disagreement',()=>{
  const {packet,results}=fixture();packet.items[0].annotations=[];
  assert.throws(()=>evaluateReviewedRetrieval(packet,results),/annotation gate/);
  const f=fixture();f.packet.items[0].annotations[1].decision={answerable:false,judgments:[]};
  assert.throws(()=>evaluateReviewedRetrieval(f.packet,f.results),/annotation gate/);
});
test('reviewed scoring uses third-party adjudication, retaining no-answer denominator rules',()=>{
  const {packet,results}=fixture();const item=packet.items[0];
  item.annotations[1].decision={answerable:false,judgments:[]};
  item.adjudication={...structuredClone(item.annotations[1]),reviewer:'fixture-c'};
  const report=evaluateReviewedRetrieval(packet,results);
  assert.equal(report.perQuery.length,400);assert.equal(report.perQuery[0].answerable,false);
  assert.equal(report.perQuery[0].recall20,null);assert.equal(report.splits.tune.answerableQueries,199);
  assert.equal(report.annotationAudit.readyForMetricRun,true);assert.equal(report.formalM5ToM8Complete,false);
});
test('reviewed scoring preserves evaluator revision and slice checks',()=>{
  const f=fixture();f.results[0].datasetRevision='stale';
  assert.throws(()=>evaluateReviewedRetrieval(f.packet,f.results),/revision mismatch/);
  f.results[0].datasetRevision=f.packet.revision;delete f.packet.items[0].slices;
  assert.throws(()=>evaluateReviewedRetrieval(f.packet,f.results),/slices required/);
});
test('CLI binds reviewed scoring to exact packet bytes and rejects drafts without a report',async()=>{
  const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root);
  const {packet,results}=fixture(),input=path.join(root,'reviewed-fixture.json'),ranking=path.join(root,'ranking.jsonl'),output=path.join(root,'reviewed-score.json');
  const bytes=JSON.stringify(packet);await writeFile(input,bytes,{flag:'wx'});
  await writeFile(ranking,results.map(r=>JSON.stringify(r)).join('\n'),{flag:'wx'});
  const run=(file,out)=>spawnSync(process.execPath,['scripts/m5-m8/evaluate-retrieval.mjs',file,ranking,out,'--reviewed'],{encoding:'utf8',windowsHide:true,timeout:15000});
  const child=run(input,output);assert.equal(child.status,0,child.stderr);
  const report=JSON.parse(await readFile(output));assert.equal(report.mode,'reviewed');assert.equal(report.formalM5ToM8Complete,false);
  assert.equal(report.inputs.datasetSha256,createHash('sha256').update(bytes).digest('hex'));
  packet.items[0].annotations=[];const draft=path.join(root,'reviewed-draft.json'),rejected=path.join(root,'rejected-score.json');
  await writeFile(draft,JSON.stringify(packet),{flag:'wx'});
  const failure=run(draft,rejected);assert.notEqual(failure.status,0);assert.match(failure.stderr,/annotation gate/);
  await assert.rejects(access(rejected),{code:'ENOENT'});
});
