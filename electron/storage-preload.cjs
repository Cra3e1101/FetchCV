const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('workspaceStorage',{
  status:()=>ipcRenderer.invoke('storage:status'),
  request:request=>ipcRenderer.invoke('storage:request',request),
  importFile:request=>ipcRenderer.invoke('storage:import-file',request),
  importExtension:request=>ipcRenderer.invoke('storage:import-extension',request),
  exportFile:request=>ipcRenderer.invoke('storage:export-file',request),
  agent:request=>ipcRenderer.invoke('storage:agent',request),
  onAgentEvent:callback=>{
    const listener=(_event,value)=>callback(value);
    ipcRenderer.on('storage:agent-event',listener);
    return ()=>ipcRenderer.removeListener('storage:agent-event',listener);
  },
  onState:callback=>{
    const listener=(_event,state)=>callback(state);
    ipcRenderer.on('storage:state',listener);
    return ()=>ipcRenderer.removeListener('storage:state',listener);
  },
});
