import assert from 'node:assert/strict';

const splits=['tune','validation','sealed'];
const text=value=>typeof value==='string'&&value.trim().length>0;
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const dcg=grades=>grades.slice(0,10).reduce((sum,grade,i)=>sum+(2**grade-1)/Math.log2(i+2),0);
function unique(values,message){assert.equal(new Set(values).size,values.length,message);}

// Pure, offline scoring. A declared annotation origin is not independently
// verified human review; this function never certifies the complete milestone.
export function evaluateRetrieval(dataset,results){
  assert.equal(dataset.version,1);assert.ok(text(dataset.revision),'dataset revision');
  assert.ok(['synthetic','human'].includes(dataset.annotationOrigin),'annotation origin');
  assert.ok(Array.isArray(dataset.documents)&&dataset.documents.length,'documents required');
  assert.ok(Array.isArray(dataset.queries)&&dataset.queries.length,'queries required');
  assert.ok(Array.isArray(results),'results array required');
  const documents=new Map(),families=new Map();
  for(const d of dataset.documents){
    assert.ok(text(d.id)&&text(d.family)&&splits.includes(d.split),'document identity/split');
    assert.ok(!documents.has(d.id),'duplicate document');documents.set(d.id,d);
    assert.ok(!families.has(d.family)||families.get(d.family)===d.split,'family split leakage');families.set(d.family,d.split);
  }
  unique(dataset.queries.map(q=>q.id),'duplicate query');
  unique(results.map(r=>r.queryId),'duplicate result');
  const byQuery=new Map(results.map(row=>[row.queryId,row]));
  assert.equal(byQuery.size,dataset.queries.length,'result coverage');
  let executionRevision;
  const perQuery=dataset.queries.map(q=>{
    assert.ok(text(q.id)&&splits.includes(q.split),'query identity/split');
    assert.ok(typeof q.answerable==='boolean'&&Array.isArray(q.judgments),'answerability/judgments');
    assert.ok(Array.isArray(q.slices)&&q.slices.length>0&&q.slices.every(text),'slices required');unique(q.slices,'duplicate slice');
    unique(q.judgments.map(j=>j.documentId),'duplicate judgment');
    const grades=new Map();
    for(const j of q.judgments){
      assert.ok(documents.has(j.documentId),'unknown judged document');
      assert.equal(documents.get(j.documentId).split,q.split,'judgment split');
      assert.ok(Number.isInteger(j.grade)&&j.grade>=0&&j.grade<=2,'relevance grade');grades.set(j.documentId,j.grade);
    }
    assert.ok(Array.isArray(q.families)&&q.families.length>0&&q.families.every(text),'query families required');unique(q.families,'duplicate query family');
    for(const family of q.families)assert.equal(families.get(family),q.split,'query family split');
    const relevant=[...grades.values()].filter(grade=>grade>0);
    assert.equal(q.answerable,relevant.length>0,'answerability contradicts relevance labels');
    const row=byQuery.get(q.id);assert.ok(row,'result coverage');
    assert.equal(row.datasetRevision,dataset.revision,'dataset revision mismatch');
    const revision=['index','config','model','prompt'].map(key=>row.revisions?.[key]);
    assert.ok(revision.every(text),'execution revision required');
    const encoded=JSON.stringify(revision);executionRevision??=encoded;
    assert.equal(encoded,executionRevision,'mixed execution revisions');
    assert.ok(Array.isArray(row.documentIds),'ranked documents required');unique(row.documentIds,'duplicate ranked document');
    for(const id of row.documentIds){assert.ok(documents.has(id),'unknown ranked document');assert.equal(documents.get(id).split,q.split,'ranked document split');}
    const ranked=row.documentIds.map(id=>grades.get(id)??0),ideal=dcg([...relevant].sort((a,b)=>b-a));
    return {queryId:q.id,split:q.split,slices:q.slices,answerable:q.answerable,
      relevantDocuments:relevant.length,returnedDocuments:ranked.length,
      recall20:relevant.length?ranked.slice(0,20).filter(grade=>grade>0).length/relevant.length:null,
      ndcg10:ideal?dcg(ranked)/ideal:null,unjudgedHits:row.documentIds.filter(id=>!grades.has(id)).length};
  });
  function aggregate(rows){return {queries:rows.length,answerableQueries:rows.filter(r=>r.answerable).length,noAnswerQueries:rows.filter(r=>!r.answerable).length,
    recall20:mean(rows.flatMap(r=>r.recall20===null?[]:[r.recall20])),ndcg10:mean(rows.flatMap(r=>r.ndcg10===null?[]:[r.ndcg10])),unjudgedHits:rows.reduce((n,r)=>n+r.unjudgedHits,0)};}
  return {version:1,datasetRevision:dataset.revision,annotationOrigin:dataset.annotationOrigin,executionRevisions:JSON.parse(executionRevision),
    unit:'unique_document_version',perQuery,splits:Object.fromEntries(splits.map(s=>[s,aggregate(perQuery.filter(q=>q.split===s))])),
    slices:Object.fromEntries([...new Set(perQuery.flatMap(q=>q.slices))].map(s=>[s,aggregate(perQuery.filter(q=>q.slices.includes(s)))])),
    formalM5ToM8Complete:false,limitations:['unjudged hits score zero; judgment coverage is reported, not assumed exhaustive',
      'no-answer queries excluded from recall/nDCG denominators; this does not measure correct refusal',
      'document-level ranking only; evidence spans, authorization, semantic support and human adjudication require separate verification',
      'annotation origin is declared metadata, not proof of independent human labeling; corpus size and full section-21 gates are not certified']};
}
