import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { storageFixture } from './helpers/storage-fixture.mjs';
import { projectCoreDomain } from '../packages/storage/core-migration.mjs';
import { projectSources, sourceUri } from '../packages/storage/source-migration.mjs';
import { createBlobStore } from '../packages/storage/blob-store.mjs';
import { readDocumentText } from '../packages/storage/document-reader.mjs';

test('source migration captures originals, separates same-URI scopes and provides immutable Unicode locators', async () => {
  let original;
  const { db, report, dir } = await storageFixture('sources-valid', async (legacy, fixtureDir) => {
    original = path.join(fixtureDir, 'synthetic-file.txt'); await writeFile(original, 'synthetic material', { flag: 'wx' });
    legacy.prepare('UPDATE material_assets SET source_path=?').run(original);
    legacy.prepare('UPDATE jobs SET jd_raw=?,source_url=?').run('中文😀SQL', 'https://example.test/job?token=fixture-query-secret&q=SQL');
    legacy.exec("INSERT INTO jobs(id,candidate_id,company,role,source_type,status,created_at,updated_at,source_url,jd_raw) VALUES('job_b','cand_b','Other','Analyst','manual','draft','2026-09-21','2026-09-21','https://example.test/job?q=SQL','Other scoped JD')");
  });
  try {
    projectCoreDomain(db);
    const blobs = await createBlobStore(path.join(dir, 'blobs'));
    const result = await projectSources(db, blobs, { allowedFileRoots: [dir] });
    assert.equal(result.sources, 4); assert.equal(result.documents, 4); assert.equal(result.unresolvedFiles, 0);
    assert.equal(await readFile(original, 'utf8'), 'synthetic material');
    const docs = db.prepare("SELECT d.*,s.candidate_id,s.job_id,s.original_uri FROM Document d JOIN Source s ON s.id=d.source_id WHERE s.kind='job_description'").all();
    assert.equal(docs.length, 2); assert.notEqual(docs[0].source_id, docs[1].source_id);
    assert.equal(docs[0].original_uri, docs[1].original_uri);
    const own = docs.find(row => JSON.parse(row.quality_json).textLength === 6);
    const options = { workspaceId: report.workspaceId, candidateId: own.candidate_id, jobId: own.job_id, documentId: own.id, expectedHash: own.blob_hash, start: 2, end: 3 };
    assert.equal((await readDocumentText(db, blobs, options)).text, '😀');
    for(const [table,id] of [['Workspace',report.workspaceId],['Candidate',own.candidate_id],['Job',own.job_id],['Source',own.source_id],['Document',own.id]]) {
      db.prepare(`UPDATE ${table} SET deleted_at=? WHERE id=?`).run('2026-09-21T00:00:00Z',id);
      await assert.rejects(readDocumentText(db, blobs, options),{code:'document_unavailable'});
      db.prepare(`UPDATE ${table} SET deleted_at=NULL WHERE id=?`).run(id);
      assert.equal((await readDocumentText(db, blobs, options)).text,'😀');
    }
    await assert.rejects(readDocumentText(db, blobs, { ...options, candidateId: 'foreign' }), { code: 'document_unavailable' });
    await assert.rejects(readDocumentText(db, blobs, { ...options, expectedHash: 'stale' }), { code: 'document_revision_mismatch' });
    assert.throws(() => db.prepare('UPDATE Document SET blob_hash=? WHERE id=?').run('other', own.id), /immutable/);
    assert.throws(() => db.prepare('UPDATE Block SET text=? WHERE document_id=?').run('replace', own.id), /immutable/);
    db.prepare("UPDATE Source SET access_state='revoked' WHERE id=?").run(own.source_id);
    await assert.rejects(readDocumentText(db, blobs, options), { code: 'document_unavailable' });
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('missing and ungranted materials are not fabricated as parsed documents', async () => {
  const { db, dir } = await storageFixture('sources-missing');
  try {
    projectCoreDomain(db); const blobs = await createBlobStore(path.join(dir, 'blobs'));
    const result = await projectSources(db, blobs);
    assert.equal(result.unresolvedFiles, 1);
    const row = db.prepare("SELECT * FROM Document WHERE state='missing_file'").get();
    assert.equal(row.blob_hash, null); assert.equal(row.text_hash, null);
    assert.equal(db.prepare('SELECT count(*) AS n FROM Block WHERE document_id=?').get(row.id).n, 0);
  } finally { db.close(); }
});

test('URI identity keeps meaningful query parameters and strips credential material', () => {
  assert.equal(sourceUri('https://u:p@example.test/jobs?keywords=SQL&token=private#fragment'), 'https://example.test/jobs?keywords=SQL');
});

test('long Unicode documents page without truncation or splitting surrogate pairs',async()=>{
  const text='中'.repeat(99999)+'😀末页';
  const {db,dir,report}=await storageFixture('long-document',legacy=>legacy.prepare('UPDATE jobs SET jd_raw=?').run(text));
  try {
    projectCoreDomain(db);const blobs=await createBlobStore(path.join(dir,'blobs'));await projectSources(db,blobs);
    const row=db.prepare("SELECT d.id,s.candidate_id,s.job_id FROM Document d JOIN Source s ON s.id=d.source_id WHERE s.kind='job_description'").get();
    const scope={workspaceId:report.workspaceId,candidateId:row.candidate_id,jobId:row.job_id,documentId:row.id};
    const first=await readDocumentText(db,blobs,scope),last=await readDocumentText(db,blobs,{...scope,start:first.nextStart});
    assert.equal(first.nextStart,100000);assert.equal(first.totalCharacters,100002);assert.equal(last.nextStart,null);
    assert.equal(first.text+last.text,text);assert.equal(first.text.endsWith('😀'),true);assert.equal(last.text,'末页');
    await assert.rejects(readDocumentText(db,blobs,{...scope,end:100001}),/invalid or excessive text range/);
  } finally {db.close();}
});
