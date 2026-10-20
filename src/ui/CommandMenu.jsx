import {useEffect, useRef, useState} from "react";
import {useModalFocusTrap} from "../lib/modal-focus";

export function CommandMenu({conversations, jobs, onConversation, onJob, onNew, onImport, onSettings, onClose}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const dialog = useRef(null);
  useModalFocusTrap(dialog);
  const entries = [
    ...conversations.map(chat => ({id:`chat-${chat.id}`, label:chat.title, group:"聊天", action:()=>onConversation(chat.id)})),
    ...jobs.map(job => ({id:`job-${job.id}`, label:`${job.company} · ${job.role}`, group:"岗位", action:()=>onJob(job.id)})),
    {id:"new", label:"新对话", group:"快捷操作", action:onNew},
    {id:"import", label:"导入简历", group:"快捷操作", action:onImport},
    {id:"settings", label:"设置", group:"快捷操作", action:onSettings},
  ].filter(item=>item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const active = Math.min(selected, Math.max(0, entries.length-1));
  const execute = item => { if(item) { onClose(); item.action(); } };
  useEffect(()=>{dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:"nearest"});},[active,query]);
  return <div className="command-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="command-menu" role="dialog" aria-modal="true" aria-label="搜索聊天" ref={dialog} onKeyDown={event=>{
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onClose();}
      if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();setSelected((active+(event.key==="ArrowDown"?1:-1)+entries.length)%Math.max(1,entries.length));}
      if(event.key==="Enter"){event.preventDefault();execute(entries[active]);}
      if(event.altKey && /^[1-9]$/.test(event.key)){event.preventDefault();execute(entries[Number(event.key)-1]);}
    }}>
      <label className="command-search"><input autoFocus role="combobox" aria-label="搜索聊天和岗位" aria-controls="command-results" aria-expanded="true" aria-activedescendant={entries[active] ? `command-${entries[active].id}` : undefined} placeholder="搜索聊天" value={query} onChange={event=>{setQuery(event.target.value);setSelected(0);}}/></label>
      <div id="command-results" role="listbox" aria-label="搜索结果" className="command-results">
        {entries.map((item,index)=>{return <div key={item.id}>
          {entries[index-1]?.group!==item.group&&<h2>{item.group}</h2>}
          <button type="button" id={`command-${item.id}`} role="option" tabIndex={-1} aria-selected={index===active} onMouseEnter={()=>setSelected(index)} onClick={()=>execute(item)}><span>{item.label}</span>{index<9&&<kbd>Alt+{index+1}</kbd>}</button>
        </div>;})}
        {!entries.length&&<p className="command-empty">没有匹配的聊天或岗位</p>}
      </div>
    </section>
  </div>;
}
