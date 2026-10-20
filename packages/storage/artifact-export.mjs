import {readArtifact} from './workspace-reader.mjs';
import {resolveCitation} from '../knowledge/retrieval.mjs';
import {contentHash} from './blob-store.mjs';
import {ContractError} from '../contracts/runtime.mjs';
export function exportArtifact(db,p){
 const artifact=readArtifact(db,p);
 if(artifact.status==='draft')throw new ContractError('artifact_not_approved');
 const saved=db.prepare("SELECT payload_json FROM Event WHERE workspace_id=? AND type='artifact.citations.reviewed' AND actor='app' AND json_extract(payload_json,'$.versionId')=? ORDER BY sequence LIMIT 1").get(p.workspaceId,artifact.versionId);
 const receipt=saved?JSON.parse(saved.payload_json):null;
 const text=typeof artifact.content.content==='string'?artifact.content.content:JSON.stringify(artifact.content.content,null,2);
 const review=receipt?.contentHash===artifact.contentHash&&receipt.review?.contentHash===contentHash(text)?receipt.review:null;
 const references=[];
 for(const [index,item]of (review?.citations??[]).entries()){
  const row={number:index+1,referenceId:item.referenceId,citation:item.citation??null,state:'unverified'};
  if(item.citation){
   try{const resolved=resolveCitation(db,{...p,citation:item.citation});
    const metadata=db.prepare('SELECT d.version,s.title FROM Document d JOIN Source s ON s.workspace_id=d.workspace_id AND s.id=d.source_id WHERE d.workspace_id=? AND d.id=?').get(p.workspaceId,item.citation.documentId);
    Object.assign(row,{state:resolved.current?'available':'historical',quote:resolved.text,documentVersion:metadata.version,title:metadata.title});
   }catch{row.state='unavailable';}
  }
  references.push(row);
 }
 return {schemaVersion:1,format:'fetchcv-reviewed-artifact-1',artifact,references,
  citationReviewRecorded:Boolean(review),semanticSupport:'not_automatically_verified',
  note:'保留完整版本正文及引用标记；出处可定位不等于语义已核验。缺失或已撤回来源不附带原文。'};
}
