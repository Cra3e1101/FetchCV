import {mkdir,readFile,writeFile,readdir,stat,appendFile,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {_electron as electron} from 'playwright';
import {storageFixture} from './helpers/storage-fixture.mjs';
import {prepareWorkspaceCopy} from '../packages/storage/prepare-workspace.mjs';
import {WorkspaceManifestWriter} from '../packages/storage/workspace-manifest.mjs';
import {localAgentProvider} from './helpers/local-agent-provider.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT,packageRoot=path.resolve(process.argv[2]);
assert.ok(root && path.isAbsolute(root));
assert.equal(path.dirname(packageRoot),path.dirname(root),'candidate must be in the stable work root');
const receipt=JSON.parse(await readFile(path.join(packageRoot,'package-report.json'),'utf8'));
assert.equal(receipt.success,true);
const hashFile=async file=>{const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');};
const installer=receipt.artifacts.find(file=>file.endsWith('.exe'));
const unpack=path.join(root,'extracted');await mkdir(unpack);
const toolchain=JSON.parse(await readFile(path.join(packageRoot,'toolchain-verification.json'),'utf8'));
const tool=await realpath(toolchain.zipTool),toolCache=await realpath(path.join(packageRoot,'builder-cache'));
const toolRelative=path.relative(toolCache,tool);
assert.ok(toolRelative&&!path.isAbsolute(toolRelative)&&toolRelative!=='..'&&!toolRelative.startsWith('..'+path.sep),'7zip must be inside this candidate cache');
assert.equal(await hashFile(tool),'223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3','7zip must still match verified publisher bytes');
const extraction=spawnSync(tool,['x',installer,`-o${unpack}`,'-y'],{encoding:'utf8',windowsHide:true});
await writeFile(path.join(root,'extraction.log'),`${extraction.stdout||''}\n${extraction.stderr||''}`,{flag:'wx'});
assert.equal(extraction.status,0,extraction.error?.message||extraction.stderr);
async function files(directory){const list=[];for(const entry of await readdir(directory,{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false);const p=path.join(directory,entry.name);if(entry.isDirectory())list.push(...await files(p));else list.push(p);}return list;}
const inventory=await files(unpack),apps=inventory.filter(file=>path.basename(file)==='FetchCV.exe');assert.equal(apps.length,1);
const executablePath=apps[0],resources=path.join(path.dirname(executablePath),'resources');
const asarHash=await hashFile(path.join(resources,'app.asar'));assert.equal(asarHash,receipt.asarSha256);
for(const file of receipt.sidecarFiles)assert.equal(await hashFile(path.join(resources,'sidecar',file.path)),file.sha256);
assert.ok(receipt.parserFiles?.length>0,'parser runtime must be bundled');
for(const file of receipt.parserFiles)assert.equal(await hashFile(path.join(resources,'parser-runtime',file.path)),file.sha256);
const {db:unused,source,dir}=await storageFixture('packaged',db=>db.prepare('UPDATE jobs SET jd_raw=?').run('中'.repeat(99999)+'😀末页'));unused.close();
const recoveryRoot=path.join(dir,'recovery'),destinationRoot=path.join(dir,'copies');await mkdir(recoveryRoot);await mkdir(destinationRoot);
const copy=await prepareWorkspaceCopy({source,recoveryRoot,destinationRoot,name:'v2'}),workspaceRoot=path.dirname(copy.archivePath);
const db=new DatabaseSync(copy.archivePath,{readOnly:true}),workspaceId=db.prepare('SELECT id FROM Workspace').get().id;
const resume=db.prepare("SELECT a.id,v.id versionId,v.content_hash FROM Artifact a JOIN ArtifactVersion v ON v.id=a.current_version_id WHERE a.kind='resume'").get();db.close();
const owner=await WorkspaceManifestWriter.acquire(workspaceRoot);
try{await owner.publish({workspaceId,database:'archive.db',blobRoot:'blobs',expectedGeneration:0});}finally{owner.close();}
const oldHash=await hashFile(source),userData=path.join(root,'user-data'),sessionData=path.join(root,'session-data');
await mkdir(userData);await mkdir(sessionData);
const baseEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!['NODE_OPTIONS','ELECTRON_RUN_AS_NODE'].includes(key)));
const provider=await localAgentProvider({artifactId:resume.id,basedOnVersionId:resume.versionId,basedOnHash:resume.content_hash});
const env={...baseEnv,...provider.env,FETCHCV_V2_STORAGE_ROOT:workspaceRoot,FETCHCV_E2E_USER_DATA:userData,FETCHCV_E2E_SESSION_DATA:sessionData,FETCHCV_E2E_TEMP:root};
const runs=[];
const selectedFile=path.join(root,'Packaged-Import.txt'),selectedText='SQL 中文😀 PackagedLpacProof 2026';
await writeFile(selectedFile,selectedText,{flag:'wx'});
try{
for(const mode of ['write','restart','invalid-manifest']) {
  const invalidRoot=path.join(root,'invalid-workspace');if(mode==='invalid-manifest')await mkdir(invalidRoot);
  const application=await electron.launch({executablePath,args:[],cwd:process.cwd(),env:{...env,...(mode==='invalid-manifest'?{FETCHCV_V2_STORAGE_ROOT:invalidRoot}:{})},timeout:40000});
  const errors=[];
  try{
    const window=await application.firstWindow();window.setDefaultTimeout(15000);window.on('pageerror',error=>errors.push(error.message));
    const utility=async name=>{if(await window.locator('#utility-drawer').isVisible())await window.getByRole('button',{name:'关闭资料面板',exact:true}).click();await window.locator(`.workspace-actions [data-utility="${name}"]`).click();};
    const closeUtility=async()=>{if(await window.locator('#utility-drawer').isVisible())await window.getByRole('button',{name:'关闭资料面板',exact:true}).click();};
    const expected=mode==='invalid-manifest'?'工作区打开失败':'本地工作区已打开';await window.getByText(expected,{exact:true}).waitFor({timeout:20000});
    const info=await application.evaluate(({app})=>({packaged:app.isPackaged,version:process.versions.electron,userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),metrics:app.getAppMetrics().map(({pid,name,serviceName,type})=>({pid,name,serviceName,type}))}));
    assert.equal(info.packaged,true);assert.equal(info.userData,userData);assert.equal(info.sessionData,sessionData);
    assert.equal(await window.evaluate(()=>typeof window.desktop),'undefined');
    const foreignSenderDenied=await application.evaluate(async({app,BrowserWindow})=>{
      const foreign=new BrowserWindow({show:false,webPreferences:{preload:app.getAppPath()+'/build/electron/storage-preload.cjs',contextIsolation:true,nodeIntegration:false,sandbox:true}});
      try{
        await foreign.loadURL('about:blank');
        return await foreign.webContents.executeJavaScript(`(async()=>{const results=[];for(const call of [()=>window.workspaceStorage.status(),()=>window.workspaceStorage.request({}),()=>window.workspaceStorage.agent({}),()=>window.workspaceStorage.importFile({})]){try{await call();results.push(false);}catch(error){results.push(error.message.includes('sender_denied'));}}return results;})()`);
      }finally{foreign.destroy();}
    });
    assert.deepEqual(foreignSenderDenied,[true,true,true,true]);
    if(mode!=='invalid-manifest'){
      assert.ok(info.metrics.some(p=>p.type==='Utility' && p.name==='FetchCV Application'),JSON.stringify(info.metrics));
      await window.locator('[data-kind="artifacts"]').click();await window.locator('#items').getByRole('button',{name:'Synthetic resume',exact:true}).click();await window.getByText(mode==='write'?'Original version':'Packaged synthetic reviewed version',{exact:true}).waitFor();
      await window.locator('[data-kind="documents"]').click();
      const documents=window.locator('#items').getByRole('button',{name:'Synthetic Company Analyst',exact:true});
      for(let i=0;i<await documents.count();i++){await documents.nth(i).click();await window.getByText('此处展示保留的版本内容。',{exact:true}).waitFor();if(await window.getByRole('button',{name:'继续读取文档',exact:true}).isVisible())break;}
      await window.getByRole('button',{name:'继续读取文档',exact:true}).click();await window.getByText('末页',{exact:true}).waitFor();
      await window.locator('[data-kind="activities"]').click();
      await window.locator('#items').getByRole('button',{name:'历史审批',exact:true}).click();await window.getByText('approval_a',{exact:true}).waitFor();
      await window.locator('#items').getByRole('button',{name:'历史投递',exact:true}).click();await window.getByText('application_a',{exact:true}).waitFor();
      await window.locator('[data-kind="conversations"]').click();await window.locator('#items button').first().click();
      if(mode==='write'){
        await utility('note');await window.getByLabel('添加本地备注').fill('NSIS extracted APP persisted note');await window.getByRole('button',{name:'保存备注',exact:true}).click();await window.getByText('备注已保存。',{exact:true}).waitFor();
      }
      await closeUtility();await window.locator('#detail').getByText('NSIS extracted APP persisted note',{exact:true}).waitFor();
      if(mode==='write'){
        await window.getByRole('button',{name:'将这条消息设为记忆候选',exact:true}).last().click();
        await window.getByLabel('主题（例如 简历）').fill('resume');await window.getByLabel('事项（例如 页数）').fill('style');
        await window.getByRole('button',{name:'创建候选',exact:true}).click();await window.getByText('候选已保存，请核对后确认。',{exact:true}).waitFor();
        await window.getByRole('button',{name:'确认这条记忆',exact:true}).click();await window.getByRole('button',{name:'撤回这条记忆',exact:true}).waitFor();
        await window.getByRole('button',{name:'查看来源消息',exact:true}).click();
        await window.locator('#memory-items').getByText('NSIS extracted APP persisted note',{exact:true}).last().waitFor();
        await closeUtility();await window.getByLabel('向模型提问',{exact:true}).fill('Review the synthetic resume and prepare a draft.');
        await window.getByRole('button',{name:'发送给模型',exact:true}).click();
        await window.getByText('Packaged Pi answer persisted in APP.',{exact:true}).waitFor({timeout:40000});
        await window.locator('[data-kind="approvals"]').click();await window.locator('#items').getByRole('button',{name:'待审阅草稿',exact:true}).click();
        await window.getByText('Packaged synthetic reviewed version',{exact:true}).waitFor();
        await window.getByRole('button',{name:'确认并保存此版本',exact:true}).click();await window.getByText('新版本已保存，原版本保留。',{exact:true}).waitFor();
        assert.equal(provider.calls,3);
      }else {
        await window.getByText('Packaged Pi answer persisted in APP.',{exact:true}).waitFor();
        await utility('memory');await window.getByRole('button',{name:'撤回这条记忆',exact:true}).click();await window.getByText('resume · style · 已撤回',{exact:true}).waitFor();
        await utility('knowledge');await window.getByLabel('搜索此范围的资料').fill('Synthetic');await window.getByRole('button',{name:'查找原文',exact:true}).click();
        await window.getByRole('button',{name:'核对原文引用',exact:true}).first().click();await window.getByRole('button',{name:'原文与引用一致',exact:true}).waitFor();
      }
      if(mode==='write'){
        // Only the user's picker decision is substituted. Main, preload, APP,
        // packaged runtime and Windows LPAC all execute their real code paths.
        await application.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},selectedFile);
        await utility('source');await window.getByRole('button',{name:'选择文件并导入',exact:true}).click();
        await window.locator('#source-status').filter({hasText:'解析完成，可以搜索和核对引用'}).waitFor({timeout:65000});
      }else{
        await closeUtility();await window.locator('[data-kind="documents"]').click();await window.locator('#items').getByRole('button',{name:'Packaged-Import.txt',exact:true}).first().click();
      }
      await utility('source');await window.getByRole('button',{name:'查看解析正文',exact:true}).click();await window.locator('#detail').getByText(selectedText,{exact:true}).waitFor();
      await utility('knowledge');await window.getByLabel('搜索此范围的资料').fill('PackagedLpacProof');await window.getByRole('button',{name:'查找原文',exact:true}).click();
      await window.getByRole('button',{name:'核对原文引用',exact:true}).first().click();await window.getByRole('button',{name:'原文与引用一致',exact:true}).waitFor();
      if(mode==='write'){
        await window.getByRole('button',{name:'将这段原文作为个人事实审阅',exact:true}).first().click();
        await window.getByRole('button',{name:'确认属实并记忆引用',exact:true}).click();
        await window.getByText('已保存个人事实与记忆引用，可在记忆列表核对和撤回。',{exact:true}).waitFor();
      }
      await utility('memory');await window.locator('#memory-refresh').click();
      await window.getByText('已确认个人事实 · 知识条目引用',{exact:true}).waitFor();
      await window.getByRole('button',{name:'核对个人事实原文',exact:true}).click();
      await window.locator('#memory-items').getByText(selectedText,{exact:true}).first().waitFor();
      if(mode==='restart'){
        await utility('source');await window.getByRole('button',{name:'停止使用此来源',exact:true}).click();await window.getByRole('button',{name:'确认停止使用并保留原件',exact:true}).click();
        await window.getByText('已停止使用此来源，原件和历史版本保留。',{exact:true}).waitFor();
        await utility('knowledge');await window.getByRole('button',{name:'查找原文',exact:true}).click();await window.getByText('未找到可用原文，请尝试更具体的关键词。',{exact:true}).waitFor();
        await utility('memory');await window.locator('#memory-refresh').click();
        await window.getByText('个人事实引用已不可用，不再提供给助手。',{exact:true}).waitFor();
        await window.getByRole('button',{name:'核对个人事实原文',exact:true}).waitFor({state:'hidden'});
        await window.getByRole('button',{name:'停止记忆此事实',exact:true}).click();
        await window.getByText('个人事实引用已不可用，不再提供给助手。',{exact:true}).waitFor({state:'hidden'});
      }
      if(mode==='write'){
  await closeUtility();await window.getByRole('button',{name:'MCP 工具设置',exact:true}).click();
  const mcp=window.getByRole('dialog',{name:'MCP 工具设置',exact:true});
  await mcp.getByRole('button',{name:'新建本地服务器',exact:true}).click();
  await mcp.getByLabel('服务器名称',{exact:true}).fill('Synthetic packaged echo');
  await mcp.getByLabel('程序绝对路径',{exact:true}).fill(process.execPath);
  await mcp.getByLabel('启动参数 JSON 数组',{exact:true}).fill(JSON.stringify([path.resolve('tests/fixtures/mcp-stdio-fixture.mjs'),'normal']));
  await mcp.getByRole('button',{name:'保存为禁用配置',exact:true}).click();
  await mcp.getByText('配置已保存，尚未启动。',{exact:true}).waitFor();
  assert.equal(await mcp.getByRole('button',{name:'确认信任此本地程序',exact:true}).isDisabled(),true);
  await mcp.getByLabel('我信任此程序，并允许它以当前用户权限运行').check();
  await mcp.getByRole('button',{name:'确认信任此本地程序',exact:true}).click();
  await mcp.getByRole('button',{name:'连接并发现工具',exact:true}).click();
  await mcp.getByLabel('允许工具 echo').check();await mcp.getByRole('button',{name:'保存逐工具授权',exact:true}).click();
  await mcp.getByLabel('echo 的 JSON 参数',{exact:true}).fill(JSON.stringify({text:'Synthetic packaged MCP approved'}));
  await mcp.getByRole('button',{name:'审阅 echo 调用',exact:true}).click();
  await mcp.getByText('调用状态：pending',{exact:true}).waitFor();
  assert.match(await mcp.locator('pre').innerText(),/Synthetic packaged MCP approved/);
  await mcp.getByRole('button',{name:'批准这一次调用',exact:true}).click();
  await mcp.getByText('调用状态：completed',{exact:true}).waitFor();
  assert.match(await mcp.locator('pre').last().innerText(),/Synthetic packaged MCP approved/);
  await mcp.getByRole('button',{name:'当前范围调用记录',exact:true}).click();
  await mcp.getByRole('button',{name:'echo · completed',exact:true}).click();
  await mcp.getByText('调用状态：completed',{exact:true}).waitFor();
  assert.equal(await mcp.getByRole('button',{name:'批准这一次调用',exact:true}).count(),0);
  await mcp.getByRole('button',{name:'服务器列表',exact:true}).click();
  await mcp.getByRole('button',{name:'Synthetic packaged echo · trusted',exact:true}).click();
  await mcp.getByRole('button',{name:'停用服务器并撤销工具授权',exact:true}).click();
  await mcp.getByText('Synthetic packaged echo · disabled',{exact:true}).waitFor();
  await window.keyboard.press('Escape');await mcp.waitFor({state:'hidden'});
  assert.equal(await window.evaluate(()=>document.activeElement.id),'mcp-settings');
      }
      const screenshotStarted=Date.now();
      await appendFile(path.join(root,'screenshot-events.jsonl'),JSON.stringify({mode,event:'started',at:new Date().toISOString(),timeoutMs:45000})+'\n');
      // Screenshot capture is evidence I/O, not the deadline of a UI operation.
      // Keep a bounded deadline without relaxing any preceding functional check.
      await window.screenshot({path:path.join(root,`${mode}.png`),fullPage:true,timeout:45000});
      await appendFile(path.join(root,'screenshot-events.jsonl'),JSON.stringify({mode,event:'completed',durationMs:Date.now()-screenshotStarted})+'\n');
    }else assert.equal(await window.locator('#items button').count(),0);
    assert.deepEqual(errors,[]);runs.push({mode,...info,rendererErrors:errors,foreignSenderDenied});
  }finally{await application.close();}
}
}finally{await provider.close();}
assert.equal(await hashFile(source),oldHash);
assert.equal(await readFile(selectedFile,'utf8'),selectedText);
await assert.rejects(stat(path.join(userData,'data')),{code:'ENOENT'},'legacy sidecar bootstrap must not create its data directory');
const processes=(await readFile(process.env.M1_PROCESS_LOG,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
assert.equal(processes.filter(p=>p.event==='spawn' && /fetchcv-api\.exe$/i.test(p.command)).length,0);
const parserHosts=processes.filter(p=>p.event==='spawn' && /python\.exe$/i.test(p.command));
assert.ok(parserHosts.length>0,'bundled parser host must actually run');
for(const host of parserHosts)assert.ok(host.command.toLowerCase().startsWith(path.join(workspaceRoot,'derived','parser','runtime-').toLowerCase()),host.command);
const verified=new DatabaseSync(copy.archivePath,{readOnly:true});let agentVerification;
try{
  const counts={requests:verified.prepare("SELECT count(*) n FROM Event WHERE type='agent.provider.request'").get().n,completed:verified.prepare("SELECT count(*) n FROM AgentRun WHERE runtime_id='pi-app' AND state='completed'").get().n,approved:verified.prepare("SELECT count(*) n FROM Approval WHERE policy_revision='m4-artifact-2' AND decision='approved'").get().n};
  assert.deepEqual(counts,{requests:3,completed:1,approved:1});
  assert.equal(verified.prepare('SELECT count(*) n FROM Event WHERE payload_json LIKE ?').get('%M4-PACKAGED-SYNTHETIC-KEY%').n,0);
  assert.equal(verified.prepare('SELECT content_hash FROM ArtifactVersion WHERE id=?').get(resume.versionId).content_hash,resume.content_hash);
  assert.equal(verified.prepare("SELECT count(*) n FROM Memory WHERE status='revoked'").get().n,1);
  assert.equal(verified.prepare("SELECT count(*) n FROM PersonalFactReference r JOIN KnowledgeItem k ON k.id=r.knowledge_id WHERE r.status='revoked' AND k.status='disabled'").get().n,1);
  agentVerification={...counts,provider:'local synthetic protocol peer; real Pi SDK in packaged APP utility',oldArtifactRetained:true,memoryReviewSourceRevoke:true,knowledgeCitationResolved:true,personalFactConfirmedRestartedAndSourceRevoked:true};
}finally{verified.close();}
const report={success:true,installer,installerSha256:await hashFile(installer),asarHash,extractedFiles:inventory.length,sidecarFilesVerified:receipt.sidecarFiles.length,parserFilesVerified:receipt.parserFiles.length,runs,agentVerification,parserHostCount:parserHosts.length,mcpConfiguredGrantedApprovedReceiptedAndRevoked:true,nativePickerSelection:'synthetic selection substitution; real main/preload/APP/packaged LPAC',parserImportSearchCitationRestartRevoke:true,selectedOriginalUnchanged:true,oldSourceUnchanged:true,legacySidecarSpawnObserved:false,installed:false,instrumentedCandidate:true};
await writeFile(path.join(root,'packaged-report.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({success:true,packaged:true,runs:runs.map(({mode})=>mode),asarHash,sidecarFilesVerified:receipt.sidecarFiles.length}));
