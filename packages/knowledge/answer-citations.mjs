import {contentHash} from '../storage/blob-store.mjs';
import {citationIdentity,resolveCitation} from './retrieval.mjs';
import {MemoryStore} from './memory.mjs';

function allowedReferences(db,scope,runId){
  const event=db.prepare("SELECT payload_json FROM Event WHERE workspace_id=? AND run_id=? AND type='agent.provider.request' ORDER BY sequence DESC LIMIT 1").get(scope.workspaceId,runId);
  const manifest=event&&JSON.parse(event.payload_json).record?.contextManifest,refs=new Map();
  if(manifest?.revision!=='whole-turn-context-2'||!Array.isArray(manifest.selectedToolCallIds))return refs;
  const started=JSON.parse(db.prepare("SELECT payload_json FROM Event WHERE workspace_id=? AND run_id=? AND type='agent.started'").get(scope.workspaceId,runId).payload_json);
  const prefix=`pi:${started.mode==='task'?runId:started.userMessageId}:`;
  for(const id of manifest.selectedToolCallIds){
    const call=db.prepare("SELECT tool_id,result_json,receipt_hash FROM ToolCall WHERE workspace_id=? AND run_id=? AND invocation_id=? AND state='completed'").get(scope.workspaceId,runId,prefix+id);
    if(!call||contentHash(call.result_json)!==call.receipt_hash)continue;
    const value=JSON.parse(call.result_json);
    let items=call.tool_id==='search_knowledge'?value.items:call.tool_id==='read_evidence'?[value]:[];
    if(call.tool_id==='read_memory'){
      try{new MemoryStore(db,scope.workspaceId).validateSnapshot(scope,value);items=value.factReferences??[];}catch{continue;}
    }
    for(const item of items)if(item.citation)refs.set(citationIdentity(item.citation),item.citation);
  }
  return refs;
}

function uncovered(content,citations){
  const chars=[...content],covered=citations.flatMap(c=>[
    [c.markerStart,c.markerEnd],...(c.verificationState==='exact_quote'?[[c.answerStart,c.answerEnd]]:[]),
  ]).sort((a,b)=>a[0]-b[0]);
  let end=0;const ranges=[];
  for(const [start,next] of [...covered,[chars.length,chars.length]]){
    if(start>end&&chars.slice(end,start).join('').trim())ranges.push({start:end,end:start});
    end=Math.max(end,next);
  }
  return ranges;
}

// Structural correspondence only. Neither a valid URL nor an exact quote proves
// that a paraphrase is entailed or that the source itself is truthful.
export function reviewAnswerCitations(db,scope,runId,content){
  const prior=db.prepare("SELECT payload_json FROM Event WHERE workspace_id=? AND run_id=? AND type='agent.finished'").get(scope.workspaceId,runId);
  if(prior){
    const saved=db.prepare("SELECT payload_json FROM Event WHERE workspace_id=? AND run_id=? AND type='agent.citations.reviewed' AND actor='app'").get(scope.workspaceId,runId);
    return saved?JSON.parse(saved.payload_json).review:undefined;
  }
  return reviewProposedCitations(db,scope,runId,content);
}

export function reviewProposedCitations(db,scope,runId,content){
  const allowed=allowedReferences(db,scope,runId),citations=[];let previousEnd=0;
  for(const match of content.matchAll(/\[\[cite:([a-f0-9]{64})\]\]/g)){
    if(citations.length===100)break;
    const markerStart=[...content.slice(0,match.index)].length,markerEnd=markerStart+[...match[0]].length;
    const row={referenceId:match[1],markerStart,markerEnd,answerStart:previousEnd,answerEnd:markerStart,verificationState:'not_in_context'};
    const citation=allowed.get(row.referenceId);
    if(citation){
      row.citation=citation;
      try{
        const resolved=resolveCitation(db,{...scope,citation});
        row.verificationState=resolved.current?'unverified_support':'source_not_current';
        const prefix=content.slice(0,match.index).trimEnd();
        if(resolved.current&&prefix.endsWith(resolved.text)){
          row.verificationState='exact_quote';row.answerEnd=[...prefix].length;row.answerStart=row.answerEnd-[...resolved.text].length;
        }
      }catch{row.verificationState='source_unavailable';}
    }
    citations.push(row);previousEnd=markerEnd;
  }
  return {schemaVersion:1,revision:'answer-citations-1',offsetUnit:'unicode_codepoint',contentHash:contentHash(content),
    semanticSupport:'not_automatically_verified',citations,unverifiedRanges:uncovered(content,citations)};
}

export function readAnswerCitationReview(db,scope,message){
  if(message.role!=='assistant'||!message.run_id)return undefined;
  const event=db.prepare("SELECT payload_json FROM Event WHERE workspace_id=? AND run_id=? AND type='agent.citations.reviewed' AND actor='app'").get(scope.workspaceId,message.run_id);
  if(!event)return undefined;
  const payload=JSON.parse(event.payload_json),review=payload.review;
  const content=JSON.parse(message.content_json).parts.filter(p=>p.type==='text').map(p=>p.text).join('\n');
  const chars=[...content],states=new Set(['exact_quote','unverified_support','source_not_current','source_unavailable','not_in_context']);
  if(payload.messageId!==message.id||review?.contentHash!==contentHash(content)||review.schemaVersion!==1||review.revision!=='answer-citations-1'||review.offsetUnit!=='unicode_codepoint'||
    review.semanticSupport!=='not_automatically_verified'||!Array.isArray(review.citations)||review.citations.length>100)return undefined;
  for(const item of review.citations){
    if(!item||!states.has(item.verificationState)||!['answerStart','answerEnd','markerStart','markerEnd'].every(k=>Number.isSafeInteger(item[k])&&item[k]>=0&&item[k]<=chars.length)||
      item.answerStart>item.answerEnd||item.answerEnd>item.markerStart||item.markerStart>=item.markerEnd||
      chars.slice(item.markerStart,item.markerEnd).join('')!==`[[cite:${item.referenceId}]]`||
      item.citation&&citationIdentity(item.citation)!==item.referenceId||!item.citation&&item.verificationState!=='not_in_context')return undefined;
  }
  for(const item of review.citations){
    if(!item.citation)continue;
    try{if(!resolveCitation(db,{...scope,citation:item.citation}).current)item.verificationState='source_not_current';}
    catch{item.verificationState='source_unavailable';}
  }
  review.unverifiedRanges=uncovered(content,review.citations);return review;
}
