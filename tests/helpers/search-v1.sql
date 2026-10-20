-- Frozen Search v1 schema from a751582 for retained-generation migration.

CREATE TABLE IF NOT EXISTS SearchGeneration(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES Workspace(id),revision TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS SearchHead(workspace_id TEXT PRIMARY KEY REFERENCES Workspace(id),generation_id TEXT NOT NULL REFERENCES SearchGeneration(id));
CREATE TABLE IF NOT EXISTS SearchChunk(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,document_id TEXT NOT NULL,block_id TEXT NOT NULL,generation_id TEXT NOT NULL REFERENCES SearchGeneration(id),
 char_start INTEGER NOT NULL,char_end INTEGER NOT NULL,text TEXT NOT NULL,text_hash TEXT NOT NULL,heading_json TEXT NOT NULL,scope_key TEXT NOT NULL,
 FOREIGN KEY(workspace_id,document_id) REFERENCES Document(workspace_id,id),FOREIGN KEY(workspace_id,block_id,document_id) REFERENCES Block(workspace_id,id,document_id));
CREATE INDEX IF NOT EXISTS search_chunk_generation ON SearchChunk(workspace_id,generation_id,document_id);
CREATE VIRTUAL TABLE IF NOT EXISTS SearchFTS USING fts5(chunk_id UNINDEXED,scope,body,tokenize='unicode61');
