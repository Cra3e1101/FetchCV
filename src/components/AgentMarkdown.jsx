import { Check, Code2, Copy } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "../ui/agent-links.css";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { formatInterviewSourceDate, isXiaohongshuSourceUrl } from "../lib/interview-sources";
import { AgentTable, MarkdownStreamingContext } from "./AgentTable";

function safeLink(href) {
  return /^(https?:|mailto:)/i.test(String(href || "")) ? href : undefined;
}

function CodeBlock({ className, children }) {
  const language = /language-([\w+#.-]+)/.exec(className || "")?.[1] || "";
  const raw = String(children || "").replace(/\n$/, "");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(raw); setCopied(true); window.clearTimeout(copyTimer.current); copyTimer.current = window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return <div className="agent-code-block rp-mdx"><header className="bar"><Code2 className="ic" size={14} aria-hidden="true" /><span>{language || "text"}</span><button className="hbtn" type="button" onClick={copy} aria-label="复制代码" title={copied ? "已复制" : "复制"}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>{copied&&<span role="status">已复制</span>}</header><pre><code>{raw}</code></pre></div>;
}

const markdownPlugins = [remarkGfm];
// The Markdown AST identifies blocks by their pre parent, including a fenced
// one-line command without a language. Content length cannot distinguish them.
function InlineCode({ children }) { return <code className="agent-inline-code">{children}</code>; }
function CodeContainer({ children }) {
  return <CodeBlock className={children?.props?.className}>{children?.props?.children}</CodeBlock>;
}

const AgentMarkdown = memo(function AgentMarkdown({
  content,
  streaming = false,
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
      return <a className="agent-link" href={safeHref} target="_blank" rel="noreferrer" title={safeHref}>{children}</a>;
    },
    code: InlineCode,
    pre: CodeContainer,
    table: AgentTable,
  }), [onOpenInterviewSnapshot, onOpenInterviewSource, resolveInterviewSource]);
  return <MarkdownStreamingContext.Provider value={streaming}><div className="agent-markdown rp-md"><ReactMarkdown remarkPlugins={markdownPlugins} components={components}>{content}</ReactMarkdown></div></MarkdownStreamingContext.Provider>;
});

export default AgentMarkdown;
