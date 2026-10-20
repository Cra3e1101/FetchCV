export function factConfirmation({card,item,scope,request,isCurrent,onError}){
  if(!scope.candidateId)return;
  const open=document.createElement('button');open.textContent='将这段原文作为个人事实审阅';card.append(open);
  open.addEventListener('click',()=>{
    open.disabled=true;
    const review=document.createElement('div'),note=document.createElement('p'),confirm=document.createElement('button'),cancel=document.createElement('button');
    note.textContent='请确认上方原文描述的是你本人的真实经历。确认后保存为个人事实，并授权助手在此范围内记忆引用；不会自动判断原文是否真实。';
    confirm.textContent='确认属实并记忆引用';cancel.textContent='取消事实确认';
    cancel.addEventListener('click',()=>{review.remove();open.disabled=false;});
    confirm.addEventListener('click',async()=>{
      confirm.disabled=true;cancel.disabled=true;
      try{await request('fact.confirm',{...scope,citation:item.citation});if(isCurrent()){note.textContent='已保存个人事实与记忆引用，可在记忆列表核对和撤回。';confirm.remove();cancel.remove();}}
      catch(error){if(isCurrent()){onError(error);confirm.disabled=false;cancel.disabled=false;}}
    });review.append(note,confirm,cancel);card.append(review);
  });
}

export function factReferences({items,parent,request,content,isCurrent,onError,onChanged}){
  for(const item of items){
    const card=document.createElement('div');card.className='memory-card';
    content(item.evidenceUnavailable?'个人事实引用已不可用，不再提供给助手。':'已确认个人事实 · 知识条目引用',card);content(item.value,card);
    if(!item.evidenceUnavailable)content(`确认时间：${item.confirmedAt}；仅在当前范围使用`,card);
    const source=document.createElement('button');source.textContent='核对个人事实原文';
    source.addEventListener('click',async()=>{try{const result=await request('citation.resolve',{candidateId:item.candidateId,jobId:item.jobId,citation:item.citation});if(isCurrent())content(result.current?result.text:'原文已成为历史版本，此事实引用不再提供给助手。',card);}catch(error){if(isCurrent()){card.replaceChildren();content('来源已不可用，请刷新记忆列表。',card);onError(error);}}});
    const revoke=document.createElement('button');revoke.textContent='停止记忆此事实';
    revoke.addEventListener('click',async()=>{revoke.disabled=true;try{await request('fact.revoke',{candidateId:item.candidateId,jobId:item.jobId,factReferenceId:item.id,expectedRevision:item.revision});if(isCurrent())await onChanged();}catch(error){if(isCurrent()){onError(error);revoke.disabled=false;}}});
    if(!item.evidenceUnavailable)card.append(source);card.append(revoke);parent.append(card);
  }
}
