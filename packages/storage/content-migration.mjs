import { CONTENT_SCHEMA } from './content-schema.mjs';
import { projectionContext, utc } from './projection-context.mjs';
import { canonicalJSON } from './legacy-archive.mjs';
import { contentHash } from './blob-store.mjs';
import { assertIntegrity } from './snapshot.mjs';

export function projectContent(db) {
  const c = projectionContext(db);
  const confidence = canonicalJSON({ sourceQuality: 'unknown', quoteMatch: 'unknown', semanticSupport: 'unknown', userConfirmed: false, calibrationVersion: 'legacy-unassessed' });
  db.exec('SAVEPOINT content_projection');
  try {
    db.exec(CONTENT_SCHEMA);
    for (const table of ['facts','experiences','job_profiles']) for (const row of c.rows(table)) {
      const scope = c.scope(row), kind = table === 'facts' ? 'personal_fact' : table === 'experiences' ? 'personal_experience' : 'job_requirement';
      const items = table !== 'job_profiles' ? [null] : ['responsibilities','hard_requirements','preferred_requirements','competencies','uncertain_items'].flatMap(field => {
        if (!Array.isArray(row[field])) throw new Error('invalid legacy job requirement list');
        return row[field].map(value => ({ field, value }));
      });
      if (!items.length) c.event(table, row, 'legacy_empty_requirements');
      for (const item of items) {
        const body = table === 'facts' ? { text: row.content, category: row.category, legacyVerified: Boolean(row.verified), sourceReference: row.source_reference, evidenceState: 'legacy_unresolved' }
          : table === 'experiences' ? { title: row.title, organization: row.organization, dateRange: { start: row.start_date, end: row.end_date }, bullets: [], legacyDetails: row.details_json, summary: row.summary, category: row.kind, sortOrder: row.sort_order }
            : { text: typeof item.value === 'string' ? item.value : canonicalJSON(item.value), requirementType: item.field, keywords: row.keywords, evidenceState: 'legacy_unresolved' };
        const values = { ...c.base(row), ...scope, kind, subject: scope.job_id || scope.candidate_id,
          predicate: table === 'facts' ? row.category : null, content_json: canonicalJSON({ schemaVersion: 1, ...body, archive: { table, id: row.id }, ...(table === 'facts' && row.verified ? { confirmationBasis: 'legacy_verified_flag' } : {}) }),
          status: table === 'facts' && row.verified ? 'confirmed' : 'pending', valid_from: null, valid_to: null,
          recorded_at: utc(row.created_at), supersedes_id: null, extractor_revision: 'legacy-preserved-1', confidence_json: confidence };
        c.insert('KnowledgeItem', values); c.map(table, row, 'KnowledgeItem', values.id);
      }
    }
    const artifacts = new Map(), versions = new Map(), legacyVersions = new Map();
    const records = ['resume_versions','portfolio_versions','interview_briefs'].flatMap(table => c.rows(table).map(row => ({ table, row, base: c.base(row) })));
    const byLegacyId = new Map(records.map(record => [`${record.table}:${record.row.id}`, record]));
    // Allocate every artifact first: a parent may sort after its child in V1.
    for (const record of records) {
      const { table, row } = record;
      const scope = c.scope(row), kind = table === 'resume_versions' ? 'resume' : table === 'portfolio_versions' ? 'portfolio' : 'interview_brief';
      const key = canonicalJSON([kind, scope.candidate_id, scope.job_id, kind === 'interview_brief' && !scope.job_id ? [row.company, row.role, row.business_unit] : null]);
      let artifact = artifacts.get(key);
      if (!artifact) {
        artifact = { ...c.base(row), ...scope, kind, title: row.name || `${kind}: ${row.company || 'legacy'}`, current_version_id: null };
        c.insert('Artifact', artifact); artifacts.set(key, artifact);
      }
      record.artifact = artifact;
    }
    const visiting = new Set(), visited = new Set();
    function resolveParent(record) {
      if (visited.has(record)) return;
      if (visiting.has(record)) throw new Error('cyclic legacy artifact lineage');
      visiting.add(record);
      const parentId = record.table === 'resume_versions' ? record.row.parent_version_id
        : record.table === 'portfolio_versions' ? record.row.resume_version_id : null;
      if (parentId) {
        const parent = byLegacyId.get(`resume_versions:${parentId}`);
        if (!parent) throw new Error('unresolved legacy artifact parent');
        if (parent.artifact.candidate_id !== record.artifact.candidate_id
          || (parent.artifact.job_id !== null && parent.artifact.job_id !== record.artifact.job_id)) throw new Error('legacy artifact parent scope mismatch');
        record.parent = parent; resolveParent(parent);
      }
      visiting.delete(record); visited.add(record);
    }
    for (const record of records) resolveParent(record);
    for (const { table, row, base, artifact, parent } of records) {
      const version = (versions.get(artifact.id) || 0) + 1; versions.set(artifact.id, version);
      const body = table === 'resume_versions' ? row.content_json : table === 'portfolio_versions' ? row.page_schema
        : { summary: row.summary, common_questions: row.common_questions, recommendations: row.recommendations, source_ids: row.source_ids, query_terms: row.query_terms, metadata_json: row.metadata_json };
      const content = canonicalJSON({ schemaVersion: 1, legacySchema: table, content: body, archive: { table, id: row.id },
        legacyParentId: row.parent_version_id ?? row.resume_version_id ?? null,
        lineage: parent ? { artifactVersionId: parent.base.id, artifactId: parent.artifact.id,
          relation: table === 'portfolio_versions' ? 'source_resume' : 'parent_resume', sameArtifact: parent.artifact.id === artifact.id } : null,
        evidenceState: 'legacy_unresolved' });
      const values = { ...base, artifact_id: artifact.id, version, content_json: content, content_hash: contentHash(content), schema_version: 1,
        blob_hash: null, based_on_id: parent?.artifact.id === artifact.id ? parent.base.id : null,
        run_id: row.run_id ? c.mapped('agent_runs', row.run_id, 'AgentRun') : null, status: row.status || 'draft' };
      // Cross-artifact derivation is an explicit immutable lineage reference,
      // not a false same-artifact based_on FK.
      c.insert('ArtifactVersion', values); c.map(table, row, 'Artifact', artifact.id); c.map(table, row, 'ArtifactVersion', values.id);
      db.prepare('UPDATE Artifact SET current_version_id=? WHERE id=?').run(values.id, artifact.id);
      legacyVersions.set(`${table}:${row.id}`, { artifact, values, row });
    }
    for (const row of c.rows('rewrite_proposals')) {
      const parent = legacyVersions.get(`resume_versions:${row.resume_version_id}`);
      if (!parent) throw new Error('proposal target is unresolved');
      const content = canonicalJSON({ schemaVersion: 1, legacySchema: 'rewrite_proposal_patch', baseVersionId: parent.values.id,
        section: row.section, before: row.before, after: row.after, editedAfter: row.edited_after, reason: row.reason,
        factIds: row.fact_ids, jdEvidence: row.jd_evidence, legacyApprovalStatus: row.approval_status, applied: false });
      const version = (versions.get(parent.artifact.id) || 0) + 1; versions.set(parent.artifact.id, version);
      const values = { ...c.base(row), artifact_id: parent.artifact.id, version, content_json: content, content_hash: contentHash(content), schema_version: 1,
        blob_hash: null, based_on_id: parent.values.id, run_id: row.run_id ? c.mapped('agent_runs', row.run_id, 'AgentRun') : null, status: 'draft' };
      c.insert('ArtifactVersion', values); c.map('rewrite_proposals', row, 'ArtifactVersion', values.id);
      c.event('rewrite_proposals', row, 'legacy_proposal', { artifactVersionId: values.id, approvalMigrated: false });
      // A proposal must not replace the current resume or revive old approval.
    }
    assertIntegrity(db);
    db.exec('RELEASE content_projection');
    return { stage: 'content_projected', activationAllowed: false,
      counts: Object.fromEntries(['KnowledgeItem','Artifact','ArtifactVersion'].map(table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n])) };
  } catch (error) { db.exec('ROLLBACK TO content_projection; RELEASE content_projection'); throw error; }
}
