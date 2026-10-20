import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { LEGACY_TABLES } from '../packages/storage/legacy-tables.mjs';
import { prepareLegacyArchive, canonicalJSON } from '../packages/storage/legacy-archive.mjs';

test('all 25 tables have an archive disposition; secrets are absent and activation is explicitly blocked', async () => {
  const root = process.env.M1_ALLOWED_DELETE_ROOT;
  assert.ok(root, 'guarded root required');
  const dir = path.join(root, 'archive-test'); await mkdir(dir);
  const source = path.join(dir, 'snapshot.db');
  const db = new DatabaseSync(source);
  for (const table of Object.keys(LEGACY_TABLES)) {
    db.exec(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY, values_json JSON, notes TEXT, large_int INTEGER)`);
    db.prepare(`INSERT INTO "${table}" VALUES (?,?,?,?)`).run('row1', '{}', 'keep material text', 9007199254740993n);
  }
  db.prepare('UPDATE workspace_settings SET values_json=?').run(JSON.stringify({ api_key: 'synthetic-long-key', theme: 'dark' }));
  db.prepare('UPDATE agent_messages SET notes=?').run('error included synthetic-long-key');
  db.close();
  const bytes = await readFile(source);
  const report = await prepareLegacyArchive({ snapshotPath: source, root: dir, name: 'prepared' });
  assert.equal(report.total, 25); assert.equal(report.activationAllowed, false); assert.equal(report.domainConverted, false);
  assert.ok(report.redactionCount >= 2);
  assert.deepEqual(await readFile(source), bytes);
  const archived = new DatabaseSync(report.outputPath, { readOnly: true });
  try {
    assert.equal(archived.prepare('SELECT count(*) AS n FROM MigrationMap').get().n, 25);
    const candidate = JSON.parse(archived.prepare("SELECT row_json FROM LegacyArchive WHERE old_table='candidates'").get().row_json);
    assert.deepEqual(candidate.large_int, { $sqliteInteger: '9007199254740993' });
    assert.equal(candidate.notes, 'keep material text');
    for (const row of archived.prepare('SELECT row_json, redactions_json FROM LegacyArchive').all()) assert.equal(JSON.stringify(row).includes('synthetic-long-key'), false);
  } finally { archived.close(); }
  assert.equal((await readFile(report.outputPath)).includes(Buffer.from('synthetic-long-key')), false, 'including SQLite free pages');
  await assert.rejects(prepareLegacyArchive({ snapshotPath: source, root: dir, name: 'prepared' }), { code: 'EEXIST' });
});

test('malformed legacy JSON fails with retained failure artifact and no success report', async () => {
  const root = process.env.M1_ALLOWED_DELETE_ROOT;
  assert.ok(root);
  const dir = path.join(root, 'invalid-json'); await mkdir(dir);
  const source = path.join(dir, 'bad.db'), db = new DatabaseSync(source);
  for (const table of Object.keys(LEGACY_TABLES)) db.exec(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY, data JSON)`);
  db.prepare('INSERT INTO candidates VALUES (?,?)').run('c', '{bad synthetic-private-data'); db.close();
  await assert.rejects(prepareLegacyArchive({ snapshotPath: source, root: dir, name: 'failed' }), /invalid legacy JSON: candidates.data/);
  assert.deepEqual(await readdir(path.join(dir, 'failed')), ['archive-failure.json']);
  assert.equal(canonicalJSON({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test('archive refuses a live WAL database; backup must precede conversion', async () => {
  const root = process.env.M1_ALLOWED_DELETE_ROOT; assert.ok(root);
  const dir = path.join(root, 'live-wal'); await mkdir(dir);
  const source = path.join(dir, 'live.db'), db = new DatabaseSync(source);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE example(id TEXT)');
    await assert.rejects(prepareLegacyArchive({ snapshotPath: source, root: dir, name: 'refused' }), /closed consistent snapshot/);
    assert.equal((await readdir(dir)).includes('refused'), false);
  } finally { db.close(); }
});
