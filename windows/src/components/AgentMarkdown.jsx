import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { formatInterviewSourceDate, isXiaohongshuSourceUrl } from "../lib/interview-sources";

function safeLink(href) {
  return /^(https?:|mailto:)/i.test(String(href || "")) ? href : undefined;
}

function CodeBlock({ className, children }) {
  const language = /language-([\w+#.-]+)/.exec(className || "")?.[1] || "";
  const raw = String(children || "").replace(/\n$/, "");
  const [copied, setCopied] = useState(false);
  if (!language && !raw.includes("\n")) return <code className="agent-inline-code">{children}</code>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(raw); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return <div className="agent-code-block"><header><span>{language || "text"}</span><button type="button" onClick={copy} aria-label="复制代码">{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "已复制" : "复制"}</button></header><pre><code>{raw}</code></pre></div>;
}

export default function AgentMarkdown({
  content,
  resolveInterviewSource,
  onOpenInterviewSource,
  onOpenInterviewSnapshot,
}) {
  const components = useMemo(() => ({
    a: ({ href, children }) => {
      const safeHref = safeLink(href);
      if (!safeHref) return <span>{children}</span>;
      if (isXiaohongshuSourceUrl(safeHref)) {
        const source = resolveInterviewSource?.(safeHref);
        const resolved = source || { source_url: safeHref, title: String(children || "") };
        return (
          <span className="agent-source-citation">
            <button className="agent-source-link" type="button" onClick={() => onOpenInterviewSource ? onOpenInterviewSource(resolved) : openOriginalInterviewSource(resolved)}>
              {children}<small>{source ? `${formatInterviewSourceDate(source)} · ` : ""}查看原帖</small>
            </button>
            {source && <button className="agent-source-snapshot" type="button" onClick={() => onOpenInterviewSnapshot?.(source)} title="查看 FetchCV 保存的本地备份">备份</button>}
          </span>
        );
      }
      return <a href={safeHref} target="_blank" rel="noreferrer">{children}</a>;
    },
    code: CodeBlock,
    pre: ({ children }) => <>{children}</>,
  }), [onOpenInterviewSnapshot, onOpenInterviewSource, resolveInterviewSource]);
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>;
}
