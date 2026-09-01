import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, FileText, FolderArchive, LoaderCircle, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function ImportResumeDialog({ open, candidates, preferredCandidateId, onClose, onImported, onLegacyImport }) {
  const [phase, setPhase] = useState("select");
  const [preview, setPreview] = useState(null);
  const [candidateId, setCandidateId] = useState(preferredCandidateId || "new");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [modelAvailable, setModelAvailable] = useState(false);
  const [aiEnhanced, setAiEnhanced] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhase("select"); setPreview(null); setError("");
    setCandidateId(preferredCandidateId || (candidates[0]?.id ?? "new"));
    let active = true;
    api.runtime().then((status) => {
      if (!active) return;
      const available = Boolean(status.configured);
      setModelAvailable(available);
      setAiEnhanced(available);
    }).catch(() => { if (active) { setModelAvailable(false); setAiEnhanced(false); } });
    return () => { active = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape" && phase !== "working") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, phase, onClose]);

  const choosePdf = async () => {
    setError("");
    if (!window.appRuntime?.selectResumePdf) { setError("请在桌面客户端中选择 PDF 简历。"); return; }
    const path = await window.appRuntime.selectResumePdf();
    if (!path) return;
    setPhase("working");
    try {
      const result = await api.previewResumePdf(path, { aiEnhanced });
      setPreview(result); setName(result.profile.name || ""); setTitle(result.profile.title || ""); setPhase("review");
    } catch (err) { setError(err.message); setPhase("select"); }
  };

  const confirm = async () => {
    if (!preview || !name.trim()) return;
    setError(""); setPhase("working");
    try {
      const result = await api.importResumePdf({ source_path: preview.source_path, ai_enhanced: aiEnhanced, candidate_id: candidateId === "new" ? null : candidateId, candidate_name: name.trim(), candidate_title: title.trim() || null });
      setPhase("done"); await onImported(result);
    } catch (err) { setError(err.message); setPhase("review"); }
  };

  if (!open) return null;
  const sectionTotal = preview?.sections.reduce((sum, item) => sum + item.entry_count, 0) || 0;
  return <div className="modal-layer import-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && phase !== "working" && onClose()}>
    <motion.section role="dialog" aria-modal="true" aria-labelledby="import-title" className="import-dialog" initial={{ opacity: 0, y: 12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: .24, ease: [0.16, 1, 0.3, 1] }}>
      <header className="import-head"><div><p className="eyebrow">PERSONAL LIBRARY</p><h2 id="import-title">导入基础简历</h2></div><button type="button" className="modal-close" onClick={onClose} disabled={phase === "working"} aria-label="关闭"><X size={16} /></button></header>
      <div className="import-steps" aria-label="导入进度"><span className={phase !== "select" ? "done" : "current"}><b>{phase !== "select" ? <Check size={11} /> : "1"}</b>选择 PDF</span><i /><span className={phase === "review" ? "current" : ["working", "done"].includes(phase) && preview ? "done" : ""}><b>{phase === "done" ? <Check size={11} /> : "2"}</b>核对内容</span><i /><span className={phase === "done" ? "done" : ""}><b>{phase === "done" ? <Check size={11} /> : "3"}</b>建立资料库</span></div>
      <AnimatePresence mode="wait">
        {phase === "select" && <motion.div key="select" className="import-select" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="pdf-drop" onClick={choosePdf}><span><Upload size={21} /></span><strong>选择 PDF 简历</strong><small>支持带文本层的 PDF，最大 20MB</small></button>
          <div className={`ai-recognition-option ${aiEnhanced ? "enabled" : ""}`}>
            <span className="ai-recognition-icon">{aiEnhanced ? <Sparkles size={16} /> : <ShieldCheck size={16} />}</span>
            <div><strong>AI 增强识别</strong><small>{modelAvailable ? "姓名和联系方式将在本地脱敏后发送给当前模型，不上传 PDF 和头像。" : "连接模型后可用；当前将完全在本地解析。"}</small></div>
            <button type="button" role="switch" aria-checked={aiEnhanced} aria-label="AI 增强识别" disabled={!modelAvailable} onClick={() => setAiEnhanced((value) => !value)}><i /></button>
          </div>
          <div className="legacy-import"><div><FolderArchive size={16} /><span><strong>使用过旧版简历编辑器？</strong><small>可迁移 resume-editor-prototype 的 JSON 工作区</small></span></div><button onClick={onLegacyImport}>迁移旧数据</button></div>
        </motion.div>}
        {phase === "working" && <motion.div key="working" className="import-working" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><LoaderCircle className="spin" size={24} /><h3>{preview ? "正在建立个人资料库" : aiEnhanced ? "正在增强识别简历" : "正在读取简历"}</h3><p>{preview ? "保存原始 PDF，并把经历拆成可追溯条目…" : aiEnhanced ? "本地提取并脱敏后，由模型判断章节和字段归属…" : "在本地识别页面、章节和经历条目…"}</p></motion.div>}
        {phase === "review" && preview && <motion.div key="review" className="import-review" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
          <div className="file-summary"><span><FileText size={18} /></span><div><strong>{preview.filename}</strong><small>{preview.page_count} 页 · {(preview.size_bytes / 1024).toFixed(0)} KB · 提取 {preview.text_length} 个字符</small></div><button onClick={choosePdf}>重新选择</button></div>
          <div className={`recognition-result ${preview.recognition_mode === "ai_enhanced" ? "enhanced" : "local"}`}><span>{preview.recognition_mode === "ai_enhanced" ? <Sparkles size={14} /> : <ShieldCheck size={14} />}</span><div><strong>{preview.recognition_mode === "ai_enhanced" ? "AI 增强识别" : aiEnhanced ? "AI 未采用，已使用本地结果" : "本地解析"}</strong><small>{preview.recognition_mode === "ai_enhanced" ? `已在本地脱敏 ${preview.redacted_fields.join("、") || "直接身份信息"}，并完成原文证据校验。` : "简历内容未发送给外部模型。"}</small></div></div>
          <div className="profile-fields">
            {candidates.length > 0 && <label>存入<select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="new">新建个人资料</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} 的资料库</option>)}</select></label>}
            <label>姓名<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>目标方向（可选）<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：AI 产品 / 数据分析" /></label>
          </div>
          <div className="parse-summary"><div><strong>{preview.sections.length}</strong><small>识别章节</small></div><div><strong>{sectionTotal}</strong><small>经历条目</small></div><div><strong>{preview.profile.email || "未识别"}</strong><small>邮箱</small></div></div>
          <div className="section-chips">{preview.sections.map((section) => <span key={section.key}>{section.title}<b>{section.entry_count}</b></span>)}</div>
          {preview.warnings?.length > 0 && <details className="recognition-warnings"><summary>识别说明</summary><ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
          <details className="text-preview"><summary>查看提取文本</summary><pre>{preview.text_preview}</pre></details>
        </motion.div>}
        {phase === "done" && <motion.div key="done" className="import-done" initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}><span><Check size={23} /></span><h3>个人资料库已建立</h3><p>原始 PDF 和提取出的经历已经保存。下一步可以新建目标岗位，不需要先处理“事实锁”。</p></motion.div>}
      </AnimatePresence>
      {error && <div className="dialog-error" role="alert">{error}</div>}
      <footer className="import-actions">{phase === "review" && <><button className="text-button" onClick={() => setPhase("select")}><ArrowLeft size={13} />返回</button><button className="primary-button" disabled={!name.trim()} onClick={confirm}>确认导入 <Check size={14} /></button></>}{phase === "done" && <button className="primary-button" onClick={onClose}>进入资料库 <Check size={14} /></button>}</footer>
    </motion.section>
  </div>;
}
