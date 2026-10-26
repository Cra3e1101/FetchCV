import { useEffect, useId, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { COMPOSER_COMMANDS, MAX_COMPOSER_FILES, MAX_COMPOSER_FILE_BYTES, composerFileKey, createComposerCompositionGuard, getComposerTrigger, removeComposerTrigger, uniqueComposerFiles } from "../lib/composer-input";
import "./ComposerSuggestions.css";

export function useComposerSuggestions({ value, setValue, input, attachments, setAttachments, enabled, onAction }) {
  const [trigger, setTrigger] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeCommand, setActiveCommand] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const listId = useId();
  const guard = useRef(null);
  if (guard.current === null) guard.current = createComposerCompositionGuard(/Apple Computer/.test(navigator.vendor));
  const kind = enabled ? trigger?.kind : null;

  useEffect(() => {
    if (kind !== "file") return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    const list = window.appRuntime?.listWorkspaceFiles;
    if (!list) {
      setFiles([]);
      setError("请在桌面客户端中引用工作区文件。");
      setLoading(false);
      return undefined;
    }
    Promise.resolve().then(() => list()).then((items) => {
      if (!cancelled) setFiles(uniqueComposerFiles(items || []));
    }).catch(() => {
      if (!cancelled) { setFiles([]); setError("文件列表读取失败，请重试。"); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, revision]);

  const query = trigger?.query.toLocaleLowerCase() || "";
  const items = kind === "command"
    ? COMPOSER_COMMANDS.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(query))
    : kind === "file"
      ? uniqueComposerFiles([...attachments, ...files]).filter((item) => `${item.name} ${item.relativePath || item.workspacePath}`.toLocaleLowerCase().includes(query))
      : [];
  const index = Math.min(selectedIndex, Math.max(0, items.length - 1));
  const selected = items[index];
  const fileLoading = kind === "file" && loading;
  const fileError = kind === "file" ? error : "";
  const atLimit = attachments.length >= MAX_COMPOSER_FILES;
  const disabledItem = (item) => kind === "file" && (item.sizeBytes > MAX_COMPOSER_FILE_BYTES || (atLimit && !attachments.some((file) => composerFileKey(file) === composerFileKey(item))));

  const detect = (element) => {
    if (!enabled || guard.current.isComposing) return;
    const next = getComposerTrigger(element.value, element.selectionStart, element.selectionEnd);
    // React also emits select after navigation keys even when the caret did not
    // move. Keep the highlighted row unless the token itself changed.
    if (trigger?.start === next?.start && trigger?.end === next?.end && trigger?.kind === next?.kind && trigger?.query === next?.query) return;
    setTrigger(next);
    setSelectedIndex(0);
  };
  const close = () => setTrigger(null);
  const apply = (item) => {
    if (!trigger || !item || disabledItem(item) || guard.current.isComposing) return;
    const next = removeComposerTrigger(value, trigger);
    setValue(next.value);
    close();
    if (kind === "file") setAttachments((current) => uniqueComposerFiles([...current, item]).slice(0, MAX_COMPOSER_FILES));
    else if (item.action) onAction(item.action);
    else setActiveCommand(item);
    // State commits before restoring the caret; only the trigger range changes.
    requestAnimationFrame(() => {
      if (item.action === "model") return;
      input.current?.focus();
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const onKeyDown = (event) => {
    if (guard.current.ignoreKeyDown(event)) return true;
    if (!kind) return false;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); close(); return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length) setSelectedIndex((index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      // Even an empty/loading menu consumes Enter; dismiss it before sending.
      event.preventDefault();
      if (!fileLoading && !fileError) apply(selected);
      return true;
    }
    if (event.key === "Tab" && !event.shiftKey && selected && !disabledItem(selected) && !fileLoading && !fileError) {
      event.preventDefault(); apply(selected); return true;
    }
    return false;
  };

  return {
    activeCommand, clearCommand: () => setActiveCommand(null), close,
    isComposing: () => guard.current.isComposing,
    reset: () => { close(); setActiveCommand(null); },
    inputProps: {
      onChange: (event) => { setValue(event.target.value); detect(event.target); },
      onSelect: (event) => detect(event.target),
      onBlur: close,
      onCompositionStart: () => { guard.current.start(); close(); },
      onCompositionEnd: (event) => { guard.current.end(event.nativeEvent.timeStamp); detect(event.target); },
      onKeyUp: (event) => guard.current.keyUp(event),
      "aria-autocomplete": "list",
      "aria-haspopup": "listbox",
      "aria-controls": kind ? listId : undefined,
      "aria-activedescendant": kind && selected && !fileLoading && !fileError ? `${listId}-${index}` : undefined,
    },
    onKeyDown,
    menuProps: { kind, listId, items, index, loading: fileLoading, error: fileError, atLimit, disabledItem, apply, onHover: setSelectedIndex, onRetry: () => setRevision((current) => current + 1) },
  };
}

export function ComposerSuggestions({ kind, listId, items, index, loading, error, atLimit, disabledItem, apply, onHover, onRetry }) {
  const list = useRef(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index, kind, items.length]);
  if (!kind) return null;
  const isFile = kind === "file";
  return <aside className="composer-suggestions" onMouseDown={(event) => event.preventDefault()}>
    <header><strong>{isFile ? "引用文件" : "快捷指令"}</strong><small>↑↓ 选择 · Tab 确认 · Esc 关闭</small></header>
    <div ref={list} id={listId} role="listbox" aria-label={isFile ? "引用文件" : "快捷指令"} aria-busy={isFile && loading} className="composer-suggestion-list">
      {!error && !loading && items.map((item, itemIndex) => <button type="button" role="option" tabIndex={-1} aria-selected={itemIndex === index} aria-disabled={disabledItem(item)} id={`${listId}-${itemIndex}`} key={item.id} onMouseMove={() => onHover(itemIndex)} onClick={() => apply(item)} title={isFile ? item.relativePath || item.workspacePath : item.description}>
        <span className="composer-suggestion-icon" aria-hidden="true">{isFile ? <FileText size={16} /> : "/"}</span>
        <span className="composer-suggestion-copy"><strong>{item.name}</strong><small>{isFile ? item.sizeBytes > MAX_COMPOSER_FILE_BYTES ? "超过 50 MiB，无法引用" : item.relativePath || item.workspacePath : item.description}</small></span>
        {itemIndex === index && <span className="composer-suggestion-key" aria-hidden="true">↵</span>}
      </button>)}
    </div>
    {(loading || error || !items.length) && <div className="composer-suggestion-empty" role="status">{loading ? "正在读取工作区文件…" : error || (isFile ? "没有匹配的文件，可通过 + 上传本地文件。" : "没有匹配的指令，请换个关键词。")}{error && window.appRuntime?.listWorkspaceFiles && <button type="button" onClick={onRetry}>重试</button>}</div>}
    {isFile && <footer>{atLimit ? `最多引用 ${MAX_COMPOSER_FILES} 个文件，请先移除已有文件。` : "选择后作为附件随消息发送"}</footer>}
  </aside>;
}
