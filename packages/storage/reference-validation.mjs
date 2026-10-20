import { contentHash } from './blob-store.mjs';

export async function validateReferences(db, blobs) {
  let located = 0;
  for (const row of db.prepare(`SELECT e.*,d.text_blob_hash,d.text_hash,d.state AS document_state,
    s.candidate_id,s.job_id,k.candidate_id AS knowledge_candidate,k.job_id AS knowledge_job,
    b.text AS block_text,b.char_start AS block_start,b.char_end AS block_end
    FROM EvidenceLink e JOIN Document d ON d.id=e.document_id AND d.workspace_id=e.workspace_id
    JOIN Source s ON s.id=d.source_id AND s.workspace_id=d.workspace_id
    JOIN KnowledgeItem k ON k.id=e.knowledge_id AND k.workspace_id=e.workspace_id
    JOIN Block b ON b.id=e.block_id AND b.document_id=d.id AND b.workspace_id=e.workspace_id`).all()) {
    const locator = JSON.parse(row.locator_json);
    if (row.candidate_id !== row.knowledge_candidate || row.job_id !== row.knowledge_job) throw new Error('evidence scope mismatch');
    if (contentHash(row.quote) !== row.quote_hash || row.document_state !== 'ready' || !row.text_blob_hash) throw new Error('evidence quote integrity mismatch');
    if (locator.type !== 'text-range' || locator.documentId !== row.document_id || locator.textHash !== row.text_hash
      || locator.offsetUnit !== 'unicode_codepoint' || !Number.isSafeInteger(locator.start) || !Number.isSafeInteger(locator.end)
      || locator.start < row.block_start || locator.end > row.block_end || locator.end <= locator.start) throw new Error('evidence locator mismatch');
    const bytes = await blobs.read(row.text_blob_hash);
    if (contentHash(bytes) !== row.text_hash || [...bytes.toString('utf8')].slice(locator.start,locator.end).join('') !== row.quote
      || [...row.block_text].slice(locator.start-row.block_start,locator.end-row.block_start).join('') !== row.quote) throw new Error('evidence text mismatch');
    if (row.verifier_revision === 'legacy-exact-quote-1' && row.relation !== 'context') throw new Error('legacy matching cannot establish semantic support');
    located++;
  }
  if (located !== db.prepare('SELECT count(*) AS n FROM EvidenceLink').get().n) throw new Error('orphan evidence link');
  for (const row of db.prepare('SELECT * FROM MigrationReference').all()) {
    const kind = row.knowledge_id ? 'KnowledgeItem' : 'ArtifactVersion';
    const ownerId = row.knowledge_id ?? row.artifact_version_id;
    if (!db.prepare('SELECT 1 FROM MigrationMap WHERE migration_id=? AND old_table=? AND old_id=? AND new_table=? AND new_id=?')
      .get(row.migration_id,row.old_table,row.old_id,kind,ownerId)) throw new Error('reference owner is not the migrated legacy row');
    const owner = row.knowledge_id
      ? db.prepare('SELECT candidate_id,job_id FROM KnowledgeItem WHERE workspace_id=? AND id=?').get(row.workspace_id,ownerId)
      : db.prepare('SELECT a.candidate_id,a.job_id FROM Artifact a JOIN ArtifactVersion v ON v.artifact_id=a.id WHERE v.workspace_id=? AND v.id=?').get(row.workspace_id,ownerId);
    if (!owner) throw new Error('reference owner is missing');
    if (row.document_id) {
      const source = db.prepare('SELECT s.candidate_id,s.job_id FROM Source s JOIN Document d ON d.source_id=s.id WHERE d.workspace_id=? AND d.id=?').get(row.workspace_id,row.document_id);
      if (!source || source.candidate_id !== owner.candidate_id || source.job_id !== owner.job_id) throw new Error('reference document scope mismatch');
    }
    if (row.target_knowledge_id) {
      const target = db.prepare('SELECT candidate_id,job_id FROM KnowledgeItem WHERE workspace_id=? AND id=?').get(row.workspace_id,row.target_knowledge_id);
      if (!target || target.candidate_id !== owner.candidate_id || (target.job_id !== null && target.job_id !== owner.job_id)) throw new Error('reference knowledge scope mismatch');
    }
    if (row.evidence_id) {
      const link = db.prepare('SELECT knowledge_id,document_id FROM EvidenceLink WHERE workspace_id=? AND id=?').get(row.workspace_id,row.evidence_id);
      if (!link || link.knowledge_id !== row.knowledge_id || link.document_id !== row.document_id) throw new Error('reference evidence binding mismatch');
    }
  }
  if (db.prepare("SELECT count(*) AS n FROM EvidenceLink e WHERE NOT EXISTS (SELECT 1 FROM MigrationReference r WHERE r.evidence_id=e.id AND r.state='located_context')").get().n) throw new Error('legacy evidence has no migration receipt');
  const states = Object.fromEntries(db.prepare('SELECT state,count(*) AS n FROM MigrationReference GROUP BY state').all().map(row => [row.state,row.n]));
  return { located, states, semanticSupportAssessed: false, citationsCreated: 0 };
}
