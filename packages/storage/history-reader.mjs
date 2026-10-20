import { contentHash } from './blob-store.mjs';
import {readAnswerCitationReview} from '../knowledge/answer-citations.mjs';

// APP supplies the complete scope. This adapter exposes historical messages,
// never the raw archive, replayable tool arguments or an authorization token.
export function readConversationHistory(db, { workspaceId, candidateId = null, jobId = null, conversationId, afterSequence = 0, limit = 50 }) {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid history page');
  const conversation = db.prepare(`SELECT c.* FROM Conversation c
    JOIN Workspace w ON w.id=c.workspace_id
    LEFT JOIN Candidate p ON p.workspace_id=c.workspace_id AND p.id=c.candidate_id
    LEFT JOIN Job j ON j.workspace_id=c.workspace_id AND j.id=c.job_id
    WHERE c.workspace_id=? AND c.id=? AND c.deleted_at IS NULL AND w.deleted_at IS NULL
      AND p.deleted_at IS NULL AND j.deleted_at IS NULL`).get(workspaceId, conversationId);
  if (!conversation || conversation.candidate_id !== candidateId || conversation.job_id !== jobId) throw Object.assign(new Error('history is not available in this scope'), { code: 'history_unavailable' });
  const rows = db.prepare(`SELECT * FROM Message WHERE workspace_id=? AND conversation_id=?
    AND sequence>? AND deleted_at IS NULL ORDER BY sequence LIMIT ?`).all(workspaceId, conversationId, afterSequence, limit + 1);
  const more = rows.length > limit;
  const messages = rows.slice(0, limit).map(row => {
    if (contentHash(row.content_json) !== row.content_hash) throw new Error('history content hash mismatch');
    const citationReview=readAnswerCitationReview(db,{workspaceId,candidateId,jobId},row);
    return { id: row.id, sequence: row.sequence, role: row.role, content: JSON.parse(row.content_json), contentHash: row.content_hash,
      ...(citationReview?{citationReview}:{}),
      logicalMessageId: row.logical_message_id, supersedesId: row.supersedes_id, runId: row.run_id,
      deliveryStatus: row.delivery_status, createdAt: row.created_at, automaticDelivery: false };
  });
  return { conversationId, messages, nextSequence: more ? messages.at(-1).sequence : null, readOnly: true, replayAllowed: false };
}
