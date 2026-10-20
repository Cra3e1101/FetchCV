import {sourceReaderButton} from './source-reader.js';
export function readableCitationMarkers(text,review){
  if(!review)return text;
  let index=0;
  return text.replace(/\[\[cite:([a-f0-9]{64})\]\]/g,(_marker,id)=>{
    const item=review.citations[index++];return item?.referenceId===id?`[${index}]`:'[未核验引用]';
  });
}

export function showAnswerCitations(review,{parent,scope,request,isCurrent}){
  if(!review)return;
  const section=document.createElement('section');section.setAttribute('aria-label','回答来源核验');
  const note=document.createElement('p');
  note.textContent=review.unverifiedRanges.length?'回答含未核验内容，其中的事实和数字需要核对来源。':'引用文字与原文一致；来源是否支持回答的含义，仍需核对。';
  section.append(note);
  const states={exact_quote:'文字与原文一致',unverified_support:'原文可用，含义尚未核验',source_not_current:'来源已有新版本',source_unavailable:'来源已不可用',not_in_context:'引用不在本次证据中'};
  for(const [index,item] of review.citations.entries()){
    const label=document.createElement('p');label.textContent=`引用 ${index+1}：${states[item.verificationState]||'尚未核验'}`;section.append(label);
    if(!item.citation||['source_unavailable','not_in_context'].includes(item.verificationState))continue;
    const button=document.createElement('button'),quote=document.createElement('pre');button.textContent=`查看回答引用 ${index+1} 的原文`;
    button.addEventListener('click',async()=>{
      button.disabled=true;quote.textContent='';
      try{
        const result=await request('citation.resolve',{...scope,citation:item.citation});if(!isCurrent())return;
        quote.textContent=result.text;label.textContent=result.current?'原文仍可用；语义支持尚未核验。':'这是历史版本，来源已有更新。';
      }catch{if(isCurrent())label.textContent='来源已不可用，不能再用这条引用核验回答。';}
      finally{button.disabled=false;}
    });section.append(button,quote);
    sourceReaderButton({parent:section,request,scope,citation:item.citation,title:`回答引用 ${index+1}`,isCurrent});
  }
  parent.append(section);
}
