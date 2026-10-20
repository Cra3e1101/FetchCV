import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLegacySnapshot } from './snapshot.mjs';
import { prepareLegacyArchive } from './legacy-archive.mjs';
import { createBlobStore } from './blob-store.mjs';
import { projectCoreDomain } from './core-migration.mjs';
import { projectSources } from './source-migration.mjs';
import { projectContent } from './content-migration.mjs';
import { projectOperations } from './operation-migration.mjs';
import { projectConfiguration } from './config-migration.mjs';
import { validateProjectedCopy } from './migration-validation.mjs';
import { projectReferences } from './reference-migration.mjs';

// This is an offline preparation boundary, not a startup migration or cutover.
// The caller must choose a protected recoveryRoot for raw credentials/user data.
export async function prepareWorkspaceCopy({ source, recoveryRoot, destinationRoot, name, allowedFileRoots = [], secretValues = [], credentialVault, legacyVariant='current' }) {
  const snapshot = await createLegacySnapshot({ source, root: recoveryRoot, name,legacyVariant });
  const archive = await prepareLegacyArchive({ snapshotPath: snapshot.path, root: destinationRoot, name, secretValues, credentialVault,legacyVariant });
  const dir = path.dirname(archive.outputPath), blobs = await createBlobStore(path.join(dir, 'blobs'));
  const db = new DatabaseSync(archive.outputPath);
  let stage = 'begin';
  let transactionOpen = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionOpen = true;
    stage = 'core'; const core = projectCoreDomain(db);
    stage = 'sources'; const sources = await projectSources(db, blobs, { allowedFileRoots });
    stage = 'content'; const content = projectContent(db);
    stage = 'operations'; const operations = projectOperations(db);
    stage = 'configuration'; const configuration = await projectConfiguration(db, blobs, { allowedFileRoots });
    stage = 'references'; const references = await projectReferences(db, blobs);
    stage = 'validation'; const validation = await validateProjectedCopy(db, blobs, { expectedCounts: snapshot.counts });
    stage = 'commit'; db.exec('COMMIT'); transactionOpen = false;
    const result = { ...validation, sourceTables:snapshot.sourceTables,absentTables:snapshot.absentTables,legacyVariant,stages: { core, sources, content, operations, configuration, references }, archivePath: archive.outputPath, credentials: archive.credentials,
      note: 'No active workspace manifest is created. Known credentials use references; any sealed copy remains pending review. Arbitrary text still requires secret review.' };
    stage = 'report';
    await writeFile(path.join(dir, 'projection-report.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
    return result;
  } catch (error) {
    const errors = [error];
    let rollback = 'not_needed';
    if (transactionOpen) {
      try { db.exec('ROLLBACK'); rollback = 'succeeded'; }
      catch (rollbackError) { errors.push(rollbackError); rollback = 'failed'; }
    }
    try {
      await writeFile(path.join(dir, 'projection-failure.json'), JSON.stringify({ success: false, stage, rollback,
        activationAllowed: false, code: error.code || 'projection_failed', originalPreserved: true }), { flag: 'wx' });
    } catch (reportError) { errors.push(reportError); }
    if (errors.length > 1) throw new AggregateError(errors, 'Workspace preparation failed; rollback or failure reporting also failed', { cause: error });
    throw error;
  } finally { db.close(); }
}
