import { useEffect, useId, useRef, useState } from "react";
import { Blocks, ChevronRight, Paperclip, Plug, Plus, ScrollText } from "lucide-react";
import { ActivityIndicator } from "../ui/ActivityIndicator";
import { SelectorPopover } from "../ui/SelectorPopover";
import "./ComposerAddMenu.css";

export function ComposerAddMenu({ disabled, loading, onUpload, onManage, onOpen }) {
  const [open, setOpen] = useState(false);
  const container = useRef(null);
  const anchor = useRef(null);
  const id = useId();
  const close = () => { setOpen(false); anchor.current?.focus(); };
  const run = (action) => { close(); action?.(); };
  const show = () => { onOpen?.(); setOpen(true); };

  useEffect(() => { if (disabled || loading) setOpen(false); }, [disabled, loading]);
  useEffect(() => {
    const shortcut = (event) => {
      if (disabled || loading || event.isComposing || event.keyCode === 229 || event.repeat || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "u") return;
      if (!container.current?.closest("main")?.contains(document.activeElement)) return;
      event.preventDefault(); setOpen(false); onUpload?.();
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [disabled, loading, onUpload]);
  return <div ref={container} className="composer-add-wrap">
    <button ref={anchor} type="button" className="composer-add cds-btn-ghost cds-btn-squish" aria-label="添加内容" title="添加内容" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled || loading} onClick={() => open ? close() : show()} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); } }}>
      {loading ? <ActivityIndicator active priority={10} label="正在导入附件" /> : <Plus size={18} />}
    </button>
    {open && <SelectorPopover anchorRef={anchor} onClose={() => setOpen(false)} width={280} id={id} className="composer-add-menu" aria-label="添加内容">
      <button type="button" className="cds-btn-ghost cds-btn-squish" role="menuitem" tabIndex={-1} onClick={() => run(onUpload)}><Paperclip size={16} /><span>Add files or photos</span><kbd>{/Mac/.test(navigator.platform) ? "⌘U" : "Ctrl+U"}</kbd></button>
      <div role="separator" />
      <button type="button" className="cds-btn-ghost cds-btn-squish" role="menuitem" tabIndex={-1} disabled={!onManage} onClick={() => run(() => onManage("skills"))}><ScrollText size={16} /><span>Skills</span><ChevronRight size={14} /></button>
      <button type="button" className="cds-btn-ghost cds-btn-squish" role="menuitem" tabIndex={-1} disabled={!onManage} onClick={() => run(() => onManage("mcp"))}><Blocks size={16} /><span>Manage connectors</span></button>
      <button type="button" className="cds-btn-ghost cds-btn-squish" role="menuitem" tabIndex={-1} disabled={!onManage} onClick={() => run(() => onManage("mcp-add"))}><Plug size={16} /><span>Add MCP server</span></button>
    </SelectorPopover>}
  </div>;
}
