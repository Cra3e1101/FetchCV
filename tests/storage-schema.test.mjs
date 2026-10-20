import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { installCoreSchema } from '../packages/storage/schema.mjs';

test('database enforces scope, immutable message revisions and one active run', () => {
  const db = new DatabaseSync(':memory:');
  try {
    installCoreSchema(db);
    for (const id of ['w1', 'w2']) db.prepare('INSERT INTO Workspace VALUES (?,?,1,?,?,?, ?,?,1,NULL)').run(id, id, '{}', 'local', 'blobs', '2026-09-21', '2026-09-21');
    for (const [id, workspace] of [['c1','w1'],['c2','w2']]) db.prepare('INSERT INTO Candidate VALUES (?,?,?, ?,?,?,?,1,NULL)').run(id, workspace, id, '{}', 'active', '2026-09-21', '2026-09-21');
    const job = db.prepare('INSERT INTO Job VALUES (?,?,?,?,?,?,?,NULL,?,?,1,NULL)');
    assert.throws(() => job.run('bad','w1','c2','Company','Role',null,'draft','2026-09-21','2026-09-21'), /FOREIGN KEY/);
    job.run('j1','w1','c1','Company','Role',null,'draft','2026-09-21','2026-09-21');
    const conv = db.prepare('INSERT INTO Conversation VALUES (?,?,?,?,?,?,NULL,?,?,1,NULL)');
    assert.throws(() => conv.run('bad','w1',null,'j1','Title','chat','2026-09-21','2026-09-21'), /CHECK/);
    conv.run('conv','w1','c1','j1','Title','chat','2026-09-21','2026-09-21');
    conv.run('other','w1','c1',null,'Title','chat','2026-09-21','2026-09-21');
    const run = db.prepare("INSERT INTO AgentRun VALUES (?, 'w1', ?, 'agent','1','pi','model',?,NULL,NULL,0,'{}','{}',NULL,'2026-09-21','2026-09-21',1,NULL)");
    run.run('r1','conv','running');
    assert.throws(() => run.run('r2','conv','waiting_approval'), /UNIQUE/);
    run.run('r2','conv','interrupted');
    run.run('r3','other','running');
    const message = db.prepare("INSERT INTO Message VALUES (?, 'w1','conv',?, 'user',?, 'hash',?, 'completed',?, ?, '2026-09-21','2026-09-21',1,NULL)");
    const content = JSON.stringify({ schemaVersion: 1, parts: [{ type: 'text', text: 'Original' }] });
    message.run('m1','r1',content,1,null,'m1');
    assert.throws(() => message.run('cross','r3',content,2,null,'cross'), /FOREIGN KEY/);
    assert.throws(() => message.run('bad-shape','r1','{}',2,null,'bad'), /CHECK/);
    assert.throws(() => db.prepare('UPDATE Message SET content_json=? WHERE id=?').run(content,'m1'), /append-only/);
    message.run('m2','r1',content,2,'m1','m1');
    assert.equal(db.prepare('SELECT count(*) AS n FROM Message').get().n, 2);
    assert.throws(() => db.exec("UPDATE Conversation SET job_id=NULL WHERE id='conv'"), /ownership is immutable/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});
