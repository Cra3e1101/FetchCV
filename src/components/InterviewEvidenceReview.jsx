import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { readInterviewSourceHints } from "../lib/interview-evidence";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";

export function InterviewEvidenceReview({ source, onSaved }) {
  const [kind, setKind] = useState("unknown");
  const [origin, setOrigin] = useState("");
  const [quote, setQuote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [openingCandidate, setOpeningCandidate] = useState("");
  const [hintError, setHintError] = useState("");
  const review = source.metadata_json?.evidence_review;
  const valid = Boolean(review && source.review_content_hash && review.content_hash === source.review_content_hash);
  const hints = readInterviewSourceHints(source);
  useEffect(() => {
    setKind(valid ? review?.source_kind || "unknown" : "unknown");
    setOrigin(valid ? review?.origin_url || "" : "");
    setQuote(valid ? review?.quote || "" : "");
  }, [source.id, valid, review?.source_kind, review?.origin_url, review?.quote]);
  const save = async event => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const updated = await api.reviewInterviewSource(source.id, {
        content_hash: source.review_content_hash, source_kind: kind,
        origin_url: origin, quote, confirmed: true,
      });
      onSaved(updated); setMessage("已保存来源核验");
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const openCandidate = async sourceId => {
    setOpeningCandidate(sourceId); setHintError("");
    try { await openOriginalInterviewSource(await api.interviewSource(sourceId)); }
    catch (reason) { setHintError(reason.message || "未能打开候选来源"); }
    finally { setOpeningCandidate(""); }
  };
  return <>
    <section className="interview-source-hints" aria-label="来源自动提示">
      <small>自动提示 · 待核实</small>
      <p>{hints.classification.label}</p>
      {hints.classification.signals.map((quote, index) => <blockquote key={index}>{quote}</blockquote>)}
      <p>{hints.similarity.label}</p>
      {!!hints.similarity.candidates.length && <div className="interview-similar-candidates">
        {hints.similarity.candidates.map((candidate, index) => <button type="button" key={candidate.sourceId} disabled={Boolean(openingCandidate)} onClick={() => openCandidate(candidate.sourceId)}>
          {openingCandidate === candidate.sourceId ? "打开中…" : `打开候选原帖 ${index + 1} · ${candidate.label}`}
        </button>)}
      </div>}
      {hints.similarity.poolTruncated && <p>本次比对已达到范围预算，仍可能有未比较的来源。</p>}
      <p>相似提示不证明同源或独立性，不会自动合并来源或填写下方核验记录。</p>
      {hintError && <p role="alert">{hintError}</p>}
    </section>
    <details className="interview-evidence-review">
    <summary>来源核验 · {valid ? review.source_kind === "unknown" ? "已撤回" : "已记录" : review ? "正文已变化，需重核" : "未核验"}</summary>
    <p>仅记录你核对过的原文依据；汇编和转载不计作独立亲历。</p>
    <form onSubmit={save}>
      <label>来源类型<select value={kind} onChange={e => setKind(e.target.value)} disabled={busy}>
        <option value="unknown">未知／撤回核验</option><option value="first_person">作者亲历</option>
        <option value="compilation">汇编</option><option value="repost">转载</option>
      </select></label>
      <label>原始来源链接<input type="url" value={origin} onChange={e => setOrigin(e.target.value)} maxLength={4096} required={kind === "first_person"} disabled={busy} placeholder="填写核对过的原始发布链接" /></label>
      <label>原文依据<textarea value={quote} onChange={e => setQuote(e.target.value)} maxLength={2000} required={kind !== "unknown"} disabled={busy} placeholder="从上方正文粘贴能支持此判断的原句" /></label>
      <button type="submit" disabled={busy || !source.review_content_hash}>{busy ? "保存中…" : "确认保存"}</button>
      {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    </form>
    </details>
  </>;
}
