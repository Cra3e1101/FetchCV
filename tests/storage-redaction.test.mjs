import assert from 'node:assert/strict';
import test from 'node:test';
import { LegacyRedactor } from '../packages/storage/legacy-redaction.mjs';

test('credentials never survive in archive fields, cross-table text or URI; references do not hash secrets', () => {
  const redactor = new LegacyRedactor();
  const settings = { values_json: { apiKey: 'synthetic-secret-value', theme: 'dark' } };
  redactor.discover(settings);
  const a = redactor.redact(settings, { table: 'workspace_settings', oldId: 's' });
  const b = redactor.redact({ content: 'previous error synthetic-secret-value', uri: 'https://demo:pass123@example.test/a?token=url-secret&query=jobs' }, { table: 'agent_messages', oldId: 'm' });
  assert.equal(JSON.stringify([a, b]).includes('synthetic-secret-value'), false);
  assert.equal(JSON.stringify(b).includes('pass123'), false);
  assert.equal(JSON.stringify(b).includes('url-secret'), false);
  assert.equal(a.row.values_json.theme, 'dark');
  assert.match(b.row.uri, /query=jobs/);
  const ref = a.row.values_json.apiKey.$redacted;
  assert.match(ref, /^credential-ref:[a-f0-9-]{36}$/);
  assert.ok(b.row.content.includes(ref));
  redactor.clear();
});

test('literal redaction never rewrites generated credential references, including URL encoding', () => {
  const redactor = new LegacyRedactor({ secretValues: ['credential','a'] });
  const result = redactor.redact({ content: 'Bearer sample-private credential', url: 'https://example.test/?token=credential' }, { table: 'agent_messages', oldId: 'm' });
  const expected = new Set(result.redactions.map(row => row.reference));
  for (const text of [result.row.content, decodeURIComponent(result.row.url)]) {
    const refs = text.match(/credential-ref:[a-f0-9-]{36}/g) || [];
    assert.ok(refs.length > 0);
    assert.ok(refs.every(ref => expected.has(ref)));
    assert.equal(text.replace(/credential-ref:[a-f0-9-]{36}/g, '').includes('credential'), false);
  }
});

test('MCP launch strings are withheld for review; token metrics and ordinary material text survive', () => {
  const redactor = new LegacyRedactor();
  const result = redactor.redact({ command: 'server --auth unrecognized-value', args_json: ['--custom', 'opaque-secret'], env: { UNUSUAL: 'other' }, env_keys: ['PATH'], tool_policies: {}, token_count: 42 }, { table: 'mcp_server_configs', oldId: 'm' });
  assert.equal(JSON.stringify(result).includes('unrecognized-value'), false);
  assert.equal(JSON.stringify(result).includes('opaque-secret'), false);
  assert.equal(result.row.token_count, 42);
  assert.deepEqual(result.row.env_keys, ['PATH']);
  assert.equal(result.redactions.length, 3);
  assert.equal(redactor.redact({ content: 'Candidate prepared a statistical analysis' }, { table: 'facts', oldId: 'f' }).row.content, 'Candidate prepared a statistical analysis');
});
