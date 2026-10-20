import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, realpath, lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectLegacySchema,LEGACY_TABLES } from './legacy-tables.mjs';

export function assertIntegrity(db) {
  if (db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok')) throw new Error('SQLite integrity check failed');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite foreign-key check failed');
}

// The root is host-selected. This always creates a fresh exclusive subdirectory;
// no overwrite, delete, production manifest switch, or fallback to OS temp.
export async function createLegacySnapshot({ source, root, name, legacyVariant='current' }) {
  if (!path.isAbsolute(source) || !path.isAbsolute(root) || !/^[a-zA-Z0-9_-]{1,100}$/.test(name)) throw new Error('absolute paths and a simple snapshot name required');
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('snapshot root must be an existing real directory');
  const resolvedRoot = await realpath(root);
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error('source must be an existing regular database');
  const dir = path.join(resolvedRoot, name);
  await mkdir(dir); // EEXIST is deliberately fatal, including interrupted runs.
  const destination = path.join(dir, 'legacy-snapshot.db');
  const sourceDb = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
  let snapshot;
  try {
    // Read the source through SQLite so committed WAL pages are included.
    inspectLegacySchema(sourceDb,{legacyVariant});
    await backup(sourceDb, destination);
    snapshot = new DatabaseSync(destination, { readOnly: true });
    assertIntegrity(snapshot);
    const sourceTables=inspectLegacySchema(snapshot,{legacyVariant});
    const counts = Object.fromEntries(Object.keys(LEGACY_TABLES).map(table => [table, sourceTables.includes(table) ? snapshot.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n : 0]));
    const digest = createHash('sha256').update(await readFile(destination)).digest('hex');
    const result = { v: 1, kind: 'protected-original-snapshot', path: destination, sha256: digest, counts, sourceTables, legacyVariant,
      absentTables:Object.keys(LEGACY_TABLES).filter(table=>!sourceTables.includes(table)),createdAt: new Date().toISOString(), productionSwitched: false };
    // Contains only metadata. The raw snapshot still contains personal data and
    // credentials; the caller must place root behind the recovery access policy.
    await writeFile(path.join(dir, 'snapshot.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
    return result;
  } finally { snapshot?.close(); sourceDb.close(); }
}
