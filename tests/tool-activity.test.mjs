import test from 'node:test';
import assert from 'node:assert/strict';
import {activityUrl, receiptActivity, toolActivity} from '../shared/tool-activity.mjs';

test('activity exposes only known operation targets, not raw args or page content', () => {
  assert.deepEqual(toolActivity('search_web', {query: '大学 校史', headers: {Authorization: 'secret'}}), {kind: 'search', text: '大学 校史'});
  assert.deepEqual(toolActivity('read_workspace_file', {path: 'notes/report.md', body: 'secret'}), {kind: 'file', text: 'notes/report.md'});
  assert.equal(toolActivity('unknown_tool', {prompt: 'private', url: 'https://example.org'}), null);
  assert.equal(toolActivity('read_web_page', {url: 'javascript:alert(1)'}), null);
  assert.equal(receiptActivity({tool_name: 'search_web', summary: 'unstructured result'}), null);
});

test('web targets retain real paths while removing credentials and sensitive URL parameters', () => {
  const href = activityUrl('https://user:password@example.org/history/page?id=42&token=secret&api_key=secret#access_token=secret');
  assert.equal(href, 'https://example.org/history/page?id=42');
  assert.deepEqual(toolActivity('read_web_page', {url: href}), {kind: 'url', text: href, href});
  assert.equal(activityUrl('file:///private'), '');
  assert.equal(activityUrl('data:text/html,unsafe'), '');
  assert.equal(receiptActivity({activity: {kind: 'url', text: 'Click me', href: 'javascript:alert(1)'}}), null);
});

test('browser reads and old saved receipts use their recorded source URL', () => {
  const href = 'https://example.org/leadership';
  assert.equal(toolActivity('read_browser_page', {}, {data: {url: href, text: 'page body'}}).href, href);
  assert.equal(receiptActivity({tool_name: 'read_web_page', artifacts: [`url:${href}`]}).href, href);
});
