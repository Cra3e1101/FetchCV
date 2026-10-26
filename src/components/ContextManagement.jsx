import { useEffect, useId, useRef } from "react";
import { FileText, Plus, Quote, X } from "lucide-react";
import "./ContextManagement.css";

const METRICS = [
  { key: "input", label: "输入", tone: "input" },
  { key: "output", label: "输出", tone: "output" },
  { key: "cacheRead", label: "缓存读取", tone: "read" },
  { key: "cacheWrite", label: "缓存写入", tone: "write" },
];
const formatTokens = (value) => Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";

export function ContextManagement({
  open = false, onOpenChange, usageSummary = {}, attachments = [], quote,
  onRemoveAttachment, onClearQuote, onAddMaterial, attachmentBusy = false, disabled = false,
}) {
  const container = useRef(null);
  const trigger = useRef(null);
  const closeButton = useRef(null);
  const addButton = useRef(null);
  const panelId = useId();
  const usage = usageSummary.usage;
  const referenceCount = attachments.length + (quote ? 1 : 0);
  const totalParts = METRICS.reduce((sum, item) => sum + Math.max(0, usage?.[item.key] || 0), 0);
  const completeBreakdown = METRICS.every(item => Number.isFinite(usage?.[item.key]));
  const total = usage?.total ?? (completeBreakdown ? totalParts : null);
  const denominator = Math.max(total || 0, totalParts, 1);
  const context = usageSummary.context;
  const hasContext = Number.isFinite(context?.usedTokens) && context.usedTokens >= 0 && Number.isFinite(context?.window) && context.window > 0;
  const usageRatio = hasContext ? context.usedTokens / context.window : 0;
  const gaugeRatio = Math.max(0, Math.min(1, usageRatio));
  const estimated = context?.source === "estimated";
  const sourceLabel = estimated ? "估算" : "接口用量";
  const usagePercent = Number.isFinite(context?.percent) ? Math.max(0, Math.min(100, context.percent)) : Math.min(100, Math.round(usageRatio * 100));
  const percentageLabel = `${estimated ? "约 " : ""}${usagePercent}%`;
  const capacityState = hasContext ? usageRatio >= 1 ? "full" : usageRatio >= .8 ? "warning" : "normal" : "unknown";
  const circumference = 2 * Math.PI * 9;

  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!container.current?.contains(event.target)) onOpenChange?.(false);
    };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange?.(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onOpenChange]);

  const close = () => { onOpenChange?.(false); trigger.current?.focus(); };
  return <div ref={container} className="composer-context-control" data-capacity-state={capacityState}>
    <button ref={trigger} type="button" className="composer-context-trigger cds-btn-ghost cds-btn-squish" aria-label="上下文管理"
      aria-description={hasContext ? `上下文已用${percentageLabel}，${formatTokens(context.usedTokens)} / ${formatTokens(context.window)} tokens，${sourceLabel}` : "上下文用量未知"}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      title={hasContext ? `最近请求上下文：${percentageLabel}（${sourceLabel}），${formatTokens(context.usedTokens)} / ${formatTokens(context.window)} tokens${usageRatio > 1 ? "，超出窗口" : ""}` : "查看用量与管理本次引用"} onClick={() => onOpenChange?.(!open)}>
      <svg className="composer-context-gauge" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="context-gauge-track" cx="12" cy="12" r="9" fill="none" strokeWidth="2.5" />
        {hasContext ? <circle className="context-gauge-fill" cx="12" cy="12" r="9" fill="none" strokeWidth="2.5" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - gaugeRatio)} strokeLinecap="round" transform="rotate(-90 12 12)" />
          : <path className="context-gauge-unknown" d="M12 3a9 9 0 0 1 9 9" fill="none" strokeWidth="2.5" strokeLinecap="round" />}
      </svg>
    </button>
    {open && <section id={panelId} className="composer-context-panel" role="dialog" aria-label="上下文管理">
      <header className="context-panel-header"><strong>上下文管理</strong>
        <button ref={closeButton} type="button" aria-label="关闭上下文管理" onClick={close}><X size={15} /></button>
      </header>
      <section className="context-window-section" aria-label="最近请求上下文" aria-description="最近一次请求的输入，包含缓存；不含未发送的草稿和本次输出。">
        <div className="context-window-card">
          <div><span>{hasContext ? "最近请求" : "上下文窗口"}</span><strong>{hasContext ? `${formatTokens(context.usedTokens)} / ${formatTokens(context.window)} tokens` : usageSummary.contextWindow ? `${formatTokens(usageSummary.contextWindow)} tokens` : "尚未提供"}</strong></div>
          <span className="context-window-status">{hasContext ? percentageLabel : "占用未知"}{hasContext && usageRatio > 1 && <small>超出窗口</small>}</span>
        </div>
        {hasContext && <div className="context-capacity-bar" role="progressbar" aria-label="上下文窗口占用" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usagePercent} aria-valuetext={`${percentageLabel}，${sourceLabel}${usageRatio > 1 ? "，超出窗口" : ""}`}><span style={{ width: `${gaugeRatio * 100}%` }} /></div>}
      </section>
      <section className="context-token-section" aria-label="最近一轮累计用量">
        <div className="context-section-heading"><strong>本轮累计</strong><span>{usage ? `${formatTokens(total)} tokens` : "暂无用量"}</span></div>
        {usage && <>
          <div className="context-token-bar" aria-hidden="true">{METRICS.map(item => <span key={item.key} className={`context-tone-${item.tone}`} style={{ width: `${Math.max(0, usage[item.key] || 0) / denominator * 100}%` }} />)}</div>
          <dl className="context-token-breakdown">{METRICS.map(item => <div key={item.key}><dt><i className={`context-tone-${item.tone}`} />{item.label}</dt><dd title={Number.isFinite(usage[item.key]) ? undefined : "未返回"}>{formatTokens(usage[item.key])}</dd></div>)}</dl>
          {usageSummary.modelMismatch && usageSummary.usageModel && <p className="context-usage-model" title={`${usageSummary.usageModel} · 与当前模型不同`}>{usageSummary.usageModel} · 与当前模型不同</p>}
        </>}
      </section>
      <section className="context-reference-section" aria-label="本次发送的引用">
        <div className="context-section-heading"><strong>本次引用</strong>{referenceCount > 0 && <span>{referenceCount} 项</span>}</div>
        {referenceCount > 0 && <ul className="context-reference-list">
          {quote && <li><Quote size={15} aria-hidden="true" /><div><strong title={quote.text}>{quote.text}</strong></div><button type="button" aria-label="从上下文移除引用" onClick={() => { onClearQuote?.(); addButton.current?.focus(); }}><X size={13} /></button></li>}
          {attachments.map(file => <li key={file.workspacePath}><FileText size={15} aria-hidden="true" /><div><strong title={file.workspacePath}>{file.name}</strong></div><button type="button" aria-label={`从上下文移除 ${file.name}`} onClick={() => { onRemoveAttachment?.(file.workspacePath); addButton.current?.focus(); }}><X size={13} /></button></li>)}
        </ul>}
        <button ref={addButton} type="button" className="context-add-file" aria-label="添加上下文文件" disabled={disabled || attachmentBusy} onClick={onAddMaterial}><Plus size={14} aria-hidden="true" />{attachmentBusy ? "正在添加…" : "添加文件"}</button>
      </section>
    </section>}
  </div>;
}
