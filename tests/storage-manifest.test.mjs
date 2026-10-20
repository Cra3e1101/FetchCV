import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir,writeFile,readFile,readdir,rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { WorkspaceManifestWriter,readWorkspaceManifest } from '../packages/storage/workspace-manifest.mjs';

test('workspace manifest publishes atomically, fences concurrent owners and retains failure candidates', async () => {
  const root=path.join(process.env.M1_ALLOWED_DELETE_ROOT,'manifest'); await mkdir(root); await mkdir(path.join(root,'blobs'));
  const workspaceId=randomUUID(), db=new DatabaseSync(path.join(root,'v2.db'));
  db.exec('CREATE TABLE Workspace(id TEXT PRIMARY KEY,schema_version INTEGER NOT NULL)'); db.prepare('INSERT INTO Workspace VALUES (?,1)').run(workspaceId); db.close();
  const args={ workspaceId,database:'v2.db',blobRoot:'blobs',expectedGeneration:0 };
  assert.equal(await readWorkspaceManifest(root),null);
  const writer=await WorkspaceManifestWriter.acquire(root);
  try {
    await assert.rejects(WorkspaceManifestWriter.acquire(root),{ code:'workspace_writer_busy' });
    const first=await writer.publish(args); assert.equal(first.generation,1);
    await assert.rejects(writer.publish({ ...args,expectedGeneration:1 },async stage=>{ if(stage==='staged') throw Error('synthetic-before-rename'); }),/synthetic-before-rename/);
    assert.equal((await readWorkspaceManifest(root)).generation,1);
    await assert.rejects(writer.publish(args),{ code:'workspace_generation_conflict' });
    await assert.rejects(writer.publish({ ...args,expectedGeneration:1,database:'../outside.db' }),{ code:'invalid_workspace_target' });
    await assert.rejects(writer.publish({ ...args,expectedGeneration:1,workspaceId:randomUUID() }),{ code:'workspace_manifest_identity_mismatch' });
    await assert.rejects(writer.publish({ ...args,expectedGeneration:1 },async stage=>{ if(stage==='published') throw Error('synthetic-after-rename'); }),/synthetic-after-rename/);
    assert.equal((await readWorkspaceManifest(root)).generation,2,'published pointer remains authoritative despite lost success receipt');
  } finally { writer.close(); }
  const recovered=await WorkspaceManifestWriter.acquire(root); recovered.close();
  assert.ok((await readdir(root)).some(file=>file.endsWith('.staged.json')),'failed staging is retained');
  const before=await readFile(path.join(root,'v2.db'));
  const validPointer=JSON.parse(await readFile(path.join(root,'active-workspace.json'),'utf8'));
  await writeFile(path.join(root,'active-workspace.json'),JSON.stringify({...validPointer,schemaVersion:999}));
  await assert.rejects(readWorkspaceManifest(root),{code:'unsupported_workspace_manifest'});
  await rename(path.join(root,'active-workspace.json'),path.join(root,'lost-active.json'));
  await assert.rejects(readWorkspaceManifest(root),{ code:'workspace_manifest_recovery_required' });
  await writeFile(path.join(root,'active-workspace.json'),'{broken');
  await assert.rejects(readWorkspaceManifest(root),{ code:'invalid_workspace_manifest_json' });
  assert.deepEqual(await readFile(path.join(root,'v2.db')),before);
});

test('process death releases ownership and preserves the last published generation', async () => {
  for (const [point,generation] of [['staged',0],['published',0],['staged',1],['published',1]]) {
    const root=path.join(process.env.M1_ALLOWED_DELETE_ROOT,`crash-${point}-${generation}`);
    await mkdir(root); await mkdir(path.join(root,'blobs'));
    const workspaceId=randomUUID(), db=new DatabaseSync(path.join(root,'v2.db'));
    db.exec('CREATE TABLE Workspace(id TEXT PRIMARY KEY,schema_version INTEGER NOT NULL)');
    db.prepare('INSERT INTO Workspace VALUES (?,1)').run(workspaceId); db.close();
    const args={workspaceId,database:'v2.db',blobRoot:'blobs',expectedGeneration:0};
    if(generation===1) {
      const writer=await WorkspaceManifestWriter.acquire(root);
      try { await writer.publish(args); } finally { writer.close(); }
    }
    await writeFile(path.join(root,'child-input.json'),JSON.stringify({...args,expectedGeneration:generation}));
    const child=spawnSync(process.execPath,['tests/fixtures/manifest-crash.mjs',root,point],{encoding:'utf8',timeout:10000,windowsHide:true});
    assert.equal(child.status,23,child.stderr || child.error?.message);
    if(point==='staged' && generation===0) await assert.rejects(readWorkspaceManifest(root),{code:'workspace_manifest_recovery_required'});
    else assert.equal((await readWorkspaceManifest(root)).generation,point==='staged'?generation:generation+1);
    const recovered=await WorkspaceManifestWriter.acquire(root); recovered.close();
  }
});
