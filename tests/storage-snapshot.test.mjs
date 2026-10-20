import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { LEGACY_TABLES, inspectLegacySchema } from '../packages/storage/legacy-tables.mjs';
import { createLegacySnapshot } from '../packages/storage/snapshot.mjs';

test('consistent snapshot includes committed WAL, has all 25 counts, refuses overwrite and unknown tables', async () => {
  const root = process.env.M1_ALLOWED_DELETE_ROOT;
  assert.ok(root && path.isAbsolute(root), 'run via guarded isolated test root');
  const dir = path.join(root, 'snapshot-test');
  await mkdir(dir);
  const source = path.join(dir, 'original.db');
  const writer = new DatabaseSync(source);
  try {
    writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
    for (const table of Object.keys(LEGACY_TABLES)) writer.exec(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY, value TEXT)`);
    writer.prepare('INSERT INTO candidates VALUES (?,?)').run('c1', 'first committed');
    writer.prepare('INSERT INTO candidates VALUES (?,?)').run('c2', 'still in WAL');
    const before = await readFile(source);
    const result = await createLegacySnapshot({ source, root: dir, name: 'copy' });
    assert.equal(result.counts.candidates, 2);
    assert.equal(Object.keys(result.counts).length, 25);
    assert.equal(result.productionSwitched, false);
    const copy = new DatabaseSync(result.path, { readOnly: true });
    try { assert.equal(copy.prepare('SELECT value FROM candidates WHERE id=?').get('c2').value, 'still in WAL'); }
    finally { copy.close(); }
    assert.deepEqual(await readFile(source), before, 'source DB file not overwritten/checkpointed');
    await assert.rejects(createLegacySnapshot({ source, root: dir, name: 'copy' }), { code: 'EEXIST' });
    writer.exec('CREATE TABLE constructor(id TEXT PRIMARY KEY)');
    assert.throws(() => inspectLegacySchema(writer), /unexpected=constructor/);
    await assert.rejects(createLegacySnapshot({ source, root: path.join(dir, 'absent'), name: 'copy' }), { code: 'ENOENT' });
  } finally { writer.close(); }
});
