const kinds=new Set(['conversations','artifacts','documents','activities','approvals','jobs','runs']);
// Cache is navigation metadata only. Opening always resolves the ID through APP.
export function readTabs(storage,key){
  try{
    const raw=JSON.parse(storage.getItem(key));
    if(!Array.isArray(raw))return [];
    const seen=new Set();return raw.slice(-12).filter(x=>{
      if(!x||!kinds.has(x.kind)||typeof x.id!=='string'||x.id.length>100||!x.id||seen.has(`${x.kind}:${x.id}`))return false;
      seen.add(`${x.kind}:${x.id}`);return true;
    }).map(({kind,id})=>({kind,id}));
  }catch{return [];}
}
export function objectTabs({parent,request,canNavigate,getEpoch,onOpen,onUnavailable}){
  let workspaceId,key,tabs=[],active=null,activation=0;
  const save=()=>{try{localStorage.setItem(key,JSON.stringify(tabs.map(({kind,id})=>({kind,id}))));}catch{/* optional cache only */}};
  const render=()=>{
    parent.replaceChildren();
    for(const tab of tabs){
      const group=document.createElement('span'),open=document.createElement('button'),close=document.createElement('button');
      open.textContent=tab.title||({conversations:'对话',documents:'来源资料',artifacts:'简历与作品',jobs:'岗位',runs:'运行活动',approvals:'待审阅草稿',activities:'审批与投递'}[tab.kind]);open.setAttribute('aria-pressed',String(active===`${tab.kind}:${tab.id}`));
      open.addEventListener('click',()=>void activate(tab));
      close.textContent='×';close.setAttribute('aria-label',`关闭标签 ${tab.title||'恢复记录'}`);
      close.addEventListener('click',()=>{if(!canNavigate())return;activation++;tabs=tabs.filter(t=>t!==tab);if(active===`${tab.kind}:${tab.id}`)active=null;save();render();parent.querySelector('button')?.focus();});
      group.append(open,close);parent.append(group);
    }
  };
  const activate=async tab=>{
    if(!canNavigate())return;
    const stamp=getEpoch(),ticket=++activation;
    try{
      const result=await request('workspace.catalogue',{kind:tab.kind,objectId:tab.id,limit:1});
      if(!canNavigate()||stamp!==getEpoch()||ticket!==activation||!tabs.includes(tab))return;
      if(!result.items.length){tab.title='记录已不可用';render();onUnavailable();return;}
      await onOpen(tab.kind,result.items[0],()=>ticket===activation&&tabs.includes(tab));
    }catch{if(stamp===getEpoch()&&ticket===activation&&tabs.includes(tab))onUnavailable();}
  };
  return {
    async restore(id){workspaceId=id;key=`fetchcv-object-tabs-1:${workspaceId}`;tabs=readTabs(localStorage,key);render();if(tabs.length)await activate(tabs.at(-1));},
    remember(kind,item){if(!key||!kinds.has(kind))return;const old=tabs.find(t=>t.kind===kind&&t.id===item.id);tabs=tabs.filter(t=>t!==old);tabs.push({kind,id:item.id,title:item.title||'历史记录'});tabs=tabs.slice(-12);active=`${kind}:${item.id}`;save();render();parent.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});},
  };
}
