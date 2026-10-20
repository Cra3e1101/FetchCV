const {app,BrowserWindow,session}=require('electron');const fs=require('node:fs');const path=require('node:path');
const root=process.env.M1_ALLOWED_DELETE_ROOT;if(!root)throw Error('isolated root required');require(path.resolve('scripts/m1/guard-node-deletions.cjs'));
for(const key of ['userData','sessionData']){const dir=path.join(root,key);fs.mkdirSync(dir);app.setPath(key,dir)}app.setPath('temp',root);app.disableHardwareAcceleration();
app.whenReady().then(()=>{const w=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{session:session.fromPartition('ui-integration-test'),contextIsolation:true,nodeIntegration:false,sandbox:true}});w.loadURL('about:blank')});
app.on('window-all-closed',()=>app.quit());setTimeout(()=>app.exit(3),180000).unref();
