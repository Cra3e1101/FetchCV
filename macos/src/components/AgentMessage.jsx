import { Check, Copy, FileText } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { ProcessingDisclosure } from "./AgentActivity";

const AgentMarkdown = lazy(() => import("./AgentMarkdown"));

export function AgentMessage({ message, pending = false }) {
  const [copied, setCopied] = useState(false);
  const assistant = message.role === "assistant";
  const content = String(message.content || "");
  const processingTrace = message.metadata_json?.processing_trace || [];
  const processingDuration = message.metadata_json?.processing_duration_ms || 0;
  const attachments = message.metadata_json?.attachment_paths || [];
  const copy = async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return <article className={`agent-message ${assistant ? "assistant" : "user"} ${pending ? "pending" : ""}`}>
    <div className="agent-message-content">
      {assistant && <ProcessingDisclosure status="completed" durationMs={processingDuration} events={processingTrace} />}
      {assistant ? <Suspense fallback={<p className="agent-markdown-fallback">{content}</p>}><AgentMarkdown content={content} /></Suspense> : <p>{content}</p>}
      {!assistant && !!attachments.length && <div className="message-attachments">{attachments.map((path) => <span key={path}><FileText size={12} />{String(path).split("/").pop()}</span>)}</div>}
      <div className="agent-message-actions"><button type="button" onClick={copy} aria-label="复制消息" title="复制消息">{copied ? <Check size={13} /> : <Copy size={13} />}</button></div>
    </div>
  </article>;
}
