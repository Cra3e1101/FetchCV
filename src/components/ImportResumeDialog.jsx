import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowUp, Check, FileText, LoaderCircle, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useModalFocusTrap } from "../lib/modal-focus";
import { useAgentMotion } from "../ui/motion";
import "./ImportResumeDialog.css";

export function ImportResumeDialog({ open, candidates, preferredCandidateId, onClose, onImported, onLegacyImport }) {
  const { enter, transition } = useAgentMotion();
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

  const chooseFile = async () => {
    setError(""); setNotice("");
    const selectFile = window.appRuntime?.selectResumeFile || window.appRuntime?.selectResumePdf;
    if (!selectFile) { setError("请在桌面客户端中选择简历文件。"); return; }
    let path;
    try { path = await selectFile(); } catch (err) { setError(err.message || "无法打开文件选择器"); return; }
    if (!path) return;
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 25000);
    setPreview(null); setPhase("working");
    try {
      // Parse locally first. Optional model enhancement is a separate action
      // after the user has inspected the exact redacted outbound text.
      const result = await api.previewResume(path, { aiEnhanced: false, signal: controller.signal });
      if (controller.signal.aborted) return;
      setPreview({ ...result, experiences: (result.experiences || []).map((item, index) => ({ ...item, _source_index: index })) }); setName(result.profile.name || ""); setTitle(result.profile.title || ""); setPhase("review");
    } catch (err) {
      if (previewController.current !== controller) return;
      if (!controller.signal.aborted) setError(err.message);
      else if (controller.signal.reason === "timeout") setError("读取超时，请检查文件是否包含可提取文本。");
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
      const result = await api.previewResume(preview.source_path, { aiEnhanced: true, signal: controller.signal });
      if (controller.signal.aborted) return;
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
      const result = await api.importResume({ source_path: preview.source_path, ai_enhanced: preview.recognition_mode === "ai_enhanced", candidate_id: candidateId === "new" ? null : candidateId, candidate_name: name.trim(), candidate_title: title.trim() || null, reviewed_preview: { source_sha256: preview.source_sha256, source_photo_sha256: preview.source_photo_sha256, profile: { ...preview.profile, name: name.trim(), title: title.trim() }, experiences: preview.experiences } });
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
  return <div className="modal-layer import-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && phase !== "working" && onClose()}>
    <motion.section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="import-title" className={`import-dialog ${phase === "review" ? "is-review" : ""}`} initial={enter()} animate={{ opacity: 1, y: 0 }} transition={transition("enter")}>
      <header className="import-head"><h2 id="import-title">{phase === "review" ? "核对简历" : "导入简历"}</h2><button type="button" className="modal-close" onClick={onClose} disabled={phase === "working"} aria-label="关闭"><X size={17} /></button></header>
      <AnimatePresence initial={false} mode="wait">
        {phase === "select" && <motion.div key="select" className="import-select" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: transition("exit") }} transition={transition("micro")}>
          <button className="resume-file-picker" onClick={chooseFile}><Upload size={25} strokeWidth={1.4} /><strong>选择简历文件</strong><span>PDF · Word (.docx) · LaTeX · JSON</span><small>最大 20 MB</small></button>
          <div className="import-select-footer"><span>在本地读取</span><button onClick={onLegacyImport}>迁移旧版工作区</button></div>
        </motion.div>}
        {phase === "working" && <motion.div key="working" className="import-working" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transition("micro")}><LoaderCircle className="spin" size={24} /><h3>{preview ? "正在保存简历…" : "正在读取简历…"}</h3>{!preview && <button type="button" className="text-button" onClick={cancelPreview}>取消</button>}</motion.div>}
        {phase === "review" && preview && <motion.div key="review" className="import-review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transition("micro")}>
          <div className="file-summary"><FileText size={20} /><div><strong>{preview.filename}</strong><small>{preview.page_count ? `${preview.page_count} 页 · ` : ""}{(preview.size_bytes / 1024).toFixed(0)} KB</small></div><button onClick={chooseFile} disabled={aiBusy}>更换文件</button></div>
          <div className="import-review-columns">
            <aside className="import-source-pane"><h3>原文</h3><pre>{preview.text_preview}</pre></aside>
            <div className="import-fields-pane">
              <div className="profile-fields">
                {candidates.length > 0 && <label className="import-destination">存入<select disabled={aiBusy} value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="new">新建个人资料</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>}
                <label>姓名<input disabled={aiBusy} autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>求职方向<input disabled={aiBusy} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="选填" /></label>
              </div>
              <details className="import-profile-details"><summary>联系信息</summary><div className="profile-fields">{[["phone", "电话"], ["email", "邮箱"], ["website", "个人网站"]].map(([key,label]) => <label key={key}>{label}<input disabled={aiBusy} value={preview.profile[key] || ""} onChange={(event) => setPreview(current => ({ ...current, profile: { ...current.profile, [key]: event.target.value } }))} /></label>)}</div></details>
              <section className="import-experience-review" aria-label="简历内容">
                <div className="import-entries-heading"><h3>简历内容</h3><span>{preview.experiences.length} 项</span></div>
                {preview.experiences.map((experience, index) => <article key={experience._source_index}>
                  <header><select disabled={aiBusy} aria-label={`第 ${index + 1} 项所属模块`} value={experience.kind} onChange={(event) => updateExperience(index, { kind: event.target.value, section: event.target.options[event.target.selectedIndex].text })}><option value="education">教育背景</option><option value="experience">实习/工作经历</option><option value="project">项目经历</option><option value="research">科研经历</option><option value="campus">校园经历</option><option value="award">荣誉奖项</option><option value="skill">技能</option><option value="summary">个人总结</option><option value="other">其他经历</option></select><div><button type="button" disabled={aiBusy || index === 0} onClick={() => moveExperience(index, -1)} aria-label={`上移第 ${index + 1} 项`}><ArrowUp size={13} /></button><button type="button" disabled={aiBusy || index === preview.experiences.length - 1} onClick={() => moveExperience(index, 1)} aria-label={`下移第 ${index + 1} 项`}><ArrowDown size={13} /></button><button type="button" disabled={aiBusy} onClick={() => removeExperience(index)} aria-label={`删除第 ${index + 1} 项`}><Trash2 size={13} /></button></div></header>
                  <div className="import-field-grid"><label>名称<input disabled={aiBusy} value={experience.title || ""} onChange={(event) => updateExperience(index, { title: event.target.value })} /></label><label>组织 / 学校<input disabled={aiBusy} value={experience.organization || ""} onChange={(event) => updateExperience(index, { organization: event.target.value })} /></label><label>角色 / 专业<input disabled={aiBusy} value={experience.role || ""} onChange={(event) => updateExperience(index, { role: event.target.value })} /></label><label>时间<div className="import-date-fields"><input disabled={aiBusy} aria-label={`第 ${index + 1} 项开始时间`} value={experience.start_date || ""} onChange={(event) => updateExperience(index, { start_date: event.target.value })} /><span>—</span><input disabled={aiBusy} aria-label={`第 ${index + 1} 项结束时间`} value={experience.end_date || ""} onChange={(event) => updateExperience(index, { end_date: event.target.value })} /></div></label></div>
                  <label className="import-summary-field">内容<textarea disabled={aiBusy} value={experience.summary || ""} onChange={(event) => updateExperience(index, { summary: event.target.value })} /></label>
                  <footer><label><input type="checkbox" disabled={aiBusy} checked={experience.review_status === "uncertain"} onChange={(event) => updateExperience(index, { review_status: event.target.checked ? "uncertain" : "confirmed" })} />暂无法确认</label></footer>
                </article>)}
                {preview.experiences.length === 0 && <p className="import-no-entries">未识别到经历条目。可尝试增强识别，或更换包含正文的文件。</p>}
              </section>
            </div>
          </div>
          {preview.warnings?.length > 0 && <details className="recognition-warnings"><summary>读取提示 · {preview.warnings.length}</summary><ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
          {modelAvailable && <details className="outbound-preview" open={aiEnhanced} onToggle={(event) => setAiEnhanced(event.currentTarget.open)}>
            <summary><Sparkles size={14} />{preview.recognition_mode === "ai_enhanced" ? "已增强识别" : "使用 AI 增强识别"}</summary>
            <p>仅将以下脱敏文本发送给当前模型。增强识别会重新读取内容，请在修改字段前使用。</p>
            <pre>{preview.outbound_preview || "当前没有可发送的文本"}</pre>
            <button type="button" disabled={aiBusy || !preview.outbound_preview} onClick={enhancePreview}>{aiBusy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{aiBusy ? "正在识别" : "发送并增强识别"}</button>
          </details>}
        </motion.div>}
        {phase === "done" && <motion.div key="done" className="import-done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transition("micro")}><span><Check size={23} /></span><h3>简历已导入</h3></motion.div>}
      </AnimatePresence>
      {notice && <div className="dialog-notice" role="status">{notice}</div>}
      {error && <div className="dialog-error" role="alert">{error}</div>}
      {phase === "review" && <footer className="import-actions"><button className="text-button" disabled={aiBusy} onClick={() => setPhase("select")}><ArrowLeft size={14} />返回</button><button className="primary-button" disabled={!name.trim() || aiBusy} onClick={confirm}>确认导入 <Check size={14} /></button></footer>}
      {phase === "done" && <footer className="import-actions"><button className="primary-button" onClick={onClose}>完成</button></footer>}
    </motion.section>
  </div>;
}
