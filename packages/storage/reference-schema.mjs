// M4 restores block/text evidence only. Chunk/message evidence requires its
// own future schema migration; it must not be accepted without its constraints.
export const REFERENCE_SCHEMA = `
CREATE TABLE EvidenceLink (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), knowledge_id TEXT NOT NULL,
 document_id TEXT NOT NULL, block_id TEXT NOT NULL, chunk_id TEXT CHECK(chunk_id IS NULL), message_id TEXT CHECK(message_id IS NULL),
 locator_json TEXT NOT NULL CHECK(json_valid(locator_json) AND json_extract(locator_json,'$.type') IS 'text-range'
   AND json_type(locator_json,'$.start') IS 'integer' AND json_type(locator_json,'$.end') IS 'integer'
   AND json_extract(locator_json,'$.start')>=0 AND json_extract(locator_json,'$.end')>json_extract(locator_json,'$.start')),
 quote TEXT NOT NULL CHECK(length(quote)>0), quote_hash TEXT NOT NULL, relation TEXT NOT NULL CHECK(relation IN ('supports','contradicts','context')),
 verified_at TEXT, verifier_revision TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,knowledge_id) REFERENCES KnowledgeItem(workspace_id,id),
 FOREIGN KEY(workspace_id,document_id) REFERENCES Document(workspace_id,id),
 FOREIGN KEY(workspace_id,block_id,document_id) REFERENCES Block(workspace_id,id,document_id)
) STRICT;
CREATE INDEX evidence_knowledge_document ON EvidenceLink(workspace_id,knowledge_id,document_id);
CREATE TRIGGER evidence_block_scope BEFORE INSERT ON EvidenceLink WHEN NOT EXISTS (
 SELECT 1 FROM KnowledgeItem k JOIN Document d ON d.workspace_id=k.workspace_id
 JOIN Source s ON s.workspace_id=d.workspace_id AND s.id=d.source_id
 JOIN Block b ON b.workspace_id=d.workspace_id AND b.document_id=d.id
 WHERE k.workspace_id=NEW.workspace_id AND k.id=NEW.knowledge_id AND d.id=NEW.document_id AND b.id=NEW.block_id
 AND k.candidate_id IS s.candidate_id AND k.job_id IS s.job_id
 AND k.deleted_at IS NULL AND d.deleted_at IS NULL AND s.deleted_at IS NULL AND b.deleted_at IS NULL
 AND s.access_state!='revoked' AND d.state='ready'
 AND json_extract(NEW.locator_json,'$.documentId') IS d.id AND json_extract(NEW.locator_json,'$.textHash') IS d.text_hash
 AND json_extract(NEW.locator_json,'$.offsetUnit') IS 'unicode_codepoint'
 AND json_extract(NEW.locator_json,'$.start')>=b.char_start AND json_extract(NEW.locator_json,'$.end')<=b.char_end
 AND substr(b.text,json_extract(NEW.locator_json,'$.start')-b.char_start+1,json_extract(NEW.locator_json,'$.end')-json_extract(NEW.locator_json,'$.start')) IS NEW.quote)
 BEGIN SELECT RAISE(ABORT,'evidence locator or scope mismatch'); END;
CREATE TRIGGER evidence_content_immutable BEFORE UPDATE OF workspace_id,knowledge_id,document_id,block_id,chunk_id,message_id,locator_json,quote,quote_hash,relation ON EvidenceLink
 BEGIN SELECT RAISE(ABORT,'evidence content is immutable'); END;
CREATE TABLE MigrationReference (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), migration_id TEXT NOT NULL,
 old_table TEXT NOT NULL, old_id TEXT NOT NULL, field TEXT NOT NULL,
 knowledge_id TEXT, artifact_version_id TEXT, target_knowledge_id TEXT, document_id TEXT, evidence_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('located_context','reference_only','unresolved')), reason TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((knowledge_id IS NOT NULL)+(artifact_version_id IS NOT NULL)=1),
 CHECK((state='located_context')=(evidence_id IS NOT NULL)),
 CHECK(state!='reference_only' OR target_knowledge_id IS NOT NULL OR document_id IS NOT NULL),
 FOREIGN KEY(migration_id,old_table,old_id) REFERENCES LegacyArchive(migration_id,old_table,old_id),
 FOREIGN KEY(workspace_id,knowledge_id) REFERENCES KnowledgeItem(workspace_id,id),
 FOREIGN KEY(workspace_id,artifact_version_id) REFERENCES ArtifactVersion(workspace_id,id),
 FOREIGN KEY(workspace_id,target_knowledge_id) REFERENCES KnowledgeItem(workspace_id,id),
 FOREIGN KEY(workspace_id,document_id) REFERENCES Document(workspace_id,id),
 FOREIGN KEY(workspace_id,evidence_id) REFERENCES EvidenceLink(workspace_id,id)
) STRICT;
CREATE TRIGGER migration_reference_scope BEFORE INSERT ON MigrationReference WHEN NOT EXISTS (
 SELECT 1 FROM (
  SELECT workspace_id,candidate_id,job_id FROM KnowledgeItem WHERE id=NEW.knowledge_id AND deleted_at IS NULL
  UNION ALL
  SELECT a.workspace_id,a.candidate_id,a.job_id FROM Artifact a JOIN ArtifactVersion v ON v.artifact_id=a.id
    WHERE v.id=NEW.artifact_version_id AND a.deleted_at IS NULL AND v.deleted_at IS NULL
 ) owner JOIN LegacyArchive l ON l.migration_id=NEW.migration_id AND l.old_table=NEW.old_table AND l.old_id=NEW.old_id
 WHERE owner.workspace_id=NEW.workspace_id AND l.workspace_id=NEW.workspace_id
 AND (NEW.document_id IS NULL OR EXISTS(SELECT 1 FROM Document d JOIN Source s ON s.id=d.source_id AND s.workspace_id=d.workspace_id
   WHERE d.workspace_id=NEW.workspace_id AND d.id=NEW.document_id AND s.candidate_id IS owner.candidate_id AND s.job_id IS owner.job_id))
 AND (NEW.target_knowledge_id IS NULL OR EXISTS(SELECT 1 FROM KnowledgeItem k WHERE k.workspace_id=NEW.workspace_id AND k.id=NEW.target_knowledge_id
   AND k.candidate_id IS owner.candidate_id AND (k.job_id IS NULL OR k.job_id IS owner.job_id)))
 AND (NEW.evidence_id IS NULL OR EXISTS(SELECT 1 FROM EvidenceLink e WHERE e.workspace_id=NEW.workspace_id AND e.id=NEW.evidence_id
   AND e.knowledge_id IS NEW.knowledge_id AND e.document_id IS NEW.document_id)))
 BEGIN SELECT RAISE(ABORT,'migration reference scope mismatch'); END;
CREATE TRIGGER migration_reference_immutable BEFORE UPDATE ON MigrationReference
 BEGIN SELECT RAISE(ABORT,'migration reference receipts are immutable'); END;
`;
