import {randomUUID} from 'node:crypto';
import {ContractError} from '../contracts/runtime.mjs';
import {canonicalJSON} from './legacy-archive.mjs';
import {contentHash} from './blob-store.mjs';
import {readArtifact} from './workspace-reader.mjs';
import {reviewProposedCitations} from '../knowledge/answer-citations.mjs';

// Caller holds the APP transaction. A model may create a draft, but only the
// separate trusted-user command may decide and publish that exact operation.
export function proposeArtifact(db,repo,runId,callId,scope,args){
  const base=readArtifact(db,{...scope,artifactId:args.artifactId});
  if(base.versionId!==args.basedOnVersionId||base.contentHash!==args.basedOnHash)throw new ContractError('artifact_revision_conflict');
  const row=db.prepare('SELECT * FROM Artifact WHERE workspace_id=? AND id=?').get(scope.workspaceId,args.artifactId);
  const version=db.prepare('SELECT max(version)+1 n FROM ArtifactVersion WHERE workspace_id=? AND artifact_id=?').get(scope.workspaceId,row.id).n;
  const now=new Date().toISOString(),versionId=randomUUID(),approvalId=randomUUID();
  const body=canonicalJSON({schemaVersion:1,content:args.text,proposed:true,reason:args.reason});
  db.prepare(`INSERT INTO ArtifactVersion(id,workspace_id,artifact_id,version,content_json,based_on_id,run_id,status,content_hash,schema_version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'draft',?,1,?,?)`).run(versionId,scope.workspaceId,row.id,version,body,base.versionId,runId,contentHash(body),now,now);
  const target={...scope,artifactId:row.id,basedOnVersionId:base.versionId,versionId,contentHash:contentHash(body)};
  const operationHash=db.prepare('SELECT operation_hash FROM ToolCall WHERE workspace_id=? AND id=? AND run_id=?').get(scope.workspaceId,callId,runId).operation_hash;
  db.prepare(`INSERT INTO Approval(id,workspace_id,tool_call_id,operation_hash,decision,actor,expires_at,scope_json,policy_revision,created_at,updated_at)
    VALUES (?,?,?,?,'pending','app',?,?,'m4-artifact-2',?,?)`).run(approvalId,scope.workspaceId,callId,operationHash,new Date(Date.now()+86400000).toISOString(),canonicalJSON(target),now,now);
  const result={artifactId:row.id,versionId,approvalId,operationHash,requires_user_action:true,summary:'已保存待审阅草稿；当前版本尚未改变。'};
  const receipt=canonicalJSON(result);
  db.prepare("UPDATE ToolCall SET state='waiting_approval',result_json=?,receipt_hash=?,target_json=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND id=? AND state='running'").run(receipt,contentHash(receipt),canonicalJSON(target),now,scope.workspaceId,callId);
  repo.event('artifact.citations.reviewed',runId,{versionId,contentHash:contentHash(body),review:reviewProposedCitations(db,scope,runId,args.text)});
  repo.event('artifact.proposed',runId,{...result});return result;
}

export function readPendingApproval(db,{workspaceId,candidateId=null,jobId=null,approvalId}){
  const row=db.prepare(`SELECT a.*,t.run_id,t.state AS call_state,t.result_json,t.operation_hash AS call_operation_hash,t.args_json,t.target_json,t.tool_id,t.tool_revision FROM Approval a JOIN ToolCall t ON t.workspace_id=a.workspace_id AND t.id=a.tool_call_id
    WHERE a.workspace_id=? AND a.id=? AND a.deleted_at IS NULL AND t.deleted_at IS NULL AND a.policy_revision='m4-artifact-2'`).get(workspaceId,approvalId);
  if(!row)throw new ContractError('approval_unavailable');
  const target=JSON.parse(row.scope_json);
  const args=JSON.parse(row.args_json);
  const expectedHash=contentHash(canonicalJSON({runId:row.run_id,toolId:row.tool_id,revision:row.tool_revision,args}));
  if(target.candidateId!==candidateId||target.jobId!==jobId||row.tool_id!=='propose_artifact'||row.operation_hash!==row.call_operation_hash||expectedHash!==row.operation_hash||row.target_json!==row.scope_json)throw new ContractError('approval_unavailable');
  const proposed=readArtifact(db,{workspaceId,candidateId,jobId,artifactId:target.artifactId,versionId:target.versionId});
  const original=readArtifact(db,{workspaceId,candidateId,jobId,artifactId:target.artifactId,versionId:target.basedOnVersionId});
  const expectedContent=canonicalJSON({schemaVersion:1,content:args.text,proposed:true,reason:args.reason});
  if(target.artifactId!==args.artifactId||target.basedOnVersionId!==args.basedOnVersionId||original.contentHash!==args.basedOnHash||proposed.contentHash!==target.contentHash||proposed.contentHash!==contentHash(expectedContent))throw new ContractError('approval_corrupt');
  return {row,target,proposed,original};
}

export function decideArtifact(db,repo,p){
  const {row,target,proposed}=readPendingApproval(db,p);
  if(row.operation_hash!==p.operationHash)throw new ContractError('approval_operation_mismatch');
  if(!['approved','rejected'].includes(p.decision))throw new ContractError('invalid_decision');
  if(row.decision===p.decision)return {approvalId:row.id,decision:row.decision,versionId:target.versionId};
  if(row.decision!=='pending'||row.call_state!=='waiting_approval'||row.expires_at<=new Date().toISOString())throw new ContractError('approval_expired');
  const now=new Date().toISOString();
  if(p.decision==='approved'){
    const current=readArtifact(db,{...p,artifactId:target.artifactId});
    if(current.versionId!==target.basedOnVersionId||proposed.status!=='draft')throw new ContractError('artifact_revision_conflict');
    db.prepare("UPDATE ArtifactVersion SET status='approved',updated_at=?,revision=revision+1 WHERE workspace_id=? AND id=?").run(now,p.workspaceId,target.versionId);
    const change=db.prepare('UPDATE Artifact SET current_version_id=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND id=? AND current_version_id=?').run(target.versionId,now,p.workspaceId,target.artifactId,target.basedOnVersionId).changes;
    if(change!==1)throw new ContractError('artifact_revision_conflict');
  }
  db.prepare("UPDATE Approval SET decision=?,actor='user',decided_at=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND id=?").run(p.decision,now,now,p.workspaceId,row.id);
  db.prepare('UPDATE ToolCall SET state=?,ended_at=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND id=?').run(p.decision==='approved'?'completed':'cancelled',now,now,p.workspaceId,row.tool_call_id);
  repo.event('artifact.approval.decided',row.run_id,{approvalId:row.id,operationHash:row.operation_hash,decision:p.decision,versionId:target.versionId});
  return {approvalId:row.id,decision:p.decision,versionId:target.versionId};
}
