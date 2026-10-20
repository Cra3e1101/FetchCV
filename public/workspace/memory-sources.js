// Every click resolves a stored evidence identity through APP again; the UI
// does not retain an independently trusted copy of a withdrawn source.
export function memorySources({item,card,request,content,isCurrent,onError}){
  const button=document.createElement('button');button.textContent='查看来源消息';
  const panel=document.createElement('div');
  const load=async evidenceId=>{
    panel.replaceChildren();
    try{
      const source=await request('memory.source',{candidateId:item.candidateId,jobId:item.jobId,memoryId:item.id,...(evidenceId?{evidenceId}:{})});
      if(!isCurrent())return;
      content(`来源消息 · ${source.createdAt}`,panel);content(source.text,panel);
      if(source.sources.length>1){
        content(`这条记忆关联了 ${source.sources.length} 条原始证据。`,panel);
        for(const [index,reference] of source.sources.entries()){
          const select=document.createElement('button');select.textContent=`查看来源 ${index+1}`;
          select.addEventListener('click',()=>void load(reference.id));panel.append(select);
        }
      }
    }catch(error){panel.replaceChildren();if(isCurrent())onError(error);}
  };
  button.addEventListener('click',()=>void load());card.append(button,panel);
}
