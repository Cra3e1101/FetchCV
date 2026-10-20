import {settingsPage} from "./settings-shell.js";
export function extensionSettings({trigger,request,getWorkspaceId,onError}){
 trigger.addEventListener('click',()=>{
  const dialog=document.createElement('dialog');dialog.className='source-reader';dialog.setAttribute('aria-label','扩展与 Agent 设置');
  const close=document.createElement('button');close.textContent='关闭扩展设置';close.autofocus=true;close.addEventListener('click',()=>dialog.close());
  const heading=document.createElement('h2');heading.textContent='扩展与 Agent 设置';
  const note=document.createElement('p');note.textContent='仅支持本地文本声明包；包不会执行代码。导入后默认禁用，请先阅读说明与资源，再逐项授予工具能力。外部 MCP 服务在独立的 MCP 工具设置中管理，不继承旧授权。';
  const status=document.createElement('p');status.setAttribute('role','status');
  const actions=document.createElement('div'),list=document.createElement('div');dialog.append(close,heading,note,status,actions,list);document.body.append(dialog);
  let generation=0;const current=t=>dialog.open&&generation===t;
  const button=(parent,label,fn)=>{const b=document.createElement('button');b.textContent=label;b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){if(dialog.open)status.textContent=`未完成（${e.message}）。`;}finally{b.disabled=false;}});parent.append(b);return b;};
  const p=(parent,value)=>{const el=document.createElement('p');el.textContent=value;parent.append(el);};
  const inspect=async id=>{const ticket=++generation;const record=await request('extension.read',{installId:id});if(!current(ticket))return;list.replaceChildren();
   p(list,`${record.packageId} · ${record.version} · ${record.state}`);p(list,`内容指纹：${record.hash}`);
   const pre=document.createElement('pre');pre.textContent=JSON.stringify(record.bundle,null,2);list.append(pre);
   if(record.state==='removed'){p(list,'扩展已移除；其历史快照与用户资料保留。');return;}
   const grants=new Map();for(const capability of record.requestedCapabilities){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=record.grants.includes(capability);input.style.width='auto';label.append(input,document.createTextNode(` 允许 ${capability}`));list.append(label);grants.set(capability,input);}
   const control=async state=>{if(!current(ticket))return;await request('extension.control',{installId:id,expectedRevision:record.revision,expectedHash:record.hash,state,grants:state==='enabled'?[...grants].filter(([,input])=>input.checked).map(([cap])=>cap):[]});if(current(ticket)){status.textContent=state==='enabled'?'能力授权已保存。':'扩展已停用，后续调用将被拒绝。';await load();}};
   button(list,'确认所选能力并启用',()=>control('enabled'));button(list,'立即停用并撤权',()=>control('disabled'));
   let confirmed=false;const remove=button(list,'移除扩展',async()=>{if(!current(ticket))return;if(!confirmed){confirmed=true;remove.textContent='确认移除扩展并保留历史';return;}await control('removed');});
   for(const agent of record.agents){const b=button(list,`选择 Agent：${agent.title}`,async()=>{if(!current(ticket))return;await request('extension.select',{installId:id,agentId:agent.id,expectedRevision:record.revision,expectedHash:record.hash});if(current(ticket)){status.textContent='新运行将使用此 Agent，正在进行的运行仍使用原快照。';await load();}});b.disabled=record.state!=='enabled';}
  };
  const load=async()=>{const ticket=++generation;list.replaceChildren();const append=async afterId=>{const page=await request('extension.list',afterId?{afterId}:{});if(!current(ticket))return;
    if(!afterId)p(list,page.selected?`后续运行选择：${page.selected.agentId}（若授权失效会拒绝运行）`:'后续运行使用内置求职助手。');
    for(const item of page.items)button(list,`${item.packageId} · ${item.version} · ${item.state}`,()=>inspect(item.id));
    if(!afterId&&!page.items.length)p(list,'没有已导入的声明包。');
    if(page.nextId){const more=button(list,'继续读取扩展',async()=>{await append(page.nextId);more.remove();});}
   };await append();};
  button(actions,'导入本地声明包',async()=>{const result=await window.workspaceStorage.importExtension({v:1,id:crypto.randomUUID(),workspaceId:getWorkspaceId(),method:'extension.list',payload:{}});if(!result?.ok)throw new Error(result?.error?.code||'extension_import_failed');if(!dialog.open)return;if(result.result.cancelled){status.textContent='已取消导入。';return;}status.textContent='已导入，尚未授权。';await inspect(result.result.id);});
  button(actions,'返回扩展列表',load);button(actions,'恢复内置求职助手',async()=>{await request('extension.select',{installId:null});if(dialog.open){status.textContent='后续运行恢复内置助手；扩展授权可单独撤回。';await load();}});
  dialog.addEventListener('close',()=>{generation++;dialog.remove();trigger.focus();},{once:true});settingsPage(dialog,"extension-settings");dialog.showModal();void load().catch(e=>{if(dialog.open)status.textContent=`未完成（${e.message}）。`;});
 });
}
