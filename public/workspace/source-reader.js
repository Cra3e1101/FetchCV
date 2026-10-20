// Read only through APP: citations and document permissions are rechecked on open.
export function sourceReaderButton({parent,request,scope,citation,title='引用来源',page,isCurrent}){
  const button=document.createElement('button');button.textContent='打开原文定位';
  button.addEventListener('click',()=>{
    if(!isCurrent())return;
    const dialog=document.createElement('dialog');dialog.className='source-reader';
    dialog.setAttribute('aria-label','原文定位');
    const heading=document.createElement('h2');heading.textContent=title;
    const close=document.createElement('button');close.textContent='关闭原文';close.autofocus=true;
    const status=document.createElement('p');status.setAttribute('role','status');
    const meta=document.createElement('p');meta.className='muted';
    const body=document.createElement('pre');
    const refresh=document.createElement('button');refresh.textContent='重新核对来源';
    const dispose=()=>{dialog.remove();if(button.isConnected)button.focus();};
    close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',dispose,{once:true});
    dialog.append(heading,close,status,meta,body,refresh);document.body.append(dialog);dialog.showModal();
    const load=async()=>{
      refresh.disabled=true;body.replaceChildren();meta.textContent='';status.textContent='正在核对原文…';
      try{
        const resolved=await request('citation.resolve',{...scope,citation});
        const start=Math.max(0,citation.start-300);
        const doc=await request('document.read',{...resolved.sourceScope,documentId:citation.documentId,start});
        if(!dialog.open||!isCurrent())return;
        if(doc.textHash!==citation.textHash||doc.offsetUnit!=='unicode_codepoint')throw new Error('source_revision_mismatch');
        const chars=[...doc.text],from=citation.start-doc.start,to=citation.end-doc.start;
        if(from<0||to>chars.length||chars.slice(from,to).join('')!==resolved.text)throw new Error('source_quote_mismatch');
        const mark=document.createElement('mark');mark.textContent=resolved.text;
        body.append(document.createTextNode(chars.slice(0,from).join('')),mark,document.createTextNode(chars.slice(to,to+300).join('')));
        meta.textContent=`版本 ${doc.version}${page?` · 第 ${page} 页`:''} · 字符 ${citation.start}–${citation.end} · 显示引用及相邻片段`;
        status.textContent=resolved.current?'已定位原文；是否支持结论仍需核对。':'这是历史版本，来源已有更新。';
      }catch{
        if(dialog.open){body.replaceChildren();meta.textContent='';status.textContent='来源已不可用或无法核对。原引用记录保留，请关闭后刷新资料。';}
      }finally{refresh.disabled=false;}
    };
    refresh.addEventListener('click',()=>void load());void load();
  });
  parent.append(button);return button;
}
