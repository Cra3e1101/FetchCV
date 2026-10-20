import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { prepareLegacyArchive } from '../../packages/storage/legacy-archive.mjs';

export async function storageFixture(name, configureLegacy) {
  const root = process.env.M1_ALLOWED_DELETE_ROOT; assert.ok(root);
  const dir = path.join(root, name); await mkdir(dir);
  const source = path.join(dir, 'v1.db');
  const child = spawnSync(path.resolve('backend/.venv-m1/Scripts/python.exe'), ['-B', 'tests/fixtures/create-v1-storage.py', source], { encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).tables, 25);
  if (configureLegacy) {
    const db = new DatabaseSync(source);
    try { await configureLegacy(db, dir); } finally { db.close(); }
  }
  const report = await prepareLegacyArchive({ snapshotPath: source, root: dir, name: 'archive' });
  return { db: new DatabaseSync(report.outputPath), report, source, dir };
}
