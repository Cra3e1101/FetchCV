import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { storageFixture } from './helpers/storage-fixture.mjs';
import { prepareWorkspaceCopy } from '../packages/storage/prepare-workspace.mjs';
import { validateProjectedCopy } from '../packages/storage/migration-validation.mjs';
import { BlobStore } from '../packages/storage/blob-store.mjs';

test('full 25-table copy pipeline retains original, validates every destination and rejects mapping tampering', async () => {
  const { db: unusedArchive, source, dir } = await storageFixture('workspace-copy'); unusedArchive.close();
  const recoveryRoot = path.join(dir, 'private-recovery'), destinationRoot = path.join(dir, 'new-workspaces');
  await mkdir(recoveryRoot); await mkdir(destinationRoot);
  const before = await readFile(source);
  const result = await prepareWorkspaceCopy({ source, recoveryRoot, destinationRoot, name: 'run1' });
  assert.equal(result.structuralValidationPassed, true); assert.equal(result.totalRows, 27);
  assert.equal(Object.keys(result.tableCounts).length, 25); assert.equal(result.activationAllowed, false);
  assert.equal(result.exceptions.length, 1); assert.equal(result.exceptions[0].resolution, 'read_only_unbound_approval_history');
  assert.equal(result.references.semanticSupportAssessed, false);
  assert.equal(result.stages.references.citationsCreated, 0);
  assert.equal(result.stages.references.reasons.source_reference_absent, 1);
  assert.deepEqual(await readFile(source), before);
  // Corrupt a separate copy: the successful pipeline evidence stays valid.
  const tamperPath = path.join(dir, 'tampered-copy.db');
  await copyFile(result.archivePath, tamperPath);
  const copy = new DatabaseSync(tamperPath);
  try {
    assert.equal(copy.prepare('SELECT count(*) AS n FROM LegacyArchive').get().n, 27);
    assert.equal(copy.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name='Memory'").get().n, 0, 'old summaries are not promoted to memory');
    copy.prepare("UPDATE MigrationMap SET new_id='nonexistent' WHERE new_table='Candidate'").run();
    await assert.rejects(validateProjectedCopy(copy, new BlobStore(path.join(path.dirname(result.archivePath), 'blobs'))), /invalid migration mapping/);
  } finally { copy.close(); }
});

test('malformed reference lists fail the final projection stage and retain the original archive', async () => {
  const { db: unusedArchive, source, dir } = await storageFixture('workspace-reference-failure', legacy => {
    legacy.exec("UPDATE rewrite_proposals SET fact_ids='[42]'");
  });
  unusedArchive.close();
  const recoveryRoot = path.join(dir, 'private-recovery'), destinationRoot = path.join(dir, 'new-workspaces');
  await mkdir(recoveryRoot); await mkdir(destinationRoot);
  const before = await readFile(source);
  await assert.rejects(prepareWorkspaceCopy({ source, recoveryRoot, destinationRoot, name: 'failed' }), /invalid legacy reference list/);
  assert.deepEqual(await readFile(source), before);
  const failedRoot = path.join(destinationRoot, 'failed');
  const failure = JSON.parse(await readFile(path.join(failedRoot, 'projection-failure.json'), 'utf8'));
  assert.equal(failure.stage, 'references'); assert.equal(failure.rollback, 'succeeded');
  const db = new DatabaseSync(path.join(failedRoot, 'archive.db'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM LegacyArchive').get().n, 27);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name IN ('Candidate','Artifact','EvidenceLink','MigrationReference')").get().n, 0);
  } finally { db.close(); }
});

test('late configuration failure rolls back all projected tables while preserving archive, source and captured blobs', async () => {
  const { db: unusedArchive, source, dir } = await storageFixture('workspace-copy-failure', async (legacy, fixtureDir) => {
    const invalidSkill = path.join(fixtureDir, 'directory-is-not-a-skill');
    await mkdir(invalidSkill);
    legacy.prepare('UPDATE agent_skills SET path=?').run(invalidSkill);
  });
  unusedArchive.close();
  const recoveryRoot = path.join(dir, 'private-recovery'), destinationRoot = path.join(dir, 'new-workspaces');
  await mkdir(recoveryRoot); await mkdir(destinationRoot);
  const before = await readFile(source);
  await assert.rejects(prepareWorkspaceCopy({ source, recoveryRoot, destinationRoot, name: 'failed', allowedFileRoots: [dir] }), /invalid legacy material/);
  assert.deepEqual(await readFile(source), before);
  const failedRoot = path.join(destinationRoot, 'failed');
  const failure = JSON.parse(await readFile(path.join(failedRoot, 'projection-failure.json'), 'utf8'));
  assert.equal(failure.stage, 'configuration'); assert.equal(failure.rollback, 'succeeded'); assert.equal(failure.activationAllowed, false);
  await assert.rejects(readFile(path.join(failedRoot, 'projection-report.json')), { code: 'ENOENT' });
  const db = new DatabaseSync(path.join(failedRoot, 'archive.db'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM LegacyArchive').get().n, 27);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name IN ('Workspace','Candidate','Document','Artifact','ToolCall','McpServer')").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM MigrationMap WHERE new_table!='LegacyArchive'").get().n, 0);
  } finally { db.close(); }
});
