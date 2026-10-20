import { projectionContext } from './projection-context.mjs';
import { canonicalJSON } from './legacy-archive.mjs';
import { contentHash } from './blob-store.mjs';
import { assertIntegrity } from './snapshot.mjs';

const SCHEMA = `
CREATE TABLE Setting(workspace_id TEXT NOT NULL REFERENCES Workspace(id), key TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)), schema_version INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,key)) STRICT;
CREATE TABLE McpServer(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), install_id TEXT,
 server_id TEXT NOT NULL, transport TEXT NOT NULL, launch_json TEXT NOT NULL CHECK(json_valid(launch_json)),
 secret_refs_json TEXT NOT NULL CHECK(json_valid(secret_refs_json)), schema_hash TEXT,
 state TEXT NOT NULL, tool_policies_json TEXT NOT NULL CHECK(json_valid(tool_policies_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,server_id)) STRICT;
CREATE TABLE SkillSnapshot(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), install_id TEXT,
 skill_id TEXT NOT NULL, version TEXT NOT NULL, manifest_hash TEXT, metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
 body_blob_hash TEXT, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 CHECK(enabled=0 OR (manifest_hash IS NOT NULL AND body_blob_hash IS NOT NULL)),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,skill_id,version)) STRICT;
`;

export async function projectConfiguration(db, blobs, { allowedFileRoots = [] } = {}) {
  const c = projectionContext(db);
  db.exec('SAVEPOINT configuration_projection');
  try {
    db.exec(SCHEMA);
    for (const row of c.rows('workspace_settings')) {
      const base = c.base(row);
      c.insert('Setting', { workspace_id: c.workspace, key: row.id, value_json: canonicalJSON(row.values_json), schema_version: 1, created_at: base.created_at, updated_at: base.updated_at });
      c.map('workspace_settings', row, 'Setting', row.id);
    }
    for (const row of c.rows('mcp_server_configs')) {
      const refs = [...new Set(canonicalJSON(row).match(/credential-ref:[a-f0-9-]{36}/g) || [])];
      const values = { ...c.base(row), install_id: null, server_id: row.name, transport: row.transport,
        launch_json: canonicalJSON({ schemaVersion: 1, legacyCommand: row.command, legacyArguments: row.args_json, executable: false }),
        secret_refs_json: canonicalJSON({ schemaVersion: 1, references: refs, resolution: 'requires_reentry_or_review' }),
        schema_hash: null, state: 'requires_review', tool_policies_json: '{}' };
      c.insert('McpServer', values); c.map('mcp_server_configs', row, 'McpServer', values.id);
    }
    let unavailableSkills = 0;
    for (const row of c.rows('agent_skills')) {
      const capture = row.path ? await blobs.capture(row.path, allowedFileRoots) : { state: 'missing_file', hash: null };
      if (!capture.hash) unavailableSkills++;
      const metadata = { schemaVersion: 1, name: row.name, description: row.description, legacyMetadata: row.metadata_json,
        legacyClaimedHash: row.content_hash, accessState: capture.state, trust: 'unreviewed', packageAuthorizationTransferred: false };
      const values = { ...c.base(row), install_id: null, skill_id: row.id, version: 'legacy-1',
        manifest_hash: capture.hash ? contentHash(canonicalJSON({ metadata, bodyHash: capture.hash })) : null,
        metadata_json: canonicalJSON(metadata), body_blob_hash: capture.hash, enabled: 0 };
      c.insert('SkillSnapshot', values); c.map('agent_skills', row, 'SkillSnapshot', values.id);
    }
    assertIntegrity(db); db.exec('RELEASE configuration_projection');
    return { stage: 'configuration_projected', activationAllowed: false, unavailableSkills, credentialsInstalled: false };
  } catch (error) { db.exec('ROLLBACK TO configuration_projection; RELEASE configuration_projection'); throw error; }
}
