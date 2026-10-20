import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { REFERENCE_SCHEMA } from './reference-schema.mjs';
import { projectionContext, utc } from './projection-context.mjs';
import { canonicalJSON } from './legacy-archive.mjs';
import { contentHash } from './blob-store.mjs';
import { locateUniqueQuote } from './quote-locator.mjs';
import { assertIntegrity } from './snapshot.mjs';

export async function projectReferences(db, blobs) {
  const c = projectionContext(db);
  const record = (table, row, field, owner, result) => c.insert('MigrationReference', {
    id: randomUUID(), workspace_id: c.workspace, migration_id: c.migration.id, old_table: table, old_id: row.id, field,
    knowledge_id: owner.knowledge_id ?? null, artifact_version_id: owner.artifact_version_id ?? null,
    target_knowledge_id: null, document_id: null, evidence_id: null, ...result,
    created_at: utc(row.created_at), updated_at: utc(row.updated_at ?? row.created_at),
  });
  const knowledgeOwner = id => ({ ...db.prepare('SELECT * FROM KnowledgeItem WHERE workspace_id=? AND id=?').get(c.workspace, id), knowledge_id: id });
  const artifactOwner = (table, row) => {
    const id = c.mapped(table, row.id, 'ArtifactVersion');
    return { ...db.prepare('SELECT a.candidate_id,a.job_id FROM Artifact a JOIN ArtifactVersion v ON v.artifact_id=a.id WHERE v.workspace_id=? AND v.id=?').get(c.workspace, id), artifact_version_id: id };
  };
  function documentTarget(table, id, owner) {
    const map = db.prepare("SELECT new_id FROM MigrationMap WHERE migration_id=? AND old_table=? AND old_id=? AND new_table='Document'").all(c.migration.id, table, id);
    if (map.length !== 1) return { reason: 'missing_or_ambiguous_document' };
    const doc = db.prepare(`SELECT d.*,s.candidate_id,s.job_id,s.deleted_at AS source_deleted,s.access_state
      FROM Document d JOIN Source s ON s.workspace_id=d.workspace_id AND s.id=d.source_id WHERE d.workspace_id=? AND d.id=?`).get(c.workspace, map[0].new_id);
    if (!doc) throw new Error('mapped reference document is missing');
    if (doc.candidate_id !== owner.candidate_id || doc.job_id !== owner.job_id) return { reason: 'cross_scope_reference' };
    if (doc.deleted_at || doc.source_deleted || doc.access_state === 'revoked') return { reason: 'source_unavailable' };
    return { doc };
  }
  async function locate(doc, quote) {
    if (doc.state !== 'ready' || !doc.text_blob_hash) return { state: 'unresolved', reason: 'document_text_unavailable' };
    const bytes = await blobs.read(doc.text_blob_hash);
    if (contentHash(bytes) !== doc.text_hash) throw new Error('reference document text hash mismatch');
    return locateUniqueQuote(bytes.toString('utf8'), quote);
  }
  async function knowledgeEvidence(table, row, field, owner, target, quote) {
    if (!target.doc) return record(table, row, field, owner, { state: 'unresolved', reason: target.reason });
    const doc = target.doc, location = await locate(doc, quote);
    if (location.state !== 'located') return record(table, row, field, owner, { document_id: doc.id, ...location });
    const blocks = db.prepare('SELECT * FROM Block WHERE workspace_id=? AND document_id=? AND deleted_at IS NULL AND char_start<=? AND char_end>=?').all(c.workspace, doc.id, location.start, location.end);
    if (blocks.length !== 1) return record(table, row, field, owner, { state: 'unresolved', reason: 'missing_or_ambiguous_block', document_id: doc.id });
    const evidence = { ...c.base(row), knowledge_id: owner.knowledge_id, document_id: doc.id, block_id: blocks[0].id, chunk_id: null, message_id: null,
      locator_json: canonicalJSON({ schemaVersion: 1, type: 'text-range', documentId: doc.id, textHash: doc.text_hash, start: location.start, end: location.end, offsetUnit: location.offsetUnit }),
      quote, quote_hash: contentHash(quote), relation: 'context', verified_at: new Date().toISOString(), verifier_revision: 'legacy-exact-quote-1' };
    c.insert('EvidenceLink', evidence);
    record(table, row, field, owner, { state: 'located_context', reason: 'quote_verified_semantics_unassessed', document_id: doc.id, evidence_id: evidence.id });
  }
  function factReference(table, row, field, owner, factId) {
    const mappings = db.prepare("SELECT new_id FROM MigrationMap WHERE migration_id=? AND old_table='facts' AND old_id=? AND new_table='KnowledgeItem'").all(c.migration.id, factId);
    if (mappings.length !== 1) return record(table, row, field, owner, { state: 'unresolved', reason: 'missing_fact' });
    const fact = knowledgeOwner(mappings[0].new_id);
    // Candidate-wide personal facts can ground that candidate's job artifacts;
    // a fact belonging to another job/candidate cannot cross the boundary.
    if (fact.candidate_id !== owner.candidate_id || (fact.job_id !== null && fact.job_id !== owner.job_id)) return record(table, row, field, owner, { state: 'unresolved', reason: 'cross_scope_reference' });
    record(table, row, field, owner, { state: 'reference_only', reason: 'fact_relation_without_answer_locator', target_knowledge_id: fact.id });
  }
  const list = value => { if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('invalid legacy reference list'); return value; };
  db.exec('SAVEPOINT reference_projection');
  try {
    db.exec(REFERENCE_SCHEMA);
    for (const row of c.rows('job_profiles')) {
      const mapped = db.prepare("SELECT new_id FROM MigrationMap WHERE migration_id=? AND old_table='job_profiles' AND old_id=? AND new_table='KnowledgeItem'").all(c.migration.id, row.id);
      for (const { new_id: id } of mapped) {
        const owner = knowledgeOwner(id), content = JSON.parse(owner.content_json);
        await knowledgeEvidence('job_profiles', row, content.requirementType, owner, documentTarget('jobs', row.job_id, owner), content.text);
      }
    }
    const materials = c.rows('material_assets');
    for (const row of c.rows('facts')) {
      const owner = knowledgeOwner(c.mapped('facts', row.id, 'KnowledgeItem'));
      const match = typeof row.source_reference === 'string' && /^(.*)#sha256=([a-f0-9]{64})$/i.exec(row.source_reference);
      if (!match) { record('facts', row, 'source_reference', owner, { state: 'unresolved', reason: row.source_reference ? 'unsupported_source_reference' : 'source_reference_absent' }); continue; }
      const normalize = value => path.win32.normalize(value).toLowerCase();
      const matches = materials.filter(item => typeof item.source_path === 'string' && normalize(item.source_path) === normalize(match[1]));
      if (matches.length !== 1) { record('facts', row, 'source_reference', owner, { state: 'unresolved', reason: 'missing_or_ambiguous_material' }); continue; }
      const target = documentTarget('material_assets', matches[0].id, owner);
      if (target.doc && target.doc.blob_hash !== match[2].toLowerCase()) { record('facts', row, 'source_reference', owner, { state: 'unresolved', reason: target.doc.blob_hash ? 'source_hash_mismatch' : 'original_not_captured' }); continue; }
      await knowledgeEvidence('facts', row, 'source_reference', owner, target, row.content);
    }
    for (const row of c.rows('experiences')) {
      if (!row.source_asset_id) continue;
      const owner = knowledgeOwner(c.mapped('experiences', row.id, 'KnowledgeItem')), target = documentTarget('material_assets', row.source_asset_id, owner);
      record('experiences', row, 'source_asset_id', owner, target.doc ? { state: 'reference_only', reason: 'source_relation_without_quote', document_id: target.doc.id } : { state: 'unresolved', reason: target.reason });
    }
    for (const table of ['resume_versions','rewrite_proposals']) for (const row of c.rows(table)) {
      const owner = artifactOwner(table, row), field = table === 'resume_versions' ? 'source_fact_ids' : 'fact_ids';
      list(row[field]).forEach((id, index) => factReference(table, row, `${field}/${index}`, owner, id));
      if (table !== 'rewrite_proposals') continue;
      for (const [index, quote] of list(row.jd_evidence).entries()) {
        const sourceJob = db.prepare("SELECT old_id FROM MigrationMap WHERE migration_id=? AND old_table='jobs' AND new_table='Job' AND new_id=?").get(c.migration.id, owner.job_id);
        const target = sourceJob ? documentTarget('jobs', sourceJob.old_id, owner) : { reason: 'job_reference_absent' };
        const location = target.doc ? await locate(target.doc, quote) : { state: 'unresolved', reason: target.reason };
        record(table, row, `jd_evidence/${index}`, owner, location.state === 'located'
          ? { state: 'reference_only', reason: 'quote_verified_but_answer_locator_absent', document_id: target.doc.id }
          : { state: 'unresolved', reason: location.reason, document_id: target.doc?.id ?? null });
      }
    }
    for (const row of c.rows('interview_briefs')) {
      const owner = artifactOwner('interview_briefs', row);
      const fields = [['source_ids', row.source_ids], ...row.common_questions.map((question, index) => [`common_questions/${index}/source_ids`, question.source_ids ?? []])];
      for (const [field, values] of fields) for (const [index, id] of list(values).entries()) {
        const target = documentTarget('interview_sources', id, owner);
        record('interview_briefs', row, `${field}/${index}`, owner, target.doc ? { state: 'reference_only', reason: 'source_relation_without_quote_or_answer_locator', document_id: target.doc.id } : { state: 'unresolved', reason: target.reason });
      }
    }
    assertIntegrity(db); db.exec('RELEASE reference_projection');
    return { stage: 'references_projected', activationAllowed: false, citationsCreated: 0,
      states: Object.fromEntries(db.prepare('SELECT state,count(*) AS n FROM MigrationReference GROUP BY state').all().map(row => [row.state,row.n])),
      reasons: Object.fromEntries(db.prepare('SELECT reason,count(*) AS n FROM MigrationReference GROUP BY reason').all().map(row => [row.reason,row.n])),
      note: 'Exact quotes establish context only; missing answer locators never become fabricated Citations.' };
  } catch (error) { db.exec('ROLLBACK TO reference_projection; RELEASE reference_projection'); throw error; }
}
