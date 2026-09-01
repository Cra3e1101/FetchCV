import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowUp, Check, FileText, FolderArchive, LoaderCircle, ShieldCheck, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useModalFocusTrap } from "../lib/modal-focus";

export function ImportResumeDialog({ open, candidates, preferredCandidateId, onClose, onImported, onLegacyImport }) {
  const [phase, setPhase] = useState("select");
  const [preview, setPreview] = useState(null);
  const [candidateId, setCandidateId] = useState(preferredCandidateId || "new");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [modelAvailable, setModelAvailable] = useState(false);
  const [aiEnhanced, setAiEnhanced] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const previewController = useRef(null);
  const dialog = useRef(null);
  useModalFocusTrap(dialog, open);

  useEffect(() => {
    if (!open) return;
    setPhase("select"); setPreview(null); setError(""); setNotice(""); setAiBusy(false);
    setCandidateId(preferredCandidateId || (candidates[0]?.id ?? "new"));
    let active = true;
    api.runtime().then((status) => {
      if (!active) return;
      const available = Boolean(status.configured);
      setModelAvailable(available);
      // Remote parsing is useful but it is never an implied default. The user
      // must choose it after seeing the actual outbound data boundary.
      setAiEnhanced(false);
    }).catch(() => { if (active) { setModelAvailable(false); setAiEnhanced(false); } });
    return () => { active = false; previewController.current?.abort(); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape" && phase !== "working") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, phase, onClose]);

  const choosePdf = async () => {
    setError(""); setNotice("");
    if (!window.appRuntime?.selectResumePdf) { setError("请在桌面客户端中选择 PDF 简历。"); return; }
    const path = await window.appRuntime.selectResumePdf();
    if (!path) return;
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 25000);
    setPhase("working");
    try {
      // Parse locally first. Optional model enhancement is a separate action
      // after the user has inspected the exact redacted outbound text.
      const result = await api.previewResumePdf(path, { aiEnhanced: false, signal: controller.signal });
      setPreview({ ...result, experiences: (result.experiences || []).map((item, index) => ({ ...item, _source_index: index })) }); setName(result.profile.name || ""); setTitle(result.profile.title || ""); setPhase("review");
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message);
      else if (controller.signal.reason === "timeout") setError("本地解析超时，请检查 PDF 是否包含可提取文本。");
      setPhase("select");
    } finally {
      window.clearTimeout(timeout);
      if (previewController.current === controller) previewController.current = null;
    }
  };
  const cancelPreview = () => {
    previewController.current?.abort("user");
    previewController.current = null;
    setPhase("select");
    setError("");
    setNotice("已取消，未保存任何简历内容。");
  };

  const enhancePreview = async () => {
    if (!preview?.source_path || aiBusy) return;
    setAiBusy(true); setError(""); setNotice("");
    const controller = new AbortController();
    previewController.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 60000);
    try {
      const result = await api.previewResumePdf(preview.source_path, { aiEnhanced: true, signal: controller.signal });
      setPreview({ ...result, experiences: (result.experiences || []).map((item, index) => ({ ...item, _source_index: index })) });
      setNotice(result.recognition_mode === "ai_enhanced" ? "AI 增强识别完成；请继续核对结构和字段。" : "模型结果未通过原文证据校验，已保留本地解析结果。");
    } catch (err) {
      setError(controller.signal.reason === "timeout" ? "AI 增强识别超时；本地解析结果仍可继续使用。" : err.message);
    } finally {
      window.clearTimeout(timeout);
      if (previewController.current === controller) previewController.current = null;
      setAiBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview || !name.trim()) return;
    setError(""); setPhase("working");
    try {
      const result = await api.importResumePdf({ source_path: preview.source_path, ai_enhanced: preview.recognition_mode === "ai_enhanced", candidate_id: candidateId === "new" ? null : candidateId, candidate_name: name.trim(), candidate_title: title.trim() || null, reviewed_preview: { source_sha256: preview.source_sha256, profile: { ...preview.profile, name: name.trim(), title: title.trim() }, experiences: preview.experiences } });
      setPhase("done"); await onImported(result);
    } catch (err) { setError(err.message); setPhase("review"); }
  };

  if (!open) return null;
  const updateExperience = (index, patch) => setPreview((current) => ({ ...current, experiences: current.experiences.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  const removeExperience = (index) => setPreview((current) => ({ ...current, experiences: current.experiences.filter((_, itemIndex) => itemIndex !== index) }));
  const moveExperience = (index, offset) => setPreview((current) => {
    const target = index + offset;
    if (target < 0 || target >= current.experiences.length) return current;
    const experiences = [...current.experiences];
    [experiences[index], experiences[target]] = [experiences[target], experiences[index]];
    return { ...current, experiences };
  });
  const sectionTotal = preview?.sections.reduce((sum, item) => sum + item.entry_count, 0) || 0;
  return <div className="modal-layer import-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && phase !== "working" && onClose()}>
    <motion.section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="import-title" className="import-dialog" initial={{ opacity: 0, y: 12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: .24, ease: [0.16, 1, 0.3, 1] }}>
      <header className="import-head"><div><p className="eyebrow">PERSONAL LIBRARY</p><h2 id="import-title">导入基础简历</h2></div><button type="button" className="modal-close" onClick={onClose} disabled={phase === "working"} aria-label="关闭"><X size={16} /></button></header>
      <div className="import-steps" aria-label="导入进度"><span className={phase !== "select" ? "done" : "current"}><b>{phase !== "select" ? <Check size={11} /> : "1"}</b>选择 PDF</span><i /><span className={phase === "review" ? "current" : ["working", "done"].includes(phase) && preview ? "done" : ""}><b>{phase === "done" ? <Check size={11} /> : "2"}</b>核对内容</span><i /><span className={phase === "done" ? "done" : ""}><b>{phase === "done" ? <Check size={11} /> : "3"}</b>建立资料库</span></div>
      <AnimatePresence mode="wait">
        {phase === "select" && <motion.div key="select" className="import-select" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="pdf-drop" onClick={choosePdf}><span><Upload size={21} /></span><strong>选择 PDF 简历</strong><small>支持带文本层的 PDF，最大 20MB</small></button>
          <div className={`ai-recognition-option ${aiEnhanced ? "enabled" : ""}`}>
            <span className="ai-recognition-icon">{aiEnhanced ? <Sparkles size={16} /> : <ShieldCheck size={16} />}</span>
            <div><strong>AI 增强识别（可选）</strong><small>{modelAvailable ? "选择 PDF 后先在本地解析；发送给模型前，你可以展开查看完整的脱敏外发文本。不会上传 PDF 文件或头像。" : "连接模型后可选；当前将完全在本地解析。"}</small></div>
            <button type="button" role="switch" aria-checked={aiEnhanced} aria-label="AI 增强识别" disabled={!modelAvailable} onClick={() => setAiEnhanced((value) => !value)}><i /></button>
          </div>
          <div className="legacy-import"><div><FolderArchive size={16} /><span><strong>使用过旧版简历编辑器？</strong><small>可迁移 resume-editor-prototype 的 JSON 工作区</small></span></div><button onClick={onLegacyImport}>迁移旧数据</button></div>
        </motion.div>}
        {phase === "working" && <motion.div key="working" className="import-working" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><LoaderCircle className="spin" size={24} /><h3>{preview ? "正在建立个人资料库" : "正在本地读取简历"}</h3><p>{preview ? "保存原始 PDF，并把经历拆成可追溯条目…" : "此阶段不会向模型发送任何内容；完成后再由你决定是否增强识别。"}</p>{!preview && <button type="button" className="text-button" onClick={cancelPreview}>停止识别并返回</button>}</motion.div>}
        {phase === "review" && preview && <motion.div key="review" className="import-review" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
          <div className="file-summary"><span><FileText size={18} /></span><div><strong>{preview.filename}</strong><small>{preview.page_count} 页 · {(preview.size_bytes / 1024).toFixed(0)} KB · 提取 {preview.text_length} 个字符</small></div><button onClick={choosePdf}>重新选择</button></div>
          <div className={`recognition-result ${preview.recognition_mode === "ai_enhanced" ? "enhanced" : "local"}`}><span>{preview.recognition_mode === "ai_enhanced" ? <Sparkles size={14} /> : <ShieldCheck size={14} />}</span><div><strong>{preview.recognition_mode === "ai_enhanced" ? "AI 增强识别" : aiEnhanced ? "本地解析完成 · 等待外发确认" : "本地解析"}</strong><small>{preview.recognition_mode === "ai_enhanced" ? `已在本地脱敏 ${preview.redacted_fields.join("、") || "直接身份信息"}，并完成原文证据校验。` : "简历内容尚未发送给外部模型。"}</small></div></div>
          {aiEnhanced && preview.recognition_mode !== "ai_enhanced" && <section className="outbound-preview">
            <header><div><ShieldCheck size={15} /><span><strong>发送前核对</strong><small>以下是将发给当前模型的脱敏文本，共 {preview.outbound_text_length || 0} 字{preview.outbound_truncated ? "（已按 30,000 字上限截断）" : ""}</small></span></div><b>PDF 与头像不会上传</b></header>
            <details><summary>展开查看实际外发内容</summary><pre>{preview.outbound_preview || "当前没有可发送的文本"}</pre></details>
            <button type="button" disabled={aiBusy || !preview.outbound_preview} onClick={enhancePreview}>{aiBusy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{aiBusy ? "正在增强识别" : "确认发送并增强识别"}</button>
          </section>}
          <div className="profile-fields">
            {candidates.length > 0 && <label>存入<select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="new">新建个人资料</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} 的资料库</option>)}</select></label>}
            <label>姓名<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>目标方向（可选）<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：AI 产品 / 数据分析" /></label>
          </div>
          <div className="parse-summary"><div><strong>{preview.sections.length}</strong><small>识别章节</small></div><div><strong>{sectionTotal}</strong><small>经历条目</small></div><div><strong>{preview.profile.email || "未识别"}</strong><small>邮箱</small></div></div>
          <div className="section-chips">{preview.sections.map((section) => <span key={section.key}>{section.title}<b>{section.entry_count}</b></span>)}</div>
          <details className="import-experience-review">
            <summary>逐项核对识别字段 <span>{preview.experiences.length} 项</span></summary>
            <div>{preview.experiences.map((experience, index) => <article key={`${experience._source_index}-${index}`}>
              <header><select aria-label={`第 ${index + 1} 项所属模块`} value={experience.kind} onChange={(event) => updateExperience(index, { kind: event.target.value, section: event.target.options[event.target.selectedIndex].text })}><option value="education">教育背景</option><option value="experience">实习/工作经历</option><option value="project">项目经历</option><option value="research">科研经历</option><option value="campus">校园经历</option><option value="award">荣誉奖项</option><option value="skill">技能</option><option value="summary">个人总结</option><option value="other">其他经历</option></select><div><button type="button" disabled={index === 0} onClick={() => moveExperience(index, -1)} aria-label="上移"><ArrowUp size={12} /></button><button type="button" disabled={index === preview.experiences.length - 1} onClick={() => moveExperience(index, 1)} aria-label="下移"><ArrowDown size={12} /></button><button type="button" onClick={() => removeExperience(index)} aria-label="删除"><Trash2 size={12} /></button></div></header>
              <div className="import-field-grid"><label>名称<input value={experience.title || ""} onChange={(event) => updateExperience(index, { title: event.target.value })} /></label><label>组织/学校<input value={experience.organization || ""} onChange={(event) => updateExperience(index, { organization: event.target.value })} /></label><label>角色/专业<input value={experience.role || ""} onChange={(event) => updateExperience(index, { role: event.target.value })} /></label><label>开始时间<input value={experience.start_date || ""} onChange={(event) => updateExperience(index, { start_date: event.target.value })} /></label><label>结束时间<input value={experience.end_date || ""} onChange={(event) => updateExperience(index, { end_date: event.target.value })} /></label></div>
              <label className="import-summary-field">内容<textarea value={experience.summary || ""} onChange={(event) => updateExperience(index, { summary: event.target.value })} /></label>
              <footer><small>PDF 原文：{experience.details?.raw_text || experience.content || "未保留可定位原文"}</small><button type="button" className={experience.review_status === "uncertain" ? "active" : ""} onClick={() => updateExperience(index, { review_status: experience.review_status === "uncertain" ? "confirmed" : "uncertain" })}>{experience.review_status === "uncertain" ? "已标记无法确认" : "标记无法确认"}</button></footer>
            </article>)}</div>
          </details>
          {preview.warnings?.length > 0 && <details className="recognition-warnings"><summary>识别说明</summary><ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
          <details className="text-preview"><summary>查看提取文本</summary><pre>{preview.text_preview}</pre></details>
        </motion.div>}
        {phase === "done" && <motion.div key="done" className="import-done" initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}><span><Check size={23} /></span><h3>个人资料库已建立</h3><p>原始 PDF 和提取出的经历已经保存。下一步可以新建目标岗位，不需要先处理“事实锁”。</p></motion.div>}
      </AnimatePresence>
      {notice && <div className="dialog-notice" role="status">{notice}</div>}
      {error && <div className="dialog-error" role="alert">{error}</div>}
      <footer className="import-actions">{phase === "review" && <><button className="text-button" onClick={() => setPhase("select")}><ArrowLeft size={13} />返回</button><button className="primary-button" disabled={!name.trim()} onClick={confirm}>确认导入 <Check size={14} /></button></>}{phase === "done" && <button className="primary-button" onClick={onClose}>进入资料库 <Check size={14} /></button>}</footer>
    </motion.section>
  </div>;
}
