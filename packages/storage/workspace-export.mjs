import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, lstat, realpath, readFile, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { assertIntegrity } from './snapshot.mjs';
import { BlobStore, contentHash } from './blob-store.mjs';
import { canonicalJSON } from './legacy-archive.mjs';
import { WORKSPACE_SCHEMA_VERSION } from './schema.mjs';

const quote = name => `"${name.replaceAll('"','""')}"`;
async function realDirectory(root) {
  if (!path.isAbsolute(root)) throw new Error('absolute export directory required');
  const info=await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('real export directory required');
  return realpath(root);
}
async function save(file,bytes) {
  const handle=await open(file,'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
const BLOB_COLUMNS = { Document:['blob_hash','text_blob_hash','ir_blob_hash'],ArtifactVersion:['blob_hash'],SkillSnapshot:['body_blob_hash'] };

// Protected recovery bundle, not a public/redacted export or V1 import file.
// The caller must hold APP writer ownership and keep immutable blobs available.
// This captures all V2 data, including post-cutover writes; it never rewrites V1.
export async function exportWorkspace({ database,blobRoot,recoveryRoot,name,workspaceId }) {
  if (!path.isAbsolute(database) || !/^[a-zA-Z0-9_-]{1,100}$/.test(name)) throw new Error('invalid export path');
  const info=await lstat(database);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('regular workspace database required');
  const root=await realDirectory(recoveryRoot), blobs=await realDirectory(blobRoot);
  const dir=path.join(root,name); await mkdir(dir); // Never reuse partial exports.
  const source=new DatabaseSync(database,{readOnly:true,timeout:5000});
  const dbPath=path.join(dir,'workspace.db');
  let snapshot;
  try {
    await backup(source,dbPath);
    snapshot=new DatabaseSync(dbPath,{readOnly:true}); assertIntegrity(snapshot);
    const workspaces=snapshot.prepare('SELECT id,schema_version FROM Workspace').all();
    if (workspaces.length!==1 || workspaces[0].id!==workspaceId || workspaces[0].schema_version!==WORKSPACE_SCHEMA_VERSION)
      throw new Error('export workspace identity mismatch');
    const tables=snapshot.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
    const files=[], counts={}, requiredBlobs=new Set();
    await mkdir(path.join(dir,'tables')); await mkdir(path.join(dir,'blobs'));
    for (const [index,table] of tables.entries()) {
      const relative=`tables/${index}.jsonl`, handle=await open(path.join(dir,relative),'wx');
      let count=0;
      try {
        const rows=snapshot.prepare(`SELECT * FROM ${quote(table)}`); rows.setReadBigInts(true);
        for (const row of rows.iterate()) {
          for (const column of BLOB_COLUMNS[table] ?? []) {
            if (row[column]!=null) requiredBlobs.add(row[column]);
          }
          await handle.writeFile(`${canonicalJSON(row)}\n`); count++;
        }
        await handle.sync();
      } finally { await handle.close(); }
      counts[table]=count;
      files.push({path:relative,table,rows:count,sha256:contentHash(await readFile(path.join(dir,relative)))});
    }
    // Include unreferenced immutable objects too: interrupted new writes may
    // have persisted a blob before the transaction that references it.
    const names=await readdir(blobs), sourceBlobs=new BlobStore(blobs);
    for (const hash of requiredBlobs) if (!names.includes(hash)) throw new Error('export referenced blob missing');
    for (const hash of names.sort()) {
      const bytes=await sourceBlobs.read(hash); // Reject foreign names/links/corruption.
      await save(path.join(dir,'blobs',hash),bytes);
      files.push({path:`blobs/${hash}`,sha256:hash,bytes:bytes.length});
    }
    snapshot.close(); snapshot=null;
    files.push({path:'workspace.db',sha256:contentHash(await readFile(dbPath))});
    const result={format:'fetchcv-protected-recovery',version:1,workspaceId,schemaVersion:WORKSPACE_SCHEMA_VERSION,createdAt:new Date().toISOString(),
      counts,files,credentials:'separate_account_bound_vault_required',v1ImportSupported:false,containsPrivateData:true};
    // Completion receipt is written last. An interrupted directory is retained
    // but cannot be presented as a completed recovery bundle.
    await save(path.join(dir,'bundle.json'),JSON.stringify(result,null,2));
    return {directory:dir,...result};
  } finally { snapshot?.close(); source.close(); }
}
