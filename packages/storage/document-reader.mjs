import {ContractError} from '../contracts/runtime.mjs';
import { contentHash } from './blob-store.mjs';

// Scope is provided by APP, never inferred from a caller-supplied path/hash.
export async function readDocumentText(db, blobs, { workspaceId, candidateId = null, jobId = null, documentId, expectedHash, start = 0, end }) {
  const row = db.prepare(`SELECT d.*,s.candidate_id,s.job_id,s.access_state,s.deleted_at AS source_deleted FROM Document d
    JOIN Source s ON s.workspace_id=d.workspace_id AND s.id=d.source_id
    JOIN Workspace w ON w.id=d.workspace_id
    LEFT JOIN Candidate p ON p.workspace_id=s.workspace_id AND p.id=s.candidate_id
    LEFT JOIN Job j ON j.workspace_id=s.workspace_id AND j.id=s.job_id
    WHERE d.workspace_id=? AND d.id=? AND w.deleted_at IS NULL
      AND (s.candidate_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL))
      AND (s.job_id IS NULL OR (j.id IS NOT NULL AND j.deleted_at IS NULL))`).get(workspaceId, documentId);
  if (!row || row.candidate_id !== candidateId || row.job_id !== jobId || row.deleted_at || row.source_deleted || row.access_state === 'revoked') throw Object.assign(new Error('document is not available in this scope'), { code: 'document_unavailable' });
  if (expectedHash && row.blob_hash !== expectedHash) throw Object.assign(new Error('document revision mismatch'), { code: 'document_revision_mismatch' });
  if (row.state !== 'ready' || !row.text_blob_hash) throw Object.assign(new Error('document text is not ready'), { code: 'document_not_ready' });
  const bytes = await blobs.read(row.text_blob_hash);
  if (contentHash(bytes) !== row.text_hash) throw new Error('document text hash mismatch');
  const characters = [...bytes.toString('utf8')];
  end ??= Math.min(start + 100000, characters.length);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > characters.length || end - start > 100000) throw new Error('invalid or excessive text range');
  return { documentId: row.id, sourceId: row.source_id, version: row.version, blobHash: row.blob_hash,
    textHash: row.text_hash, start, end, totalCharacters: characters.length, nextStart: end < characters.length ? end : null,
    offsetUnit: 'unicode_codepoint', text: characters.slice(start, end).join('') };
}

export function readDocumentVersions(db,{workspaceId,candidateId=null,jobId=null,documentId,afterVersion=0}){
 const row=db.prepare(`SELECT d.source_id FROM Document d JOIN Source s ON s.workspace_id=d.workspace_id AND s.id=d.source_id
 JOIN Workspace w ON w.id=d.workspace_id LEFT JOIN Candidate c ON c.workspace_id=s.workspace_id AND c.id=s.candidate_id
 LEFT JOIN Job j ON j.workspace_id=s.workspace_id AND j.id=s.job_id
 WHERE d.workspace_id=? AND d.id=? AND d.deleted_at IS NULL AND s.deleted_at IS NULL AND s.access_state!='revoked' AND w.deleted_at IS NULL
 AND s.candidate_id IS ? AND s.job_id IS ? AND (s.candidate_id IS NULL OR(c.id IS NOT NULL AND c.deleted_at IS NULL)) AND(s.job_id IS NULL OR(j.id IS NOT NULL AND j.deleted_at IS NULL))`).get(workspaceId,documentId,candidateId,jobId);
 if(!row)throw new ContractError('document_unavailable');
 const rows=db.prepare('SELECT id,version,state,active,captured_at,blob_hash FROM Document WHERE workspace_id=? AND source_id=? AND deleted_at IS NULL AND version>? ORDER BY version LIMIT 51').all(workspaceId,row.source_id,afterVersion);
 return {sourceId:row.source_id,items:rows.slice(0,50),nextVersion:rows.length>50?rows[49].version:null};
}
