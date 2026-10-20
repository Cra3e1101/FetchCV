import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createBlobStore } from '../packages/storage/blob-store.mjs';

test('blobs are immutable, hash-checked, bounded and only capture granted legacy paths', async () => {
  const root = process.env.M1_ALLOWED_DELETE_ROOT; assert.ok(root);
  const dir = path.join(root, 'blob-test'); await mkdir(dir);
  const blobRoot = path.join(dir, 'blobs'), blobs = await createBlobStore(blobRoot);
  const bytes = Buffer.from('中文 😀 immutable content');
  const hash = await blobs.put(bytes);
  assert.equal(await blobs.put(bytes), hash);
  assert.deepEqual(await blobs.read(hash), bytes);
  await assert.rejects(blobs.read('../outside'), /invalid blob hash/);
  assert.deepEqual(await blobs.capture('C:\\not-granted\\secret.txt', [dir]), { state: 'requires_file_access', hash: null });
  assert.deepEqual(await blobs.capture(path.join(dir, 'missing.pdf'), [dir]), { state: 'missing_file', hash: null });
  const material = path.join(dir, 'synthetic.txt'); await writeFile(material, bytes, { flag: 'wx' });
  assert.equal((await blobs.capture(material, [dir])).hash, hash);
  assert.deepEqual(await readFile(material), bytes);
  await writeFile(path.join(blobRoot, hash), 'intentional synthetic corruption');
  await assert.rejects(blobs.read(hash), /integrity mismatch/);
  await assert.rejects(blobs.put(bytes), /integrity mismatch/);
});
