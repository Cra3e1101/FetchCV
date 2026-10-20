export const SOURCE_SCHEMA = `
CREATE TABLE Source (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), candidate_id TEXT, job_id TEXT,
 kind TEXT NOT NULL, identity_key TEXT NOT NULL, original_uri TEXT, title TEXT NOT NULL, publisher TEXT, published_at TEXT,
 access_state TEXT NOT NULL CHECK(access_state IN ('available','missing','requires_file_access','revoked')),
 retention_json TEXT NOT NULL CHECK(json_valid(retention_json)), metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,identity_key), CHECK(job_id IS NULL OR candidate_id IS NOT NULL),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES Candidate(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id,candidate_id) REFERENCES Job(workspace_id,id,candidate_id)
) STRICT;
CREATE TRIGGER source_scope_immutable BEFORE UPDATE OF workspace_id,candidate_id,job_id,identity_key,original_uri ON Source
 BEGIN SELECT RAISE(ABORT,'source identity and scope are immutable'); END;
CREATE TABLE Document (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), source_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), blob_hash TEXT, text_hash TEXT, text_blob_hash TEXT, ir_blob_hash TEXT,
 parser_id TEXT, parser_revision TEXT, state TEXT NOT NULL CHECK(state IN ('captured','ready','missing_file','requires_file_access','failed')),
 captured_at TEXT NOT NULL, source_updated_at TEXT, quality_json TEXT NOT NULL CHECK(json_valid(quality_json)), active INTEGER NOT NULL CHECK(active IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,id,source_id), UNIQUE(source_id,version),
 CHECK(state IN ('missing_file','requires_file_access','failed') OR blob_hash IS NOT NULL),
 CHECK(state!='ready' OR (text_hash IS NOT NULL AND text_blob_hash IS NOT NULL)),
 FOREIGN KEY(workspace_id,source_id) REFERENCES Source(workspace_id,id)
) STRICT;
CREATE UNIQUE INDEX document_one_active ON Document(workspace_id,source_id) WHERE active=1 AND deleted_at IS NULL;
CREATE TRIGGER document_content_immutable BEFORE UPDATE OF workspace_id,source_id,version,blob_hash,text_hash,text_blob_hash,ir_blob_hash,parser_id,parser_revision,captured_at,source_updated_at,quality_json ON Document
 BEGIN SELECT RAISE(ABORT,'document content is immutable; append a version'); END;
CREATE TABLE Block (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES Workspace(id), document_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal>=0), type TEXT NOT NULL, text TEXT NOT NULL,
 char_start INTEGER NOT NULL CHECK(char_start>=0), char_end INTEGER NOT NULL CHECK(char_end>=char_start),
 page INTEGER, bbox_json TEXT CHECK(bbox_json IS NULL OR json_valid(bbox_json)), heading_path_json TEXT NOT NULL CHECK(json_valid(heading_path_json)),
 origin_json TEXT NOT NULL CHECK(json_valid(origin_json)), quality_json TEXT NOT NULL CHECK(json_valid(quality_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,id,document_id), UNIQUE(document_id,ordinal),
 FOREIGN KEY(workspace_id,document_id) REFERENCES Document(workspace_id,id)
) STRICT;
CREATE TRIGGER block_bounds BEFORE INSERT ON Block
 WHEN NOT EXISTS (SELECT 1 FROM Document d WHERE d.workspace_id=NEW.workspace_id AND d.id=NEW.document_id
 AND d.text_hash IS NOT NULL AND NEW.char_end<=json_extract(d.quality_json,'$.textLength'))
 BEGIN SELECT RAISE(ABORT,'block outside document text'); END;
CREATE TRIGGER block_content_immutable BEFORE UPDATE OF workspace_id,document_id,ordinal,type,text,char_start,char_end,page,bbox_json,heading_path_json,origin_json,quality_json ON Block
 BEGIN SELECT RAISE(ABORT,'block content is immutable'); END;
ALTER TABLE Job ADD COLUMN jd_source_id TEXT REFERENCES Source(id);
CREATE TRIGGER job_jd_scope BEFORE UPDATE OF jd_source_id ON Job WHEN NEW.jd_source_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM Source s WHERE s.id=NEW.jd_source_id AND s.workspace_id=NEW.workspace_id AND s.candidate_id=NEW.candidate_id AND s.job_id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'JD source scope mismatch'); END;
CREATE TRIGGER job_jd_scope_insert BEFORE INSERT ON Job WHEN NEW.jd_source_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM Source s WHERE s.id=NEW.jd_source_id AND s.workspace_id=NEW.workspace_id AND s.candidate_id=NEW.candidate_id AND s.job_id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'JD source scope mismatch'); END;
`;
