import assert from 'node:assert/strict';

const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
const timestamp=value=>nonempty(value)&&Number.isFinite(Date.parse(value));

// Audit declared review records only. Reviewer identities and independence need
// external confirmation; even complete records cannot certify human quality.
export function auditAnnotations(packet){
  assert.ok(nonempty(packet.revision),'revision required');
  assert.ok(Array.isArray(packet.documents)&&Array.isArray(packet.items),'documents/items required');
  const documents=new Map(),families=new Map(),ids=new Set(),splits=['tune','validation','sealed'];
  for(const doc of packet.documents){
    assert.ok(nonempty(doc.id)&&nonempty(doc.family)&&splits.includes(doc.split),'document identity');
    assert.ok(typeof doc.text==='string'&&/^[a-f0-9]{64}$/i.test(doc.sha256),'document text/source hash');
    assert.ok(!documents.has(doc.id),'duplicate document');
    assert.ok(!families.has(doc.family)||families.get(doc.family)===doc.split,'family split leakage');
    documents.set(doc.id,doc);families.set(doc.family,doc.split);
  }
  const results=[];
  for(const item of packet.items){
    assert.ok(nonempty(item.id)&&!ids.has(item.id),'item identity');ids.add(item.id);
    assert.ok(['retrieval','memory'].includes(item.kind)&&splits.includes(item.split),'item kind/split');
    assert.ok(nonempty(item.prompt)&&nonempty(item.scope?.candidateId)&&timestamp(item.asOf),'prompt/scope/asOf');
    assert.ok(Array.isArray(item.families)&&item.families.length&&new Set(item.families).size===item.families.length,'families required');
    for(const family of item.families)assert.equal(families.get(family),item.split,'query family split');
    assert.ok(Array.isArray(item.annotations)&&item.annotations.length<=2,'zero, one or two reviews required');
    const reviewers=new Set();
    function validate(annotation){
      assert.ok(nonempty(annotation.reviewer)&&timestamp(annotation.at),'reviewer/time');
      assert.equal(annotation.origin,'human','declared human review required');
      const decision=annotation.decision;assert.ok(decision&&typeof decision==='object','decision required');
      if(item.kind==='memory'){
        assert.equal(typeof decision.remember,'boolean','remember boolean');assert.ok(nonempty(decision.reason),'memory reason');return;
      }
      assert.equal(typeof decision.answerable,'boolean','answerability');assert.ok(Array.isArray(decision.judgments),'judgments');
      const judged=new Set();let positive=0;
      for(const judgment of decision.judgments){
        const doc=documents.get(judgment.documentId);assert.ok(doc,'unknown document');
        assert.equal(doc.split,item.split,'judgment split');assert.ok(item.families.includes(doc.family),'judgment family');
        assert.ok(!judged.has(doc.id),'duplicate judgment');judged.add(doc.id);
        assert.ok(Number.isInteger(judgment.grade)&&judgment.grade>=0&&judgment.grade<=2,'grade');
        assert.ok(Array.isArray(judgment.spans),'spans');if(judgment.grade>0){positive++;assert.ok(judgment.spans.length,'positive evidence span required');}
        const points=Array.from(doc.text);
        for(const span of judgment.spans)assert.ok(Number.isInteger(span.start)&&Number.isInteger(span.end)&&span.start>=0&&span.end>span.start&&span.end<=points.length&&points.slice(span.start,span.end).join('')===span.quote,'invalid evidence span');
      }
      assert.equal(decision.answerable,positive>0,'answerability vs relevance');
    }
    for(const annotation of item.annotations){validate(annotation);assert.ok(!reviewers.has(annotation.reviewer),'duplicate reviewer');reviewers.add(annotation.reviewer);}
    const conflict=item.annotations.length===2&&canonical(item.annotations[0].decision)!==canonical(item.annotations[1].decision);
    if(item.adjudication){
      assert.ok(conflict,'adjudication requires disagreement');validate(item.adjudication);
      assert.ok(!reviewers.has(item.adjudication.reviewer),'independent third reviewer required');
      assert.ok(Date.parse(item.adjudication.at)>=Math.max(...item.annotations.map(a=>Date.parse(a.at))),'adjudication predates review');
    }
    results.push({id:item.id,kind:item.kind,split:item.split,reviewed:item.annotations.length>0,doubleReviewed:item.annotations.length===2,unresolved:conflict&&!item.adjudication});
  }
  const count=filter=>results.filter(filter).length;
  const retrieval=count(x=>x.kind==='retrieval'),memory=count(x=>x.kind==='memory');
  const reviewed=count(x=>x.reviewed),doubleReviewed=count(x=>x.doubleReviewed),unresolved=count(x=>x.unresolved);
  const splitCounts=Object.fromEntries(splits.map(split=>[split,count(x=>x.kind==='retrieval'&&x.split===split)]));
  const doubleByKind=Object.fromEntries(['retrieval','memory'].map(kind=>[kind,count(x=>x.kind===kind&&x.doubleReviewed)]));
  return {revision:packet.revision,retrieval,memory,reviewed,doubleReviewed,unresolved,splitCounts,doubleByKind,items:results,
    readyForMetricRun:retrieval===400&&memory===100&&reviewed===500&&!unresolved&&splitCounts.tune===200&&splitCounts.validation===100&&splitCounts.sealed===100&&doubleByKind.retrieval>=80&&doubleByKind.memory>=20,
    formalM5ToM8Complete:false,limitations:['declared human identities and independence are not authenticated','source hashes are metadata; original files must be verified separately','this checks record structure and exact spans, not semantic correctness or sealed-set access history','array order differences conservatively require adjudication']};
}
