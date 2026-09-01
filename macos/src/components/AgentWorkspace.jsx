import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Check, CheckCircle2, ChevronDown, ChevronRight,
  Download, FileText, LoaderCircle, MessageSquare, Pencil,
  Pause, Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Square, X, XCircle,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentActivity } from "./AgentActivity";
import { AGENT_EFFORT_LEVELS, AgentEffortControl, getAgentEffortApiLevel, getStoredAgentEffort } from "./AgentEffortControl";
import { AgentMessage } from "./AgentMessage";
import { api } from "../lib/api";
import { isChatNearBottom, resolveChatScrollTop } from "../lib/chat-scroll";

const labels = {
  created: "准备任务", input_validating: "核对输入", jd_analyzing: "理解岗位",
  facts_matching: "匹配经历", awaiting_fact_review: "确认经历", strategy_generating: "制定简历策略",
  draft_generating: "生成改写建议", awaiting_user_review: "等待审阅", approved_changes_applying: "应用修改",
  fact_validating: "核验事实", portfolio_building: "组织作品材料", consistency_checking: "一致性检查",
  awaiting_publish_approval: "最终检查", ready_to_publish: "可导出", published: "已记录投递",
  frozen: "已记录投递", failed: "运行失败", blocked: "需要处理", cancelled: "已取消",
};

const conversationScrollPositions = new Map();

function ConversationEmpty({ job }) {
  return <section className="conversation-empty">
    <span className="conversation-empty-mark"><Sparkles size={17} /></span>
    <div>
      <p className="conversation-empty-kicker">岗位工作区</p>
      <h2>从这份 {job.role} 开始</h2>
      <p className="conversation-empty-copy">我会围绕岗位要求理解你的经历，保留原简历结构，只改动有依据的表达。</p>
      <div className="conversation-empty-context"><span>{job.company}</span><span>{job.role}</span></div>
    </div>
  </section>;
}

function ProposalPanel({ detail, busy, onSubmit }) {
  const [decisions, setDecisions] = useState({});
  const proposals = detail.proposals || [];
  const decide = (id, decision, edited_after) => setDecisions((value) => ({ ...value, [id]: { decision, edited_after } }));
  const complete = proposals.length > 0 && proposals.every((item) => decisions[item.id]);
  return <section className="proposal-panel">
    <header><small>简历改写</small><h3>逐条确认，不覆盖原始资料</h3><p>教育背景与身份信息已原样保留；这里只审阅需要岗位化表达的内容。</p></header>
    <div className="proposal-list">{proposals.map((item) => <article key={item.id} className={`${decisions[item.id]?.decision ? "decided" : ""} ${item.section === "no_change" ? "no-change" : ""}`}>
      <div className="proposal-reason"><span>{item.section === "no_change" ? "无需改写" : item.section}</span><p>{item.reason}</p></div>
      <div className="proposal-compare"><div><small>原文</small><p>{item.before}</p></div><div><small>{item.section === "no_change" ? "判断" : "岗位化表达"}</small><p>{item.after}</p></div></div>
      {!!item.jd_evidence?.[0] && item.section !== "no_change" && <div className="proposal-evidence"><small>对应 JD</small><p>{item.jd_evidence[0]}</p></div>}
      {decisions[item.id]?.decision === "edited" && <textarea autoFocus value={decisions[item.id].edited_after || item.after} onChange={(event) => decide(item.id, "edited", event.target.value)} />}
      <footer><button className={decisions[item.id]?.decision === "rejected" ? "active" : ""} onClick={() => decide(item.id, "rejected")}>保留原文</button><button onClick={() => decide(item.id, "edited", item.after)}>编辑后采用</button><button className={decisions[item.id]?.decision === "accepted" ? "active accent" : "accent"} onClick={() => decide(item.id, "accepted")}>采用建议</button></footer>
    </article>)}</div>
    <button className="panel-submit" disabled={!complete || busy} onClick={() => onSubmit(decisions)}>{busy ? <LoaderCircle size={14} /> : <Check size={14} />}应用已确认修改</button>
  </section>;
}

function ProposalReviewOverlay({ detail, busy, onClose, onSubmit }) {
  return <motion.section className="workspace-review-overlay" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
    <header><div><small>简历改写审阅</small><strong>确认模型建议后再应用到当前版本</strong></div><button onClick={onClose} aria-label="关闭改写审阅"><X size={15} /></button></header>
    <div className="workspace-review-scroll"><ProposalPanel detail={detail} busy={busy} onSubmit={onSubmit} /></div>
  </motion.section>;
}

function hasUsableResumeSnapshot(snapshot) {
  return Boolean(
    snapshot
    && typeof snapshot === "object"
    && snapshot.profile
    && typeof snapshot.profile === "object"
    && Array.isArray(snapshot.sections)
  );
}

function ResumeEditorOverlay({ resume, onClose, onSave, onPdfSaved }) {
  const frame = useRef(null);
  const latest = useRef(resume.content_json?.editor_snapshot || {});
  const saveTimer = useRef(null);
  const editorReady = useRef(false);
  const [status, setStatus] = useState("正在载入原编辑器…");
  const editorSrc = `./resume-editor/index.html?embedded=1&resumeId=${encodeURIComponent(resume.id)}&apiBase=${encodeURIComponent(window.appRuntime?.apiBase || "http://127.0.0.1:8766")}&apiToken=${encodeURIComponent(window.appRuntime?.apiToken || "")}`;
  const loadSnapshot = useCallback(async () => {
    if (!hasUsableResumeSnapshot(latest.current)) {
      try {
        const fresh = await api.getResume(resume.id);
        const snapshot = fresh?.content_json?.editor_snapshot;
        if (hasUsableResumeSnapshot(snapshot)) latest.current = snapshot;
      } catch { /* editor bootstrap remains the fallback */ }
    }
    if (!hasUsableResumeSnapshot(latest.current)) {
      setStatus("当前简历数据尚未就绪");
      return;
    }
    const editorWindow = frame.current?.contentWindow;
    editorWindow?.postMessage({ type: "fetchcv:load-snapshot", snapshot: latest.current }, "*");
    try { editorWindow?.fetchCVBridge?.loadSnapshot(latest.current); } catch { /* file:// frames use opaque origins */ }
    setStatus("正在同步当前简历版本…");
  }, [resume.id]);
  const exportPdf = () => {
    setStatus("正在生成正式 PDF…");
    clearTimeout(saveTimer.current);
    void (async () => {
      try {
        await onSave(latest.current);
        const result = await window.appRuntime?.renderResumePdf?.(resume.id);
        if (!result?.ok) throw new Error(result?.message || "PDF 生成失败");
        setStatus("正式 PDF 已保存，与当前预览一致");
        await onPdfSaved?.();
      } catch (error) { setStatus(error.message || "PDF 生成失败"); }
    })();
  };
  useEffect(() => {
    let bridgeAttempts = 0;
    const bridgeTimer = window.setInterval(() => {
      if (editorReady.current) {
        window.clearInterval(bridgeTimer);
        return;
      }
      bridgeAttempts += 1;
      loadSnapshot();
      if (bridgeAttempts >= 40) {
        window.clearInterval(bridgeTimer);
      }
    }, 250);
    const receive = (event) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "fetchcv:editor-ready") {
        editorReady.current = true;
        window.clearInterval(bridgeTimer);
        loadSnapshot();
      }
      if (event.data?.type === "fetchcv:editor-change") {
        if (!editorReady.current || !hasUsableResumeSnapshot(event.data.snapshot)) return;
        latest.current = event.data.snapshot;
        setStatus("正在保存…");
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => { await onSave(event.data.snapshot); setStatus("已自动保存"); }, 700);
      }
      if (event.data?.type === "fetchcv:snapshot-applied") {
        editorReady.current = true;
        setStatus(`已载入 ${event.data.profileName || "当前简历"}`);
      }
      if (event.data?.type === "fetchcv:editor-error") {
        setStatus(event.data.message || "简历编辑器载入失败");
      }
      if (event.data?.type === "fetchcv:pdf-saved") {
        setStatus("正式 PDF 已保存，与当前预览一致");
        onPdfSaved?.();
      }
      if (event.data?.type === "fetchcv:pdf-error") setStatus(event.data.message || "PDF 生成失败");
    };
    window.addEventListener("message", receive);
    return () => { window.clearInterval(bridgeTimer); window.removeEventListener("message", receive); clearTimeout(saveTimer.current); };
  }, [loadSnapshot, onPdfSaved, onSave]);
  const close = async () => { clearTimeout(saveTimer.current); await onSave(latest.current); onClose(); };
  return <motion.div className="resume-editor-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <header><div><button onClick={close}><ArrowLeft size={15} />返回 FetchCV</button><span /><strong>{resume.name}</strong><small>{status}</small></div><div><button onClick={exportPdf}><Download size={14} />导出 PDF</button><button aria-label="关闭编辑器" onClick={close}><X size={15} /></button></div></header>
    <iframe ref={frame} title="FetchCV 简历编辑器" src={editorSrc} onLoad={loadSnapshot} />
  </motion.div>;
}

function CanonicalResumePreview({ pdfUrl, frameRef, onReady }) {
  const pdfSrc = pdfUrl ? `${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH` : "";
  if (!pdfSrc) {
    return <div className="canonical-preview-empty"><FileText size={22} /><strong>正式 PDF 尚未生成</strong><p>完成编辑后生成 PDF，这里只展示最终导出文件。</p></div>;
  }
  return <iframe ref={frameRef} className="canonical-resume-frame source-pdf-frame" title="FetchCV 正式 PDF 预览" src={pdfSrc} onLoad={() => onReady?.(true)} />;
}

function ResumeStudio({ detail, onSaveResumeEditor, onResumePdfSaved }) {
  const resume = detail.resumes?.[0];
  const [editing, setEditing] = useState(false);
  const [previewReady, setPreviewReady] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewFrame = useRef(null);
  const autoRenderKey = useRef("");
  const editorPdfVersion = Number(resume?.content_json?.pdf_renderer_version || 0);
  const staleEditorPdf = resume?.content_json?.pdf_renderer === "resume-editor-prototype" && editorPdfVersion < 2;
  const pdfSaved = useCallback(async () => { setExporting(false); await onResumePdfSaved?.(); }, [onResumePdfSaved]);
  const saveSnapshot = useCallback((snapshotValue) => onSaveResumeEditor(resume?.id, snapshotValue), [onSaveResumeEditor, resume?.id]);
  const handlePreviewReady = useCallback((ready, message) => {
    setPreviewReady(ready);
    if (message) { setPreviewError(message); setExporting(false); }
  }, []);
  useEffect(() => {
    const needsRender = !resume?.pdf_path || staleEditorPdf;
    const renderKey = `${resume?.id || ""}:${editorPdfVersion}`;
    if (!resume?.id || !needsRender || autoRenderKey.current === renderKey) return;
    if (!window.appRuntime?.renderResumePdf) return;
    autoRenderKey.current = renderKey;
    setExporting(true);
    setPreviewError("");
    void (async () => {
      try {
        const result = await window.appRuntime.renderResumePdf(resume.id);
        if (!result?.ok) throw new Error(result?.message || "正式 PDF 生成失败");
        setExporting(false);
        await onResumePdfSaved?.();
      } catch (error) {
        autoRenderKey.current = "";
        setExporting(false);
        setPreviewError(error.message || "正式 PDF 生成失败");
      }
    })();
  }, [editorPdfVersion, onResumePdfSaved, resume?.id, resume?.pdf_path, staleEditorPdf]);
  if (!resume) return <div className="resume-empty"><FileText size={22} /><h3>简历尚未生成</h3><p>完成经历确认和改写审阅后，这里会出现完整简历。</p></div>;
  const pdfVersion = encodeURIComponent(resume.updated_at || resume.content_hash || "current");
  const pdfUrl = resume.pdf_path && !staleEditorPdf ? api.assetUrl(`/api/resumes/${resume.id}/pdf?v=${pdfVersion}`) : "";
  const exportPdf = () => {
    if (resume.content_json?.source_pdf_fidelity && !resume.content_json?.pdf_renderer && pdfUrl) {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setExporting(true); setPreviewError("");
    void (async () => {
      try {
        const result = await window.appRuntime?.renderResumePdf?.(resume.id);
        if (!result?.ok) throw new Error(result?.message || "PDF 生成失败");
        await pdfSaved();
      } catch (error) { setExporting(false); setPreviewError(error.message || "PDF 生成失败"); }
    })();
  };
  const hasCanonicalPdf = Boolean(pdfUrl);
  return <div className="resume-studio-v2">
    <div className="resume-toolbar-v2"><div><i />{hasCanonicalPdf ? "正式 PDF 预览" : "等待正式 PDF"}<small>{hasCanonicalPdf ? "这里只展示已生成的最终文件" : "编辑完成后生成 PDF"}</small></div><div>{hasCanonicalPdf && <a href={pdfUrl} target="_blank" rel="noreferrer"><FileText size={14} />打开已保存 PDF</a>}<button onClick={() => setEditing(true)}><Pencil size={14} />编辑内容与排版</button><button className="accent" disabled={!previewReady || exporting} onClick={exportPdf}>{exporting ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}{exporting ? "正在生成" : "导出正式 PDF"}</button></div></div>
    {previewError && <div className="canonical-preview-error"><AlertCircle size={14} />{previewError}</div>}
    <div className="canonical-resume-preview"><CanonicalResumePreview pdfUrl={pdfUrl} frameRef={previewFrame} onReady={handlePreviewReady} /></div>
    <AnimatePresence>{editing && <ResumeEditorOverlay resume={resume} onClose={() => setEditing(false)} onSave={saveSnapshot} onPdfSaved={onResumePdfSaved} />}</AnimatePresence>
  </div>;
}

function Composer({ busy, streaming, queued, runtime, approvals = [], onSend, onCancel, onAddMaterial, onApprovalDecision, onModelActivated, onManageModels }) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [agentEffort, setAgentEffort] = useState(getStoredAgentEffort);
  const [modelBusy, setModelBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState(null);
  const [modelError, setModelError] = useState("");
  const input = useRef(null);
  const controls = useRef(null);
  useEffect(() => {
    window.appRuntime?.listModelProviders?.().then((store) => setProfiles(store?.profiles || [])).catch(() => {});
  }, [runtime?.model]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (!settingsOpen && !approvalOpen) return undefined;
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "pointerdown" && !controls.current?.contains(event.target))) {
        setSettingsOpen(false);
        setApprovalOpen(false);
        setSettingsSection(null);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, [settingsOpen, approvalOpen]);
  const activeProfile = profiles.find((profile) => profile.id === runtime?.provider_id)
    || profiles.find((profile) => profile.providerName === runtime?.provider_name && profile.model === runtime?.model)
    || profiles.find((profile) => profile.model === runtime?.model)
    || null;
  const activeProfileId = activeProfile?.id || "";
  const selectModel = async (profile, model) => {
    if (!profile?.id || !model || !window.appRuntime?.activateModelProvider) return;
    if (profile.id === activeProfileId && model === runtime?.model) { setSettingsSection(null); return; }
    setModelBusy(true);
    setModelError("");
    try {
      const result = await window.appRuntime.activateModelProvider(profile.id, model);
      setProfiles(result.store?.profiles || profiles.map((item) => item.id === profile.id ? { ...item, model } : item));
      onModelActivated?.(result.runtime);
      setSettingsSection(null);
    } catch (error) { setModelError(error.message || "模型切换失败"); } finally { setModelBusy(false); }
  };
  const thinkingLevel = getAgentEffortApiLevel(agentEffort);
  const submit = async () => {
    if ((!value.trim() && !attachments.length) || streaming) return;
    const content = value.trim() || "请读取并处理这些附件。";
    const attachmentPaths = attachments.map((item) => item.workspacePath);
    setValue(""); setAttachments([]);
    if (input.current) input.current.style.height = "";
    await onSend(content, { thinkingLevel, attachmentPaths });
  };
  const update = (event) => { setValue(event.target.value); event.target.style.height = "0px"; event.target.style.height = `${Math.min(event.target.scrollHeight, 126)}px`; };
  const handlePaste = (event) => {
    // Electron normally forwards Cmd/Ctrl+V through the native window hook.
    // Keep a DOM fallback for browser preview and sandboxed iframe contexts.
    if (event.clipboardData?.getData("text/plain")) return;
    if (!window.appRuntime?.readClipboardText) return;
    event.preventDefault();
    window.appRuntime.readClipboardText().then((text) => {
      if (!text) return;
      const start = input.current?.selectionStart ?? value.length;
      const end = input.current?.selectionEnd ?? start;
      setValue((current) => `${current.slice(0, start)}${text}${current.slice(end)}`);
    }).catch(() => {});
  };
  const currentEffort = AGENT_EFFORT_LEVELS.find((item) => item.id === agentEffort) || AGENT_EFFORT_LEVELS[2];
  const currentModel = modelBusy ? "正在切换" : runtime?.model || activeProfile?.model || "选择模型";
  const openSettings = () => {
    setApprovalOpen(false);
    setSettingsOpen((value) => {
      const next = !value;
      setSettingsSection(null);
      return next;
    });
  };
  const addAttachments = async () => {
    if (attachmentBusy) return;
    setAttachmentBusy(true);
    try {
      const files = await onAddMaterial?.();
      if (files?.length) setAttachments((current) => [...new Map([...current, ...files].map((item) => [item.workspacePath, item])).values()]);
    } finally { setAttachmentBusy(false); }
  };
  const pendingApprovals = approvals.filter((item) => item.status === "pending" && (
    item.action_type?.startsWith("workspace_")
    || item.action_type?.startsWith("permission:")
  ));
  const approvalCopy = {
    workspace_write: "写入本地文件",
    workspace_move: "移动或重命名文件",
    workspace_delete: "删除本地文件",
  };
  return <div className={`agent-composer-v2 ${busy ? "working" : ""}`}>
    {!!attachments.length && <div className="composer-attachments">{attachments.map((file) => <span key={file.workspacePath}><FileText size={13} /><b>{file.name}</b><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.workspacePath !== file.workspacePath))}><X size={12} /></button></span>)}</div>}
    <textarea ref={input} value={value} onChange={update} onPaste={handlePaste} aria-keyshortcuts="Control+Enter Meta+Enter" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.isComposing) return;
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    }} placeholder={queued ? "继续输入，消息会在当前任务停下后处理…" : "询问任何问题，或让 Agent 处理岗位材料…"} />
    {modelError && <div className="composer-error"><AlertCircle size={12} />{modelError}</div>}
    <div ref={controls} className="composer-foot">
      <div className="composer-foot-left">
        <button type="button" className="composer-add" aria-label="添加文件" title="添加文件" disabled={attachmentBusy} onClick={addAttachments}>{attachmentBusy ? <LoaderCircle className="spin" size={16} /> : <Plus size={18} />}</button>
        <div className="composer-control-wrap approval-control-wrap">
          <button type="button" className="approval-trigger" aria-label="查看关键操作确认规则" aria-haspopup="dialog" aria-expanded={approvalOpen} onClick={() => { setApprovalOpen((value) => !value); setSettingsOpen(false); setSettingsSection(null); }}>
            <ShieldCheck size={15} /><span>关键操作确认</span><ChevronDown size={13} />
          </button>
          <AnimatePresence>{approvalOpen && <motion.div role="dialog" aria-label="关键操作确认规则" className="composer-popover approval-popover" initial={{ opacity: 0, y: 6, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 5, scale: .99 }} transition={{ duration: .14 }}>
            <header><div><small>{pendingApprovals.length ? `${pendingApprovals.length} 项等待决定` : "FetchCV 权限边界"}</small><strong>{pendingApprovals.length ? "Agent 请求执行本地操作" : "关键操作由你确认"}</strong></div><ShieldCheck size={16} /></header>
            {pendingApprovals.length ? <div className="pending-approval-list">{pendingApprovals.map((approval) => {
              const request = approval.decision_payload?.items?.[0] || {};
              const argumentsValue = request.arguments || {};
              const pathCopy = argumentsValue.path || [argumentsValue.source_path, argumentsValue.destination_path].filter(Boolean).join(" -> ");
              const permissionCopy = request.tool_name === "search_web" ? "搜索公开网页" : request.tool_name === "read_web_page" ? "读取公开网页" : request.tool_name === "open_browser_page" ? "打开受控浏览器" : request.tool_name === "read_browser_page" ? "读取受控浏览器" : "本地文件操作";
              return <article key={approval.id}><div><strong>{approvalCopy[approval.action_type] || permissionCopy}</strong><small>{pathCopy || request.tool_name}</small></div><p>{approval.action_type?.startsWith("permission:") ? "仅允许本次工具调用；下一次访问仍会重新询问。" : "仅授权这一次具体操作；其他路径仍需重新确认。"}</p><footer><button type="button" disabled={busy} onClick={() => onApprovalDecision?.(approval.id, "rejected")}>拒绝</button><button type="button" className="approve" disabled={busy} onClick={() => onApprovalDecision?.(approval.id, "approved")}>允许并执行</button></footer></article>;
            })}</div> : <div className="approval-rule-list">
              <div><span><FileText size={15} /></span><p><strong>读取已导入资料</strong><small>只在 FetchCV 隔离工作区内读取</small></p><Check size={14} /></div>
              <div><span><Pencil size={15} /></span><p><strong>写入、移动或重命名</strong><small>显示具体路径后逐次批准</small></p><ShieldCheck size={14} /></div>
              <div><span><ShieldCheck size={15} /></span><p><strong>覆盖与删除</strong><small>批准后执行，并在本地保留恢复备份</small></p><ShieldCheck size={14} /></div>
            </div>}
          </motion.div>}</AnimatePresence>
        </div>
      </div>
      <div className="composer-foot-right">
        <div className="composer-control-wrap composer-model-wrap">
        <button type="button" className="composer-control-button model-effort-trigger" aria-label="选择模型和推理强度" aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={openSettings}>
          <i className={runtime?.configured ? "online" : ""} />
          <span className="composer-trigger-copy"><strong>{currentModel}</strong><small>{currentEffort.label}</small></span>
          {modelBusy ? <LoaderCircle className="spin" size={12} /> : <ChevronDown size={12} />}
        </button>
        <AnimatePresence>{settingsOpen && <motion.div role="dialog" aria-label="模型与推理设置" className="composer-popover model-effort-popover" initial={{ opacity: 0, y: 5, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: .99 }} transition={{ duration: .16, ease: [0.16, 1, 0.3, 1] }}>
          <AgentEffortControl disabled={busy} value={agentEffort} onChange={setAgentEffort} />
          <button type="button" className="settings-row model-setting-row" aria-label={settingsSection === "model" ? "收起模型选择" : "打开模型选择"} aria-expanded={settingsSection === "model"} onClick={() => { setSettingsSection((value) => value === "model" ? null : "model"); setModelError(""); }}>
            <span className="model-setting-copy"><small>模型</small><strong><i className={runtime?.configured ? "online" : ""} />{currentModel}</strong></span><ChevronRight size={14} />
          </button>
          {settingsSection === "model" && <div className="model-choice-list">{profiles.map((profile) => {
            const models = profile.availableModels?.length ? profile.availableModels : [{ id: profile.model }];
            const uniqueModels = [...new Map(models.filter((item) => item?.id).map((item) => [item.id, item])).values()];
            return <section key={profile.id}><div className="model-choice-provider"><span className={`provider-status-dot ${profile.health}`} />{profile.providerName}<small>{uniqueModels.length > 1 ? `${uniqueModels.length} 个` : ""}</small></div>{uniqueModels.map((item) => {
              const active = profile.id === activeProfileId && item.id === runtime?.model;
              return <button type="button" role="menuitemradio" aria-checked={active} key={`${profile.id}-${item.id}`} onClick={() => selectModel(profile, item.id)}><span><strong>{item.id}</strong>{item.ownedBy && <small>{item.ownedBy}</small>}</span>{active && <Check size={13} />}</button>;
            })}</section>;
          })}{!profiles.length && <p className="model-menu-empty">还没有已保存的模型连接</p>}<button type="button" className="manage-models-button" onClick={() => { setSettingsOpen(false); setSettingsSection(null); onManageModels?.(); }}><Settings2 size={13} />管理模型连接</button></div>}
          {!!modelError && <p className="settings-error"><AlertCircle size={12} />{modelError}</p>}
        </motion.div>}</AnimatePresence>
        </div>
        <button className={`composer-send ${streaming ? "stop" : ""}`} disabled={!streaming && !value.trim() && !attachments.length} onClick={streaming ? onCancel : submit} aria-label={streaming ? "停止生成" : queued ? "加入消息队列" : "发送消息"}>{streaming ? <Square size={11} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.1} />}</button>
      </div>
    </div>
  </div>;
}

function ExperienceSelector({ detail, busy, onSubmit }) {
  const experiences = detail.experiences || [];
  const approval = detail.approvals.find((item) => item.action_type === "confirm_relevant_facts" && item.status === "pending");
  const ranked = approval?.decision_payload?.items || [];
  const factsByExperience = useMemo(() => detail.facts.reduce((map, fact) => { const id = fact.normalized_value?.experience_id || fact.subject_id; if (id) (map[id] ||= []).push(fact); return map; }, {}), [detail.facts]);
  const idsFor = (experience) => experience.fact_ids?.length ? experience.fact_ids : (factsByExperience[experience.id] || []).map((fact) => fact.id);
  const fixed = experiences.filter((item) => item.kind === "education");
  const adjustable = experiences.filter((item) => item.kind !== "education");
  const recommended = new Set(ranked.filter((item) => item.recommended).map((item) => item.fact_id));
  const initial = adjustable.filter((item) => idsFor(item).some((id) => recommended.has(id))).map((item) => item.id);
  const [selected, setSelected] = useState(() => new Set(initial.length ? initial : adjustable.slice(0, 3).map((item) => item.id)));
  const submit = () => onSubmit([...fixed, ...adjustable.filter((item) => selected.has(item.id))].flatMap(idsFor));
  return <div className="rail-selector">
    <header><small>本次简历</small><strong>选择要重点表达的经历</strong><p>教育与基础信息固定保留；这里只决定哪些实习、项目和技能参与岗位化表达。</p></header>
    {!!fixed.length && <section><div className="rail-selector-title"><span>固定保留</span><small>{fixed.length}</small></div>{fixed.map((item) => <article className="fixed" key={item.id}><span><Check size={11} /></span><div><strong>{item.organization || item.title}</strong><small>{[item.start_date, item.end_date].filter(Boolean).join(" – ")}</small></div></article>)}</section>}
    <section><div className="rail-selector-title"><span>岗位相关经历</span><small>{selected.size}/{adjustable.length}</small></div>{adjustable.map((item) => { const active = selected.has(item.id); const suggested = idsFor(item).some((id) => recommended.has(id)); return <button key={item.id} className={`rail-experience-choice ${active ? "active" : ""}`} onClick={() => setSelected((current) => { const next = new Set(current); active ? next.delete(item.id) : next.add(item.id); return next; })}><span>{active && <Check size={11} />}</span><div><strong>{item.organization || item.title}</strong><small>{item.role || item.kind}</small></div>{suggested && <em>建议</em>}</button>; })}</section>
    <button className="rail-confirm" disabled={busy || !approval} onClick={submit}>{busy ? <LoaderCircle size={14} /> : <Check size={14} />}确认并生成策略</button>
  </div>;
}

function StandardRail({ detail, runtime, busy, task, onStart, onRestart, onOpenResume, onOpenReview, onPublishApproval, onFinalize, onRetry, onPauseTask, onResumeTask, onCancelTask, onOpenModelSettings }) {
  const run = detail.run;
  const profile = detail.profile;
  const stage = run?.current_stage;
  const canRun = runtime?.configured || runtime?.allow_mock_runtime;
  let action = null;
  if (!run && canRun) action = <section className="rail-next-action"><small>下一步</small><div><Sparkles size={15} /><strong>让 Agent 理解岗位</strong><p>读取 JD 并形成岗位重点与经历匹配。</p><button disabled={busy || !detail.job.jd_raw} onClick={onStart}>理解岗位</button></div></section>;
  if (!run && !canRun) action = <section className="rail-next-action"><small>开始之前</small><div><Settings2 size={15} /><strong>连接一个模型</strong><p>岗位理解和简历改写必须由你选择的模型完成。</p><button disabled={busy} onClick={onOpenModelSettings}>连接模型</button></div></section>;
  if (stage === "awaiting_user_review") action = <section className="rail-next-action"><small>需要确认</small><div><Pencil size={15} /><strong>审阅 {detail.proposals.length} 条改写建议</strong><p>建议不会自动覆盖基础简历。若岗位理解或经历组合不对，可以保留本轮并重新规划。</p><button onClick={onOpenReview}>打开改写审阅</button><button className="secondary" disabled={busy} onClick={onRestart}>重新选择经历</button></div></section>;
  if (stage === "awaiting_publish_approval") action = <section className="rail-next-action"><small>下一步</small><div><ShieldCheck size={15} /><strong>事实检查已通过</strong><p>确认后进入简历编辑和导出；也可以保留当前草稿后重新规划。</p><button disabled={busy} onClick={onPublishApproval}>进入导出检查</button><button className="secondary" disabled={busy} onClick={onRestart}>重新规划新版本</button></div></section>;
  if (["ready_to_publish", "published", "frozen"].includes(stage)) action = <section className="rail-next-action ready"><small>{stage === "ready_to_publish" ? "可用操作" : "投递记录"}</small><div><CheckCircle2 size={15} /><strong>{stage === "ready_to_publish" ? "简历可编辑和导出" : "已保存本次投递快照"}</strong><p>当前版本会保留；重新规划会创建新的 Run 和简历版本。</p><button onClick={onOpenResume}>打开简历</button><button className="secondary" disabled={busy} onClick={onRestart}>重新规划新版本</button>{stage === "ready_to_publish" && <button className="secondary" onClick={onFinalize}>记录为已投递</button>}</div></section>;
  if (["failed", "blocked", "cancelled"].includes(stage)) action = <section className="rail-next-action error"><small>需要处理</small><div><AlertCircle size={15} /><strong>{labels[stage]}</strong><p>{(() => { try { return JSON.parse(run.error || "{}").message; } catch { return run.error || "本轮运行中断"; } })()}</p><button disabled={busy} onClick={onRetry}><RotateCcw size={13} />从中断处重试</button></div></section>;
  const taskRunning = ["queued", "running"].includes(task?.status);
  return <div className="standard-rail"><section><small>当前状态</small><div className="rail-state"><span className={taskRunning ? "running" : ""}><Sparkles size={14} /></span><div><strong>{taskRunning ? (task.status === "queued" ? "等待执行" : labels[stage] || "Agent 工作中") : run ? labels[stage] || run.status : "等待开始"}</strong><p>{run ? `${detail.steps.filter((item) => item.event_type === "stage" || item.event_type === "tool").length} 条真实执行记录` : "提供 JD 后开始"}</p></div></div>{task && <div className="task-controls">{taskRunning && <button onClick={onPauseTask} title="暂停任务"><Pause size={13} />暂停</button>}{task?.status === "paused" && !["awaiting_fact_review", "awaiting_user_review", "awaiting_publish_approval"].includes(stage) && <button onClick={onResumeTask} title="恢复任务"><Play size={13} />恢复</button>}{taskRunning && <button className="danger" onClick={onCancelTask} title="取消任务"><XCircle size={13} />取消</button>}</div>}</section>{action}{profile && <section><small>岗位重点</small><strong className="rail-heading">{profile.competencies?.slice(0, 3).join(" · ") || "等待形成岗位重点"}</strong><div className="rail-tags">{(profile.keywords || []).slice(0, 7).map((item) => <span key={item}>{item}</span>)}</div></section>}<section><small>材料</small><div className="rail-assets"><p><FileText size={13} />简历版本 <b>{detail.resumes.length}</b></p><p><ShieldCheck size={13} />已验证事实 <b>{detail.facts.filter((item) => item.verified).length}</b></p></div></section></div>;
}

export function AgentWorkspace({ detail, runtime, busy, error, activity, task, onStart, onRestart, onFactReview, onReview, onPublishApproval, onRetry, onPauseTask, onResumeTask, onCancelTask, onFinalize, onSendMessage, onCancelMessage, onAddMaterial, onApprovalDecision, onModelActivated, onOpenModelSettings, onSaveResumeEditor, onResumePdfSaved }) {
  const [tab, setTab] = useState("conversation");
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const conversationScroll = useRef(null);
  const userIsNearBottom = useRef(true);
  const scrollFrame = useRef(null);
  const run = detail.run;
  useEffect(() => { if (!detail.resumes?.length) setTab("conversation"); }, [detail.job.id, detail.resumes?.length]);
  useEffect(() => { if (run?.current_stage !== "awaiting_user_review") setReviewOpen(false); }, [run?.current_stage]);
  const scrollToLatest = (behavior = "smooth") => {
    const node = conversationScroll.current;
    if (!node) return;
    userIsNearBottom.current = true;
    setShowJumpToLatest(false);
    node.scrollTo({ top: node.scrollHeight, behavior });
  };
  useLayoutEffect(() => {
    if (tab !== "conversation") return;
    const node = conversationScroll.current;
    if (!node) return;
    const saved = conversationScrollPositions.get(detail.job.id);
    node.scrollTop = resolveChatScrollTop(saved, node.scrollHeight, node.clientHeight);
    userIsNearBottom.current = isChatNearBottom(node);
    setShowJumpToLatest(!userIsNearBottom.current);
  }, [detail.job.id, tab]);
  useLayoutEffect(() => {
    if (tab !== "conversation" || !userIsNearBottom.current) {
      if (tab === "conversation") setShowJumpToLatest(true);
      return;
    }
    scrollFrame.current = window.requestAnimationFrame(() => scrollToLatest("smooth"));
    return () => window.cancelAnimationFrame(scrollFrame.current);
  }, [tab, detail.messages?.length, pendingPrompt, activity?.startedAt]);
  useEffect(() => () => { if (scrollFrame.current) window.cancelAnimationFrame(scrollFrame.current); }, []);
  const handleConversationScroll = () => {
    const node = conversationScroll.current;
    if (!node) return;
    conversationScrollPositions.set(detail.job.id, node.scrollTop);
    userIsNearBottom.current = isChatNearBottom(node);
    setShowJumpToLatest(!userIsNearBottom.current);
  };
  const send = async (content, options) => {
    setPendingPrompt(content);
    window.requestAnimationFrame(() => scrollToLatest("smooth"));
    await onSendMessage(content, options);
    setPendingPrompt("");
  };
  const messages = detail.messages || [];
  const pendingAlreadyStored = pendingPrompt && messages.slice(-2).some((message) => message.role === "user" && message.content === pendingPrompt);
  const streamingMessage = messages.find((message) => message.id === "streaming-assistant");
  const settledMessages = messages.filter((message) => message.id !== "streaming-assistant");
  const queuedMessages = (detail.queued_messages || []).filter((message) => ["queued", "processing"].includes(message.status));
  const taskRunning = ["queued", "running"].includes(task?.status);
  return <>
    <main className="main-pane agent-workspace-v2">
      <header className="task-header"><div><span>{detail.job.company}</span><h1>{detail.job.role}</h1></div><nav className="workspace-tabs"><button className={tab === "conversation" ? "active" : ""} onClick={() => setTab("conversation")}><MessageSquare size={14} />对话</button><button disabled={!detail.resumes?.length} className={tab === "resume" ? "active" : ""} onClick={() => setTab("resume")}><FileText size={14} />简历</button></nav><div className="task-meta"><i className={taskRunning || activity ? "running" : ""} />{taskRunning ? "Agent 工作中" : activity ? "正在回答" : run ? labels[run.current_stage] || run.status : "尚未开始"}</div></header>
      {tab === "resume" ? <div className="content-scroll studio-scroll"><ResumeStudio detail={detail} onSaveResumeEditor={onSaveResumeEditor} onResumePdfSaved={onResumePdfSaved} /></div> : <>
        <div ref={conversationScroll} onScroll={handleConversationScroll} className="content-scroll conversation-scroll-v2"><div className="conversation-stream">
          {!messages.length && !pendingPrompt && <ConversationEmpty job={detail.job} />}
          {settledMessages.map((message) => <AgentMessage key={message.id} message={message} />)}
          {pendingPrompt && !pendingAlreadyStored && <AgentMessage message={{ id: "pending-user", role: "user", content: pendingPrompt }} pending />}
          <AgentActivity activity={activity} run={run} task={task} steps={detail.steps} />
          {queuedMessages.map((message) => <div className="queued-message" key={message.id}><span>{message.status === "processing" ? <LoaderCircle className="spin" size={12} /> : <MessageSquare size={12} />}</span><p>{message.content}</p><small>{message.status === "processing" ? "正在处理" : "已排队"}</small></div>)}
          {streamingMessage && <AgentMessage key={streamingMessage.id} message={streamingMessage} />}
          {error && <div className="inline-error"><AlertCircle size={14} />{error}</div>}
        </div></div>
        <AnimatePresence>{showJumpToLatest && <motion.button type="button" className="jump-to-latest" aria-label="返回最新消息" title="返回最新消息" onClick={() => scrollToLatest("smooth")} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}><ArrowDown size={14} /></motion.button>}</AnimatePresence>
        {detail.job.jd_raw && <Composer busy={busy} streaming={activity?.kind === "chat"} queued={taskRunning} runtime={runtime} approvals={detail.approvals || []} onSend={send} onCancel={onCancelMessage} onAddMaterial={onAddMaterial} onApprovalDecision={onApprovalDecision} onModelActivated={onModelActivated} onManageModels={onOpenModelSettings} />}
      </>}
      <AnimatePresence>{reviewOpen && <ProposalReviewOverlay detail={detail} busy={busy} onClose={() => setReviewOpen(false)} onSubmit={async (decisions) => { await onReview(decisions); setReviewOpen(false); }} />}</AnimatePresence>
    </main>
    <aside className="context-rail agent-rail-v2"><div className="rail-head"><span>{run?.current_stage === "awaiting_fact_review" ? "经历决策" : "任务上下文"}</span></div>{run?.current_stage === "awaiting_fact_review" ? <ExperienceSelector key={run.id} detail={detail} busy={busy} onSubmit={onFactReview} /> : <StandardRail detail={detail} runtime={runtime} busy={busy} task={task} onStart={onStart} onRestart={onRestart} onOpenResume={() => setTab("resume")} onOpenReview={() => setReviewOpen(true)} onPublishApproval={onPublishApproval} onFinalize={onFinalize} onRetry={onRetry} onPauseTask={onPauseTask} onResumeTask={onResumeTask} onCancelTask={onCancelTask} onOpenModelSettings={onOpenModelSettings} />}</aside>
  </>;
}
