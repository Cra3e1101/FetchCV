import { LEGACY_TABLES } from './legacy-tables.mjs';
import { projectionContext } from './projection-context.mjs';
import { contentHash } from './blob-store.mjs';
import { assertIntegrity } from './snapshot.mjs';
import { canonicalJSON } from './legacy-archive.mjs';
import { validateReferences } from './reference-validation.mjs';

export async function validateProjectedCopy(db, blobs, { expectedCounts } = {}) {
  const c = projectionContext(db), tableCounts = {}, exceptions = [];
  const allowedTargets = new Set(Object.values(LEGACY_TABLES).flat());
  const exists = (target, id, oldId) => {
    if (!allowedTargets.has(target)) return false;
    if (target === 'LegacyArchive') return id === oldId;
    if (target === 'Setting') return Boolean(db.prepare('SELECT 1 FROM Setting WHERE workspace_id=? AND key=?').get(c.workspace, id));
    return Boolean(db.prepare(`SELECT 1 FROM "${target}" WHERE workspace_id=? AND id=?`).get(c.workspace, id));
  };
  for (const [table, required] of Object.entries(LEGACY_TABLES)) {
    const rows = c.rows(table); tableCounts[table] = rows.length;
    if (expectedCounts && expectedCounts[table] !== rows.length) throw new Error(`legacy row count mismatch: ${table}`);
    for (const row of rows) {
      const mappings = db.prepare('SELECT * FROM MigrationMap WHERE migration_id=? AND old_table=? AND old_id=?').all(c.migration.id, table, row.id);
      const archived = db.prepare('SELECT row_hash FROM LegacyArchive WHERE migration_id=? AND old_table=? AND old_id=?').get(c.migration.id, table, row.id);
      if (!mappings.some(mapping => mapping.new_table === 'LegacyArchive')) throw new Error(`missing archive disposition: ${table}`);
      for (const mapping of mappings) if (mapping.source_hash !== archived.row_hash || !exists(mapping.new_table, mapping.new_id, row.id)) throw new Error(`invalid migration mapping: ${table}`);
      for (const target of required) if (!mappings.some(mapping => mapping.new_table === target)) {
        const historicalApproval = table === 'approvals' && target === 'Approval' && db.prepare("SELECT 1 FROM MigrationIssue WHERE migration_id=? AND old_table=? AND old_id=? AND code='legacy_approval_without_exact_invocation'").get(c.migration.id, table, row.id);
        const emptyProfile = table === 'job_profiles' && target === 'KnowledgeItem' && ['responsibilities','hard_requirements','preferred_requirements','competencies','uncertain_items'].every(key => Array.isArray(row[key]) && row[key].length === 0);
        if ((!historicalApproval && !emptyProfile) || !mappings.some(mapping => mapping.new_table === 'Event')) throw new Error(`unconverted legacy row: ${table} -> ${target}`);
        exceptions.push({ table, oldId: row.id, missingTarget: target, resolution: historicalApproval ? 'read_only_unbound_approval_history' : 'empty_requirement_profile_event' });
      }
    }
  }
  for (const table of ['Message','ArtifactVersion']) for (const row of db.prepare(`SELECT content_json,content_hash FROM ${table}`).all()) if (contentHash(row.content_json) !== row.content_hash) throw new Error(`${table} content hash mismatch`);
  for (const row of db.prepare('SELECT v.*,a.candidate_id,a.job_id FROM ArtifactVersion v JOIN Artifact a ON a.id=v.artifact_id').all()) {
    const lineage = JSON.parse(row.content_json).lineage;
    if (!lineage) continue;
    const parent = db.prepare('SELECT v.*,a.candidate_id,a.job_id FROM ArtifactVersion v JOIN Artifact a ON a.id=v.artifact_id WHERE v.workspace_id=? AND v.id=?').get(c.workspace, lineage.artifactVersionId);
    if (!parent || parent.artifact_id !== lineage.artifactId || parent.candidate_id !== row.candidate_id
      || (parent.job_id !== null && parent.job_id !== row.job_id)
      || lineage.sameArtifact !== (parent.artifact_id === row.artifact_id)
      || row.based_on_id !== (lineage.sameArtifact ? parent.id : null)) throw new Error('artifact lineage mismatch');
  }
  let blobChecks = 0;
  for (const row of db.prepare('SELECT * FROM Document').all()) {
    if (row.blob_hash) { await blobs.read(row.blob_hash); blobChecks++; }
    if (row.text_blob_hash) {
      const bytes = await blobs.read(row.text_blob_hash);
      if (contentHash(bytes) !== row.text_hash) throw new Error('document text integrity mismatch');
      const characters = [...bytes.toString('utf8')];
      for (const block of db.prepare('SELECT * FROM Block WHERE document_id=?').all(row.id)) {
        if (block.char_end > characters.length || characters.slice(block.char_start, block.char_end).join('') !== block.text) throw new Error('block locator/text mismatch');
      }
    }
  }
  for (const row of db.prepare('SELECT * FROM SkillSnapshot WHERE body_blob_hash IS NOT NULL').all()) {
    await blobs.read(row.body_blob_hash); blobChecks++;
    if (contentHash(canonicalJSON({ metadata: JSON.parse(row.metadata_json), bodyHash: row.body_blob_hash })) !== row.manifest_hash) throw new Error('skill manifest hash mismatch');
  }
  const references = await validateReferences(db, blobs);
  assertIntegrity(db);
  return { schemaVersion: 1, structuralValidationPassed: true, tableCounts, totalRows: Object.values(tableCounts).reduce((a,b) => a+b,0), exceptions, blobChecks, references,
    activationAllowed: false, productionSwitched: false,
    remainingGates: ['evidence_reference_resolution','credential_resolution','single_writer_cutover','crash_and_new_data_rollback'] };
}
