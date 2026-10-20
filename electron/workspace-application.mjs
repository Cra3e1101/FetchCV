import path from 'node:path';
import {lstat,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {startStorageUtility} from './storage-client.mjs';
import {isTrustedFrame} from '../packages/app/runtime-rpc.mjs';
import {ContractError,validateRequest} from '../packages/contracts/runtime.mjs';
import {validateStorageRequest} from '../packages/contracts/storage.mjs';

// Selected workspace startup is exclusive: the caller must not start the legacy
// sidecar or its Pi persistence adapter. Errors never fall back to the old DB.
export async function startWorkspaceApplication({app,BrowserWindow,ipcMain,utilityProcess,dialog,root,projectRoot,runtimeDir,getProviderConfig=()=>null}) {
  const file=path.join(projectRoot,'dist','workspace','index.html'),allowed=pathToFileURL(file).href;
  let client=null,state='starting',workspaceId=null,closing=false;
  let importing=false,exporting=false,importingExtension=false;
  const check=event=>{if(!isTrustedFrame(event,allowed))throw new ContractError('sender_denied');};
  ipcMain.handle('storage:status',event=>{check(event);return {state,workspaceId};});
  ipcMain.handle('storage:request',async(event,request)=>{
    check(event);
    try {
      if(state!=='ready' || !client) throw new ContractError('storage_unavailable');
      return {ok:true,result:await client.request(request)};
    } catch(error) {return {ok:false,error:{code:error instanceof ContractError?error.code:'storage_failed'}};}
  });
  ipcMain.handle('storage:agent',async(event,raw)=>{
    check(event);
    try{
      if(state!=='ready'||!client)throw new ContractError('storage_unavailable');
      const request=validateRequest(raw,workspaceId);
      const provider=['agent.turn','agent.task'].includes(request.method)?getProviderConfig():undefined;
      return await client.agentRequest(request,String(event.sender.id),provider);
    }catch(error){return {ok:false,error:{code:error instanceof ContractError?error.code:'runtime_failed'}};}
  });
  ipcMain.handle('storage:import-file',async(event,raw)=>{
    check(event);
    if(importing)return {ok:false,error:{code:'import_busy'}};
    importing=true;
    try{
      if(state!=='ready'||!client||!dialog)throw new ContractError('storage_unavailable');
      if(!raw?.payload||Object.keys(raw.payload).some(key=>!['candidateId','jobId','sourceId','expectedRevision'].includes(key)))throw new ContractError('invalid_payload');
      const metadata=validateStorageRequest({...raw,method:'source.import',payload:{...raw.payload,title:'native selection',format:'txt'}},workspaceId);
      const chosen=await dialog.showOpenDialog(window,{title:'导入来源资料',buttonLabel:'导入并保留原件',properties:['openFile','dontAddToRecent'],filters:[{name:'文档和聊天记录',extensions:['pdf','docx','txt','md','html','htm','json']}]});
      if(chosen.canceled)return {ok:true,result:{cancelled:true}};
      if(chosen.filePaths.length!==1)throw new ContractError('invalid_selected_file');
      const selectedPath=chosen.filePaths[0],extension=path.extname(selectedPath).slice(1).toLowerCase();
      const format=extension==='htm'?'html':extension==='json'?'chat':extension;
      if(!['pdf','docx','txt','md','html','chat'].includes(format))throw new ContractError('unsupported_format');
      metadata.payload.title=path.basename(selectedPath);metadata.payload.format=format;
      return {ok:true,result:{...await client.importSelectedFile(metadata,selectedPath),title:metadata.payload.title}};
    }catch(error){return {ok:false,error:{code:error instanceof ContractError?error.code:'import_failed'}};}
    finally{importing=false;}
  });
  ipcMain.handle('storage:import-extension',async(event,raw)=>{
    check(event);if(importingExtension)return {ok:false,error:{code:'import_busy'}};importingExtension=true;
    try{
      if(state!=='ready'||!client||!dialog)throw new ContractError('storage_unavailable');
      const request=validateStorageRequest(raw,workspaceId);if(request.method!=='extension.list'||Object.keys(request.payload).length)throw new ContractError('invalid_payload');
      const chosen=await dialog.showOpenDialog(window,{title:'导入本地声明扩展包',properties:['openFile','dontAddToRecent'],filters:[{name:'FetchCV 文本声明包',extensions:['json']}]});
      if(chosen.canceled)return {ok:true,result:{cancelled:true}};
      if(chosen.filePaths.length!==1||path.extname(chosen.filePaths[0]).toLowerCase()!=='.json')throw new ContractError('invalid_selected_file');
      return {ok:true,result:await client.importSelectedExtension(request,chosen.filePaths[0])};
    }catch(error){return {ok:false,error:{code:error instanceof ContractError?error.code:'extension_import_failed'}};}
    finally{importingExtension=false;}
  });
  ipcMain.handle('storage:export-file',async(event,raw)=>{
    check(event);if(exporting)return {ok:false,error:{code:'export_busy'}};exporting=true;
    try{
      if(state!=='ready'||!client||!dialog)throw new ContractError('storage_unavailable');
      const request=validateStorageRequest(raw,workspaceId);
      if(request.method!=='artifact.export')throw new ContractError('method_not_allowed');
      const initial=await client.request(request);
      const chosen=await dialog.showSaveDialog(window,{title:'导出已确认版本与出处',defaultPath:'FetchCV-reviewed-artifact.json',filters:[{name:'正文、版本和出处归档',extensions:['json']}]});
      if(chosen.canceled)return {ok:true,result:{cancelled:true}};
      if(!path.isAbsolute(chosen.filePath)||path.extname(chosen.filePath).toLowerCase()!=='.json')throw new ContractError('invalid_export_path');
      // Freeze the selected immutable version, but revalidate permissions and citations after the native dialog.
      const current=await client.request({...request,payload:{...request.payload,versionId:initial.artifact.versionId}});
      if(current.artifact.contentHash!==initial.artifact.contentHash)throw new ContractError('artifact_revision_conflict');
      await writeFile(chosen.filePath,JSON.stringify(current,null,2)+'\n',{encoding:'utf8',flag:'wx'});
      return {ok:true,result:{saved:true,versionId:current.artifact.versionId}};
    }catch(error){return {ok:false,error:{code:error.code==='EEXIST'?'export_file_exists':error instanceof ContractError?error.code:'export_failed'}};}
    finally{exporting=false;}
  });
  const window=new BrowserWindow({width:1200,height:800,minWidth:720,minHeight:540,show:false,title:'FetchCV · 工作区',backgroundColor:'#ffffff',
    webPreferences:{preload:path.join(runtimeDir,'storage-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==allowed)event.preventDefault();});
  const owner=String(window.webContents.id);
  window.webContents.on('destroyed',()=>client?.disposeAgentOwner(owner));
  window.once('ready-to-show',()=>window.show());
  await window.loadFile(file);
  try {
    if(!path.isAbsolute(root) || (await lstat(root)).isSymbolicLink()) throw new ContractError('invalid_workspace_root');
    client=await startStorageUtility({utilityProcess,entry:path.join(runtimeDir,'storage-worker.mjs'),root,onAgentEvent:(id,event)=>{
      if(id===owner&&!window.isDestroyed())window.webContents.send('storage:agent-event',event);
    },onExit:()=>{
      state='error';if(!window.isDestroyed())window.webContents.send('storage:state',{state,workspaceId});
    }});
    workspaceId=client.workspaceId;state='ready';
  } catch {state='error';}
  window.webContents.send('storage:state',{state,workspaceId});
  app.on('before-quit',event=>{
    if(client && !closing) {event.preventDefault();closing=true;state='closing';void client.close().finally(()=>app.quit());}
  });
  return {window,get state(){return state;},get client(){return client;}};
}
