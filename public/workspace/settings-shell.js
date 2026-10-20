// Visual adapter only: each settings module keeps its existing IPC and state.
export function settingsPage(dialog, active) {
  dialog.classList.add('ipc-settings-page');
  const content=document.createElement('div');content.className='ipc-settings-content';
  while(dialog.firstChild)content.append(dialog.firstChild);
  const sidebar=document.createElement('aside');sidebar.className='ipc-settings-nav';
  const title=document.createElement('h2');title.textContent='设置';sidebar.append(title);
  for(const [id,label] of [['interface-settings','外观'],['extension-settings','扩展与 Agent 设置'],['mcp-settings','MCP 工具设置']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;
    if(id===active)button.setAttribute('aria-current','page');
    button.addEventListener('click',()=>{
      if(id===active)return;
      dialog.addEventListener('close',()=>document.getElementById(id)?.click(),{once:true});
      dialog.close();
    });sidebar.append(button);
  }
  dialog.append(sidebar,content);
}
