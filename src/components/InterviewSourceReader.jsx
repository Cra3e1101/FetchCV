import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { Check, Copy, ExternalLink, FileText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { InterviewEvidenceReview } from "./InterviewEvidenceReview";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { formatInterviewSourceDate } from "../lib/interview-sources";
import { ActivityIndicator } from "../ui/ActivityIndicator";
import { useAgentMotion } from "../ui/motion";
import { useModalFocusTrap } from "../lib/modal-focus";
import "./InterviewSourceReader.css";

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
  return source?.metadata_json?.coverage_scope === "same_business_role" ? "同事业部同岗" : "部门／岗位匹配待核实";
}

export function SourceReaderDialog({ source, onClose }) {
  const { transition, enter, exit } = useAgentMotion();
  const present = useIsPresent();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmingOcr, setConfirmingOcr] = useState(false);
  const [openingOriginal, setOpeningOriginal] = useState(false);
  const onCloseRef = useRef(onClose);
  const dialogRef = useRef(null);
  useModalFocusTrap(dialogRef);

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
  const onEvidenceSaved = updated => {
    setDetail(updated);
    window.dispatchEvent(new CustomEvent("fetchcv:interview-evidence-changed", {
      detail: { sourceId: updated.id, candidateId: updated.candidate_id },
    }));
  };
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
    <motion.div className="interview-reader-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: transition("exit") }} transition={transition("enter")}>
      <motion.section ref={dialogRef} tabIndex={-1} className="interview-reader" role="dialog" aria-modal="true" aria-label={`面经原文：${sourceLabel(source)}`} initial={enter()} animate={{ opacity: 1, y: 0 }} exit={{ ...exit(), transition: transition("exit") }} transition={transition("enter")}>
        <header>
          <span><FileText size={16} /></span>
          <div>
            <small>{sourcePlatformLabel(resolved)} · {formatInterviewSourceDate(resolved)} · 本地备份</small>
            <strong>{sourceLabel(resolved)}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭原文"><X size={16} /></button>
        </header>
        <div className="interview-reader-meta">
          <span>{resolved.status === "ocr_pending" ? "图片 OCR 待核对" : resolved.status === "analyzed" ? "已提取问题" : "已保存正文"}</span>
          {!!resolved.extracted_questions?.length && <span>{resolved.extracted_questions.length} 个问题</span>}
          <span>{coverageLabel(resolved)}</span>
          {resolved.metadata_json?.image_count > 0 && <span>{resolved.metadata_json.image_count} 张图片</span>}
        </div>
        <div className="interview-reader-content">
          {!detail && !error && <div className="interview-reader-loading"><ActivityIndicator active={present} priority={5} label="正在打开本地快照" /><span>正在打开本地快照…</span></div>}
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
          {detail?.raw_text && <InterviewEvidenceReview key={detail.id} source={detail} onSaved={onEvidenceSaved} />}
          {detail?.metadata_json?.ocr_job_id && <section className="interview-reader-raw"><small>本地图片识别</small><p>已保存 {detail.metadata_json.ocr_images_saved || 0} 张，已处理 {detail.metadata_json.ocr_images_processed || 0} 张。状态：{detail.metadata_json.ocr_status || "待处理"}。</p></section>}
          {detail?.metadata_json?.ocr_text && <section className="interview-reader-raw"><small>{detail.metadata_json.ocr_reviewed ? "图片 OCR · 已核对" : "图片 OCR · 待核对"}</small><p>{detail.metadata_json.ocr_reviewed ? "已由用户核对，保留 OCR 来源标记。" : "只处理页面已加载的图片，可能未覆盖整组图片，也可能误识别，尚未作为面试题证据。"}</p><p>{detail.metadata_json.ocr_text}</p></section>}
        </div>
        <footer>
          <div>
            {detail?.status === "ocr_pending" && detail?.metadata_json?.ocr_status === "completed" && <button type="button" disabled={confirmingOcr} onClick={async()=>{setConfirmingOcr(true);try{onEvidenceSaved(await api.confirmInterviewOcr(detail.id,detail.metadata_json.ocr_text));}catch(e){setError(e.message);}finally{setConfirmingOcr(false);}}}>我已核对 OCR 文本</button>}
            {resolved.source_url && <button type="button" onClick={copySource}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "已复制" : "复制链接"}</button>}
            {resolved.source_url && <button type="button" className="primary" onClick={openOriginal} disabled={openingOriginal}>{openingOriginal ? <ActivityIndicator active={present} priority={5} label="正在打开原帖" /> : <ExternalLink size={12} />}打开原帖</button>}
          </div>
        </footer>
      </motion.section>
    </motion.div>
  );
}

export function InterviewSourceReader({ source, onClose }) {
  return <AnimatePresence>{source && <SourceReaderDialog source={source} onClose={onClose} />}</AnimatePresence>;
}
