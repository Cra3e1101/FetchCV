import { createHash } from 'node:crypto';
import { lstat, realpath, open, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const contentHash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => { const relative = path.relative(root, file); return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };
export class BlobStore {
  #root;
  constructor(root) { if (!path.isAbsolute(root)) throw new Error('absolute blob root required'); this.#root = root; }
  async #file(hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid blob hash');
    const info = await lstat(this.#root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('real blob directory required');
    return path.join(await realpath(this.#root), hash);
  }
  async put(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 50 * 1024 * 1024) throw new Error('blob must be bytes, at most 50 MiB');
    const hash = contentHash(bytes), file = await this.#file(hash);
    let handle;
    try {
      handle = await open(file, 'wx');
      await handle.writeFile(bytes); await handle.sync();
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await this.read(hash); // Existing corrupt/link targets must never be reused.
    } finally { await handle?.close(); }
    return hash;
  }
  async read(hash) {
    const file = await this.#file(hash), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 50 * 1024 * 1024) throw new Error('invalid blob object');
    const bytes = await readFile(file);
    if (contentHash(bytes) !== hash) throw new Error('blob integrity mismatch');
    return bytes;
  }
  async capture(file, allowedRoots) {
    if (!path.isAbsolute(file)) return { state: 'requires_file_access', hash: null };
    // Do not stat/read arbitrary legacy paths before checking host-granted roots.
    const roots = await Promise.all(allowedRoots.map(root => realpath(root)));
    const absolute = path.resolve(file);
    if (!roots.some(root => inside(root, absolute))) return { state: 'requires_file_access', hash: null };
    let resolved;
    try { resolved = await realpath(absolute); }
    catch (error) { if (error.code === 'ENOENT') return { state: 'missing_file', hash: null }; throw error; }
    if (!roots.some(root => inside(root, resolved))) throw new Error('legacy file escapes granted roots');
    const info = await lstat(resolved);
    if (!info.isFile() || info.size > 50 * 1024 * 1024) throw new Error('invalid legacy material');
    return { state: 'captured', hash: await this.put(await readFile(resolved)) };
  }
}
export async function createBlobStore(root) { await mkdir(root); return new BlobStore(root); }
