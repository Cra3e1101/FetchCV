import {settingsPage} from "./settings-shell.js";
export function mcpSettings({trigger,request,getScope}){
 trigger.addEventListener('click',()=>{
  const scope={...getScope()},dialog=document.createElement('dialog');dialog.className='source-reader';dialog.setAttribute('aria-label','MCP 工具设置');
  let generation=0;const current=t=>dialog.open&&generation===t;
  const heading=document.createElement('h2');heading.textContent='MCP 工具设置';
  const note=document.createElement('p');note.textContent='只连接你信任的本地程序。程序以当前用户权限运行，可以访问本机资源；此连接不提供系统沙箱。配置参数中不要填写密码或 API Key。';
  const status=document.createElement('p');status.setAttribute('role','status');
  const actions=document.createElement('div'),body=document.createElement('div');dialog.append(heading,note,status,actions,body);
  function button(parent,label,fn){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(error){if(dialog.open)status.textContent=`未完成（${error.message}）。不会自动重试。`;}finally{b.disabled=false;}});parent.append(b);return b;}
  function text(value,pre=false){const e=document.createElement(pre?'pre':'p');e.textContent=value;body.append(e);return e;}
  function input(label,value='',multiline=false){const l=document.createElement('label'),e=document.createElement(multiline?'textarea':'input');l.textContent=label;l.append(e);e.value=value;body.append(l);return e;}
  async function operation(id){const ticket=++generation,result=await request('mcp.operation',{...scope,operationId:id});if(!current(ticket))return;body.replaceChildren();
   text(`调用状态：${result.state}`);text('请核对工具、目标范围和全部参数。批准只适用于这次调用。');text(JSON.stringify({scope:result.scope,tool:result.snapshot.identity,arguments:result.arguments},null,2),true);
   if(result.receipt)text(JSON.stringify(result.receipt,null,2),true);
   if(result.state==='pending')button(body,'批准这一次调用',async()=>{if(!current(ticket))return;status.textContent='正在执行；外部调用可能产生实际影响。';await request('mcp.execute',{...scope,operationId:id,operationHash:result.operationHash});if(current(ticket)){status.textContent='回执已保存。';await operation(id);}});
   if(['pending','running'].includes(result.state))button(body,result.state==='pending'?'拒绝这次调用':'请求停止调用',async()=>{if(!current(ticket))return;await request('mcp.cancel',{...scope,operationId:id});if(current(ticket))await operation(id);});
   button(body,'刷新调用回执',()=>operation(id));
   if(result.state==='unknown')text('调用结果未知，请先核对外部服务。这里不会重新执行。');
  }
  async function inspect(id){const ticket=++generation,server=await request('mcp.read',{serverId:id});if(!current(ticket))return;body.replaceChildren();text(`${server.name} · ${server.state}`);text(JSON.stringify(server.launch,null,2),true);
   if(server.legacyRequiresReconfiguration){text('旧配置不能执行，请新建并重新授权。');return;}
   if(server.state!=='trusted'){
    const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.className='inline-check';label.append(check,document.createTextNode(' 我信任此程序，并允许它以当前用户权限运行'));body.append(label);
    const trust=button(body,'确认信任此本地程序',async()=>{if(!current(ticket)||!check.checked)return;await request('mcp.control',{serverId:id,expectedRevision:server.revision,state:'trusted',acknowledgeLocalExecution:true});if(current(ticket))await inspect(id);});trust.disabled=true;check.addEventListener('change',()=>{trust.disabled=!check.checked;});
   }else{
    button(body,'连接并发现工具',async()=>{if(!current(ticket))return;await request('mcp.discover',{serverId:id});if(current(ticket))await inspect(id);});
    button(body,'停用服务器并撤销工具授权',async()=>{if(!current(ticket))return;await request('mcp.control',{serverId:id,expectedRevision:server.revision,state:'disabled'});if(current(ticket))await inspect(id);});
    if(server.schemaHash){const grants=new Map();for(const tool of server.tools){
      const d=document.createElement('details'),summary=document.createElement('summary');summary.textContent=tool.name;d.append(summary);const pre=document.createElement('pre');pre.textContent=JSON.stringify(tool,null,2);d.append(pre);body.append(d);
      const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.className='inline-check';check.checked=tool.approved;label.append(check,document.createTextNode(` 允许工具 ${tool.name}`));body.append(label);grants.set(tool.name,check);
      if(tool.approved){const args=input(`${tool.name} 的 JSON 参数`,'{}',true);button(body,`审阅 ${tool.name} 调用`,async()=>{if(!current(ticket))return;let parsed;try{parsed=JSON.parse(args.value);}catch{throw new Error('invalid_json');}const op=await request('mcp.propose',{...scope,serverId:id,toolName:tool.name,expectedToolHash:tool.hash,arguments:parsed});if(current(ticket))await operation(op.id);});}
     }
     button(body,'保存逐工具授权',async()=>{if(!current(ticket))return;await request('mcp.grant',{serverId:id,expectedRevision:server.revision,expectedSchemaHash:server.schemaHash,tools:[...grants].filter(([,check])=>check.checked).map(([name])=>name)});if(current(ticket))await inspect(id);});
    }
   }
  }
  async function list(){const ticket=++generation;body.replaceChildren();async function page(afterId){const result=await request('mcp.list',afterId?{afterId}:{});if(!current(ticket))return;for(const s of result.items)button(body,`${s.name} · ${s.state}`,()=>inspect(s.id));if(!afterId&&!result.items.length)text('尚未配置 MCP 服务器。');if(result.nextId){const more=button(body,'继续读取服务器',async()=>{await page(result.nextId);more.remove();});}}await page();}
  button(actions,'服务器列表',list);
  button(actions,'新建本地服务器',()=>{const ticket=++generation;body.replaceChildren();const name=input('服务器名称'),executable=input('程序绝对路径'),args=input('启动参数 JSON 数组','[]',true);
   button(body,'保存为禁用配置',async()=>{if(!current(ticket))return;let parsed;try{parsed=JSON.parse(args.value);}catch{throw new Error('invalid_json');}const s=await request('mcp.configure',{name:name.value,executable:executable.value,args:parsed});if(current(ticket)){status.textContent='配置已保存，尚未启动。';await inspect(s.id);}});
  });
  button(actions,'当前范围调用记录',async()=>{const ticket=++generation;body.replaceChildren();async function page(afterId){const result=await request('mcp.operations',{...scope,...(afterId?{afterId}:{})});if(!current(ticket))return;for(const op of result.items)button(body,`${op.snapshot.toolName} · ${op.state}`,()=>operation(op.id));if(!afterId&&!result.items.length)text('此范围还没有外部工具调用。');if(result.nextId){const more=button(body,'继续读取调用',async()=>{await page(result.nextId);more.remove();});}}await page();});
  button(actions,'关闭 MCP 设置',()=>dialog.close());dialog.addEventListener('close',()=>{generation++;dialog.remove();trigger.focus();},{once:true});document.body.append(dialog);settingsPage(dialog,"mcp-settings");dialog.showModal();void list().catch(error=>{if(dialog.open)status.textContent=`未完成（${error.message}）。`;});
 });
}
