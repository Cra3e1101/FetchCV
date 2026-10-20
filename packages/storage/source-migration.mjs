import { SOURCE_SCHEMA } from './source-schema.mjs';
import { projectionContext, utc } from './projection-context.mjs';
import { canonicalJSON } from './legacy-archive.mjs';
import { contentHash } from './blob-store.mjs';
import { assertIntegrity } from './snapshot.mjs';

export function sourceUri(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.username = ''; url.password = ''; url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(?:(?:access|refresh|auth|id)[_-]?)?token$|^(?:api[_-]?)?key$|^(?:secret|auth|signature|sig|password|cookie|sessionid|x-amz-credential|x-amz-signature|x-amz-security-token)$/i.test(key) || url.searchParams.get(key).includes('credential-ref:')) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}

export async function projectSources(db, blobs, { allowedFileRoots = [] } = {}) {
  const c = projectionContext(db);
  const counts = { sources: 0, documents: 0, blocks: 0, unresolvedFiles: 0 };
  db.exec('SAVEPOINT source_projection');
  try {
    db.exec(SOURCE_SCHEMA);
    for (const table of ['material_assets','jobs','interview_sources']) for (const row of c.rows(table)) {
      const scope = c.scope(table === 'jobs' ? { ...row, job_id: row.id } : row);
      const uri = sourceUri(row.source_url);
      const kind = table === 'jobs' ? 'job_description' : table === 'interview_sources' ? 'interview' : `material:${row.kind}`;
      const identity = contentHash(canonicalJSON([c.workspace, scope.candidate_id, scope.job_id, kind, uri || `${table}:${row.id}`]));
      let source = db.prepare('SELECT * FROM Source WHERE workspace_id=? AND identity_key=?').get(c.workspace, identity);
      if (!source) {
        source = { ...c.base(row), ...scope, kind, identity_key: identity, original_uri: uri,
          title: row.title || row.name || `${row.company} ${row.role}`, publisher: row.author ?? null, published_at: row.published_at ?? null,
          access_state: 'available', retention_json: canonicalJSON({ schemaVersion: 1, externalOriginal: 'keep' }),
          metadata_json: canonicalJSON({ schemaVersion: 1, archive: { migrationId: c.migration.id, table, id: row.id }, legacyMetadata: row.metadata_json || {} }) };
        c.insert('Source', source); counts.sources++;
      }
      c.map(table, row, 'Source', source.id);
      if (table === 'jobs') db.prepare('UPDATE Job SET jd_source_id=? WHERE workspace_id=? AND id=?').run(source.id, c.workspace, c.mapped('jobs', row.id, 'Job'));
      let text = table === 'jobs' ? row.jd_raw : table === 'interview_sources' ? row.raw_text : null;
      if (text != null && typeof text !== 'string') throw new Error('legacy captured text must be text');
      if (text?.includes('\0')) throw new Error('legacy text contains NUL; explicit parser repair required');
      if (!text) text = null;
      const capture = text !== null ? { state: 'ready', hash: await blobs.put(Buffer.from(text, 'utf8')) }
        : table === 'material_assets' && row.source_path ? await blobs.capture(row.source_path, allowedFileRoots) : { state: 'missing_file', hash: null };
      let document = capture.hash ? db.prepare('SELECT * FROM Document WHERE workspace_id=? AND source_id=? AND blob_hash=? AND state=? AND active=1').get(c.workspace, source.id, capture.hash, capture.state) : null;
      if (!document) {
        const version = db.prepare('SELECT coalesce(max(version),0)+1 AS n FROM Document WHERE source_id=?').get(source.id).n;
        db.prepare('UPDATE Document SET active=0 WHERE source_id=?').run(source.id);
        document = { ...c.base(row), source_id: source.id, version, blob_hash: capture.hash,
          text_hash: text === null ? null : capture.hash, text_blob_hash: text === null ? null : capture.hash, ir_blob_hash: null,
          parser_id: text === null ? null : 'legacy-captured-text', parser_revision: text === null ? null : '1',
          state: capture.state, captured_at: utc(row.created_at), source_updated_at: utc(row.updated_at), active: 1,
          quality_json: canonicalJSON({ schemaVersion: 1, offsetUnit: 'unicode_codepoint', textLength: text === null ? null : [...text].length, legacyText: text !== null, parserRevalidated: false }) };
        c.insert('Document', document); counts.documents++;
        if (text !== null) {
          c.insert('Block', { ...c.base(row), document_id: document.id, ordinal: 0, type: 'legacy_text', text,
            char_start: 0, char_end: [...text].length, page: null, bbox_json: null, heading_path_json: '[]',
            origin_json: canonicalJSON({ schemaVersion: 1, type: 'legacy-field', table, id: row.id, field: table === 'jobs' ? 'jd_raw' : 'raw_text' }), quality_json: '{"schemaVersion":1,"layoutKnown":false}' });
          counts.blocks++;
        }
      }
      c.map(table, row, 'Document', document.id);
      if (!capture.hash) counts.unresolvedFiles++;
      db.prepare('UPDATE Source SET access_state=? WHERE id=?').run(capture.hash ? 'available' : capture.state === 'requires_file_access' ? 'requires_file_access' : 'missing', source.id);
    }
    assertIntegrity(db);
    db.exec('RELEASE source_projection');
    return { stage: 'sources_projected', activationAllowed: false, ...counts };
  } catch (error) { db.exec('ROLLBACK TO source_projection; RELEASE source_projection'); throw error; }
}
