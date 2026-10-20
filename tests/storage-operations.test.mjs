import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { storageFixture } from './helpers/storage-fixture.mjs';
import { projectCoreDomain } from '../packages/storage/core-migration.mjs';
import { projectSources } from '../packages/storage/source-migration.mjs';
import { projectContent } from '../packages/storage/content-migration.mjs';
import { projectOperations } from '../packages/storage/operation-migration.mjs';
import { projectConfiguration } from '../packages/storage/config-migration.mjs';
import { createBlobStore } from '../packages/storage/blob-store.mjs';
import { claimIngest, completeIngest } from '../packages/storage/ingest-lease.mjs';

test('historical operations never replay, approvals expire, configuration stays untrusted and leases fence late workers', async () => {
  const { db, dir, report } = await storageFixture('operations-valid', legacy => {
    legacy.exec("INSERT INTO approvals(id,run_id,action_type,target_type,target_id,status,decision_payload,created_at,updated_at) VALUES('approval_bound','run_a','write','tool_action','synthetic-operation','approved','{}','2026-09-21','2026-09-21')");
  });
  try {
    projectCoreDomain(db); const blobs = await createBlobStore(path.join(dir, 'blobs'));
    await projectSources(db, blobs); projectContent(db); const operations = projectOperations(db);
    const config = await projectConfiguration(db, blobs);
    assert.equal(operations.historicalIssues, 1);
    const tool = db.prepare('SELECT * FROM ToolCall').get();
    assert.equal(tool.state, 'unknown'); assert.equal(tool.receipt_hash, null);
    assert.throws(() => db.prepare("UPDATE ToolCall SET state='running' WHERE id=?").run(tool.id), /cannot be replayed/);
    const approval = db.prepare('SELECT * FROM Approval').get(); assert.equal(approval.decision, 'expired');
    assert.throws(() => db.prepare("UPDATE Approval SET decision='approved' WHERE id=?").run(approval.id), /cannot authorize/);
    assert.equal(db.prepare('SELECT state FROM AgentRun').get().state, 'interrupted');
    const mcp = db.prepare('SELECT * FROM McpServer').get();
    assert.equal(mcp.state, 'requires_review'); assert.equal(JSON.parse(mcp.launch_json).executable, false);
    assert.deepEqual(JSON.parse(mcp.tool_policies_json), {});
    assert.equal(db.prepare('SELECT enabled FROM SkillSnapshot').get().enabled, 0);
    assert.equal(config.unavailableSkills, 1); assert.equal(config.credentialsInstalled, false);
    assert.equal(JSON.parse(db.prepare('SELECT value_json FROM Setting').get().value_json).theme, 'dark');
    assert.equal(db.prepare('SELECT value_json FROM Setting').get().value_json.includes('fixture-provider-secret'), false);
    const source = db.prepare("SELECT * FROM Source WHERE kind='job_description'").get();
    db.prepare("INSERT INTO IngestJob VALUES ('ingest',?,?,NULL,'parse','pending',0,NULL,NULL,1,'hash','parser1',NULL,?,?,1,NULL)").run(report.workspaceId, source.id, '2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z');
    const common = { workspaceId: report.workspaceId, jobId: 'ingest', sourceRevision: 1 };
    const first = claimIngest(db, { ...common, owner: 'worker1', now: '2026-09-21T00:00:00.000Z', leaseUntil: '2026-09-21T00:01:00.000Z' });
    assert.equal(first.attempt, 1);
    assert.equal(claimIngest(db, { ...common, owner: 'worker2', now: '2026-09-21T00:00:30.000Z', leaseUntil: '2026-09-21T00:02:00.000Z' }), null);
    const second = claimIngest(db, { ...common, owner: 'worker2', now: '2026-09-21T00:01:01.000Z', leaseUntil: '2026-09-21T00:03:00.000Z' });
    assert.equal(second.attempt, 2);
    assert.equal(completeIngest(db, { ...common, owner: 'worker1', attempt: 1, now: '2026-09-21T00:01:30.000Z' }), false);
    db.prepare('UPDATE Source SET revision=2 WHERE id=?').run(source.id);
    assert.equal(completeIngest(db, { ...common, owner: 'worker2', attempt: 2, now: '2026-09-21T00:01:30.000Z' }), false);
    db.prepare("INSERT INTO IngestJob VALUES ('ingest2',?,?,NULL,'parse','pending',0,NULL,NULL,2,'hash','parser2',NULL,?,?,1,NULL)").run(report.workspaceId, source.id, '2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z');
    const next = { ...common, jobId: 'ingest2', sourceRevision: 2, owner: 'worker3' };
    assert.equal(claimIngest(db, { ...next, now: '2026-09-21T08:00:00+08:00', leaseUntil: '2026-09-21T08:01:00+08:00' }).lease_until, '2026-09-21T00:01:00.000Z');
    assert.equal(completeIngest(db, { ...next, attempt: 1, now: '2026-09-21T00:00:30Z' }), true);
    assert.equal(completeIngest(db, { ...next, attempt: 1, now: '2026-09-21T00:00:31Z' }), false);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});
