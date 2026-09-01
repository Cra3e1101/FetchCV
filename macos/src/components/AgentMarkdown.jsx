import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

export default function AgentMarkdown({ content }) {
  const components = useMemo(() => ({
    a: ({ href, children }) => {
      const safeHref = safeLink(href);
      return safeHref ? <a href={safeHref} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
    },
    code: CodeBlock,
    pre: ({ children }) => <>{children}</>,
  }), []);
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>;
}
