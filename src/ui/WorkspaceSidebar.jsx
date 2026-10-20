import {useState} from "react";
import {Plus,Folder,Search,MoreHorizontal,PanelLeft,SquarePen,Trash2} from "lucide-react";

export function WorkspaceSidebar({jobs,activeId,activeView,onHome,onSelect,onNew,onManage,onCollapse,conversations=[],activeConversationId,onConversation,onDeleteConversation}) {
 const [query,setQuery]=useState("");
 const [searchOpen,setSearchOpen]=useState(false);
 const filtered=jobs.filter(job=>`${job.company} ${job.role}`.toLowerCase().includes(query.toLowerCase()));
 return <aside className="source-sidebar rp-sidebar" aria-label="工作空间导航">
  <header className="rp-sidebar-head"><div className="rp-mode source-workspace-name">FetchCV</div><div className="source-sidebar-controls"><button type="button" className="source-icon" aria-label="搜索岗位" aria-expanded={searchOpen} onClick={()=>{setSearchOpen(value=>!value);setQuery("");}}><Search size={16}/></button><button type="button" className="source-icon" aria-label="收起侧栏" onClick={onCollapse}><PanelLeft size={16}/></button></div></header>
  <div className="rp-scroll">
    <button type="button" className="rp-row" aria-current={activeView==="home"&&!activeConversationId?"page":undefined} onClick={onHome}><SquarePen size={14}/><span className="lbl">新对话</span></button>
   {searchOpen&&<div className="source-search"><Search size={15}/><input autoFocus aria-label="搜索侧栏岗位" placeholder="搜索岗位" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Escape"){setSearchOpen(false);setQuery("");}}}/></div>}
   <section className="rp-section"><div className="rp-sec"><span>岗位</span><button type="button" className="source-icon" aria-label="新增岗位" onClick={onNew}><Plus size={14}/></button></div>
    {filtered.map(job=><div className="source-job" key={job.id}><button type="button" className="rp-row source-job-item" aria-current={activeView==="job"&&job.id===activeId?"page":undefined} aria-label={`${job.company} ${job.role}`} onClick={()=>onSelect(job.id)}><Folder size={14}/><span className="lbl" title={`${job.company} · ${job.role}`}>{job.company} · {job.role}</span></button><button type="button" className="source-job-menu source-icon" aria-label={`管理 ${job.company} 岗位`} onClick={()=>onManage(job)}><MoreHorizontal size={14}/></button></div>)}
    {!filtered.length&&<p className="source-empty">{query?"没有匹配的岗位":"暂无岗位"}</p>}
   </section>
   <section className="rp-section"><div className="rp-sec"><span>最近对话</span></div>{conversations.map(chat=><div className="source-job" key={chat.id}><button type="button" className="rp-row" aria-current={activeView==="home"&&activeConversationId===chat.id?"page":undefined} onClick={()=>onConversation(chat.id)}><span className="lbl">{chat.title}</span></button><button type="button" className="source-job-menu source-icon" aria-label={`删除对话 ${chat.title}`} onClick={()=>onDeleteConversation(chat)}><Trash2 size={14}/></button></div>)}{jobs.filter(job=>job.latest_run).slice(0,8).map(job=><button type="button" className="rp-row" key={job.id} onClick={()=>onSelect(job.id)}><span className="lbl">{job.company} · {job.role}</span></button>)}</section>
  </div>
 </aside>;
}
