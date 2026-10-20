import { randomUUID } from 'node:crypto';
import { canonicalJSON } from './legacy-archive.mjs';
import { contentHash } from './blob-store.mjs';
import { LEGACY_TABLES } from './legacy-tables.mjs';

export function utc(value) {
  if (typeof value !== 'string' || !value) throw new Error('legacy timestamp required');
  const text = value.replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(text) ? text : `${text}Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid legacy timestamp');
  return date.toISOString();
}

export function projectionContext(db) {
  const migrations = db.prepare('SELECT * FROM Migration').all();
  if (migrations.length !== 1 || migrations[0].state !== 'archive_prepared') throw new Error('one prepared migration required');
  const migration = migrations[0], workspace = migration.workspace_id;
  const rows = table => {
    if (!Object.hasOwn(LEGACY_TABLES, table)) throw new Error('unknown legacy table');
    return db.prepare('SELECT old_id,row_json,row_hash FROM LegacyArchive WHERE migration_id=? AND old_table=? ORDER BY json_extract(row_json,\'$.created_at\'),old_id').all(migration.id, table).map(entry => {
      if (contentHash(entry.row_json) !== entry.row_hash) throw new Error('tampered archive row');
      const row = JSON.parse(entry.row_json);
      if (row.id !== entry.old_id) throw new Error('archive identity mismatch');
      return row;
    });
  };
  const mapped = (table, oldId, target) => {
    const values = db.prepare('SELECT new_id FROM MigrationMap WHERE migration_id=? AND old_table=? AND old_id=? AND new_table=?').all(migration.id, table, oldId, target);
    if (values.length !== 1) throw new Error(`unresolved or ambiguous ${table} reference to ${target}`);
    return values[0].new_id;
  };
  const insert = (table, values) => {
    const keys = Object.keys(values);
    if (![table, ...keys].every(name => /^[A-Za-z_][A-Za-z_0-9]*$/.test(name))) throw new Error('invalid SQL identifier');
    db.prepare(`INSERT INTO "${table}" (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(values));
  };
  const base = row => ({ id: randomUUID(), workspace_id: workspace, created_at: utc(row.created_at), updated_at: utc(row.updated_at ?? row.created_at), revision: 1, deleted_at: null });
  const map = (table, row, target, id) => {
    const source = db.prepare('SELECT row_hash FROM LegacyArchive WHERE migration_id=? AND old_table=? AND old_id=?').get(migration.id, table, row.id);
    if (!source) throw new Error('archive disposition requires original row');
    db.prepare('INSERT INTO MigrationMap VALUES (?,?,?,?,?,?)').run(migration.id, table, row.id, target, id, source.row_hash);
  };
  const scope = row => {
    const candidate = row.candidate_id ? mapped('candidates', row.candidate_id, 'Candidate') : null;
    const job = row.job_id ? db.prepare('SELECT * FROM Job WHERE workspace_id=? AND id=?').get(workspace, mapped('jobs', row.job_id, 'Job')) : null;
    if (job && candidate && job.candidate_id !== candidate) throw new Error('legacy candidate/job scope mismatch');
    return { candidate_id: candidate ?? job?.candidate_id ?? null, job_id: job?.id ?? null };
  };
  const event = (table, row, type, payload = {}, runId = null) => {
    const id = randomUUID(), now = utc(row.created_at);
    const sequence = db.prepare('SELECT coalesce(max(sequence),0)+1 AS n FROM Event WHERE workspace_id=?').get(workspace).n;
    insert('Event', { id, workspace_id: workspace, run_id: runId, entity_kind: 'legacy', entity_id: row.id, sequence, type,
      payload_json: canonicalJSON({ schemaVersion: 1, archive: { migrationId: migration.id, table, id: row.id }, ...payload }), payload_schema: 1, actor: 'migration', timestamp: now, created_at: now, updated_at: now });
    map(table, row, 'Event', id); return id;
  };
  return { db, migration, workspace, rows, mapped, insert, base, map, scope, event };
}
