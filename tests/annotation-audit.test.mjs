import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAnnotations} from '../scripts/m5-m8/annotation-audit.mjs';
import {writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const packet=()=>({revision:'pilot-1',documents:[{id:'d',family:'f',split:'tune',text:'中文😀事实',sha256:'a'.repeat(64)}],
  items:[{id:'q',kind:'retrieval',split:'tune',families:['f'],scope:{candidateId:'synthetic'},asOf:'2026-10-05T00:00:00Z',prompt:'事实是什么？',annotations:[]}]});
const annotation=(reviewer,answerable=true)=>({reviewer,at:'2026-10-05T00:00:00Z',origin:'human',decision:{answerable,judgments:answerable?[{documentId:'d',grade:2,spans:[{start:2,end:5,quote:'😀事实'}]}]:[]}});
test('draft cannot pass formal annotation gate',()=>{
  const r=auditAnnotations(packet());assert.equal(r.reviewed,0);assert.equal(r.readyForMetricRun,false);assert.equal(r.formalM5ToM8Complete,false);
});
test('two distinct reviewers agree; spans use Unicode code points',()=>{
  const p=packet();p.items[0].annotations=[annotation('a'),annotation('b')];
  const r=auditAnnotations(p);assert.equal(r.reviewed,1);assert.equal(r.doubleReviewed,1);assert.equal(r.unresolved,0);assert.equal(r.readyForMetricRun,false);
});
test('duplicate reviewer and synthetic origin are rejected',()=>{
  const p=packet();p.items[0].annotations=[annotation('a'),annotation('a')];assert.throws(()=>auditAnnotations(p),/reviewer/);
  p.items[0].annotations=[{...annotation('a'),origin:'synthetic'}];assert.throws(()=>auditAnnotations(p),/human/);
});
test('incorrect quote and split leakage are rejected',()=>{
  const p=packet();p.items[0].annotations=[annotation('a')];p.items[0].annotations[0].decision.judgments[0].spans[0].quote='incorrect';assert.throws(()=>auditAnnotations(p),/span/);
  p.items[0].annotations=[];p.documents.push({...p.documents[0],id:'d2',split:'sealed'});assert.throws(()=>auditAnnotations(p),/family/);
});
test('disagreement needs a third reviewer; self arbitration rejected',()=>{
  const p=packet();p.items[0].annotations=[annotation('a'),annotation('b',false)];assert.equal(auditAnnotations(p).unresolved,1);
  p.items[0].adjudication=annotation('a');assert.throws(()=>auditAnnotations(p),/third reviewer/);
  p.items[0].adjudication=annotation('c');assert.equal(auditAnnotations(p).unresolved,0);
});
test('memory uses explicit remember decisions and rationale',()=>{
  const p=packet();p.items=[{...p.items[0],kind:'memory',id:'m',annotations:[{reviewer:'a',at:'2026-10-05T00:00:00Z',origin:'human',decision:{remember:false,reason:'explicit withdrawal'}}]}];
  assert.equal(auditAnnotations(p).reviewed,1);p.items[0].annotations[0].decision.reason='';assert.throws(()=>auditAnnotations(p),/reason/);
});
test('size, split and double-review thresholds are enforced together',()=>{
  const p=packet(),base=p.items[0];p.items=[];
  p.documents=['tune','validation','sealed'].map(split=>({...p.documents[0],id:split,family:split,split}));
  for(let i=0;i<500;i++){
    const kind=i<400?'retrieval':'memory',split=i<200||i>=400?'tune':i<300?'validation':'sealed';
    const a=annotation('a');if(kind==='memory')a.decision={remember:false,reason:'synthetic test only'};else a.decision.judgments[0].documentId=split;
    const annotations=[a];if(i<80||i>=400&&i<420)annotations.push({...structuredClone(a),reviewer:'b'});
    p.items.push({...base,id:`case-${i}`,kind,split,families:[split],annotations});
  }
  assert.equal(auditAnnotations(p).readyForMetricRun,true);
  p.items[419].annotations.pop();assert.equal(auditAnnotations(p).readyForMetricRun,false);
  p.items[419].annotations.push({...structuredClone(p.items[419].annotations[0]),reviewer:'b'});
  p.items.pop();assert.equal(auditAnnotations(p).readyForMetricRun,false);
});
test('CLI writes draft audit without certifying it, refuses overwrite and outside input',async()=>{
  const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root);
  const input=path.join(root,'annotation-draft.json'),output=path.join(root,'annotation-report.json');
  await writeFile(input,JSON.stringify(packet()),{flag:'wx'});
  const run=file=>spawnSync(process.execPath,['scripts/m5-m8/audit-annotations.mjs',file,output],{encoding:'utf8',windowsHide:true,timeout:15000});
  const first=run(input);assert.equal(first.status,0,first.stderr);
  const before=await readFile(output);const report=JSON.parse(before);assert.equal(report.readyForMetricRun,false);assert.equal(report.formalM5ToM8Complete,false);assert.match(report.inputSha256,/^[a-f0-9]{64}$/);
  const repeat=run(input);assert.notEqual(repeat.status,0);assert.match(repeat.stderr,/EEXIST/);assert.deepEqual(await readFile(output),before);
  const outside=run(process.execPath);assert.notEqual(outside.status,0);assert.match(outside.stderr,/input scope/);
});
