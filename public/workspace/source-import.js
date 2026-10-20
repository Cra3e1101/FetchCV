export function sourceImportPanel({request,getWorkspaceId,onOpen,onChanged}){
  const el=id=>document.getElementById(id);
  let selected=null,tracked=null,timer=null,epoch=0,ready=false;
  const scope=item=>({candidateId:item?.candidate_id??null,jobId:item?.job_id??null});
  const buttons=['source-cancel','source-retry','source-open','source-revoke','source-confirm-revoke'];
  function message(text){el('source-status').textContent=text;}
  function error(error){message(`未完成（${error.message}）。原件保留，可重新查看状态。`);}
  async function refresh(){
    if(!tracked||!ready)return;const current=tracked,stamp=epoch;
    try{
      const status=await request('source.status',{...current.scope,sourceId:current.sourceId});
      if(stamp!==epoch)return;current.status=status;current.job=status.jobs.at(-1);
      for(const id of buttons)el(id).hidden=true;
      if(status.accessState==='revoked'){message('已停止使用此来源，原件和历史版本保留。');return;}
      el('source-revoke').hidden=false;
      const job=current.job,state=job?.state;
      const blocked=state==='pending'&&status.parser?.state==='unavailable';
      let quality;try{quality=JSON.parse(job?.quality_json??'null');}catch{quality=null;}
      const labels={pending:'已保存原件，等待解析',running:'正在本地解析',failed:'解析失败，原件已保留',cancelled:'解析已取消，原件已保留',completed:quality?.status==='needs_review'?'解析需要复核，暂不用于搜索':'解析完成，可以搜索和核对引用'};
      message(`${current.title} · ${labels[state]??'已保留的历史来源'}`);
      el('source-cancel').hidden=!['pending','running'].includes(state);
      el('source-retry').hidden=!blocked&&!['failed','cancelled'].includes(state);
      el('source-open').hidden=state!=='completed';
      if(state==='failed')message(`${el('source-status').textContent}（${JSON.parse(job.error_json??'{}').code??'parse_failed'}）`);
      if(blocked)message(`${current.title} · 解析已暂停（${status.parser.errorCode}），任务和原件已保留。解决原因后可重试。`);
      if(!blocked&&['pending','running'].includes(state))timer=setTimeout(()=>void refresh(),1000);
    }catch(e){if(stamp===epoch)error(e);}
  }
  function track(value){clearTimeout(timer);epoch++;tracked=value;el('source-controls').hidden=!value;for(const id of buttons)el(id).hidden=true;if(value)void refresh();}
  el('import-source').addEventListener('click',async()=>{
    if(!ready||el('import-source').disabled)return;
    const captureScope=el('import-scope').value==='current'?scope(selected):scope(null);
    el('import-source').disabled=true;message('请选择要导入的原始文件。');
    try{
      const response=await window.workspaceStorage.importFile({v:1,id:crypto.randomUUID(),workspaceId:getWorkspaceId(),method:'source.import',payload:captureScope});
      if(!response?.ok)throw new Error(response?.error?.code??'import_failed');
      if(response.result.cancelled){message('已取消选择，未导入文件。');return;}
      track({sourceId:response.result.sourceId,title:response.result.title,scope:captureScope});await onChanged();
    }catch(e){error(e);}finally{el('import-source').disabled=!ready;}
  });
  for(const [id,method]of [['source-cancel','ingest.cancel'],['source-retry','ingest.retry']])el(id).addEventListener('click',async()=>{
    const current=tracked;if(!current?.job||!ready)return;el(id).disabled=true;clearTimeout(timer);
    try{await request(method,{...current.scope,sourceId:current.sourceId,ingestId:current.job.id});await refresh();}
    catch(e){error(e);}finally{el(id).disabled=false;}
  });
  el('source-refresh').addEventListener('click',()=>{clearTimeout(timer);void refresh();});
  el('source-open').addEventListener('click',()=>{if(tracked?.job?.state==='completed')void onOpen({id:tracked.job.document_id,title:tracked.title,source_id:tracked.sourceId,candidate_id:tracked.scope.candidateId,job_id:tracked.scope.jobId}).catch(error);});
  el('source-revoke').addEventListener('click',()=>{clearTimeout(timer);el('source-confirm-revoke').hidden=false;message('停止使用后，搜索与助手不再读取此来源。原件和历史版本会保留。');});
  el('source-confirm-revoke').addEventListener('click',async()=>{
    const current=tracked;if(!current?.status||!ready)return;el('source-confirm-revoke').disabled=true;
    try{await request('source.revoke',{...current.scope,sourceId:current.sourceId,expectedRevision:current.status.revision});await refresh();await onChanged({revoked:current.sourceId});}
    catch(e){error(e);}finally{el('source-confirm-revoke').disabled=false;}
  });
  window.addEventListener('beforeunload',()=>clearTimeout(timer));
  return {
    ready(value){ready=value;el('import-source').disabled=!value;},
    select(item,kind){selected=item;const current=el('import-scope').options[0];current.disabled=!item;current.textContent=item?`当前记录的范围：${item.job_id?'此岗位':item.candidate_id?'此履历':'工作区'} · ${item.title}`:'请先选择一条记录';el('import-scope').value=item?'current':'workspace';
      track(kind==='documents'&&item?.source_id?{sourceId:item.source_id,title:item.title,scope:scope(item)}:null);
    }
  };
}
