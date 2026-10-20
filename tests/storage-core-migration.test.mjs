import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { prepareLegacyArchive } from '../packages/storage/legacy-archive.mjs';
import { projectCoreDomain } from '../packages/storage/core-migration.mjs';

async function fixture(name, invalidScope = false) {
  const root = process.env.M1_ALLOWED_DELETE_ROOT; assert.ok(root);
  const dir = path.join(root, name); await mkdir(dir);
  const source = path.join(dir, 'v1.db');
  const child = spawnSync(path.resolve('backend/.venv-m1/Scripts/python.exe'), ['-B', 'tests/fixtures/create-v1-storage.py', source], { encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).tables, 25);
  if (invalidScope) {
    const db = new DatabaseSync(source);
    try { db.exec("UPDATE agent_messages SET candidate_id='cand_b' WHERE id='msg_a'"); } finally { db.close(); }
  }
  const report = await prepareLegacyArchive({ snapshotPath: source, root: dir, name: 'archive' });
  return { db: new DatabaseSync(report.outputPath), report, source };
}

test('actual legacy schema: all 25 populated tables archived; core preserves order, scope and interrupted state', async () => {
  const { db, report, source } = await fixture('actual-schema');
  const before = await readFile(source);
  try {
    assert.equal(Object.values(report.tableCounts).filter(n => n > 0).length, 25);
    const result = projectCoreDomain(db);
    assert.equal(result.activationAllowed, false);
    assert.equal(result.counts.Candidate, 2); assert.equal(result.counts.Job, 1); assert.equal(result.counts.Message, 3);
    assert.equal(db.prepare('SELECT state FROM AgentRun').get().state, 'interrupted');
    const messages = db.prepare('SELECT * FROM Message ORDER BY sequence').all();
    assert.deepEqual(messages.slice(0, 2).map(row => JSON.parse(row.content_json).parts[0].text), ['msg_a','msg_b']);
    assert.equal(JSON.parse(messages[0].content_json).legacyMetadata.custom, 'retain');
    assert.equal(messages[2].delivery_status, 'queued');
    assert.equal(JSON.parse(messages[2].content_json).automaticDelivery, false);
    assert.equal(db.prepare("SELECT count(*) AS n FROM MigrationMap WHERE new_table='LegacyArchive'").get().n, report.total);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(await readFile(source), before);
  } finally { db.close(); }
});

test('legacy cross-candidate row fails and rolls back the entire domain projection without losing archive', async () => {
  const { db, report } = await fixture('bad-scope', true);
  try {
    assert.throws(() => projectCoreDomain(db), /FOREIGN KEY/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='Workspace'").get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM LegacyArchive').get().n, report.total);
    assert.equal(db.prepare('SELECT state FROM Migration').get().state, 'archive_prepared');
  } finally { db.close(); }
});
