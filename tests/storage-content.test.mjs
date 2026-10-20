import test from 'node:test';
import assert from 'node:assert/strict';
import { storageFixture } from './helpers/storage-fixture.mjs';
import { projectCoreDomain } from '../packages/storage/core-migration.mjs';
import { projectContent } from '../packages/storage/content-migration.mjs';

test('content projection preserves facts and versions without applying proposals or promoting summaries', async () => {
  const { db } = await storageFixture('content-valid', legacy => {
    legacy.exec("INSERT INTO resume_versions(id,candidate_id,job_id,name,status,content_json,source_fact_ids,created_at,updated_at) SELECT 'resume_b',candidate_id,job_id,'Second','draft','{\"name\":\"Distinct second version\"}','[]','2026-09-22','2026-09-22' FROM resume_versions WHERE id='resume_a'");
    legacy.exec("UPDATE resume_versions SET parent_version_id='resume_b' WHERE id='resume_a'");
  });
  try {
    projectCoreDomain(db); const result = projectContent(db);
    assert.equal(result.counts.KnowledgeItem, 3); assert.equal(result.counts.Artifact, 3); assert.equal(result.counts.ArtifactVersion, 5);
    const fact = db.prepare("SELECT * FROM KnowledgeItem WHERE kind='personal_fact'").get();
    assert.equal(fact.status, 'confirmed'); assert.equal(JSON.parse(fact.content_json).text, 'SQL');
    assert.equal(JSON.parse(fact.content_json).confirmationBasis, 'legacy_verified_flag');
    assert.equal(JSON.parse(fact.confidence_json).userConfirmed, false);
    const resume = db.prepare("SELECT v.* FROM Artifact a JOIN ArtifactVersion v ON v.id=a.current_version_id WHERE a.kind='resume'").get();
    assert.equal(JSON.parse(resume.content_json).content.name, 'Distinct second version');
    const proposal = db.prepare("SELECT * FROM ArtifactVersion WHERE json_extract(content_json,'$.legacySchema')='rewrite_proposal_patch'").get();
    assert.equal(proposal.status, 'draft'); assert.equal(JSON.parse(proposal.content_json).applied, false);
    assert.notEqual(proposal.id, resume.id);
    const earlier = db.prepare("SELECT * FROM ArtifactVersion WHERE json_extract(content_json,'$.archive.id')='resume_a'").get();
    assert.equal(earlier.based_on_id, resume.id, 'forward parent references are resolved');
    const portfolio = db.prepare("SELECT * FROM ArtifactVersion WHERE json_extract(content_json,'$.legacySchema')='portfolio_versions'").get();
    assert.equal(portfolio.based_on_id, null, 'portfolio-to-resume is not a same-artifact FK');
    assert.equal(JSON.parse(portfolio.content_json).lineage.artifactVersionId, earlier.id);
    assert.throws(() => db.prepare('UPDATE ArtifactVersion SET content_json=? WHERE id=?').run('{}', resume.id), /immutable/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('content projection rejects cross-candidate parents and cycles without partial domain writes', async () => {
  for (const mode of ['scope', 'cycle']) {
    const { db } = await storageFixture(`content-invalid-${mode}`, legacy => {
      legacy.exec("INSERT INTO resume_versions(id,candidate_id,job_id,name,status,content_json,source_fact_ids,created_at,updated_at) SELECT 'parent_b',candidate_id,job_id,'Parent','draft','{}','[]',created_at,updated_at FROM resume_versions WHERE id='resume_a'");
      legacy.exec("UPDATE resume_versions SET parent_version_id='parent_b' WHERE id='resume_a'");
      if (mode === 'scope') legacy.exec("UPDATE resume_versions SET candidate_id='cand_b',job_id=NULL WHERE id='parent_b'");
      else legacy.exec("UPDATE resume_versions SET parent_version_id='resume_a' WHERE id='parent_b'");
    });
    try {
      projectCoreDomain(db);
      assert.throws(() => projectContent(db), mode === 'scope' ? /parent scope mismatch/ : /cyclic legacy/);
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='Artifact'").get().n, 0);
      assert.equal(db.prepare('SELECT count(*) AS n FROM LegacyArchive').get().n, 28);
    } finally { db.close(); }
  }
});
