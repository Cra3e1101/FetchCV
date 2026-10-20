import { DatabaseSync } from 'node:sqlite';
import { lstat,realpath,readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { contentHash } from './blob-store.mjs';
import { canonicalJSON } from './legacy-archive.mjs';
import { assertIntegrity } from './snapshot.mjs';
import { WORKSPACE_SCHEMA_VERSION } from './schema.mjs';

const quote=name=>`"${name.replaceAll('"','""')}"`;
const requireValid=(condition)=>{ if(!condition) throw new Error('invalid recovery bundle'); };
async function fileBytes(root,relative) {
  const file=path.join(root,relative),info=await lstat(file);
  requireValid(info.isFile() && !info.isSymbolicLink());
  return readFile(file);
}
// Verifies internal consistency, not authorship/authenticity. Keep the bundle
// under the host recovery access policy; it can contain private user content.
export async function verifyWorkspaceExport({directory,workspaceId}) {
  requireValid(path.isAbsolute(directory));
  for(const file of [directory,path.join(directory,'tables'),path.join(directory,'blobs')]) {
    const info=await lstat(file); requireValid(info.isDirectory() && !info.isSymbolicLink());
  }
  const root=await realpath(directory);
  const receipt=JSON.parse((await fileBytes(root,'bundle.json')).toString('utf8'));
  requireValid(receipt.format==='fetchcv-protected-recovery' && receipt.version===1
    && receipt.schemaVersion===WORKSPACE_SCHEMA_VERSION && receipt.workspaceId===workspaceId && Array.isArray(receipt.files));
  const inventory=new Map();
  for(const file of receipt.files) {
    requireValid(file && typeof file.path==='string' && /^(workspace\.db|tables\/[0-9]+\.jsonl|blobs\/[a-f0-9]{64})$/.test(file.path)
      && /^[a-f0-9]{64}$/.test(file.sha256) && !inventory.has(file.path));
    requireValid(contentHash(await fileBytes(root,file.path))===file.sha256);
    inventory.set(file.path,file);
  }
  requireValid(inventory.has('workspace.db'));
  // A mutable WAL companion would make the hashed main file non-authoritative.
  for(const suffix of ['-wal','-journal']) {
    try {
      const info=await lstat(path.join(root,`workspace.db${suffix}`));
      requireValid(info.isFile() && !info.isSymbolicLink() && info.size===0);
    }
    catch(error) { if(error.code!=='ENOENT') throw error; }
  }
  const db=new DatabaseSync(path.join(root,'workspace.db'),{readOnly:true});
  const expected=new Set(['workspace.db']);
  try {
    assertIntegrity(db);
    const workspaces=db.prepare('SELECT id,schema_version FROM Workspace').all();
    requireValid(workspaces.length===1 && workspaces[0].id===workspaceId && workspaces[0].schema_version===WORKSPACE_SCHEMA_VERSION);
    const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
    requireValid(receipt.counts && Object.keys(receipt.counts).length===tables.length);
    for(const [index,table] of tables.entries()) {
      const relative=`tables/${index}.jsonl`,file=inventory.get(relative),hash=createHash('sha256');
      let count=0;
      const rows=db.prepare(`SELECT * FROM ${quote(table)}`); rows.setReadBigInts(true);
      for(const row of rows.iterate()) {
        hash.update(`${canonicalJSON(row)}\n`); count++;
        const columns={Document:['blob_hash','text_blob_hash','ir_blob_hash'],ArtifactVersion:['blob_hash'],SkillSnapshot:['body_blob_hash']}[table] ?? [];
        for(const column of columns) if(row[column]!=null) requireValid(inventory.has(`blobs/${row[column]}`));
      }
      requireValid(file?.table===table && file.rows===count && receipt.counts[table]===count && file.sha256===hash.digest('hex'));
      expected.add(relative);
    }
    for(const name of await readdir(path.join(root,'blobs'))) {
      const relative=`blobs/${name}`,file=inventory.get(relative);
      requireValid(/^[a-f0-9]{64}$/.test(name) && file?.sha256===name); expected.add(relative);
    }
    requireValid(inventory.size===expected.size && [...inventory.keys()].every(name=>expected.has(name)));
    requireValid((await readdir(path.join(root,'tables'))).length===tables.length);
    return {valid:true,workspaceId,tableCount:tables.length,fileCount:inventory.size,v1ImportSupported:false};
  } finally {db.close();}
}
