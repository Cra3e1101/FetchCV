import { DatabaseSync } from 'node:sqlite';
import { lstat, realpath, readFile, readdir, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WORKSPACE_SCHEMA_VERSION } from './schema.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = code => Object.assign(new Error(code), { code });
const inside = (root, file) => { const relative = path.relative(root,file); return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

async function existingRoot(root) {
  if (!path.isAbsolute(root)) throw fail('absolute_workspace_root_required');
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw fail('real_workspace_root_required');
  return realpath(root);
}
async function target(root, relative, directory = false) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /[:\\]/.test(relative)
    || relative.split('/').some(part => !part || part === '.' || part === '..')) throw fail('invalid_workspace_target');
  const file = path.resolve(root,relative), info = await lstat(file), resolved = await realpath(file);
  if (!inside(root,resolved) || info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw fail('invalid_workspace_target');
  return resolved;
}
async function validate(root, manifest) {
  if (!manifest || manifest.format !== 'fetchcv-workspace' || manifest.schemaVersion !== WORKSPACE_SCHEMA_VERSION
    || !UUID.test(manifest.workspaceId) || !Number.isSafeInteger(manifest.generation) || manifest.generation < 1
    || typeof manifest.commitId !== 'string' || !UUID.test(manifest.commitId)) throw fail('unsupported_workspace_manifest');
  const database = await target(root,manifest.database), blobRoot = await target(root,manifest.blobRoot,true);
  const db = new DatabaseSync(database,{ readOnly:true });
  try {
    const rows = db.prepare('SELECT id,schema_version FROM Workspace').all();
    if (rows.length !== 1 || rows[0].id !== manifest.workspaceId || rows[0].schema_version !== WORKSPACE_SCHEMA_VERSION) throw fail('workspace_manifest_identity_mismatch');
  } finally { db.close(); }
  return { ...manifest,databasePath:database,blobRootPath:blobRoot };
}
export async function readWorkspaceManifest(root) {
  root = await existingRoot(root);
  const file = path.join(root,'active-workspace.json');
  let info;
  try { info = await lstat(file); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if ((await readdir(root)).some(name => /^manifest-[a-f0-9-]{36}(?:\.staged)?\.json$/i.test(name)))
      throw fail('workspace_manifest_recovery_required');
    return null;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw fail('invalid_workspace_manifest_file');
  let manifest;
  try { manifest = JSON.parse(await readFile(file,'utf8')); } catch { throw fail('invalid_workspace_manifest_json'); }
  // A corrupt/unsupported pointer is an error, never an implicit fallback to V1.
  return validate(root,manifest);
}

// Cooperative APP ownership. The separate SQLite lock is released by the OS
// on process death; it does not prevent unrelated software opening business DBs.
// Production activation still requires stopping the old writer and all M4 gates.
export class WorkspaceManifestWriter {
  #root; #lock; #publishing = false;
  constructor(root,lock) { this.#root=root; this.#lock=lock; }
  static async acquire(root) {
    root = await existingRoot(root);
    const file = path.join(root,'workspace-writer-lock.db');
    try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw fail('invalid_workspace_lock'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const lock = new DatabaseSync(file,{ timeout:0 });
    try { lock.exec('BEGIN IMMEDIATE'); }
    catch (error) { lock.close(); if (error.errcode === 5 || error.errcode === 6) throw fail('workspace_writer_busy'); throw error; }
    return new WorkspaceManifestWriter(root,lock);
  }
  async publish({ workspaceId,database,blobRoot,expectedGeneration }, checkpoint = async () => {}) {
    if (!this.#lock || this.#publishing) throw fail('workspace_writer_unavailable');
    if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) throw fail('invalid_expected_generation');
    this.#publishing=true;
    try {
      const previous = await readWorkspaceManifest(this.#root);
      if ((previous?.generation ?? 0) !== expectedGeneration) throw fail('workspace_generation_conflict');
      const next = { format:'fetchcv-workspace',schemaVersion:WORKSPACE_SCHEMA_VERSION,workspaceId,database,blobRoot,
        generation:expectedGeneration+1,commitId:randomUUID(),previousCommitId:previous?.commitId ?? null,createdAt:new Date().toISOString() };
      await validate(this.#root,next);
      const bytes = Buffer.from(JSON.stringify(next,null,2));
      // Both files are new and retained. History is a recovery candidate, not
      // evidence that publish succeeded; only active-workspace.json is authority.
      const stage = path.join(this.#root,`manifest-${next.commitId}.staged.json`);
      const history = path.join(this.#root,`manifest-${next.commitId}.json`);
      for (const file of [history,stage]) {
        const handle = await open(file,'wx');
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      }
      await checkpoint('staged');
      await rename(stage,path.join(this.#root,'active-workspace.json'));
      await checkpoint('published');
      const actual = await readWorkspaceManifest(this.#root);
      if (actual?.commitId !== next.commitId) throw fail('workspace_publish_verification_failed');
      return actual;
    } finally { this.#publishing=false; }
  }
  close() {
    if (this.#publishing) throw fail('workspace_publish_in_progress');
    if (this.#lock) { this.#lock.close(); this.#lock=null; }
  }
}
