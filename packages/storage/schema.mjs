// Offline V2 schema increment 1. Activation is separately gated; opening the
// existing V1 database must never execute this DDL.
export const WORKSPACE_SCHEMA_VERSION = 1;
export const CORE_SCHEMA = `
CREATE TABLE Workspace (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, schema_version INTEGER NOT NULL,
 settings_json TEXT NOT NULL CHECK(json_valid(settings_json)), privacy_mode TEXT NOT NULL,
 blob_root_ref TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), deleted_at TEXT
) STRICT;
CREATE TABLE Candidate (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), name TEXT NOT NULL,
 profile_json TEXT NOT NULL CHECK(json_valid(profile_json)), status TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), deleted_at TEXT,
 UNIQUE(workspace_id,id)
) STRICT;
CREATE TABLE Job (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), candidate_id TEXT NOT NULL,
 company TEXT NOT NULL, role TEXT NOT NULL, location TEXT, status TEXT NOT NULL, applied_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), deleted_at TEXT,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,id,candidate_id),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES Candidate(workspace_id,id)
) STRICT;
CREATE INDEX job_scope_status ON Job(workspace_id,candidate_id,status,updated_at,id);
CREATE TRIGGER job_candidate_immutable BEFORE UPDATE OF candidate_id,workspace_id ON Job
 WHEN NEW.candidate_id IS NOT OLD.candidate_id OR NEW.workspace_id IS NOT OLD.workspace_id
 BEGIN SELECT RAISE(ABORT,'job ownership is immutable'); END;
CREATE TABLE Conversation (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), candidate_id TEXT, job_id TEXT,
 title TEXT NOT NULL, kind TEXT NOT NULL, archived_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), deleted_at TEXT,
 UNIQUE(workspace_id,id), CHECK(job_id IS NULL OR candidate_id IS NOT NULL),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES Candidate(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id,candidate_id) REFERENCES Job(workspace_id,id,candidate_id)
) STRICT;
CREATE INDEX conversation_order ON Conversation(workspace_id,updated_at,id);
CREATE TABLE AgentRun (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), conversation_id TEXT NOT NULL,
 agent_definition_id TEXT NOT NULL, agent_revision TEXT NOT NULL, runtime_id TEXT NOT NULL, model_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('created','running','waiting_approval','completed','failed','cancelled','interrupted','unknown')),
 started_at TEXT, ended_at TEXT, last_event_seq INTEGER NOT NULL DEFAULT 0 CHECK(last_event_seq >= 0),
 context_manifest_json TEXT NOT NULL CHECK(json_valid(context_manifest_json)), budget_json TEXT NOT NULL CHECK(json_valid(budget_json)),
 error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), deleted_at TEXT,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,id,conversation_id),
 CHECK(ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES Conversation(workspace_id,id)
) STRICT;
CREATE UNIQUE INDEX one_active_run ON AgentRun(workspace_id,conversation_id) WHERE state IN ('running','waiting_approval');
CREATE TRIGGER run_scope_immutable BEFORE UPDATE OF workspace_id,conversation_id ON AgentRun
 WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.conversation_id IS NOT OLD.conversation_id
 BEGIN SELECT RAISE(ABORT,'run ownership is immutable'); END;
CREATE TABLE Message (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), conversation_id TEXT NOT NULL, run_id TEXT,
 role TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
 content_json TEXT NOT NULL CHECK(json_valid(content_json) AND json_extract(content_json,'$.schemaVersion') IS 1 AND json_type(content_json,'$.parts') IS 'array'),
 content_hash TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence > 0),
 delivery_status TEXT NOT NULL CHECK(delivery_status IN ('queued','streaming','completed','failed','cancelled')),
 supersedes_id TEXT, logical_message_id TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), deleted_at TEXT,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,id,conversation_id), UNIQUE(conversation_id,sequence),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES Conversation(workspace_id,id),
 FOREIGN KEY(workspace_id,run_id,conversation_id) REFERENCES AgentRun(workspace_id,id,conversation_id),
 FOREIGN KEY(workspace_id,supersedes_id,conversation_id) REFERENCES Message(workspace_id,id,conversation_id)
) STRICT;
CREATE TRIGGER message_body_immutable BEFORE UPDATE OF content_json,content_hash,conversation_id,workspace_id,sequence,supersedes_id,logical_message_id,role,run_id ON Message
 BEGIN SELECT RAISE(ABORT,'message revisions are append-only'); END;
CREATE TRIGGER message_scope_immutable BEFORE UPDATE OF workspace_id,candidate_id,job_id ON Conversation
 WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.candidate_id IS NOT OLD.candidate_id OR NEW.job_id IS NOT OLD.job_id
 BEGIN SELECT RAISE(ABORT,'conversation ownership is immutable'); END;
CREATE TABLE Event (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), run_id TEXT,
 entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence > 0),
 type TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), payload_schema INTEGER NOT NULL,
 actor TEXT NOT NULL, timestamp TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,sequence), FOREIGN KEY(workspace_id,run_id) REFERENCES AgentRun(workspace_id,id)
) STRICT;
CREATE INDEX event_run_sequence ON Event(workspace_id,run_id,sequence);
`;

export function installCoreSchema(db) {
  if (db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name IN ('Workspace','Candidate','Job','Conversation','Message','AgentRun','Event')").get().n) throw new Error('refusing to overwrite existing domain schema');
  db.exec('SAVEPOINT install_core_schema');
  try { db.exec(CORE_SCHEMA); db.exec('RELEASE install_core_schema'); }
  catch (error) { db.exec('ROLLBACK TO install_core_schema; RELEASE install_core_schema'); throw error; }
}
