import {ContractError} from '../contracts/runtime.mjs';
import {contentHash} from './blob-store.mjs';

// Summary queries are selected by a closed enum, never by caller SQL. All
// detailed reads recheck scope and tombstones; UI-provided IDs confer no access.
// Legacy approvals and applications remain evidence, never runnable commands.
// Scope is resolved from migration mappings/run ownership, not caller labels.
const activityRows=`SELECT e.id,e.workspace_id,NULL AS deleted_at,e.type AS kind,
  CASE a.old_table WHEN 'approvals' THEN '历史审批' ELSE '历史投递' END AS title,
  coalesce(cm.new_id,rc.candidate_id,j.candidate_id) AS candidate_id,
  coalesce(jm.new_id,rc.job_id) AS job_id,a.old_table,a.old_id,a.row_json,a.row_hash
  FROM Event e JOIN LegacyArchive a ON a.workspace_id=e.workspace_id
    AND a.migration_id=json_extract(e.payload_json,'$.archive.migrationId')
    AND a.old_table=json_extract(e.payload_json,'$.archive.table') AND a.old_id=json_extract(e.payload_json,'$.archive.id')
  LEFT JOIN AgentRun r ON r.workspace_id=e.workspace_id AND r.id=e.run_id
  LEFT JOIN Conversation rc ON rc.workspace_id=e.workspace_id AND rc.id=r.conversation_id
  LEFT JOIN MigrationMap cm ON cm.migration_id=a.migration_id AND cm.old_table='candidates'
    AND cm.old_id=json_extract(a.row_json,'$.candidate_id') AND cm.new_table='Candidate'
  LEFT JOIN MigrationMap jm ON jm.migration_id=a.migration_id AND jm.old_table='jobs'
    AND jm.old_id=json_extract(a.row_json,'$.job_id') AND jm.new_table='Job'
  LEFT JOIN Job j ON j.workspace_id=e.workspace_id AND j.id=jm.new_id
  WHERE ((a.old_table='approvals' AND e.type='legacy_approval_history') OR (a.old_table='applications' AND e.type='legacy_applications'))
    AND (e.run_id IS NULL OR (r.id IS NOT NULL AND r.deleted_at IS NULL AND rc.id IS NOT NULL AND rc.deleted_at IS NULL))`;
const views={
  jobs:{from:"(SELECT *,id AS job_id,company || ' · ' || role AS title FROM Job) x",fields:'x.id,x.title,x.candidate_id,x.job_id,x.status',scope:'x'},
  runs:{from:'AgentRun x JOIN Conversation c ON c.workspace_id=x.workspace_id AND c.id=x.conversation_id',fields:"x.id,'运行 · ' || x.state AS title,c.candidate_id,c.job_id,x.state",scope:'c',extra:'AND c.deleted_at IS NULL'},
  conversations:{from:'Conversation x',fields:'x.id,x.title,x.candidate_id,x.job_id',scope:'x'},
  artifacts:{from:'Artifact x',fields:'x.id,x.title,x.kind,x.candidate_id,x.job_id,x.current_version_id',scope:'x'},
  documents:{from:'Document x JOIN Source s ON s.workspace_id=x.workspace_id AND s.id=x.source_id',fields:'x.id,s.title,x.version,x.state,s.candidate_id,s.job_id,x.blob_hash,x.source_id,x.quality_json,x.active',scope:'s',extra:"AND s.deleted_at IS NULL AND s.access_state!='revoked'"},
  activities:{from:`(${activityRows}) x`,fields:'x.id,x.title,x.kind,x.candidate_id,x.job_id',scope:'x'},
  approvals:{from:`(SELECT a.id,a.workspace_id,a.deleted_at,'待审阅草稿' AS title,json_extract(a.scope_json,'$.candidateId') AS candidate_id,json_extract(a.scope_json,'$.jobId') AS job_id
    FROM Approval a WHERE a.policy_revision='m4-artifact-2' AND a.decision='pending') x`,fields:'x.id,x.title,x.candidate_id,x.job_id',scope:'x'},
};
export function readCatalogue(db,{workspaceId,kind,afterId='',limit=50,authorizedScope,objectId}) {
  const v=views[kind];
  if(!v || !Number.isSafeInteger(limit) || limit<1 || limit>100 || typeof afterId!=='string') throw new ContractError('invalid_catalogue_page');
  const rows=db.prepare(`SELECT ${v.fields} FROM ${v.from} JOIN Workspace w ON w.id=x.workspace_id
    LEFT JOIN Candidate p ON p.workspace_id=x.workspace_id AND p.id=${v.scope}.candidate_id
    LEFT JOIN Job j ON j.workspace_id=x.workspace_id AND j.id=${v.scope}.job_id
    WHERE x.workspace_id=? AND x.id>? ${objectId?'AND x.id=?':''} AND x.deleted_at IS NULL AND w.deleted_at IS NULL
      AND (${v.scope}.candidate_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL))
      AND (${v.scope}.job_id IS NULL OR (j.id IS NOT NULL AND j.deleted_at IS NULL)) ${v.extra||''}
      ${authorizedScope?`AND ${v.scope}.candidate_id IS ? AND (${v.scope}.job_id IS NULL OR ${v.scope}.job_id IS ?)`:''}
    ORDER BY x.id LIMIT ?`).all(workspaceId,afterId,...(objectId?[objectId]:[]),...(authorizedScope?[authorizedScope.candidateId,authorizedScope.jobId]:[]),limit+1);
  return {items:rows.slice(0,limit),nextId:rows.length>limit?rows[limit-1].id:null};
}
export function readActivity(db,{workspaceId,candidateId=null,jobId=null,eventId}) {
  const row=db.prepare(`SELECT x.* FROM (${activityRows}) x JOIN Workspace w ON w.id=x.workspace_id
    LEFT JOIN Candidate p ON p.workspace_id=x.workspace_id AND p.id=x.candidate_id
    LEFT JOIN Job j ON j.workspace_id=x.workspace_id AND j.id=x.job_id
    WHERE x.workspace_id=? AND x.id=? AND w.deleted_at IS NULL
      AND (x.candidate_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL))
      AND (x.job_id IS NULL OR (j.id IS NOT NULL AND j.deleted_at IS NULL))`).get(workspaceId,eventId);
  if(!row || row.candidate_id!==candidateId || row.job_id!==jobId || contentHash(row.row_json)!==row.row_hash)throw new ContractError('activity_unavailable');
  return {eventId,kind:row.kind,legacyTable:row.old_table,legacyId:row.old_id,record:JSON.parse(row.row_json),readOnly:true,executionAllowed:false};
}
export function readArtifact(db,{workspaceId,candidateId=null,jobId=null,artifactId,versionId}) {
  const artifact=db.prepare(`SELECT a.* FROM Artifact a JOIN Workspace w ON w.id=a.workspace_id
    LEFT JOIN Candidate p ON p.workspace_id=a.workspace_id AND p.id=a.candidate_id
    LEFT JOIN Job j ON j.workspace_id=a.workspace_id AND j.id=a.job_id
    WHERE a.workspace_id=? AND a.id=? AND a.deleted_at IS NULL AND w.deleted_at IS NULL
      AND (a.candidate_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL))
      AND (a.job_id IS NULL OR (j.id IS NOT NULL AND j.deleted_at IS NULL))`).get(workspaceId,artifactId);
  if(!artifact || artifact.candidate_id!==candidateId || artifact.job_id!==jobId) throw new ContractError('artifact_unavailable');
  const row=db.prepare('SELECT * FROM ArtifactVersion WHERE workspace_id=? AND artifact_id=? AND id=? AND deleted_at IS NULL').get(workspaceId,artifactId,versionId??artifact.current_version_id);
  if(!row || contentHash(row.content_json)!==row.content_hash) throw new ContractError('artifact_unavailable');
  return {artifactId,versionId:row.id,version:row.version,title:artifact.title,kind:artifact.kind,status:row.status,content:JSON.parse(row.content_json),contentHash:row.content_hash,readOnly:true};
}

export function readArtifactVersions(db,p){
  const current=readArtifact(db,p);
  const rows=db.prepare('SELECT id,version,status,created_at FROM ArtifactVersion WHERE workspace_id=? AND artifact_id=? AND deleted_at IS NULL AND version<? ORDER BY version DESC LIMIT 51').all(p.workspaceId,p.artifactId,p.beforeVersion??Number.MAX_SAFE_INTEGER);
  return {currentVersionId:current.versionId,items:rows.slice(0,50).map(row=>({...row,current:row.id===current.versionId})),nextVersion:rows.length>50?rows[49].version:null};
}
