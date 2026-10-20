import { createHash, randomUUID } from 'node:crypto';
import { installCoreSchema, WORKSPACE_SCHEMA_VERSION } from './schema.mjs';
import { canonicalJSON } from './legacy-archive.mjs';
import { assertIntegrity } from './snapshot.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const utc = value => {
  if (typeof value !== 'string' || !value) throw new Error('legacy timestamp required');
  const text = value.replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(text) ? text : `${text}Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid legacy timestamp');
  return date.toISOString();
};
const terminalRunState = state => ['completed','failed','cancelled'].includes(state) ? state : 'interrupted';

// Operates only on the NEW archive copy. Caller controls that boundary. Entire
// schema + projection commits atomically, and remains in archive_prepared state.
export function projectCoreDomain(db) {
  const migrations = db.prepare('SELECT * FROM Migration').all();
  if (migrations.length !== 1 || migrations[0].state !== 'archive_prepared') throw new Error('one prepared migration required');
  const migration = migrations[0], workspace = migration.workspace_id;
  const rows = table => db.prepare('SELECT old_id,row_json,row_hash FROM LegacyArchive WHERE migration_id=? AND old_table=? ORDER BY json_extract(row_json,\'$.created_at\'),old_id').all(migration.id, table).map(entry => {
    if (hash(entry.row_json) !== entry.row_hash) throw new Error('tampered archive row');
    const row = JSON.parse(entry.row_json);
    if (row.id !== entry.old_id) throw new Error('archive identity mismatch');
    return row;
  });
  const insert = (table, fields) => {
    const names = Object.keys(fields);
    db.prepare(`INSERT INTO "${table}" (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(fields));
  };
  const base = row => ({ id: randomUUID(), workspace_id: workspace, created_at: utc(row.created_at), updated_at: utc(row.updated_at ?? row.created_at), revision: 1, deleted_at: null });
  const mappings = new Map();
  const mapped = (table, oldId) => {
    const value = mappings.get(`${table}:${oldId}`);
    if (!value) throw new Error(`unresolved legacy reference in ${table}`);
    return value;
  };
  const map = (table, row, target, id) => {
    const source = db.prepare('SELECT row_hash FROM LegacyArchive WHERE migration_id=? AND old_table=? AND old_id=?').get(migration.id, table, row.id);
    db.prepare('INSERT INTO MigrationMap VALUES (?,?,?,?,?,?)').run(migration.id, table, row.id, target, id, source.row_hash);
    mappings.set(`${table}:${row.id}`, id);
  };
  const scopeConversations = new Map();
  const conversation = (candidate, job, row) => {
    const key = canonicalJSON([candidate, job]);
    if (!scopeConversations.has(key)) {
      const values = { ...base(row), candidate_id: candidate, job_id: job, title: 'Legacy conversation', kind: 'legacy', archived_at: null };
      insert('Conversation', values); scopeConversations.set(key, values.id);
    }
    return scopeConversations.get(key);
  };
  db.exec('SAVEPOINT core_projection');
  try {
    installCoreSchema(db);
    const now = new Date().toISOString();
    insert('Workspace', { id: workspace, name: 'Legacy workspace', schema_version: WORKSPACE_SCHEMA_VERSION, settings_json: '{}', privacy_mode: 'local', blob_root_ref: 'blobs', created_at: now, updated_at: now, revision: 1, deleted_at: null });
    for (const row of rows('candidates')) {
      const values = { ...base(row), name: row.name, profile_json: canonicalJSON({ schemaVersion: 1, legacySchema: 'Candidate', legacy: row }), status: 'active' };
      insert('Candidate', values); map('candidates', row, 'Candidate', values.id);
    }
    for (const row of rows('jobs')) {
      const values = { ...base(row), candidate_id: mapped('candidates', row.candidate_id), company: row.company, role: row.role, location: row.location ?? null, status: row.status, applied_at: null };
      insert('Job', values); map('jobs', row, 'Job', values.id);
    }
    for (const row of rows('agent_runs')) {
      const candidate = mapped('candidates', row.candidate_id), job = row.job_id ? mapped('jobs', row.job_id) : null;
      const values = { ...base(row), conversation_id: conversation(candidate, job, row), agent_definition_id: 'legacy-unresolved', agent_revision: 'legacy', runtime_id: 'legacy', model_id: 'legacy-unknown', state: terminalRunState(row.status), started_at: row.started_at ? utc(row.started_at) : null, ended_at: row.completed_at ? utc(row.completed_at) : null,
        last_event_seq: 0, context_manifest_json: canonicalJSON({ schemaVersion: 1, legacyRun: row.id, legacyStatus: row.status, resumable: false }), budget_json: '{}', error_json: row.error ? canonicalJSON({ legacy: row.error }) : null };
      insert('AgentRun', values); map('agent_runs', row, 'AgentRun', values.id);
    }
    const sequences = new Map();
    const orderedMessages = ['agent_messages', 'queued_agent_messages'].flatMap(table => rows(table).map(row => ({ table, row })));
    orderedMessages.sort((a, b) => utc(a.row.created_at).localeCompare(utc(b.row.created_at)) || a.row.id.localeCompare(b.row.id) || a.table.localeCompare(b.table));
    for (const { table, row } of orderedMessages) {
      const candidate = mapped('candidates', row.candidate_id), job = mapped('jobs', row.job_id);
      const conv = conversation(candidate, job, row);
      const sequence = (sequences.get(conv) || 0) + 1; sequences.set(conv, sequence);
      const metadata = row.metadata_json || {};
      const queued = table === 'queued_agent_messages';
      const legacyStatus = queued ? row.status : metadata.delivery_status;
      const delivery = queued ? 'queued' : ['failed','cancelled'].includes(legacyStatus) ? legacyStatus : ['streaming','steered','queued'].includes(legacyStatus) ? 'cancelled' : 'completed';
      const content = canonicalJSON({ schemaVersion: 1, parts: [{ type: 'text', text: row.content }], legacyMetadata: metadata, legacyStatus: legacyStatus ?? null, ...(queued ? { automaticDelivery: false, legacyQueueId: row.id, legacyQueueSequence: row.sequence } : {}) });
      const values = { ...base(row), conversation_id: conv, run_id: row.run_id ? mapped('agent_runs', row.run_id) : null, role: queued ? 'user' : row.role, content_json: content, content_hash: hash(content), sequence, delivery_status: delivery, supersedes_id: null };
      values.logical_message_id = values.id;
      insert('Message', values);
      if (table === 'agent_messages') map(table, row, 'Conversation', conv);
      map(table, row, 'Message', values.id);
    }
    assertIntegrity(db);
    const report = { stage: 'core_projected', activationAllowed: false,
      counts: Object.fromEntries(['Candidate','Job','Conversation','AgentRun','Message'].map(table => [table, db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n])),
      note: 'Remaining domain/source/credential conversions and cutover gates are not complete.' };
    db.exec('RELEASE core_projection');
    return report;
  } catch (error) { db.exec('ROLLBACK TO core_projection; RELEASE core_projection'); throw error; }
}
