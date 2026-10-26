import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationSessions} from '../src/lib/conversation-session.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; };
function fixture() {
  const chats = new Map(['a', 'b'].map(id => [id, {id, title: id, messages: []}]));
  const streams = [];
  const api = {
    conversation: async id => structuredClone(chats.get(id)),
    createConversation: async () => {const chat = {id: 'created', messages: []}; chats.set(chat.id, chat); return structuredClone(chat);},
    streamConversation(id, content, options) {
      const pending = deferred(); streams.push({id, options, ...pending});
      const message = {id: `user-${streams.length}`, role: 'user', content};
      chats.get(id).messages.push(message); options.onEvent('user', {message});
      options.signal.addEventListener('abort', () => pending.reject(Object.assign(new Error('cancelled'), {name: 'AbortError'})));
      return pending.promise;
    },
  };
  const registry = createConversationSessions(api);
  const finish = (index, content) => {
    const stream = streams[index], assistant = {id: `answer-${index}`, role: 'assistant', content, metadata_json: {processing_status: 'completed'}};
    chats.get(stream.id).messages.push(assistant); stream.options.onEvent('done', {assistant}); stream.resolve();
  };
  return {api, registry, streams, finish};
}

test('detaching and returning retains a live turn, receipts and a single request', async () => {
  const {registry, streams, finish} = fixture();
  const session = registry.get('a', 'a'); await session.load();
  const detach = session.subscribe(() => {});
  const run = session.send('first'); detach();
  assert.equal(streams[0].options.signal.aborted, false);
  streams[0].options.onEvent('tool_receipt', {receipt: {tool_call_id: 'read', status: 'running', activity: {kind: 'url', href: 'https://example.org/page'}}});
  const returned = registry.get('a', 'a'); await returned.load();
  assert.equal(returned, session); assert.equal(returned.getSnapshot().busy, true);
  assert.equal(returned.getSnapshot().messages.at(-1).metadata_json.tool_receipts.length, 1);
  returned.send('duplicate'); assert.equal(streams.length, 1);
  finish(0, 'finished while detached'); await run;
  assert.equal(session.getSnapshot().busy, false);
  assert.deepEqual(session.getSnapshot().messages.map(row => row.content), ['first', 'finished while detached']);
  streams[0].options.onEvent('delta', {text: 'late'});
  assert.equal(session.getSnapshot().messages.at(-1).content, 'finished while detached');
});

test('concurrent conversations remain isolated and explicit stop only cancels its own turn', async () => {
  const {registry, streams, finish} = fixture();
  const a = registry.get('a', 'a'), b = registry.get('b', 'b'); await Promise.all([a.load(), b.load()]);
  const first = a.send('question a'), second = b.send('question b');
  a.cancel(); await first;
  assert.equal(a.getSnapshot().messages.at(-1).metadata_json.processing_status, 'cancelled');
  assert.equal(streams[1].options.signal.aborted, false);
  assert.equal(b.getSnapshot().busy, true);
  finish(1, 'answer b'); await second;
  assert.deepEqual(b.getSnapshot().messages.map(row => row.content), ['question b', 'answer b']);
});

test('context telemetry follows its conversation and ignores late stream updates', async () => {
  const {registry, streams, finish} = fixture();
  const a = registry.get('a', 'a'), b = registry.get('b', 'b');
  await Promise.all([a.load(), b.load()]);
  const first = a.send('a'), second = b.send('b');
  const usage = {version: 1, model: 'test', used_tokens: 1200, source: 'estimated'};
  streams[0].options.onEvent('context_usage', {usage});
  assert.deepEqual(a.getSnapshot().messages.at(-1).metadata_json.context_usage, usage);
  assert.equal(b.getSnapshot().messages.at(-1).metadata_json.context_usage, undefined);
  finish(0, 'done a'); await first;
  streams[0].options.onEvent('context_usage', {usage: {...usage, used_tokens: 9999}});
  assert.equal(a.getSnapshot().messages.at(-1).metadata_json.context_usage, undefined);
  finish(1, 'done b'); await second;
});

test('a new draft continues creating and streaming offscreen, then reopens by persisted ID', async () => {
  const {registry, streams, api, finish} = fixture();
  const create = deferred(), original = api.createConversation;
  api.createConversation = () => create.promise;
  const draft = registry.get('draft-key');
  const unsubscribe = draft.subscribe(() => {});
  const run = draft.send('new question'); unsubscribe();
  create.resolve(await original());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(streams.length, 1);
  assert.equal(registry.get('created', 'created'), draft);
  finish(0, 'new answer'); await run;
  assert.equal(draft.getSnapshot().messages.length, 2);
});

test('late history reads cannot erase an in-flight reply', async () => {
  const {api, registry, finish} = fixture();
  const session = registry.get('a', 'a'); await session.load();
  const read = deferred(), original = api.conversation;
  api.conversation = () => read.promise;
  const load = session.load(), run = session.send('new question');
  read.resolve({id: 'a', messages: []}); await load;
  assert.equal(session.getSnapshot().messages[0].content, 'new question');
  assert.equal(session.getSnapshot().busy, true);
  api.conversation = original;
  finish(0, 'new answer'); await run;
});

test('deleting a running conversation settles cancellation before releasing its session', async () => {
  const {registry, streams} = fixture();
  const old = registry.get('a', 'a'); await old.load(); old.send('question');
  await registry.remove('a');
  assert.equal(streams[0].options.signal.aborted, true);
  assert.equal(old.getSnapshot().busy, false);
  assert.notEqual(registry.get('a', 'a'), old);
});
