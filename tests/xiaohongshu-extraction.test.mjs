import test from 'node:test';
import assert from 'node:assert/strict';
import { extractXiaohongshuNote } from '../electron/xiaohongshu-adapter.mjs';

test('image-only notes retain ordered image groups with missing description', () => {
  const image = 'https://cdn.example.com/interview.webp';
  const note = extractXiaohongshuNote({ noteDetailMap: { target: { note: {
    title: '产品面经', image_list: [{ url_default: image, info_list: [{ url: image }, null] }, null, { url: 'http://invalid/image' }],
  } } } }, 'target');
  assert.equal(note.description, '');
  assert.equal(note.imageCount, 3);
  assert.deepEqual(note.imageGroups, [[image], [], []]);
  assert.deepEqual(note.imageUrls, [image]);
});

test('malformed image metadata cannot discard an otherwise valid note', () => {
  const note = extractXiaohongshuNote({ noteId: 'target', desc: '面试问题', imageList: { length: 3 } }, 'target');
  assert.equal(note.description, '面试问题');
  assert.equal(note.imageCount, 0);
  const cyclic = { comments: { noteId: 'target', desc: '评论内容' } };
  cyclic.self = cyclic;
  assert.equal(extractXiaohongshuNote(cyclic, 'target'), null);
});
