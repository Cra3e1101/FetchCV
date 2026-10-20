-- Frozen Memory v1 schema from a751582, for additive migration regression.
CREATE TABLE IF NOT EXISTS Memory (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES Workspace(id),candidate_id TEXT,job_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('preference','constraint','decision')),subject TEXT NOT NULL,predicate TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),normalized_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','active','rejected','superseded','revoked')),
 valid_from TEXT,valid_to TEXT,recorded_at TEXT NOT NULL,supersedes_id TEXT REFERENCES Memory(id),
 source_message_id TEXT NOT NULL,source_hash TEXT NOT NULL,char_start INTEGER NOT NULL,char_end INTEGER NOT NULL,
 confirmed_by TEXT,extractor_revision TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,normalized_hash),CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to>valid_from),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES Candidate(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id,candidate_id) REFERENCES Job(workspace_id,id,candidate_id),
 FOREIGN KEY(workspace_id,source_message_id) REFERENCES Message(workspace_id,id));
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_memory ON Memory(workspace_id,coalesce(candidate_id,''),coalesce(job_id,''),kind,subject,predicate) WHERE status='active';
 CREATE TRIGGER IF NOT EXISTS memory_evidence_immutable BEFORE UPDATE OF workspace_id,candidate_id,job_id,kind,subject,predicate,value_json,normalized_hash,source_message_id,source_hash,char_start,char_end,extractor_revision ON Memory
 BEGIN SELECT RAISE(ABORT,'memory evidence is immutable'); END;
