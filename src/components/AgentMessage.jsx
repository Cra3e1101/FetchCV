import { CalendarDays, Check, Copy, ExternalLink, FileText, Quote } from "lucide-react";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProcessingDisclosure } from "./AgentActivity";
import { InterviewSourceReader, coverageLabel, sourceLabel, sourcePlatformLabel } from "./InterviewSourceReader";
import {
  findInterviewSourceByUrl,
  formatInterviewSourceDate,
  sortInterviewSourcesNewest,
} from "../lib/interview-sources";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { sanitizeAssistantContent } from "../lib/model-protocol";
import { ActivityIndicator } from "../ui/ActivityIndicator";

const AgentMarkdown = lazy(() => import("./AgentMarkdown"));
const EMPTY_ITEMS = [];

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
              {openingId === (source.id || source.source_url) ? <ActivityIndicator priority={5} label="正在打开来源" /> : <ExternalLink size={12} />}
            </button>
            <button type="button" className="message-source-snapshot" onClick={() => onOpenSnapshot(source)} title="查看 FetchCV 本地备份"><FileText size={11} /></button>
          </article>
        ))}
      </div>
    </section>
  );
}

export const AgentMessage = memo(function AgentMessage({ message, pending = false, animate = false, onQuote, interviewSources = EMPTY_ITEMS, interviewBriefs = EMPTY_ITEMS }) {
  const [copied, setCopied] = useState(false);
  const [selectionAction, setSelectionAction] = useState(null);
  const [readerSource, setReaderSource] = useState(null);
  const [openingSourceId, setOpeningSourceId] = useState("");
  const contentRef = useRef(null);
  const copyTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const assistant = message.role === "assistant";
  const content = useMemo(() => assistant ? sanitizeAssistantContent(message.content) : String(message.content || ""), [assistant, message.content]);
  const processingTrace = message.metadata_json?.processing_trace || EMPTY_ITEMS;
  const processingDuration = message.metadata_json?.processing_duration_ms || 0;
  const processingStatus = message.metadata_json?.processing_status || "completed";
  const processingLive = ["running", "stopping", "awaiting_approval"].includes(processingStatus);
  const toolReceipts = message.metadata_json?.tool_receipts || EMPTY_ITEMS;
  const attachments = message.metadata_json?.attachment_paths || EMPTY_ITEMS;
  const quotedText = message.metadata_json?.quoted_text || "";
  const steeringState = message.metadata_json?.steering_state;
  const steeringLabel = { accepted: "已接收，等待本轮读取", consumed: "已纳入本轮上下文", cancelled: "本轮已停止，此条未读取", unconsumed: "本轮未读取，可重新发送" }[steeringState];
  const researchBriefId = message.metadata_json?.research_result?.brief_id || "";
  const researchSources = useMemo(() => {
    if (!researchBriefId) return [];
    const brief = interviewBriefs.find((item) => item.id === researchBriefId);
    if (!brief?.source_ids?.length) return [];
    const sourceById = new Map(interviewSources.map((source) => [source.id, source]));
    return sortInterviewSourcesNewest(brief.source_ids.map((id) => sourceById.get(id)).filter(Boolean));
  }, [interviewBriefs, interviewSources, researchBriefId]);
  const resolveInterviewSource = useCallback((href) => findInterviewSourceByUrl(href, interviewSources), [interviewSources]);
  const openOriginalSource = useCallback(async (source) => {
    setOpeningSourceId(source?.id || source?.source_url || "");
    try {
      await openOriginalInterviewSource(source);
    } finally {
      setOpeningSourceId("");
    }
  }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); window.clearTimeout(copyTimer.current); copyTimer.current = window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
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
  const actions = content && <div className="agent-message-actions rp-msgactions"><button type="button" onClick={copy} aria-label="复制消息" title="复制消息">{copied ? <Check size={13} /> : <Copy size={13} />}</button>{copied && <span role="status" className="copy-feedback">已复制</span>}</div>;
  return <article className={`agent-message rp-msg ${assistant ? "assistant" : "user self"} ${pending ? "pending" : ""} ${animate ? "agent-message-entered" : ""}`}>
    <div ref={contentRef} className={`agent-message-content${assistant ? "" : " rp-bubble"}`} onMouseUp={captureSelection}>
      {selectionAction && <button type="button" className="selection-quote-action" style={{ top: selectionAction.top, left: selectionAction.left }} onPointerDown={(event) => event.preventDefault()} onClick={quoteSelection}><Quote size={12} />引用</button>}
      {assistant && <ProcessingDisclosure status={processingStatus} startedAt={message.metadata_json?.processing_started_at} currentLabel={message.metadata_json?.processing_label} durationMs={processingLive ? undefined : processingDuration} events={processingTrace} receipts={toolReceipts} defaultExpanded={processingLive} />}
      {!assistant && quotedText && <blockquote className="message-quote"><span><Quote size={11} />引用 Agent</span><p>{quotedText}</p></blockquote>}
      {assistant ? (content && <Suspense fallback={<p className="agent-markdown-fallback">{content}</p>}><AgentMarkdown content={content} streaming={message.id === "streaming-assistant" || processingLive} resolveInterviewSource={resolveInterviewSource} onOpenInterviewSource={openOriginalSource} onOpenInterviewSnapshot={setReaderSource} /></Suspense>) : <p>{content}</p>}
      {assistant && <InterviewMessageSources sources={researchSources} onOpenOriginal={openOriginalSource} onOpenSnapshot={setReaderSource} openingId={openingSourceId} />}
      {!assistant && !!attachments.length && <div className="message-attachments">{attachments.map((path) => <span key={path}><FileText size={12} />{String(path).split("/").pop()}</span>)}</div>}
      {!assistant && steeringLabel && <small className="message-input-receipt" role="status">{steeringLabel}</small>}
      {assistant && actions}
    </div>
    {!assistant && actions}
    {readerSource && <InterviewSourceReader source={readerSource} onClose={() => setReaderSource(null)} />}
  </article>;
});
