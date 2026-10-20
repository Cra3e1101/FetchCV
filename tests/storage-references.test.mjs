import test from 'node:test';
import assert from 'node:assert/strict';
import { locateUniqueQuote } from '../packages/storage/quote-locator.mjs';
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { storageFixture } from './helpers/storage-fixture.mjs';
import { projectCoreDomain } from '../packages/storage/core-migration.mjs';
import { projectSources } from '../packages/storage/source-migration.mjs';
import { projectContent } from '../packages/storage/content-migration.mjs';
import { projectReferences } from '../packages/storage/reference-migration.mjs';
import { createBlobStore, contentHash } from '../packages/storage/blob-store.mjs';
import { validateReferences } from '../packages/storage/reference-validation.mjs';

test('legacy quote location is exact, unambiguous and uses Unicode code points', () => {
  assert.deepEqual(locateUniqueQuote('甲😀SQL乙', '😀SQL'), { state: 'located', start: 1, end: 5, offsetUnit: 'unicode_codepoint' });
  assert.equal(locateUniqueQuote('SQL SQL', 'SQL').reason, 'ambiguous_quote');
  assert.equal(locateUniqueQuote('aaaa', 'aaa').reason, 'ambiguous_quote');
  assert.equal(locateUniqueQuote('SQL', 'sql').reason, 'quote_not_found');
  assert.equal(locateUniqueQuote('SQL', ' ').reason, 'invalid_quote');
});

test('reference migration distinguishes exact context from missing, ambiguous and cross-scope claims', async () => {
  let material;
  const { db, dir } = await storageFixture('references', async (legacy, fixtureDir) => {
    material = path.join(fixtureDir, 'synthetic-original.txt'); await writeFile(material, 'SQL', { flag: 'wx' });
    legacy.prepare('UPDATE material_assets SET source_path=?').run(material);
    legacy.prepare('UPDATE facts SET source_reference=?').run(`${material}#sha256=${contentHash('SQL')}`);
    legacy.prepare('UPDATE jobs SET jd_raw=?').run('甲😀SQL乙 重复 重复');
    legacy.prepare('UPDATE job_profiles SET hard_requirements=?').run(JSON.stringify(['😀SQL','重复','missing']));
    legacy.exec("INSERT INTO facts(id,candidate_id,subject_type,category,content,normalized_value,source_type,verified,allowed_outputs,version,created_at,updated_at) SELECT 'foreign_fact','cand_b',subject_type,category,content,normalized_value,source_type,verified,allowed_outputs,version,created_at,updated_at FROM facts");
    legacy.exec("INSERT INTO facts(id,candidate_id,subject_type,category,content,normalized_value,source_type,verified,allowed_outputs,version,created_at,updated_at) SELECT 'bad_hash_fact',candidate_id,subject_type,category,content,normalized_value,source_type,verified,allowed_outputs,version,created_at,updated_at FROM facts WHERE id='fact_a'");
    legacy.prepare("UPDATE facts SET source_reference=? WHERE id='bad_hash_fact'").run(`${material}#sha256=${'0'.repeat(64)}`);
    legacy.prepare('UPDATE rewrite_proposals SET fact_ids=?,jd_evidence=?').run(JSON.stringify(['fact_a','foreign_fact','missing_fact']), JSON.stringify(['😀SQL','重复','fake']));
    legacy.exec("UPDATE interview_sources SET candidate_id='cand_b',job_id=NULL");
  });
  try {
    projectCoreDomain(db); const blobs = await createBlobStore(path.join(dir, 'blobs'));
    await projectSources(db, blobs, { allowedFileRoots: [dir] }); projectContent(db);
    const result = await projectReferences(db, blobs);
    assert.equal(result.states.located_context, 1); assert.equal(result.citationsCreated, 0);
    assert.equal(result.reasons.cross_scope_reference, 2);
    assert.equal(result.reasons.ambiguous_quote, 2);
    assert.equal(result.reasons.missing_fact, 1);
    assert.equal(result.reasons.source_hash_mismatch, 1);
    assert.equal(result.reasons.document_text_unavailable, 1, 'captured bytes are not parser output');
    assert.equal(result.reasons.quote_verified_but_answer_locator_absent, 1);
    const link = db.prepare('SELECT * FROM EvidenceLink').get();
    assert.equal(link.relation, 'context'); assert.equal(link.quote, '😀SQL');
    assert.equal(link.quote_hash, contentHash('😀SQL')); assert.equal(JSON.parse(link.locator_json).start, 1);
    assert.equal(JSON.parse(link.locator_json).end, 5);
    const knowledge = db.prepare('SELECT * FROM KnowledgeItem WHERE id=?').get(link.knowledge_id);
    assert.equal(JSON.parse(knowledge.confidence_json).semanticSupport, 'unknown');
    assert.equal((await validateReferences(db, blobs)).located, 1);
    assert.throws(() => db.prepare("UPDATE EvidenceLink SET quote='changed'").run(), /immutable/);
    const foreign = db.prepare("SELECT * FROM KnowledgeItem WHERE json_extract(content_json,'$.archive.id')='foreign_fact'").get();
    assert.throws(() => db.prepare(`INSERT INTO EvidenceLink SELECT 'cross-scope',workspace_id,?,document_id,block_id,chunk_id,message_id,locator_json,quote,quote_hash,relation,verified_at,verifier_revision,created_at,updated_at,revision,deleted_at FROM EvidenceLink`).run(foreign.id), /scope mismatch/);
    assert.throws(() => db.prepare(`INSERT INTO EvidenceLink SELECT 'bad-range',workspace_id,knowledge_id,document_id,block_id,chunk_id,message_id,json_set(locator_json,'$.start',0),quote,quote_hash,relation,verified_at,verifier_revision,created_at,updated_at,revision,deleted_at FROM EvidenceLink`).run(), /locator or scope/);
    assert.throws(() => db.prepare(`INSERT INTO MigrationReference SELECT 'bad-reference',workspace_id,migration_id,old_table,old_id,field,knowledge_id,artifact_version_id,?,document_id,evidence_id,state,reason,created_at,updated_at FROM MigrationReference WHERE target_knowledge_id IS NOT NULL LIMIT 1`).run(foreign.id), /scope mismatch/);
    db.exec('SAVEPOINT bad_quote_hash');
    db.exec(`INSERT INTO EvidenceLink SELECT 'bad-hash',workspace_id,knowledge_id,document_id,block_id,chunk_id,message_id,locator_json,quote,'incorrect-hash',relation,verified_at,verifier_revision,created_at,updated_at,revision,deleted_at FROM EvidenceLink`);
    await assert.rejects(validateReferences(db, blobs), /quote integrity mismatch/);
    db.exec('ROLLBACK TO bad_quote_hash; RELEASE bad_quote_hash');
    assert.equal(await readFile(material, 'utf8'), 'SQL');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});
