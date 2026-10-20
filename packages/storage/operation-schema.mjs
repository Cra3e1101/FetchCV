export const OPERATION_SCHEMA = `
CREATE TABLE ToolCall (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), run_id TEXT NOT NULL,
 call_id TEXT NOT NULL, invocation_id TEXT NOT NULL, tool_id TEXT NOT NULL, tool_revision TEXT NOT NULL,
 operation_hash TEXT NOT NULL, args_json TEXT NOT NULL CHECK(json_valid(args_json)), target_json TEXT NOT NULL CHECK(json_valid(target_json)),
 state TEXT NOT NULL CHECK(state IN ('prepared','running','waiting_approval','completed','failed','cancelled','interrupted','unknown')),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)), receipt_hash TEXT, started_at TEXT, ended_at TEXT,
 error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)), policy_revision TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 UNIQUE(workspace_id,id), UNIQUE(run_id,call_id), UNIQUE(workspace_id,invocation_id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES AgentRun(workspace_id,id)
) STRICT;
CREATE TABLE Approval (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), tool_call_id TEXT NOT NULL,
 operation_hash TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('pending','approved','rejected','revoked','expired')),
 actor TEXT NOT NULL, decided_at TEXT, expires_at TEXT, scope_json TEXT NOT NULL CHECK(json_valid(scope_json)), policy_revision TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,tool_call_id) REFERENCES ToolCall(workspace_id,id)
) STRICT;
CREATE TRIGGER legacy_approval_no_revival BEFORE UPDATE OF decision,operation_hash,tool_call_id,policy_revision ON Approval WHEN OLD.policy_revision='legacy-history-only'
 BEGIN SELECT RAISE(ABORT,'historical approvals cannot authorize a new operation'); END;
CREATE TRIGGER legacy_tool_no_replay BEFORE UPDATE OF state,run_id,tool_revision,policy_revision ON ToolCall WHEN OLD.policy_revision='legacy-history-only'
 BEGIN SELECT RAISE(ABORT,'historical tool calls cannot be replayed'); END;
CREATE TABLE MigrationIssue (
 id TEXT PRIMARY KEY, migration_id TEXT NOT NULL, old_table TEXT NOT NULL, old_id TEXT NOT NULL,
 code TEXT NOT NULL, detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
 FOREIGN KEY(migration_id,old_table,old_id) REFERENCES LegacyArchive(migration_id,old_table,old_id)
) STRICT;
CREATE TABLE IngestJob (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), source_id TEXT NOT NULL, document_id TEXT,
 stage TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','running','completed','failed','cancelled')),
 attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0), lease_until TEXT, lease_owner TEXT, expected_source_revision INTEGER NOT NULL,
 input_hash TEXT NOT NULL, config_revision TEXT NOT NULL, error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 UNIQUE(workspace_id,id), UNIQUE(source_id,input_hash,config_revision),
 FOREIGN KEY(workspace_id,source_id) REFERENCES Source(workspace_id,id),
 FOREIGN KEY(workspace_id,document_id,source_id) REFERENCES Document(workspace_id,id,source_id)
) STRICT;
`;
