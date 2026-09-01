import { CalendarDays, Check, ChevronDown, Copy, ExternalLink, FileText, LoaderCircle, Quote, Wrench } from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { ProcessingDisclosure } from "./AgentActivity";
import { InterviewSourceReader, coverageLabel, sourceLabel, sourcePlatformLabel } from "./InterviewSourceReader";
import {
  findInterviewSourceByUrl,
  formatInterviewSourceDate,
  sortInterviewSourcesNewest,
} from "../lib/interview-sources";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { sanitizeAssistantContent } from "../lib/model-protocol";

const AgentMarkdown = lazy(() => import("./AgentMarkdown"));

function ToolReceipt({ receipts = [] }) {
  const completed = receipts.filter((item) => item.status === "completed");
  const evidenceCount = completed.reduce((total, item) => total + (item.artifacts?.length || 0), 0);
  if (!receipts.length) return null;
  return <details className="agent-tool-receipt">
    <summary><span><Wrench size={12} />{completed.length} 个真实工具{evidenceCount ? ` · ${evidenceCount} 条证据` : ""}</span><ChevronDown size={12} /></summary>
    <div>{receipts.map((item) => <article key={item.tool_call_id || `${item.tool_name}-${item.summary}`} className={item.status}>
      <span><strong>{String(item.tool_name || "tool").replaceAll("_", " ")}</strong><small>{item.status === "failed" ? "未完成" : item.requires_user_action ? "等待确认" : "已完成"}</small></span>
      {item.summary && <p>{item.summary}</p>}
      {!!item.artifacts?.length && <small>已登记 {item.artifacts.length} 项可追溯记录</small>}
    </article>)}</div>
  </details>;
}

function InterviewMessageSources({ sources, onOpenOriginal, onOpenSnapshot, openingId }) {
  if (!sources.length) return null;
  return (
    <section className="message-interview-sources">
      <header>
        <span><CalendarDays size={13} />本轮公开面经来源</span>
        <small>最新优先 · {sources.length} 篇</small>
      </header>
      <div>
        {sources.map((source, index) => (
          <article key={source.id || source.source_url}>
            <button type="button" className="message-source-original" onClick={() => onOpenOriginal(source)}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <small>{formatInterviewSourceDate(source)} · {sourcePlatformLabel(source)} · {coverageLabel(source)}</small>
                <strong>{sourceLabel(source)}</strong>
              </div>
              {openingId === source.id ? <LoaderCircle className="spin" size={12} /> : <ExternalLink size={12} />}
            </button>
            <button type="button" className="message-source-snapshot" onClick={() => onOpenSnapshot(source)} title="查看 FetchCV 本地备份"><FileText size={11} /></button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AgentMessage({ message, pending = false, onQuote, interviewSources = [], interviewBriefs = [] }) {
  const [copied, setCopied] = useState(false);
  const [selectionAction, setSelectionAction] = useState(null);
  const [readerSource, setReaderSource] = useState(null);
  const [openingSourceId, setOpeningSourceId] = useState("");
  const contentRef = useRef(null);
  const assistant = message.role === "assistant";
  const content = assistant ? sanitizeAssistantContent(message.content) : String(message.content || "");
  const processingTrace = message.metadata_json?.processing_trace || [];
  const processingDuration = message.metadata_json?.processing_duration_ms || 0;
  const toolReceipts = message.metadata_json?.tool_receipts || [];
  const attachments = message.metadata_json?.attachment_paths || [];
  const quotedText = message.metadata_json?.quoted_text || "";
  const researchBriefId = message.metadata_json?.research_result?.brief_id || "";
  const researchSources = useMemo(() => {
    if (!researchBriefId) return [];
    const brief = interviewBriefs.find((item) => item.id === researchBriefId);
    if (!brief?.source_ids?.length) return [];
    const sourceById = new Map(interviewSources.map((source) => [source.id, source]));
    return sortInterviewSourcesNewest(brief.source_ids.map((id) => sourceById.get(id)).filter(Boolean));
  }, [interviewBriefs, interviewSources, researchBriefId]);
  const resolveInterviewSource = (href) => findInterviewSourceByUrl(href, interviewSources);
  const openOriginalSource = async (source) => {
    setOpeningSourceId(source?.id || source?.source_url || "");
    try {
      await openOriginalInterviewSource(source);
    } finally {
      setOpeningSourceId("");
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  const captureSelection = () => {
    if (!assistant || !onQuote) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const root = contentRef.current;
    const text = selection?.toString().trim().slice(0, 4000) || "";
    if (!range || !root || !text || !root.contains(range.commonAncestorContainer)) {
      setSelectionAction(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    setSelectionAction({
      text,
      top: Math.max(0, rect.top - rootRect.top - 34),
      left: Math.max(4, Math.min(rootRect.width - 72, rect.left - rootRect.left + rect.width / 2 - 34)),
    });
  };
  const quoteSelection = () => {
    if (!selectionAction?.text) return;
    onQuote({ messageId: message.id, text: selectionAction.text });
    window.getSelection()?.removeAllRanges();
    setSelectionAction(null);
  };
  return <article className={`agent-message ${assistant ? "assistant" : "user"} ${pending ? "pending" : ""}`}>
    <div ref={contentRef} className="agent-message-content" onMouseUp={captureSelection}>
      {selectionAction && <button type="button" className="selection-quote-action" style={{ top: selectionAction.top, left: selectionAction.left }} onPointerDown={(event) => event.preventDefault()} onClick={quoteSelection}><Quote size={12} />引用</button>}
      {assistant && <ProcessingDisclosure status="completed" durationMs={processingDuration} events={processingTrace} contextKind={message.metadata_json?.task_kind || "conversation"} />}
      {!assistant && quotedText && <blockquote className="message-quote"><span><Quote size={11} />引用 Agent</span><p>{quotedText}</p></blockquote>}
      {assistant ? (content && <Suspense fallback={<p className="agent-markdown-fallback">{content}</p>}><AgentMarkdown content={content} resolveInterviewSource={resolveInterviewSource} onOpenInterviewSource={openOriginalSource} onOpenInterviewSnapshot={setReaderSource} /></Suspense>) : <p>{content}</p>}
      {assistant && <InterviewMessageSources sources={researchSources} onOpenOriginal={openOriginalSource} onOpenSnapshot={setReaderSource} openingId={openingSourceId} />}
      {assistant && <ToolReceipt receipts={toolReceipts} />}
      {!assistant && !!attachments.length && <div className="message-attachments">{attachments.map((path) => <span key={path}><FileText size={12} />{String(path).split("/").pop()}</span>)}</div>}
      <div className="agent-message-actions"><button type="button" onClick={copy} aria-label="复制消息" title="复制消息">{copied ? <Check size={13} /> : <Copy size={13} />}</button></div>
    </div>
    <InterviewSourceReader source={readerSource} onClose={() => setReaderSource(null)} />
  </article>;
}
