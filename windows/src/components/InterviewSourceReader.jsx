import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, ExternalLink, FileText, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { formatInterviewSourceDate } from "../lib/interview-sources";

export function sourceLabel(source) {
  if (!source) return "来源已移除";
  return source.title || [source.company, source.role].filter(Boolean).join(" · ") || "公开面经";
}

export function sourcePlatformLabel(source) {
  return {
    xiaohongshu: "小红书",
    nowcoder: "牛客",
    zhihu: "知乎",
    csdn: "CSDN",
  }[source?.platform] || "公开来源";
}

export function coverageLabel(source) {
  return source?.metadata_json?.coverage_scope === "same_business_role" ? "同事业部同岗" : "公司同岗";
}

export function SourceReaderDialog({ source, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [openingOriginal, setOpeningOriginal] = useState(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError("");
    setCopied(false);
    if (source?.id) {
      api.interviewSource(source.id)
        .then((value) => { if (active) setDetail(value); })
        .catch((reason) => { if (active) setError(reason?.message || "未能读取本地原文"); });
    }
    const onKeyDown = (event) => { if (event.key === "Escape") onCloseRef.current?.(); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      active = false;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [source?.id]);

  if (!source) return null;
  const resolved = detail || source;
  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(resolved.source_url || "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const openOriginal = async () => {
    setOpeningOriginal(true);
    try {
      await openOriginalInterviewSource(resolved);
    } finally {
      setOpeningOriginal(false);
    }
  };
  return (
    <motion.div className="interview-reader-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="interview-reader" role="dialog" aria-modal="true" aria-label={`面经原文：${sourceLabel(source)}`} initial={{ opacity: 0, scale: .985, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .99, y: 6 }} transition={{ duration: .22, ease: [0.16, 1, 0.3, 1] }}>
        <header>
          <span><FileText size={16} /></span>
          <div>
            <small>{sourcePlatformLabel(resolved)} · {coverageLabel(resolved)} · {formatInterviewSourceDate(resolved)} · 本地证据快照</small>
            <strong>{sourceLabel(resolved)}</strong>
            <p>正文已保存在 FetchCV，可作为原帖暂时不可用时的备用证据。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭原文"><X size={16} /></button>
        </header>
        <div className="interview-reader-meta">
          <span>{resolved.status === "analyzed" ? "已提取问题" : "已保存正文"}</span>
          <span>{(resolved.extracted_questions || []).length} 个原文问题</span>
          <span>{formatInterviewSourceDate(resolved)} 发布</span>
          {resolved.metadata_json?.image_count > 0 && <span>{resolved.metadata_json.image_count} 张图片</span>}
        </div>
        <div className="interview-reader-content">
          {!detail && !error && <div className="interview-reader-loading"><i /><span>正在打开本地快照…</span></div>}
          {error && <p className="interview-reader-error">{error}</p>}
          {detail?.summary && <section className="interview-reader-summary"><small>Agent 摘要</small><p>{detail.summary}</p></section>}
          {!!detail?.extracted_questions?.length && (
            <section className="interview-reader-questions">
              <small>原文中识别的问题</small>
              {detail.extracted_questions.map((question, index) => (
                <article key={`${question.question}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{question.question}</strong>{question.evidence_quote && <blockquote>{question.evidence_quote}</blockquote>}</div>
                </article>
              ))}
            </section>
          )}
          {detail?.raw_text && <section className="interview-reader-raw"><small>保存的正文</small><p>{detail.raw_text}</p></section>}
        </div>
        <footer>
          <span>这里是 FetchCV 保存的备用原文；原始发布页面始终是主入口。</span>
          <div>
            {resolved.source_url && <button type="button" onClick={copySource}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "已复制" : "复制链接"}</button>}
            {resolved.source_url && <button type="button" className="primary" onClick={openOriginal} disabled={openingOriginal}>{openingOriginal ? <LoaderCircle className="spin" size={12} /> : <ExternalLink size={12} />}打开原帖</button>}
          </div>
        </footer>
      </motion.section>
    </motion.div>
  );
}

export function InterviewSourceReader({ source, onClose }) {
  return <AnimatePresence>{source && <SourceReaderDialog source={source} onClose={onClose} />}</AnimatePresence>;
}
