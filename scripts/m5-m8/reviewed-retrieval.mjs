import assert from 'node:assert/strict';
import {auditAnnotations} from './annotation-audit.mjs';
import {evaluateRetrieval} from './retrieval-evaluation.mjs';

// Use the reviewed packet itself, not independently copied relevance labels.
// Structural readiness does not authenticate reviewers or certify quality.
export function evaluateReviewedRetrieval(packet,results){
  const annotationAudit=auditAnnotations(packet);
  assert.ok(annotationAudit.readyForMetricRun,'annotation gate: incomplete review coverage or unresolved disagreement');
  const dataset={version:1,revision:packet.revision,annotationOrigin:'human',documents:packet.documents,
    queries:packet.items.filter(item=>item.kind==='retrieval').map(item=>{
      const decision=(item.adjudication??item.annotations[0]).decision;
      return {id:item.id,split:item.split,families:item.families,slices:item.slices,
        answerable:decision.answerable,judgments:decision.judgments};
    })};
  return {...evaluateRetrieval(dataset,results),annotationAudit,formalM5ToM8Complete:false};
}
