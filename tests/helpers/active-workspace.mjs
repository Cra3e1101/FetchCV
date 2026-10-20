import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {storageFixture} from './storage-fixture.mjs';
import {prepareWorkspaceCopy} from '../../packages/storage/prepare-workspace.mjs';
import {WorkspaceManifestWriter} from '../../packages/storage/workspace-manifest.mjs';
import {ApplicationStore} from '../../packages/storage/application-store.mjs';
import {randomUUID} from 'node:crypto';

export async function activeWorkspace(name){
  const fixture=await storageFixture(name);fixture.db.close();
  const recoveryRoot=path.join(fixture.dir,'recovery'),destinationRoot=path.join(fixture.dir,'copies');
  await mkdir(recoveryRoot);await mkdir(destinationRoot);
  const copy=await prepareWorkspaceCopy({source:fixture.source,recoveryRoot,destinationRoot,name:'v2'});
  const root=path.dirname(copy.archivePath),probe=new DatabaseSync(copy.archivePath,{readOnly:true});
  const workspaceId=probe.prepare('SELECT id FROM Workspace').get().id;
  const conversation=probe.prepare('SELECT * FROM Conversation').get();probe.close();
  const owner=await WorkspaceManifestWriter.acquire(root);
  try{await owner.publish({workspaceId,database:'archive.db',blobRoot:'blobs',expectedGeneration:0});}finally{owner.close();}
  const store=await ApplicationStore.open(root);
  return {root,store,copy,workspaceId,conversation,
    request:(method,payload={})=>store.dispatch({v:1,id:randomUUID(),workspaceId,method,payload})};
}
