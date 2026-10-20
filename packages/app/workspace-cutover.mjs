import {DatabaseSync} from 'node:sqlite';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {prepareWorkspaceCopy} from '../storage/prepare-workspace.mjs';
import {WorkspaceManifestWriter} from '../storage/workspace-manifest.mjs';
import {contentHash} from '../storage/blob-store.mjs';
import {ContractError} from '../contracts/runtime.mjs';

// Host-only orchestration; never exposed as a renderer RPC. The host must stop
// its old writer and hold a verified lease until publication finishes. A review
// is bound to THIS final copy, not to a previous dry run. No automatic restart,
// fallback, deletion, or rollback after a possibly committed publication.
export async function cutoverWorkspace({acquireSourceLease,reviewFinalCopy,checkpoint=async()=>{},...preparation}) {
  if(typeof acquireSourceLease!=='function' || typeof reviewFinalCopy!=='function')throw new ContractError('cutover_host_required');
  const lease=await acquireSourceLease(preparation.source);
  if(typeof lease?.verify!=='function' || typeof lease?.release!=='function')throw new ContractError('source_lease_required');
  let owner;
  const verify=async()=>{if(await lease.verify()!==true)throw new ContractError('legacy_writer_not_stopped');};
  try{
    await verify();await checkpoint('writer-stopped');
    const copy=await prepareWorkspaceCopy(preparation);
    await verify();await checkpoint('final-copy-validated');
    const root=path.dirname(copy.archivePath);
    owner=await WorkspaceManifestWriter.acquire(root);
    const db=new DatabaseSync(copy.archivePath,{readOnly:true});let workspaceId;
    try{workspaceId=db.prepare('SELECT id FROM Workspace').get().id;}finally{db.close();}
    const decision=await reviewFinalCopy({copy,root,workspaceId});
    if(decision?.approved!==true || typeof decision.reviewId!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(decision.reviewId))throw new ContractError('final_copy_review_required');
    const review={version:1,workspaceId,reviewId:decision.reviewId,projectionHash:contentHash(JSON.stringify(copy)),
      reviewedAt:new Date().toISOString(),originalModified:false,authority:'active-workspace.json only; this review is not publication proof'};
    const handle=await open(path.join(root,'cutover-review.json'),'wx');
    try{await handle.writeFile(JSON.stringify(review,null,2));await handle.sync();}finally{await handle.close();}
    await verify();await checkpoint('before-publish');
    const manifest=await owner.publish({workspaceId,database:path.basename(copy.archivePath),blobRoot:'blobs',expectedGeneration:0},async phase=>{
      if(phase==='staged')await verify();await checkpoint(phase);
    });
    return {activated:true,root,workspaceId,manifest,review,copy,oldDatabaseModified:false};
  }finally{owner?.close();await lease.release();}
}
