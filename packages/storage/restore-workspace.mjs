import {mkdir,lstat,realpath,readFile,open,rename} from 'node:fs/promises';
import path from 'node:path';
import {verifyWorkspaceExport} from './verify-workspace-export.mjs';
import {contentHash} from './blob-store.mjs';
import {WorkspaceManifestWriter} from './workspace-manifest.mjs';

// Restore into a new V2 workspace, never into the old V1 database or over an
// existing workspace. The original bundle/vault and failed copies are retained.
export async function restoreWorkspace({bundleRoot,destinationRoot,name,workspaceId}) {
  await verifyWorkspaceExport({directory:bundleRoot,workspaceId});
  if(!path.isAbsolute(destinationRoot) || !/^[a-zA-Z0-9_-]{1,100}$/.test(name)) throw new Error('invalid restore destination');
  const info=await lstat(destinationRoot);
  if(!info.isDirectory() || info.isSymbolicLink()) throw new Error('real restore root required');
  const root=path.join(await realpath(destinationRoot),name);await mkdir(root);
  const manifestBytes=await readFile(path.join(bundleRoot,'bundle.json')),manifest=JSON.parse(manifestBytes);
  await mkdir(path.join(root,'tables'));await mkdir(path.join(root,'blobs'));
  for(const file of manifest.files) {
    // Re-check bytes at copy time, and never let a changed receipt introduce a
    // path outside the explicitly allowed bundle structure.
    if(!/^(workspace\.db|tables\/[0-9]+\.jsonl|blobs\/[a-f0-9]{64})$/.test(file.path)) throw new Error('invalid restore file');
    const source=path.join(bundleRoot,file.path),stat=await lstat(source);
    if(!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid restore source');
    const bytes=await readFile(source);
    if(contentHash(bytes)!==file.sha256) throw new Error('restore source changed');
    const handle=await open(path.join(root,file.path),'wx');
    try {await handle.writeFile(bytes);await handle.sync();} finally {await handle.close();}
  }
  const handle=await open(path.join(root,'bundle.json'),'wx');
  try {await handle.writeFile(manifestBytes);await handle.sync();} finally {await handle.close();}
  await verifyWorkspaceExport({directory:root,workspaceId});
  // This copy will become writable. Its original export receipt is provenance,
  // not a claim that future workspace bytes still match that immutable bundle.
  await rename(path.join(root,'bundle.json'),path.join(root,'restore-source-bundle.json'));
  const owner=await WorkspaceManifestWriter.acquire(root);
  try {await owner.publish({workspaceId,database:'workspace.db',blobRoot:'blobs',expectedGeneration:0});} finally {owner.close();}
  return {root,workspaceId,restored:true,v1Modified:false,credentials:'separate_account_bound_vault_required'};
}
