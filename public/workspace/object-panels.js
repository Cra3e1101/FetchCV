const states={created:'已创建',running:'运行中',waiting_approval:'等待确认',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断',unknown:'结果未知',prepared:'已准备'};
const text=(parent,value)=>{const p=document.createElement('p');p.textContent=value;parent.append(p);};
function button(parent,label,action,onError){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',async()=>{b.disabled=true;try{await action();}catch(e){onError(e);}finally{b.disabled=false;}});parent.append(b);return b;}
export async function jobPanel({parent,request,scope,isCurrent,onNavigate,onError}){
 const result=await request('job.read',scope);if(!isCurrent())return;
 text(parent,`${result.job.company} · ${result.job.role}`);text(parent,`地点：${result.job.location||'未填写'}；状态：${result.job.status}；投递时间：${result.job.applied_at||'未记录'}`);
 button(parent,'为此岗位新建对话',async()=>{if(!isCurrent())return;const item=await request('conversation.create',{...scope,title:`${result.job.company} · ${result.job.role}`.slice(0,200)});if(isCurrent())await onNavigate('conversations',item);},onError);
 const controls=document.createElement('nav'),list=document.createElement('div');controls.setAttribute('aria-label','岗位关联对象');parent.append(controls,list);let ticket=0;
 for(const [kind,label]of [['conversations','岗位对话'],['artifacts','相关简历'],['documents','岗位资料'],['runs','岗位运行'],['approvals','岗位草稿']])button(controls,label,async()=>{
   if(!isCurrent())return;const current=++ticket;list.replaceChildren();
   const load=async afterId=>{const page=await request('job.objects',{...scope,kind,...(afterId?{afterId}:{})});if(!isCurrent()||current!==ticket)return;
    if(!afterId&&!page.items.length)text(list,'此范围暂时没有记录。');
    for(const item of page.items)button(list,item.title||'记录',()=>isCurrent()&&current===ticket&&onNavigate(kind,item),onError);
    if(page.nextId){const more=button(list,'继续读取关联对象',async()=>{await load(page.nextId);more.remove();},onError);}
   };await load();
 },onError);
}
export async function runPanel({parent,request,scope,runId,isCurrent,onNavigate,onError}){
 let ticket=0;
 const load=async()=>{const current=++ticket;const result=await request('run.read',{...scope,runId});if(!isCurrent()||current!==ticket)return;
  parent.replaceChildren();text(parent,`运行状态：${states[result.run.state]||'未知'}；开始：${result.run.started_at||'未记录'}；结束：${result.run.ended_at||'尚未结束'}`);
  text(parent,'仅展示运行与工具状态及回执是否保存；不展示隐藏思考、凭据、原始参数或结果。中断任务不会自动重放。');
  button(parent,'刷新运行状态',load,onError);
  button(parent,'打开所属对话',async()=>{const page=await request('workspace.catalogue',{kind:'conversations',objectId:result.run.conversation_id,limit:1});if(isCurrent()&&current===ticket){if(!page.items.length)throw new Error('conversation_unavailable');await onNavigate('conversations',page.items[0]);}},onError);
  const list=document.createElement('div');parent.append(list);
  const append=page=>{if(!page.tools.length&&!page.nextId)text(list,'本页没有工具调用。');for(const tool of page.tools)text(list,`${tool.name} · ${states[tool.state]||'未知'} · 回执${tool.receiptRecorded?'已保存':'未保存'} · ${tool.startedAt||'未记录'} → ${tool.endedAt||'尚未结束'}`);
   if(page.nextId){const more=button(list,'继续读取工具活动',async()=>{const next=await request('run.read',{...scope,runId,afterId:page.nextId});if(isCurrent()&&current===ticket){append(next);more.remove();}},onError);}
  };append(result);
 };await load();
}
