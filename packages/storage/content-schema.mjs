export const CONTENT_SCHEMA = `
CREATE TABLE KnowledgeItem (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), candidate_id TEXT, job_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('personal_fact','personal_experience','job_requirement','research_claim')),
 subject TEXT NOT NULL, predicate TEXT, content_json TEXT NOT NULL CHECK(json_valid(content_json) AND json_extract(content_json,'$.schemaVersion') IS 1),
 status TEXT NOT NULL CHECK(status IN ('pending','confirmed','superseded','disabled')),
 valid_from TEXT, valid_to TEXT, recorded_at TEXT NOT NULL, supersedes_id TEXT, extractor_revision TEXT,
 confidence_json TEXT NOT NULL CHECK(json_valid(confidence_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 UNIQUE(workspace_id,id), CHECK(job_id IS NULL OR candidate_id IS NOT NULL), CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to>valid_from),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES Candidate(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id,candidate_id) REFERENCES Job(workspace_id,id,candidate_id),
 FOREIGN KEY(workspace_id,supersedes_id) REFERENCES KnowledgeItem(workspace_id,id)
) STRICT;
CREATE INDEX knowledge_scope ON KnowledgeItem(workspace_id,candidate_id,job_id,kind,status);
CREATE TABLE Artifact (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), candidate_id TEXT, job_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('resume','cover_letter','portfolio','interview_brief')), title TEXT NOT NULL, current_version_id TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 UNIQUE(workspace_id,id), CHECK(job_id IS NULL OR candidate_id IS NOT NULL),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES Candidate(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id,candidate_id) REFERENCES Job(workspace_id,id,candidate_id),
 FOREIGN KEY(workspace_id,current_version_id,id) REFERENCES ArtifactVersion(workspace_id,id,artifact_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE ArtifactVersion (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), artifact_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 content_json TEXT NOT NULL CHECK(json_valid(content_json) AND json_extract(content_json,'$.schemaVersion') IS 1),
 blob_hash TEXT, based_on_id TEXT, run_id TEXT, status TEXT NOT NULL CHECK(status IN ('draft','approved','published','frozen')),
 content_hash TEXT NOT NULL, schema_version INTEGER NOT NULL CHECK(schema_version=1),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,id,artifact_id), UNIQUE(artifact_id,version),
 FOREIGN KEY(workspace_id,artifact_id) REFERENCES Artifact(workspace_id,id),
 FOREIGN KEY(workspace_id,based_on_id,artifact_id) REFERENCES ArtifactVersion(workspace_id,id,artifact_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(workspace_id,run_id) REFERENCES AgentRun(workspace_id,id)
) STRICT;
CREATE TRIGGER artifact_scope_immutable BEFORE UPDATE OF workspace_id,candidate_id,job_id,kind ON Artifact
 BEGIN SELECT RAISE(ABORT,'artifact ownership is immutable'); END;
CREATE TRIGGER artifact_version_immutable BEFORE UPDATE OF workspace_id,artifact_id,version,content_json,blob_hash,based_on_id,run_id,content_hash,schema_version ON ArtifactVersion
 BEGIN SELECT RAISE(ABORT,'artifact versions are immutable'); END;
CREATE TRIGGER artifact_run_scope BEFORE INSERT ON ArtifactVersion WHEN NEW.run_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM Artifact a JOIN AgentRun r ON r.workspace_id=a.workspace_id JOIN Conversation c ON c.id=r.conversation_id
 WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.artifact_id AND r.id=NEW.run_id
 AND a.candidate_id IS c.candidate_id AND (a.job_id IS NULL OR a.job_id IS c.job_id))
 BEGIN SELECT RAISE(ABORT,'artifact run scope mismatch'); END;
`;
