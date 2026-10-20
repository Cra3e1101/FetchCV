export function claimIngest(db, { workspaceId, jobId, owner, sourceRevision, now, leaseUntil, protocol }) {
  if (typeof owner !== 'string' || !owner || owner.length > 120 || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1 || !Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(leaseUntil)) || Date.parse(leaseUntil) <= Date.parse(now)) throw new Error('invalid lease claim');
  now = new Date(now).toISOString(); leaseUntil = new Date(leaseUntil).toISOString();
  return db.prepare(`UPDATE IngestJob SET state='running',attempt=attempt+1,lease_owner=?,lease_until=?,updated_at=?,revision=revision+1
    WHERE workspace_id=? AND id=? AND deleted_at IS NULL AND expected_source_revision=?
    AND (state='pending' OR (state='running' AND lease_until<=?))
    ${protocol?`AND stage='parse' AND config_revision=? AND input_hash=? AND document_id=? AND EXISTS(SELECT 1 FROM Document d WHERE d.id=IngestJob.document_id AND d.workspace_id=IngestJob.workspace_id AND d.source_id=IngestJob.source_id AND d.blob_hash=IngestJob.input_hash AND d.deleted_at IS NULL AND d.active=1)`:''}
    AND EXISTS(SELECT 1 FROM Source s WHERE s.id=IngestJob.source_id AND s.workspace_id=IngestJob.workspace_id AND s.revision=? AND s.deleted_at IS NULL AND s.access_state${protocol?"='available'":"!='revoked'"})
    RETURNING id,attempt,lease_owner,lease_until,expected_source_revision`).get(owner, leaseUntil, now, workspaceId, jobId, sourceRevision, now,...(protocol?[protocol.configRevision,protocol.inputHash,protocol.documentId]:[]), sourceRevision) || null;
}
export function completeIngest(db, { workspaceId, jobId, owner, attempt, sourceRevision, now }) {
  if (typeof owner !== 'string' || !owner || !Number.isSafeInteger(attempt) || attempt < 1 || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1 || !Number.isFinite(Date.parse(now))) throw new Error('invalid lease completion');
  now = new Date(now).toISOString();
  return db.prepare(`UPDATE IngestJob SET state='completed',lease_owner=NULL,lease_until=NULL,updated_at=?,revision=revision+1
    WHERE workspace_id=? AND id=? AND state='running' AND deleted_at IS NULL
    AND lease_owner=? AND attempt=? AND expected_source_revision=? AND lease_until>?
    AND EXISTS(SELECT 1 FROM Source s WHERE s.id=IngestJob.source_id AND s.workspace_id=IngestJob.workspace_id AND s.revision=? AND s.deleted_at IS NULL AND s.access_state!='revoked')`).run(now, workspaceId, jobId, owner, attempt, sourceRevision, now, sourceRevision).changes === 1;
}
