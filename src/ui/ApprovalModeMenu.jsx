import {useEffect,useRef,useState} from "react";
import {Hand,ShieldCheck,ChevronDown,Check} from "lucide-react";
import {api} from "../lib/api";
import {AnimatePresence,motion,useIsPresent} from "framer-motion";
import {useAgentMotion} from "./motion";
const modes=[
 {id:"request",label:"请求批准",description:"联网前请求批准，保留文件权限策略",icon:Hand},
 {id:"assist",label:"帮我批准",description:"允许联网，保留文件权限策略",icon:ShieldCheck},
];
function selectedMode(value){
 if(!value||value.workspace_write!=="ask"||value.file_delete!=="ask")return "custom";
 if(value.web_access==="ask"&&value.browser_bridge==="ask")return "request";
 if(value.web_access==="allow"&&value.browser_bridge==="allow")return "assist";
 return "custom";
}
function ApprovalMenuPanel({menuRef,busy,onKeyDown,children}){
 const {transition,enter,exit}=useAgentMotion();
 const present=useIsPresent();
 return <motion.div ref={menuRef} className="approval-menu rp-permmenu" role="menu" aria-label="审批模式" aria-busy={busy} aria-hidden={!present||undefined} inert={!present?"":undefined} onKeyDown={onKeyDown} style={{pointerEvents:present?undefined:"none"}} initial={enter()} animate={{opacity:1,y:0}} exit={{...exit(),transition:transition("exit")}} transition={transition("enter")}>{children}</motion.div>;
}
export function ApprovalModeMenu({disabled=false}){
 const [settings,setSettings]=useState(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const anchor=useRef(null),menu=useRef(null),container=useRef(null);const alive=useRef(true);const generation=useRef(0);
 useEffect(()=>{
  if(!open)return;
  const closeOutside=event=>{if(!container.current?.contains(event.target))setOpen(false)};
  const escape=event=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);anchor.current?.focus()}};
  document.addEventListener('pointerdown',closeOutside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',escape)};
 },[open]);
 const menuKeys=event=>{
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  const items=[...menu.current.querySelectorAll('[role=menuitemradio]:not(:disabled)')];if(!items.length)return;
  event.preventDefault();const current=items.indexOf(document.activeElement);
  const index=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
  items[index].focus();
 };
 useEffect(()=>{alive.current=true;const ticket=++generation.current;api.permissionSettings().then(value=>{if(alive.current&&ticket===generation.current)setSettings(value)}).catch(()=>{});return()=>{alive.current=false}},[]);
 const mode=selectedMode(settings),current=modes.find(item=>item.id===mode),Icon=current?.icon||ShieldCheck;
 const show=async()=>{if(open){setOpen(false);return}setOpen(true);const ticket=++generation.current;setBusy(true);setError("");try{const value=await api.permissionSettings();if(alive.current&&ticket===generation.current)setSettings(value)}catch(err){if(alive.current&&ticket===generation.current)setError(err.message||"审批设置读取失败")}finally{if(alive.current&&ticket===generation.current)setBusy(false)}};
 const choose=async(id)=>{if(!settings||busy)return;const ticket=++generation.current;setBusy(true);setError("");try{
  // Only supported network policies change. Explicit file/read denials remain intact.
  const saved=await api.updatePermissionSettings({web_access:id==="request"?"ask":"allow",browser_bridge:id==="request"?"ask":"allow"});
  if(alive.current&&ticket===generation.current){setSettings(saved);setOpen(false);window.dispatchEvent(new CustomEvent("fetchcv:permissions",{detail:saved}))}
 }catch(err){if(alive.current&&ticket===generation.current)setError(err.message||"审批设置保存失败")}finally{if(alive.current&&ticket===generation.current)setBusy(false)}};
 return <div ref={container} className="approval-mode-control rp-perm-wrap"><button type="button" ref={anchor} className="composer-mode" aria-label="审批模式" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={show} onKeyDown={event=>{if(open)menuKeys(event)}}><Icon size={13}/><span>{current?.label||(settings?"自定义审批":"审批模式")}</span><ChevronDown size={11}/></button>
 <AnimatePresence>{open&&<ApprovalMenuPanel menuRef={menu} busy={busy} onKeyDown={menuKeys}>
  <div className="h">应如何批准操作？</div>
  {modes.map(item=><button key={item.id} type="button" className="rp-permrow" role="menuitemradio" aria-checked={item.id===mode} disabled={busy||!settings} onClick={()=>choose(item.id)}><item.icon size={16}/><span className="txt"><span className="t">{item.label}</span><span className="d">{item.description}</span></span><Check className="check" size={16}/></button>)}
 </ApprovalMenuPanel>}</AnimatePresence>
 {error&&<p role="alert" className="composer-error">{error}</p>}</div>;
}
