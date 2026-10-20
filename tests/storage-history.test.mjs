import test from 'node:test';
import assert from 'node:assert/strict';
import { storageFixture } from './helpers/storage-fixture.mjs';
import { projectCoreDomain } from '../packages/storage/core-migration.mjs';
import { readConversationHistory } from '../packages/storage/history-reader.mjs';

test('history adapter preserves stable paging and queue metadata, rejects foreign scopes and tombstones', async () => {
  const { db } = await storageFixture('history');
  try {
    projectCoreDomain(db);
    const c = db.prepare('SELECT * FROM Conversation').get();
    const scope = { workspaceId: c.workspace_id, candidateId: c.candidate_id, jobId: c.job_id, conversationId: c.id, limit: 2 };
    const before = db.prepare('SELECT total_changes() AS n').get().n;
    const first = readConversationHistory(db, scope);
    assert.deepEqual(first.messages.map(message => message.content.parts[0].text), ['msg_a', 'msg_b']);
    assert.equal(first.nextSequence, 2);
    const second = readConversationHistory(db, { ...scope, afterSequence: first.nextSequence });
    assert.equal(second.messages.length, 1); assert.equal(second.nextSequence, null);
    assert.equal(second.messages[0].content.legacyQueueId, 'queue_a');
    assert.equal(second.messages[0].automaticDelivery, false); assert.equal(second.replayAllowed, false);
    for (const key of ['workspaceId','candidateId','jobId']) assert.throws(() => readConversationHistory(db, { ...scope, [key]: 'other' }), { code: 'history_unavailable' });
    assert.throws(() => readConversationHistory(db, { ...scope, limit: 101 }), /invalid history page/);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before, 'all history reads are non-mutating');
    db.prepare('UPDATE Message SET deleted_at=? WHERE id=?').run('2026-09-21T00:00:00.000Z', first.messages[0].id);
    assert.deepEqual(readConversationHistory(db, scope).messages.map(message => message.sequence), [2, 3]);
    db.prepare('UPDATE Candidate SET deleted_at=? WHERE id=?').run('2026-09-21T00:00:00.000Z', c.candidate_id);
    assert.throws(() => readConversationHistory(db, scope), { code: 'history_unavailable' });
  } finally { db.close(); }
});
