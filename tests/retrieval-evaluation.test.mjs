import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRetrieval} from '../scripts/m5-m8/retrieval-evaluation.mjs';

const fixture=()=>({
  dataset:{version:1,revision:'synthetic-test-1',annotationOrigin:'synthetic',
    documents:[{id:'a',family:'fa',split:'sealed'},{id:'b',family:'fb',split:'sealed'}],
    queries:[{id:'q',split:'sealed',families:['fa'],slices:['numbers'],answerable:true,judgments:[{documentId:'a',grade:2},{documentId:'b',grade:1}]}]},
  results:[{queryId:'q',datasetRevision:'synthetic-test-1',revisions:{index:'i',config:'c',model:'none',prompt:'none'},documentIds:['b']}]});

test('document recall and graded nDCG use the full judged denominator',()=>{
  const {dataset,results}=fixture(),r=evaluateRetrieval(dataset,results);
  assert.equal(r.splits.sealed.recall20,.5);
  assert.ok(Math.abs(r.splits.sealed.ndcg10-1/(3+1/Math.log2(3)))<1e-12);
  assert.equal(r.slices.numbers.recall20,.5);
  assert.equal(r.formalM5ToM8Complete,false);
});
test('no-answer queries are not fabricated as perfect recall or refusal success',()=>{
  const {dataset,results}=fixture();dataset.queries[0].answerable=false;dataset.queries[0].judgments=[];
  const r=evaluateRetrieval(dataset,results);
  assert.equal(r.splits.sealed.recall20,null);assert.equal(r.splits.sealed.ndcg10,null);
  assert.equal(r.splits.sealed.noAnswerQueries,1);assert.equal(r.perQuery[0].unjudgedHits,1);
});
test('source families cannot leak between tuning and sealed queries',()=>{
  const {dataset,results}=fixture();dataset.documents[1].family='fa';dataset.documents[1].split='tune';
  assert.throws(()=>evaluateRetrieval(dataset,results),/family split leakage/);
});
test('missing or duplicate query results cannot improve averages by omission',()=>{
  const {dataset,results}=fixture();assert.throws(()=>evaluateRetrieval(dataset,[]),/result coverage/);
  assert.throws(()=>evaluateRetrieval(dataset,[...results,...results]),/duplicate result/);
});
test('duplicate ranked documents and unknown documents are rejected',()=>{
  const {dataset,results}=fixture();results[0].documentIds=['b','b'];
  assert.throws(()=>evaluateRetrieval(dataset,results),/duplicate ranked document/);
  results[0].documentIds=['unknown'];assert.throws(()=>evaluateRetrieval(dataset,results),/unknown ranked document/);
});
test('dataset and execution revisions are required, and mixed runs are rejected',()=>{
  const {dataset,results}=fixture();results[0].datasetRevision='different';
  assert.throws(()=>evaluateRetrieval(dataset,results),/dataset revision mismatch/);
  results[0].datasetRevision=dataset.revision;delete results[0].revisions.index;
  assert.throws(()=>evaluateRetrieval(dataset,results),/execution revision/);
});
test('relevance labels cannot contradict answerability or cross split boundaries',()=>{
  const {dataset,results}=fixture();dataset.queries[0].answerable=false;
  assert.throws(()=>evaluateRetrieval(dataset,results),/answerability/);
  dataset.queries[0].answerable=true;dataset.queries[0].split='tune';
  assert.throws(()=>evaluateRetrieval(dataset,results),/judgment split/);
});
test('cutoffs do not credit relevant documents below rank 20 or 10',()=>{
  const {dataset,results}=fixture();dataset.queries[0].judgments=[{documentId:'a',grade:2}];
  for(let i=0;i<20;i++)dataset.documents.push({id:`noise-${i}`,family:`noise-${i}`,split:'sealed'});
  results[0].documentIds=[...Array.from({length:20},(_,i)=>`noise-${i}`),'a'];
  const r=evaluateRetrieval(dataset,results);assert.equal(r.splits.sealed.recall20,0);assert.equal(r.splits.sealed.ndcg10,0);
});
test('execution revisions cannot be silently mixed across queries',()=>{
  const {dataset,results}=fixture();dataset.queries.push({...dataset.queries[0],id:'q2'});
  results.push({...results[0],queryId:'q2',revisions:{...results[0].revisions,index:'different'}});
  assert.throws(()=>evaluateRetrieval(dataset,results),/mixed execution revisions/);
});
test('no-answer queries retain an origin family and cannot leak across splits',()=>{
  const {dataset,results}=fixture();const q=dataset.queries[0];q.answerable=false;q.judgments=[];q.split='tune';results[0].documentIds=[];
  assert.throws(()=>evaluateRetrieval(dataset,results),/query family split/);
  q.split='sealed';q.families=[];assert.throws(()=>evaluateRetrieval(dataset,results),/query families/);
});
test('queries cannot disappear from all slice denominators',()=>{
  const {dataset,results}=fixture();dataset.queries[0].slices=[];
  assert.throws(()=>evaluateRetrieval(dataset,results),/slices required/);
});
