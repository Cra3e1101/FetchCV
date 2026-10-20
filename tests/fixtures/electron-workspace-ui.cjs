require(require('node:path').join(process.cwd(),'scripts/m1/guard-node-deletions.cjs'));
const {app,BrowserWindow,ipcMain,utilityProcess}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const root=process.env.M1_ALLOWED_DELETE_ROOT;
setTimeout(()=>{console.error('synthetic UI fixture exceeded 120 second deadline');app.exit(3);},120000).unref();
for(const name of ['user-data','session-data'])fs.mkdirSync(path.join(root,name));
app.setPath('userData',path.join(root,'user-data'));app.setPath('sessionData',path.join(root,'session-data'));app.setPath('temp',root);app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const {startWorkspaceApplication}=await import('../../electron/workspace-application.mjs');
  const input=JSON.parse(fs.readFileSync(path.join(root,'input.json'),'utf8'));
  let pickerCalls=0;
  let saveCalls=0;
  const dialog={showSaveDialog:async()=>++saveCalls===1?{canceled:true}:{canceled:false,filePath:path.join(root,'reviewed-artifact.json')},showOpenDialog:async(_window,options)=>options.title==='导入本地声明扩展包'?{canceled:false,filePaths:[input.extensionSelection]}:++pickerCalls===1?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[input.syntheticSelection]}};
  await startWorkspaceApplication({app,BrowserWindow,ipcMain,utilityProcess,dialog,root:input.workspaceRoot,projectRoot:path.join(root,'stage'),runtimeDir:path.join(root,'runtime'),getProviderConfig:()=>process.env.FETCHCV_PROVIDER_BASE_URL?{baseUrl:process.env.FETCHCV_PROVIDER_BASE_URL,apiKey:process.env.FETCHCV_PROVIDER_API_KEY,model:'gpt-4o-mini',protocol:'openai',providerName:'Synthetic local model',contextWindow:32768,maxOutputTokens:2048}:null});
});
app.on('window-all-closed',()=>app.quit());
