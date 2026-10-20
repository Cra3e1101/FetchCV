import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { inspectLegacySchema, LEGACY_TABLES } from './legacy-tables.mjs';
import { assertIntegrity } from './snapshot.mjs';
import { LegacyRedactor } from './legacy-redaction.mjs';
import { CredentialVault } from './credential-vault.mjs';

export const canonicalJSON = value => JSON.stringify(value, (_, item) => {
  if (typeof item === 'bigint') return item <= BigInt(Number.MAX_SAFE_INTEGER) && item >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(item) : { $sqliteInteger: item.toString() };
  if (item instanceof Uint8Array) return { $sqliteBlob: Buffer.from(item).toString('base64') };
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  return item;
});
const digest = value => createHash('sha256').update(value).digest('hex');
async function assertClosedSnapshot(filename) {
  try {
    if ((await lstat(`${filename}-wal`)).size > 0) throw new Error('archive requires a closed consistent snapshot, not a live WAL database');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const ARCHIVE_SCHEMA = `
  PRAGMA foreign_keys=ON;
  CREATE TABLE Migration (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('archive_prepared','domain_validated')),
    snapshot_id TEXT NOT NULL, policy_revision TEXT NOT NULL
  ) STRICT;
  CREATE TABLE LegacyArchive (
    migration_id TEXT NOT NULL REFERENCES Migration(id), workspace_id TEXT NOT NULL,
    old_table TEXT NOT NULL, old_id TEXT NOT NULL,
    row_json TEXT NOT NULL CHECK(json_valid(row_json)), row_hash TEXT NOT NULL,
    redactions_json TEXT NOT NULL CHECK(json_valid(redactions_json)),
    PRIMARY KEY(migration_id,old_table,old_id)
  ) STRICT;
  CREATE TABLE MigrationMap (
    migration_id TEXT NOT NULL, old_table TEXT NOT NULL, old_id TEXT NOT NULL,
    new_table TEXT NOT NULL, new_id TEXT NOT NULL, source_hash TEXT NOT NULL,
    PRIMARY KEY(migration_id,old_table,old_id,new_table,new_id),
    FOREIGN KEY(migration_id,old_table,old_id) REFERENCES LegacyArchive(migration_id,old_table,old_id)
  ) STRICT;
`;

function decodeRows(db, table) {
  const jsonFields = db.prepare(`PRAGMA table_info("${table}")`).all().filter(column => column.type.toUpperCase() === 'JSON').map(column => column.name);
  const statement = db.prepare(`SELECT * FROM "${table}" ORDER BY id`);
  statement.setReadBigInts(true);
  return function* () {
    for (const row of statement.iterate()) {
      if (typeof row.id !== 'string' || !row.id) throw new Error(`invalid legacy identity: ${table}`);
      for (const field of jsonFields) {
        if (row[field] != null) {
          try { row[field] = JSON.parse(row[field]); }
          catch { throw new Error(`invalid legacy JSON: ${table}.${field}`); }
        }
      }
      // Convert SQLite values to lossless JSON before discovery/redaction.
      yield JSON.parse(canonicalJSON(row));
    }
  };
}

// Offline preparation only. No call site activates this output as the app DB.
// Unknown credentials in arbitrary prose cannot be ruled out by heuristics:
// credential-field review and secret scan remain explicit activation gates.
export async function prepareLegacyArchive({ snapshotPath, root, name, secretValues = [], credentialVault, legacyVariant='current' }) {
  if (credentialVault !== undefined && !(credentialVault instanceof CredentialVault)) throw new Error('host credential vault required');
  if (!path.isAbsolute(snapshotPath) || !path.isAbsolute(root) || !/^[a-zA-Z0-9_-]{1,100}$/.test(name)) throw new Error('absolute paths and simple archive name required');
  if ((await lstat(root)).isSymbolicLink() || !(await lstat(snapshotPath)).isFile()) throw new Error('real root and regular snapshot required');
  await assertClosedSnapshot(snapshotPath);
  const dir = path.join(await realpath(root), name);
  await mkdir(dir);
  const sourceHash = digest(await readFile(snapshotPath));
  const source = new DatabaseSync(snapshotPath, { readOnly: true });
  const outputPath = path.join(dir, 'archive.db');
  const redactor = new LegacyRedactor({ secretValues });
  let output;
  try {
    source.exec('BEGIN');
    assertIntegrity(source);
    const sourceTables = inspectLegacySchema(source,{legacyVariant}), tables=Object.keys(LEGACY_TABLES);
    const iterators = Object.fromEntries(tables.map(table => [table, sourceTables.includes(table) ? decodeRows(source, table) : function* () {}]));
    // Discover across all tables BEFORE writing any row; credentials can also
    // appear in old error messages, traces and tool results.
    for (const table of tables) for (const row of iterators[table]()) redactor.discover(row);
    output = new DatabaseSync(outputPath);
    output.exec(ARCHIVE_SCHEMA);
    output.exec('BEGIN IMMEDIATE');
    const migrationId = randomUUID(), workspaceId = randomUUID(), snapshotId = randomUUID();
    output.prepare('INSERT INTO Migration VALUES (?,?,?,?,?,?)').run(migrationId, workspaceId, new Date().toISOString(), 'archive_prepared', snapshotId, 'legacy-redaction-v1');
    const insert = output.prepare('INSERT INTO LegacyArchive VALUES (?,?,?,?,?,?,?)');
    const map = output.prepare('INSERT INTO MigrationMap VALUES (?,?,?,?,?,?)');
    const tableCounts = {}, tableHashes = {};
    let redactionCount = 0;
    for (const table of tables) {
      const hash = createHash('sha256');
      tableCounts[table] = 0;
      for (const original of iterators[table]()) {
        const { row, redactions } = redactor.redact(original, { table, oldId: original.id });
        const json = canonicalJSON(row), rowHash = digest(json);
        insert.run(migrationId, workspaceId, table, original.id, json, rowHash, canonicalJSON(redactions));
        map.run(migrationId, table, original.id, 'LegacyArchive', original.id, rowHash);
        hash.update(canonicalJSON([original.id, rowHash]) + '\n');
        tableCounts[table]++;
        redactionCount += redactions.length;
      }
      tableHashes[table] = hash.digest('hex');
    }
    assertIntegrity(output);
    for (const row of output.prepare('SELECT row_json,row_hash FROM LegacyArchive').iterate()) if (digest(row.row_json) !== row.row_hash) throw new Error('archive hash mismatch');
    const total = Object.values(tableCounts).reduce((a, b) => a + b, 0);
    if (output.prepare('SELECT count(*) AS n FROM MigrationMap').get().n !== total) throw new Error('missing archive disposition');
    await assertClosedSnapshot(snapshotPath);
    if (digest(await readFile(snapshotPath)) !== sourceHash) throw new Error('snapshot changed during preparation');
    const credentials = credentialVault ? await redactor.sealCredentials(credentialVault, workspaceId)
      : { state: 'requires_reentry_or_review' };
    output.exec('COMMIT');
    source.exec('COMMIT');
    // Raw-file integrity belongs beside the protected snapshot, not the ordinary
    // archive/report. Return an opaque snapshot ID; no credential-derived hash.
    const report = { v: 1, state: 'archive_prepared', migrationId, workspaceId, snapshotId, snapshotPath, outputPath,
      tableCounts, tableHashes, total, redactionCount, credentials,sourceTables,legacyVariant,
      rowHashSemantics: 'sha256 of canonical REDACTED row, not original credential bytes',
      plannedDomainTargets: LEGACY_TABLES, domainConverted: false, activationAllowed: false,
      unresolvedGates: ['domain_mapping', 'credential_classification_and_vault', 'scope_and_version_checks', 'cutover_crash_matrix'] };
    await writeFile(path.join(dir, 'archive-report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    return report;
  } catch (error) {
    // Preserve failed output; do not remove it or publish a success manifest.
    await writeFile(path.join(dir, 'archive-failure.json'), JSON.stringify({ success: false, activationAllowed: false, code: error.code || 'archive_preparation_failed' }), { flag: 'wx' });
    throw error;
  } finally { redactor.clear(); output?.close(); source.close(); }
}
