import {useEffect,useId,useRef,useState} from "react";
import {Hand,ShieldCheck,ChevronDown,Check} from "lucide-react";
import {api} from "../lib/api";
import {AnimatePresence} from "framer-motion";
import {SelectorPopover} from "./SelectorPopover";
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
export function ApprovalModeMenu({disabled=false}){
 const [settings,setSettings]=useState(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const anchor=useRef(null);const alive=useRef(true);const generation=useRef(0);const menuId=useId();
 useEffect(()=>{if(disabled)setOpen(false)},[disabled]);
 useEffect(()=>{alive.current=true;const ticket=++generation.current;api.permissionSettings().then(value=>{if(alive.current&&ticket===generation.current)setSettings(value)}).catch(()=>{});return()=>{alive.current=false}},[]);
 const mode=selectedMode(settings),current=modes.find(item=>item.id===mode),Icon=current?.icon||ShieldCheck;
 const show=async()=>{if(open){setOpen(false);return}setOpen(true);const ticket=++generation.current;setBusy(true);setError("");try{const value=await api.permissionSettings();if(alive.current&&ticket===generation.current)setSettings(value)}catch(err){if(alive.current&&ticket===generation.current)setError(err.message||"审批设置读取失败")}finally{if(alive.current&&ticket===generation.current)setBusy(false)}};
 const choose=async(id)=>{if(!settings||busy)return;const ticket=++generation.current;setBusy(true);setError("");try{
  // Only supported network policies change. Explicit file/read denials remain intact.
  const saved=await api.updatePermissionSettings({web_access:id==="request"?"ask":"allow",browser_bridge:id==="request"?"ask":"allow"});
  if(alive.current&&ticket===generation.current){setSettings(saved);setOpen(false);const panel=document.getElementById(menuId);if(panel&&!panel.inert&&(panel.contains(document.activeElement)||document.activeElement===document.body))anchor.current?.focus();window.dispatchEvent(new CustomEvent("fetchcv:permissions",{detail:saved}))}
 }catch(err){if(alive.current&&ticket===generation.current)setError(err.message||"审批设置保存失败")}finally{if(alive.current&&ticket===generation.current)setBusy(false)}};
 return <div className="approval-mode-control rp-perm-wrap"><button type="button" ref={anchor} className="composer-mode cds-btn-ghost cds-btn-squish" aria-label="审批模式" aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined} disabled={disabled} onClick={show} onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(!open)void show();else document.getElementById(menuId)?.querySelector('[role=menuitemradio]:not(:disabled)')?.focus()}}}><Icon size={13}/><span>{current?.label||(settings?"自定义审批":"审批模式")}</span><ChevronDown size={11}/></button>
 <AnimatePresence>{open&&<SelectorPopover id={menuId} anchorRef={anchor} onClose={()=>setOpen(false)} focusKey={busy} className="approval-menu rp-permmenu" aria-label="审批模式" aria-busy={busy}>
  <div className="h">应如何批准操作？</div>
  {modes.map(item=><button key={item.id} type="button" tabIndex={-1} className="rp-permrow cds-btn-ghost cds-btn-squish" role="menuitemradio" aria-checked={item.id===mode} disabled={busy||!settings} onClick={()=>choose(item.id)}><item.icon size={16}/><span className="txt"><span className="t">{item.label}</span><span className="d">{item.description}</span></span><Check className="check" size={16}/></button>)}
  {busy&&<p role="status" className="selector-status">正在同步审批设置…</p>}
  {error&&<p role="alert" className="settings-error">{error}</p>}
 </SelectorPopover>}</AnimatePresence></div>;
}
