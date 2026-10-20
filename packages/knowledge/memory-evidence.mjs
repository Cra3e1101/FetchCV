import {randomUUID} from 'node:crypto';
import {ContractError} from '../contracts/runtime.mjs';
import {contentHash} from '../storage/blob-store.mjs';
import {canonicalJSON} from '../storage/legacy-archive.mjs';
import {upgradeMemoryLifecycle} from './memory-lifecycle.mjs';

// Only Unicode canonical equivalence and surrounding whitespace are folded.
// Negation, case, internal spacing, numbers and wording remain distinct.
export const normalizeMemoryValue=text=>text.normalize('NFC').trim();
export const memoryEquivalence=(scope,kind,subject,predicate,text)=>contentHash(canonicalJSON([
  scope.candidateId??null,scope.jobId??null,kind,subject,predicate,normalizeMemoryValue(text),
]));
export const MEMORY_EVIDENCE_LIMIT=20;

export function upgradeMemoryEvidence(db,from){
  if(![0,1,2].includes(from))throw new ContractError('unsupported_feature_schema');
  if(from<2)upgradeMemoryLifecycle(db,from);
  db.exec(`ALTER TABLE Memory ADD COLUMN equivalence_hash TEXT;
    ALTER TABLE Memory ADD COLUMN proposal_valid_from TEXT;
    CREATE INDEX memory_equivalence ON Memory(workspace_id,equivalence_hash,status);
    CREATE TABLE MemoryEvidence (
      id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,memory_id TEXT NOT NULL,
      message_id TEXT NOT NULL,source_hash TEXT NOT NULL,char_start INTEGER NOT NULL,char_end INTEGER NOT NULL,
      proposal_hash TEXT NOT NULL,recorded_at TEXT NOT NULL,
      CHECK(char_start>=0 AND char_end>char_start),UNIQUE(workspace_id,proposal_hash),
      UNIQUE(memory_id,message_id,source_hash,char_start,char_end),
      FOREIGN KEY(workspace_id,memory_id) REFERENCES Memory(workspace_id,id),
      FOREIGN KEY(workspace_id,message_id) REFERENCES Message(workspace_id,id)) STRICT;
    CREATE INDEX memory_evidence_source ON MemoryEvidence(workspace_id,message_id);`);
  for(const row of db.prepare('SELECT * FROM Memory').all()){
    const scope={candidateId:row.candidate_id,jobId:row.job_id};
    // Old rows did not distinguish supplied from defaulted starts. Keep their
    // known value conservatively; do not infer that an old start was omitted.
    db.prepare('UPDATE Memory SET equivalence_hash=?,proposal_valid_from=? WHERE id=?').run(memoryEquivalence(scope,row.kind,row.subject,row.predicate,JSON.parse(row.value_json).text),row.valid_from,row.id);
    db.prepare('INSERT INTO MemoryEvidence VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),row.workspace_id,row.id,row.source_message_id,row.source_hash,row.char_start,row.char_end,row.normalized_hash,row.recorded_at);
  }
  db.exec(`CREATE TRIGGER memory_equivalence_immutable BEFORE UPDATE OF equivalence_hash,proposal_valid_from ON Memory
    BEGIN SELECT RAISE(ABORT,'memory equivalence is immutable'); END;
    CREATE TRIGGER memory_evidence_row_immutable BEFORE UPDATE ON MemoryEvidence
    BEGIN SELECT RAISE(ABORT,'memory source evidence is immutable'); END;
    CREATE TRIGGER memory_evidence_scope BEFORE INSERT ON MemoryEvidence WHEN NOT EXISTS (
      SELECT 1 FROM Memory m JOIN Message s ON s.workspace_id=m.workspace_id
      JOIN Conversation c ON c.workspace_id=s.workspace_id AND c.id=s.conversation_id
      WHERE m.id=NEW.memory_id AND m.workspace_id=NEW.workspace_id AND s.id=NEW.message_id
        AND c.candidate_id IS m.candidate_id AND c.job_id IS m.job_id AND s.role='user'
        AND s.content_hash=NEW.source_hash AND s.deleted_at IS NULL AND c.deleted_at IS NULL)
    BEGIN SELECT RAISE(ABORT,'memory source scope mismatch'); END;`);
  // Primary-source v2 triggers remain. These cover every additional source;
  // the state predicate makes both trigger paths emit only one disabled event.
  for(const [table,selector] of Object.entries({Message:'message_id=NEW.id',Conversation:'message_id IN (SELECT id FROM Message WHERE conversation_id=NEW.id AND workspace_id=NEW.workspace_id)'})){
    db.exec(`CREATE TRIGGER memory_evidence_withdraw_${table.toLowerCase()} AFTER UPDATE OF deleted_at ON ${table}
      WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL BEGIN
        UPDATE Memory SET status='revoked',disabled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),disabled_reason='source_unavailable',revision=revision+1
        WHERE workspace_id=NEW.workspace_id AND status IN ('pending','active','superseded') AND id IN (
          SELECT memory_id FROM MemoryEvidence WHERE workspace_id=NEW.workspace_id AND ${selector}); END;`);
  }
}
