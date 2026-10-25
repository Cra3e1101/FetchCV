import { resolveElectronRuntime } from "../scripts/electron-runtime.mjs";
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {storageFixture} from './helpers/storage-fixture.mjs';
import {prepareWorkspaceCopy} from '../packages/storage/prepare-workspace.mjs';
import {WorkspaceManifestWriter} from '../packages/storage/workspace-manifest.mjs';

const electronRuntime = await resolveElectronRuntime({ projectRoot: path.resolve(import.meta.dirname, "..") });
const root=process.env.M1_ALLOWED_DELETE_ROOT;
const {db:unused,source,dir}=await storageFixture('utility');unused.close();
const recoveryRoot=path.join(dir,'recovery'),destinationRoot=path.join(dir,'copies');await mkdir(recoveryRoot);await mkdir(destinationRoot);
const copy=await prepareWorkspaceCopy({source,recoveryRoot,destinationRoot,name:'v2'});
const workspaceRoot=path.dirname(copy.archivePath),db=new DatabaseSync(copy.archivePath,{readOnly:true});
const workspaceId=db.prepare('SELECT id FROM Workspace').get().id,c=db.prepare('SELECT * FROM Conversation').get();db.close();
const owner=await WorkspaceManifestWriter.acquire(workspaceRoot);
try {await owner.publish({workspaceId,database:'archive.db',blobRoot:'blobs',expectedGeneration:0});} finally {owner.close();}
await writeFile(path.join(root,'input.json'),JSON.stringify({workspaceRoot,workspaceId,scope:{conversationId:c.id,candidateId:c.candidate_id,jobId:c.job_id}}),{flag:'wx'});
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!['NODE_OPTIONS','ELECTRON_RUN_AS_NODE'].includes(key)));
await new Promise((resolve,reject)=>{
  const child=spawn(electronRuntime.executable,[path.resolve('tests/fixtures/electron-storage-app.cjs')],{env,stdio:'inherit',windowsHide:true});
  const timer=setTimeout(()=>{child.kill();reject(Error('utility test timeout'));},70000);
  child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(`utility exited ${code}`));});
});
const report=JSON.parse(await readFile(path.join(root,'utility-report.json'),'utf8'));assert.equal(report.success,true);console.log(JSON.stringify(report));
