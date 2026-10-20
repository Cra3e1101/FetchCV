import {ContractError} from '../contracts/runtime.mjs';

// Additive migration: revoked + disabled_reason represents automatic withdrawal,
// preserving the v1 status constraint and every original memory/evidence row.
export function upgradeMemoryLifecycle(db,from){
  if(from!==0&&from!==1)throw new ContractError('unsupported_feature_schema');
  db.exec(`ALTER TABLE Memory ADD COLUMN disabled_at TEXT;
    ALTER TABLE Memory ADD COLUMN disabled_reason TEXT;
    CREATE TRIGGER memory_disabled_event AFTER UPDATE OF disabled_at ON Memory
    WHEN NEW.disabled_at IS NOT NULL AND OLD.disabled_at IS NULL
    BEGIN
      INSERT INTO Event(id,workspace_id,run_id,entity_kind,entity_id,sequence,type,payload_json,payload_schema,actor,timestamp,created_at,updated_at)
      VALUES(lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),NEW.workspace_id,NULL,'memory',NEW.id,
        (SELECT coalesce(max(sequence),0)+1 FROM Event WHERE workspace_id=NEW.workspace_id),
        'memory.disabled',json_object('reason',NEW.disabled_reason,'sourceMessageId',NEW.source_message_id),1,'system',NEW.disabled_at,NEW.disabled_at,NEW.disabled_at);
    END;`);
  const disable=where=>`UPDATE Memory SET status='revoked',disabled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    disabled_reason='source_unavailable',revision=revision+1
    WHERE status IN ('pending','active','superseded') AND ${where};`;
  const scopes={
    Message:'source_message_id=NEW.id AND workspace_id=NEW.workspace_id',
    Conversation:'workspace_id=NEW.workspace_id AND source_message_id IN (SELECT id FROM Message WHERE conversation_id=NEW.id)',
    Candidate:'candidate_id=NEW.id AND workspace_id=NEW.workspace_id',
    Job:'job_id=NEW.id AND workspace_id=NEW.workspace_id',
    Workspace:'workspace_id=NEW.id',
  };
  for(const [table,where] of Object.entries(scopes))db.exec(`CREATE TRIGGER memory_source_${table.toLowerCase()} AFTER UPDATE OF deleted_at ON ${table}
    WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL BEGIN ${disable(where)} END;`);
  db.exec(disable(`NOT EXISTS (
    SELECT 1 FROM Message m JOIN Conversation c ON c.id=m.conversation_id AND c.workspace_id=m.workspace_id
    JOIN Workspace w ON w.id=m.workspace_id
    LEFT JOIN Candidate p ON p.id=c.candidate_id AND p.workspace_id=c.workspace_id
    LEFT JOIN Job j ON j.id=c.job_id AND j.workspace_id=c.workspace_id
    WHERE m.id=Memory.source_message_id AND m.workspace_id=Memory.workspace_id AND m.role='user'
      AND m.content_hash=Memory.source_hash AND c.candidate_id IS Memory.candidate_id AND c.job_id IS Memory.job_id
      AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND w.deleted_at IS NULL
      AND (c.candidate_id IS NULL OR p.id IS NOT NULL AND p.deleted_at IS NULL)
      AND (c.job_id IS NULL OR j.id IS NOT NULL AND j.deleted_at IS NULL))`));
}
