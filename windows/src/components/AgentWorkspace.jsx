import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Check, CheckCircle2, ChevronDown, ChevronRight,
  BookOpenCheck, Copy, Download, FileSignature, FileText, Gauge, LoaderCircle, MessageSquare, Pencil, Quote,
  PanelRightClose, PanelRightOpen, Pause, Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Square, X, XCircle,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentActivity } from "./AgentActivity";
import { AGENT_EFFORT_LEVELS, AgentEffortControl, getAgentEffortApiLevel, getStoredAgentEffort } from "./AgentEffortControl";
import { AgentMessage } from "./AgentMessage";
import { api } from "../lib/api";
import { isChatNearBottom, resolveChatScrollTop } from "../lib/chat-scroll";
import { useModalFocusTrap } from "../lib/modal-focus";
import { resolveAgentRuntimeState } from "../lib/runtime-state";

const InterviewIntelligence = lazy(() => import("./InterviewIntelligence").then((module) => ({ default: module.InterviewIntelligence })));
const InterviewRail = lazy(() => import("./InterviewIntelligence").then((module) => ({ default: module.InterviewRail })));

const labels = {
  created: "准备任务", input_validating: "核对输入", jd_analyzing: "理解岗位",
  facts_matching: "匹配经历", awaiting_fact_review: "确认经历", strategy_generating: "制定简历策略",
  draft_generating: "生成改写建议", awaiting_user_review: "等待审阅", approved_changes_applying: "应用修改",
  fact_validating: "核验事实", portfolio_building: "组织作品材料", consistency_checking: "一致性检查",
  awaiting_publish_approval: "最终检查", ready_to_publish: "可导出", published: "已记录投递",
  frozen: "已记录投递", failed: "运行失败", blocked: "需要处理", cancelled: "已取消",
};

const approvalCopy = {
  workspace_write: "写入本地文件",
  workspace_move: "移动或重命名文件",
  workspace_delete: "删除本地文件",
  rollback_version_snapshot: "恢复先前版本",
};

function pendingToolApprovals(approvals = []) {
  return approvals.filter((item) => {
    if (item.status !== "pending") return false;
    const request = item.decision_payload?.items?.[0] || {};
    return Boolean(
      request.tool_name
      || request.operation_id
      || item.action_type?.startsWith("workspace_")
      || item.action_type?.startsWith("permission:")
      || item.action_type?.startsWith("mcp_write:")
      || item.action_type === "rollback_version_snapshot"
    );
  });
}

function approvalDetails(approval) {
  const request = approval.decision_payload?.items?.[0] || {};
  const argumentsValue = request.arguments || {};
  const pathCopy = argumentsValue.path || [argumentsValue.source_path, argumentsValue.destination_path].filter(Boolean).join(" → ");
  const isMcp = approval.action_type?.startsWith("mcp_write:") || request.source === "mcp";
  const permissionCopy = request.tool_name === "search_web" ? "搜索公开网页"
    : request.tool_name === "read_web_page" ? "读取公开网页"
      : request.tool_name === "open_browser_page" ? "打开受控浏览器"
        : request.tool_name === "read_browser_page" ? "读取受控浏览器"
          : isMcp ? "MCP 外部写入" : "本地文件操作";
  const safeArguments = Object.entries(argumentsValue).slice(0, 4).map(([key, raw]) => {
    const hidden = /secret|password|token|api.?key/i.test(key);
    const value = hidden ? "••••••" : typeof raw === "string" ? raw : JSON.stringify(raw);
    return `${key}: ${String(value).slice(0, 100)}`;
  }).join(" · ");
  return {
    request,
    title: approvalCopy[approval.action_type] || permissionCopy,
    summary: pathCopy || safeArguments || request.tool_name || approval.target_id,
    operationCopy: request.operation_id ? `操作 ${request.operation_id.slice(-8)}` : "",
  };
}

const conversationScrollPositions = new Map();
const workspaceTabs = new Map();

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

function InterviewLoading({ compact = false }) {
  return <div className={compact ? "interview-rail-loading" : "interview-workspace-loading"} aria-live="polite"><LoaderCircle className="spin" size={compact ? 14 : 18} /><span>正在载入面试情报…</span></div>;
}

function ProposalPanel({ detail, busy, onSubmit }) {
  const runKey = detail.run?.id || detail.job.id;
  const approval = detail.approvals?.find((item) => item.action_type === "apply_resume_changes" && item.status === "pending");
  const persistedDraft = approval?.decision_payload?.draft || {};
  const [decisions, setDecisions] = useState(() => persistedDraft.decisions || {});
  const [draftRevision, setDraftRevision] = useState(() => Number(persistedDraft.revision || 0));
  const [draftState, setDraftState] = useState("saved");
  const lastSavedDraft = useRef(JSON.stringify(persistedDraft.decisions || {}));
  const proposals = detail.proposals || [];
  const factsById = useMemo(() => new Map((detail.facts || []).map((item) => [item.id, item])), [detail.facts]);
  useEffect(() => {
    const serialized = JSON.stringify(decisions);
    if (!approval?.id || serialized === lastSavedDraft.current) return undefined;
    setDraftState("saving");
    const timer = window.setTimeout(() => {
      api.saveApprovalDraft(runKey, approval.id, {
        base_revision: draftRevision,
        decisions,
        edited_by: "local_user",
      }).then((saved) => {
        const draft = saved?.decision_payload?.draft || {};
        lastSavedDraft.current = serialized;
        setDraftRevision(Number(draft.revision || draftRevision + 1));
        setDraftState("saved");
      }).catch((saveError) => {
        setDraftState(saveError?.payload?.code === "approval_revision_conflict" ? "conflict" : "error");
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [approval?.id, decisions, draftRevision, runKey]);
  const decide = (id, decision, edited_after) => setDecisions((value) => ({ ...value, [id]: { decision, edited_after } }));
  const complete = proposals.length > 0 && proposals.every((item) => decisions[item.id]);
  const decidedCount = proposals.filter((item) => decisions[item.id]).length;
  return <section className="proposal-panel">
    <header><small>简历改写</small><h3>逐条确认，不覆盖原始资料</h3><p>教育背景与身份信息已原样保留；这里只审阅需要岗位化表达的内容。</p><span className={`proposal-draft-state ${draftState}`}>{draftState === "saving" ? "正在保存审批草稿…" : draftState === "conflict" ? "草稿已在其他窗口更新，请重新打开审阅" : draftState === "error" ? "草稿保存失败，当前修改尚未持久化" : `审批草稿已保存 · v${draftRevision}`}</span></header>
    <div className="proposal-list">{proposals.map((item) => <article key={item.id} className={`${decisions[item.id]?.decision ? "decided" : ""} ${item.section === "no_change" ? "no-change" : ""}`}>
      <div className="proposal-reason"><span>{item.section === "no_change" ? "无需改写" : item.section}</span><p>{item.reason}</p></div>
      <div className="proposal-compare"><div><small>原文</small><p>{item.before}</p></div><div><small>{item.section === "no_change" ? "判断" : "岗位化表达"}</small><p>{item.after}</p></div></div>
      {!!item.jd_evidence?.[0] && item.section !== "no_change" && <div className="proposal-evidence"><small>对应 JD</small><p>{item.jd_evidence[0]}</p></div>}
      {!!item.fact_ids?.length && item.section !== "no_change" && <div className="proposal-fact-source">
        <small>事实依据 · {item.risk_level === "high" ? "需重点核对" : item.risk_level === "medium" ? "建议核对" : "低风险"}</small>
        {item.fact_ids.slice(0, 3).map((factId) => <p key={factId}>{factsById.get(factId)?.content || "事实已绑定，原文暂不可见"}</p>)}
      </div>}
      {decisions[item.id]?.decision === "edited_accepted" && <textarea autoFocus value={decisions[item.id].edited_after || item.after} onChange={(event) => decide(item.id, "edited_accepted", event.target.value)} />}
      <footer><button className={decisions[item.id]?.decision === "rejected" ? "active" : ""} onClick={() => decide(item.id, "rejected")}>保留原文</button><button onClick={() => decide(item.id, "edited_accepted", item.after)}>编辑后采用</button><button className={decisions[item.id]?.decision === "accepted" ? "active accent" : "accent"} onClick={() => decide(item.id, "accepted")}>采用建议</button></footer>
    </article>)}</div>
    <button className="panel-submit" disabled={!complete || busy || draftState === "conflict"} onClick={() => onSubmit(decisions)}>{busy ? <LoaderCircle size={14} /> : <Check size={14} />}{complete ? "应用已确认修改" : `已处理 ${decidedCount}/${proposals.length}`}</button>
  </section>;
}

function ProposalReviewOverlay({ detail, busy, onClose, onSubmit }) {
  const dialog = useRef(null);
  useModalFocusTrap(dialog);
  useEffect(() => {
    const close = (event) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);
  return <motion.section ref={dialog} role="dialog" aria-modal="true" aria-label="简历改写审阅" tabIndex={-1} className="workspace-review-overlay" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
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
  const jobResume = detail.resumes?.[0];
  const resume = jobResume || detail.base_resumes?.[0];
  const isBaseResume = Boolean(resume && !jobResume);
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
  if (!resume) return <div className="resume-empty"><FileText size={22} /><h3>还没有可预览的简历</h3><p>先在个人资料库导入基础简历；岗位版生成后会自动替换为本次定制版本。</p></div>;
  const pdfVersion = encodeURIComponent(resume.updated_at || resume.content_hash || "current");
  const pdfUrl = resume.pdf_path && !staleEditorPdf ? api.assetUrl(`/api/resumes/${resume.id}/pdf?v=${pdfVersion}`) : "";
  const docxUrl = api.assetUrl(`/api/resumes/${resume.id}/docx?v=${pdfVersion}`);
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
    <div className="resume-toolbar-v2"><div><i />{isBaseResume ? "基础简历预览" : hasCanonicalPdf ? "岗位版 PDF 预览" : "等待岗位版 PDF"}<small>{isBaseResume ? "岗位版尚未生成；这里明确展示资料库原简历，不代表 Agent 已完成优化" : hasCanonicalPdf ? "这里只展示已生成的岗位版最终文件" : "编辑完成后生成岗位版 PDF"}</small></div><div>{hasCanonicalPdf && <a href={pdfUrl} target="_blank" rel="noreferrer"><FileText size={14} />打开已保存 PDF</a>}<a href={docxUrl} target="_blank" rel="noreferrer" title={isBaseResume ? "当前导出的是资料库基础简历" : "单栏可编辑岗位版本"}><FileSignature size={14} />{isBaseResume ? "基础 Word" : "岗位版 Word"}</a><button onClick={() => setEditing(true)}><Pencil size={14} />{isBaseResume ? "编辑基础简历" : "编辑内容与排版"}</button><button className="accent" disabled={!previewReady || exporting} onClick={exportPdf}>{exporting ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}{exporting ? "正在生成" : isBaseResume ? "导出基础 PDF" : "导出岗位版 PDF"}</button></div></div>
    {previewError && <div className="canonical-preview-error"><AlertCircle size={14} />{previewError}</div>}
    <div className="canonical-resume-preview"><CanonicalResumePreview pdfUrl={pdfUrl} frameRef={previewFrame} onReady={handlePreviewReady} /></div>
    <AnimatePresence>{editing && <ResumeEditorOverlay resume={resume} onClose={() => setEditing(false)} onSave={saveSnapshot} onPdfSaved={onResumePdfSaved} />}</AnimatePresence>
  </div>;
}

function ToolApprovalInterrupt({ approvals, busy, onDecision }) {
  const pending = pendingToolApprovals(approvals);
  if (!pending.length) return null;
  return <motion.section
    className="tool-approval-interrupt"
    aria-label="需要确认的关键操作"
    initial={{ opacity: 0, y: 10, scale: .992 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: .2, ease: [0.16, 1, 0.3, 1] }}
  >
    <header><span><ShieldCheck size={16} /></span><div><small>AGENT PAUSED</small><strong>继续前需要你的确认</strong><p>Agent 已暂停在实际执行之前。请核对目标和作用范围；拒绝不会影响已经完成的只读工作。</p></div></header>
    <div className="pending-approval-list">{pending.map((approval) => {
      const { request, title, summary, operationCopy } = approvalDetails(approval);
      return <article key={approval.id}>
        <div><strong>{title}</strong><small>{summary}</small></div>
        <p>{[request.tool_name, request.permission, operationCopy, request.recoverable === false ? "不可自动恢复" : ""].filter(Boolean).join(" · ") || "只授权这一次具体操作；其他操作仍需确认。"}</p>
        <footer><button type="button" disabled={busy} onClick={() => onDecision?.(approval.id, "rejected")}>拒绝</button><button type="button" className="approve" disabled={busy} onClick={() => onDecision?.(approval.id, "approved")}>允许此操作</button></footer>
      </article>;
    })}</div>
  </motion.section>;
}

function Composer({ busy, streaming, queued, runtime, quote, onClearQuote, onSend, onCancel, onAddMaterial, onModelActivated, onManageModels }) {
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
  useEffect(() => { if (quote) input.current?.focus(); }, [quote]);
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
    const submittedQuote = quote;
    setValue(""); setAttachments([]); onClearQuote?.();
    if (input.current) input.current.style.height = "";
    await onSend(content, { thinkingLevel, attachmentPaths, quote: submittedQuote });
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
  const currentEffort = AGENT_EFFORT_LEVELS.find((item) => item.id === agentEffort) || AGENT_EFFORT_LEVELS[1];
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
  return <div className={`agent-composer-v2 ${busy ? "working" : ""}`}>
    {quote && <div className="composer-quote"><span><Quote size={13} /></span><p><strong>引用 Agent</strong><small>{quote.text}</small></p><button type="button" aria-label="移除引用" onClick={onClearQuote}><X size={13} /></button></div>}
    {!!attachments.length && <div className="composer-attachments">{attachments.map((file) => <span key={file.workspacePath}><FileText size={13} /><b>{file.name}</b><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.workspacePath !== file.workspacePath))}><X size={12} /></button></span>)}</div>}
    <textarea ref={input} value={value} onChange={update} onPaste={handlePaste} aria-keyshortcuts="Enter Shift+Enter" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.isComposing) return;
      if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
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
            <ShieldCheck size={15} /><span>权限边界</span><ChevronDown size={13} />
          </button>
          <AnimatePresence>{approvalOpen && <motion.div role="dialog" aria-label="关键操作确认规则" className="composer-popover approval-popover" initial={{ opacity: 0, y: 6, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 5, scale: .99 }} transition={{ duration: .14 }}>
            <header><div><small>FetchCV 权限边界</small><strong>关键操作由你确认</strong></div><ShieldCheck size={16} /></header>
            <div className="approval-rule-list">
              <div><span><FileText size={15} /></span><p><strong>读取已导入资料</strong><small>只在 FetchCV 隔离工作区内读取</small></p><Check size={14} /></div>
              <div><span><Pencil size={15} /></span><p><strong>写入、移动或重命名</strong><small>显示具体路径后逐次批准</small></p><ShieldCheck size={14} /></div>
              <div><span><ShieldCheck size={15} /></span><p><strong>覆盖与删除</strong><small>批准后执行，并在本地保留恢复备份</small></p><ShieldCheck size={14} /></div>
            </div>
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

function RunEvidence({ evaluation }) {
  const [expanded, setExpanded] = useState(false);
  if (!evaluation?.checks?.length) return null;
  const priority = ["warning", "pending", "passed"];
  const sorted = [...evaluation.checks]
    .sort((left, right) => priority.indexOf(left.status) - priority.indexOf(right.status));
  const visible = expanded ? sorted : sorted.slice(0, 4);
  return <section className="rail-evidence">
    <div className="rail-evidence-head"><small>运行证据</small><span>{evaluation.passed}/{evaluation.total} 已核验</span></div>
    <div className="rail-evidence-list">{visible.map((item) => <div key={item.code} className={item.status} title={(item.evidence || []).join("\n")}>
      {item.status === "passed" ? <Check size={11} /> : <AlertCircle size={11} />}
      <span>{item.label}</span><small>{item.status === "passed" ? "已核验" : item.status === "warning" ? "需处理" : "进行中"}</small>
    </div>)}</div>
    {sorted.length > 4 && <button type="button" className="rail-evidence-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起证据" : `查看全部 ${sorted.length} 项`}<ChevronDown size={12} /></button>}
  </section>;
}

function ContextInventory({ detail }) {
  const verifiedFacts = detail.facts.filter((item) => item.verified).length;
  const items = [
    { label: "岗位 JD", value: detail.job.jd_raw ? "已载入" : "未提供", ready: Boolean(detail.job.jd_raw) },
    { label: "基础简历", value: `${detail.base_resumes?.length || 0} 份`, ready: Boolean(detail.base_resumes?.length) },
    { label: "补充材料", value: `${detail.materials?.length || 0} 项`, ready: true },
    { label: "已验证事实", value: `${verifiedFacts} 条`, ready: verifiedFacts > 0 },
  ];
  return <section className="rail-context-inventory">
    <small>本轮依据</small>
    <div>{items.map((item) => <p key={item.label} className={item.ready ? "ready" : ""}><span><i />{item.label}</span><b>{item.value}</b></p>)}</div>
  </section>;
}

function AtsReadiness({ value, onImprove, onOpenResume }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  if (!value) return null;
  if (value.status === "not_ready") {
    return <section className="rail-ats-readiness pending"><div className="rail-ats-head"><span><Gauge size={13} />岗位要求覆盖</span><small>等待岗位版</small></div><p>{value.summary}</p></section>;
  }
  const allRequirements = value.requirements || [];
  const requirements = expanded ? allRequirements : allRequirements.slice(0, 4);
  const selected = allRequirements.find((item) => item.requirement_id === selectedId);
  const statusCopy = { supported: "有证据", partial: "部分支持", unsupported: "缺少证据" };
  return <section className={`rail-ats-readiness ${value.status}`}>
    <div className="rail-ats-head"><span><Gauge size={13} />岗位要求覆盖</span><small>{value.requirements?.length || 0} 项要求</small></div>
    {!!requirements.length && <div className="rail-requirement-matrix">{requirements.map((item) => {
      const supportStatus = item.support_status || (item.matched ? "supported" : item.evidence ? "partial" : "unsupported");
      const active = selectedId === item.requirement_id;
      return <button type="button" key={item.requirement_id || item.text} data-requirement-id={item.requirement_id || undefined} className={`${supportStatus} ${active ? "active" : ""}`} aria-pressed={active} onClick={() => setSelectedId((current) => current === item.requirement_id ? null : item.requirement_id)}><i /><span><strong title={item.text}>{item.text}</strong><small>{item.evidence?.length ? `简历证据：${item.evidence.join("、")}` : "当前简历没有可定位证据"}</small></span><b>{active ? "收起" : statusCopy[supportStatus]}</b></button>;
    })}</div>}
    <AnimatePresence initial={false}>{selected && <motion.div key={selected.requirement_id} className="rail-requirement-inspector" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: .18, ease: [0.16, 1, 0.3, 1] }}>
      <header><div><small>EVIDENCE</small><strong>为什么这样判断</strong></div><button type="button" aria-label="关闭证据定位" onClick={() => setSelectedId(null)}><X size={13} /></button></header>
      <div className="requirement-jd-source"><span>JD 原文</span>{selected.jd_context ? <blockquote>{selected.jd_context.before && <>{selected.jd_context.before} </>}<mark>{selected.jd_context.match}</mark>{selected.jd_context.after && <> {selected.jd_context.after}</>}</blockquote> : <p>当前岗位要求来自结构化分析，但在原始 JD 中没有找到可稳定定位的连续原文。</p>}</div>
      <div className="requirement-resume-sources"><span>简历落点</span>{selected.resume_evidence?.length ? selected.resume_evidence.map((source) => <article key={`${source.section_id}:${source.item_id}`}><div><strong>{source.section_label} · {source.item_label}</strong><small>{source.matched_terms.join(" · ")}</small></div><p>{source.snippet}</p></article>) : <p>当前岗位版简历中没有找到能直接支撑这项要求的文本。Agent 可以改善表达，但不能补造经历。</p>}</div>
      {!!selected.resume_evidence?.length && <button type="button" className="open-evidence-resume" onClick={onOpenResume}>打开简历核对上下文</button>}
    </motion.div>}</AnimatePresence>
    {allRequirements.length > 4 && <button type="button" className="rail-requirement-toggle" onClick={() => setExpanded((current) => !current)}>{expanded ? "收起其他要求" : `查看其余 ${allRequirements.length - 4} 项要求`}</button>}
    {!!value.document_checks?.length && <div className="rail-document-checks">{value.document_checks.map((item) => <span key={item.code} className={item.passed ? "passed" : ""}>{item.passed ? <Check size={10} /> : <X size={10} />}{item.label}</span>)}</div>}
    {!!value.gaps?.length && <div className="rail-ats-gaps">{value.gaps.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div>}
    {!!value.gaps?.length && <button type="button" onClick={onImprove}>让 Agent 基于事实补强缺口</button>}
    <small className="rail-ats-disclaimer">只检查当前 JD 的证据覆盖，不预测招聘系统通过率。</small>
  </section>;
}

function CoverLetterReview({ material, onClose }) {
  const [copied, setCopied] = useState(false);
  const dialog = useRef(null);
  useModalFocusTrap(dialog);
  const content = material?.metadata_json?.content || "";
  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return <motion.div className="cover-letter-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.section ref={dialog} tabIndex={-1} className="cover-letter-review" role="dialog" aria-modal="true" aria-labelledby="cover-letter-title" initial={{ opacity: 0, y: 12, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .99 }} transition={{ duration: .2, ease: [0.16, 1, 0.3, 1] }}>
      <header><div><small>APPLICATION LETTER</small><h2 id="cover-letter-title">{material.name}</h2><p>由当前 JD 与已确认事实生成；复制前请完成最终人工审阅。</p></div><button type="button" onClick={onClose} aria-label="关闭求职信"><X size={15} /></button></header>
      <article>{content.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => index === 0 ? <h3 key={index}>{paragraph}</h3> : <p key={index}>{paragraph}</p>)}</article>
      <footer><span>{material.metadata_json?.source_fact_ids?.length || 0} 条事实 · {material.metadata_json?.jd_evidence?.length || 0} 条 JD 证据</span><button type="button" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制" : "复制全文"}</button></footer>
    </motion.section>
  </motion.div>;
}

function ApplicationCollateral({ detail, busy, onGenerate, onOpen }) {
  const coverLetters = (detail.materials || []).filter((item) => item.kind === "cover_letter" && item.metadata_json?.job_id === detail.job.id);
  const latest = coverLetters[0];
  const canGenerate = Boolean(detail.resumes?.length || detail.base_resumes?.length);
  return <section className="rail-application-assets">
    <div className="rail-application-head"><span><FileSignature size={13} />投递材料</span><small>{coverLetters.length ? `${coverLetters.length} 个版本` : "未生成求职信"}</small></div>
    {latest ? <button type="button" className="rail-cover-letter" onClick={() => onOpen(latest)}><div><strong>{latest.name}</strong><small>{latest.status === "draft" ? "Agent 草稿 · 待人工审阅" : latest.status}</small></div><ChevronRight size={13} /></button> : <p>简历完成后，Agent 可以基于同一证据链起草求职信。</p>}
    <button type="button" className="rail-generate-letter" disabled={busy || !canGenerate} onClick={onGenerate} title={canGenerate ? "由 Agent 基于事实与 JD 起草" : "请先导入基础简历"}>{latest ? "重新生成一版" : "让 Agent 起草求职信"}</button>
  </section>;
}

function checkpointCopy(task) {
  const savedAt = task?.result_json?.checkpoint?.saved_at;
  if (!savedAt) return task?.status === "queued" ? "等待 Agent 接管" : "正在建立可恢复检查点";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(savedAt)) / 1000));
  return seconds < 8 ? "检查点刚刚保存" : `检查点 ${seconds}s 前保存`;
}

function StandardRail({ detail, runtime, runtimeState, busy, task, onStart, onRestart, onOpenResume, onOpenInterview, onOpenReview, onPublishApproval, onFinalize, onRetry, onPauseTask, onResumeTask, onCancelTask, onResolveInvocation, onOpenModelSettings, onImproveAts, onGenerateCoverLetter, onOpenCoverLetter }) {
  const run = detail.run;
  const profile = detail.profile;
  const stage = run?.current_stage;
  const unknownInvocation = (detail.tool_invocations || []).find((item) => item.status === "outcome_unknown");
  const canRun = runtime?.configured || runtime?.allow_mock_runtime;
  let action = null;
  if (!run && canRun) action = <section className="rail-next-action"><small>下一步</small><div><Sparkles size={15} /><strong>让 Agent 理解岗位</strong><p>读取 JD 并形成岗位重点与经历匹配。</p><button disabled={busy || !detail.job.jd_raw} onClick={onStart}>理解岗位</button></div></section>;
  if (!run && !canRun) action = <section className="rail-next-action"><small>开始之前</small><div><Settings2 size={15} /><strong>连接一个模型</strong><p>岗位理解和简历改写必须由你选择的模型完成。</p><button disabled={busy} onClick={onOpenModelSettings}>连接模型</button></div></section>;
  if (stage === "awaiting_user_review") action = <section className="rail-next-action"><small>需要确认</small><div><Pencil size={15} /><strong>审阅 {detail.proposals.length} 条改写建议</strong><p>建议不会自动覆盖基础简历。若岗位理解或经历组合不对，可以保留本轮并重新规划。</p><button onClick={onOpenReview}>打开改写审阅</button><button className="secondary" disabled={busy} onClick={onRestart}>重新选择经历</button></div></section>;
  if (stage === "awaiting_publish_approval") action = <section className="rail-next-action"><small>下一步</small><div><ShieldCheck size={15} /><strong>事实检查已通过</strong><p>确认后进入简历编辑和导出；也可以保留当前草稿后重新规划。</p><button disabled={busy} onClick={onPublishApproval}>进入导出检查</button><button className="secondary" disabled={busy} onClick={onRestart}>重新规划新版本</button></div></section>;
  if (["ready_to_publish", "published", "frozen"].includes(stage)) action = <section className="rail-next-action ready"><small>{stage === "ready_to_publish" ? "可用操作" : "投递记录"}</small><div><CheckCircle2 size={15} /><strong>{stage === "ready_to_publish" ? "简历可编辑和导出" : "已保存本次投递快照"}</strong><p>当前版本会保留；完成简历后可以继续调研真实面经。</p><button onClick={onOpenResume}>打开简历</button><button className="secondary" onClick={onOpenInterview}><BookOpenCheck size={13} />准备面试</button><button className="secondary" disabled={busy} onClick={onRestart}>重新规划新版本</button>{stage === "ready_to_publish" && <button className="secondary" onClick={onFinalize}>记录为已投递</button>}</div></section>;
  if (["failed", "blocked"].includes(stage)) action = <section className="rail-next-action error"><small>需要处理</small><div><AlertCircle size={15} /><strong>{labels[stage]}</strong><p>{(() => { try { return JSON.parse(run.error || "{}").message; } catch { return run.error || "本轮运行中断"; } })()}</p><button disabled={busy} onClick={onRetry}><RotateCcw size={13} />从中断处重试</button></div></section>;
  if (stage === "cancelled") action = <section className="rail-next-action error"><small>本轮已结束</small><div><XCircle size={15} /><strong>任务已取消</strong><p>取消是终态，不会继续复用旧任务。你可以保留现有材料，基于同一岗位创建一轮新规划。</p><button disabled={busy} onClick={onRestart}><RotateCcw size={13} />创建新一轮任务</button></div></section>;
  if (unknownInvocation) {
    const target = unknownInvocation.arguments_summary?.path || unknownInvocation.arguments_summary?.resume_id || unknownInvocation.arguments_summary?.target_id || "外部目标";
    const source = unknownInvocation.tool_name?.startsWith("mcp_") ? "MCP 工具" : unknownInvocation.tool_name === "read_skill" ? "Skill" : "FetchCV 内置工具";
    const occurredAt = unknownInvocation.updated_at || unknownInvocation.created_at;
    action = <section className="rail-next-action error invocation-unknown"><small>需要人工核对</small><div><AlertCircle size={15} /><strong>操作结果尚不确定</strong><p>应用在收到最终回执前中断。为避免重复写入，Agent 已停止自动重试。</p><dl><div><dt>操作</dt><dd>{unknownInvocation.tool_name}</dd></div><div><dt>来源</dt><dd>{source}</dd></div><div><dt>目标</dt><dd>{String(target)}</dd></div><div><dt>发生时间</dt><dd>{occurredAt ? new Date(occurredAt).toLocaleString() : "未记录"}</dd></div><div><dt>最后状态</dt><dd>请求可能已经发出，未保存完成回执</dd></div></dl><small>请先打开目标文件或系统记录核对：选择“已成功”会登记完成；选择“没有执行”才允许后续重试；不确定时保持停止最安全。</small><code>{unknownInvocation.operation_id}</code><button disabled={busy} onClick={() => onResolveInvocation(unknownInvocation.operation_id, "completed")}>已核对：操作成功</button><button className="secondary" disabled={busy} onClick={() => onResolveInvocation(unknownInvocation.operation_id, "not_executed")}>已核对：没有执行</button><button className="secondary" disabled={busy} onClick={() => onResolveInvocation(unknownInvocation.operation_id, "keep_stopped")}>尚不确定，保持停止</button></div></section>;
  }
  const taskRunning = ["queued", "running"].includes(task?.status);
  const visibleState = runtimeState?.active || runtimeState?.attention
    ? runtimeState
    : { label: run ? labels[stage] || run.status : "等待开始", detail: run ? `${detail.steps.filter((item) => item.event_type === "stage" || item.event_type === "tool").length} 条真实执行记录` : "提供 JD 后开始" };
  return <div className="standard-rail"><section className="rail-runtime"><small>当前状态</small><div className={`rail-state ${runtimeState?.id || "idle"}`}><span className={runtimeState?.active ? "running" : ""}><Sparkles size={14} /></span><div><strong>{visibleState.label}</strong><p>{taskRunning && runtimeState?.id === "running" ? checkpointCopy(task) : visibleState.detail}</p></div></div>{task && <div className="task-controls">{taskRunning && <button aria-label="暂停当前 Agent 任务" onClick={onPauseTask} title="暂停任务"><Pause size={13} />暂停</button>}{task?.status === "paused" && !["awaiting_fact_review", "awaiting_user_review", "awaiting_publish_approval"].includes(stage) && <button aria-label="从最近检查点恢复任务" onClick={onResumeTask} title="恢复任务"><Play size={13} />恢复</button>}{taskRunning && <button aria-label="取消当前 Agent 任务" className="danger" onClick={onCancelTask} title="取消任务"><XCircle size={13} />取消</button>}</div>}{taskRunning && runtime?.model && <div className="task-runtime-snapshot"><ShieldCheck size={13} /><span><small>本任务已锁定</small><strong>{runtime.provider_name || "当前连接"} · {runtime.model}</strong></span></div>}</section>{action}<AtsReadiness value={detail.ats_readiness} onImprove={onImproveAts} onOpenResume={onOpenResume} /><ApplicationCollateral detail={detail} busy={busy} onGenerate={onGenerateCoverLetter} onOpen={onOpenCoverLetter} /><ContextInventory detail={detail} /><RunEvidence evaluation={detail.run_evaluation} />{profile && <section><small>岗位重点</small><strong className="rail-heading">{profile.competencies?.slice(0, 3).join(" · ") || "等待形成岗位重点"}</strong><div className="rail-tags">{(profile.keywords || []).slice(0, 7).map((item) => <span key={item}>{item}</span>)}</div></section>}</div>;
}

export function AgentWorkspace({ requestedTab, detail, runtime, busy, error, activity, task, onStart, onRestart, onFactReview, onReview, onPublishApproval, onRetry, onPauseTask, onResumeTask, onCancelTask, onResolveInvocation, onFinalize, onSendMessage, onResearchInterviews, onCancelMessage, onAddMaterial, onApprovalDecision, onModelActivated, onOpenModelSettings, onSaveResumeEditor, onResumePdfSaved }) {
  const [tab, setTab] = useState(() => workspaceTabs.get(detail.job.id) || "conversation");
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [quotedReply, setQuotedReply] = useState(null);
  const [coverLetterOpen, setCoverLetterOpen] = useState(null);
  const [railCollapsed, setRailCollapsed] = useState(() => window.localStorage.getItem("fetchcv.context-rail-collapsed") === "1");
  const [railWidth, setRailWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem("fetchcv.context-rail-width"));
    return Number.isFinite(stored) && stored >= 268 && stored <= 420 ? stored : 306;
  });
  const conversationScroll = useRef(null);
  const conversationStream = useRef(null);
  const userIsNearBottom = useRef(true);
  const autoFollowing = useRef(false);
  const scrollFrame = useRef(null);
  const scrollSettleTimer = useRef(null);
  const run = detail.run;
  useLayoutEffect(() => {
    const grid = document.querySelector(".app-grid");
    if (!grid) return undefined;
    grid.style.setProperty("--context-rail-width", railCollapsed ? "46px" : `${railWidth}px`);
    return () => grid.style.removeProperty("--context-rail-width");
  }, [railCollapsed, railWidth]);
  useEffect(() => {
    window.localStorage.setItem("fetchcv.context-rail-collapsed", railCollapsed ? "1" : "0");
    window.localStorage.setItem("fetchcv.context-rail-width", String(railWidth));
  }, [railCollapsed, railWidth]);
  const beginRailResize = (event) => {
    if (railCollapsed || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = railWidth;
    document.body.classList.add("resizing-context-rail");
    const move = (moveEvent) => setRailWidth(Math.max(268, Math.min(420, startWidth + startX - moveEvent.clientX)));
    const stop = () => {
      document.body.classList.remove("resizing-context-rail");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  useEffect(() => { setTab(workspaceTabs.get(detail.job.id) || "conversation"); }, [detail.job.id]);
  useEffect(() => {
    if (requestedTab?.jobId === detail.job.id && ["conversation", "resume", "interview"].includes(requestedTab.tab)) setTab(requestedTab.tab);
  }, [requestedTab, detail.job.id]);

  useEffect(() => { workspaceTabs.set(detail.job.id, tab); }, [detail.job.id, tab]);
  useEffect(() => { if (run?.current_stage !== "awaiting_user_review") setReviewOpen(false); }, [run?.current_stage]);
  const scrollToLatest = (behavior = "smooth") => {
    const node = conversationScroll.current;
    if (!node) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const resolvedBehavior = reducedMotion ? "auto" : behavior;
    userIsNearBottom.current = true;
    setShowJumpToLatest(false);
    autoFollowing.current = resolvedBehavior === "smooth";
    if (scrollSettleTimer.current) window.clearTimeout(scrollSettleTimer.current);
    node.scrollTo({ top: node.scrollHeight, behavior: resolvedBehavior });
    if (autoFollowing.current) {
      scrollSettleTimer.current = window.setTimeout(() => {
        autoFollowing.current = false;
        userIsNearBottom.current = isChatNearBottom(node);
        setShowJumpToLatest(!userIsNearBottom.current);
      }, 360);
    }
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
    if (tab !== "conversation" || typeof ResizeObserver === "undefined") return undefined;
    const scroller = conversationScroll.current;
    const stream = conversationStream.current;
    if (!scroller || !stream) return undefined;
    const followGrowth = () => {
      if (!userIsNearBottom.current && !autoFollowing.current) return;
      if (scrollFrame.current) window.cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = window.requestAnimationFrame(() => scrollToLatest("smooth"));
    };
    const observer = new ResizeObserver(followGrowth);
    observer.observe(scroller);
    observer.observe(stream);
    return () => observer.disconnect();
  }, [detail.job.id, tab]);
  useEffect(() => () => {
    if (scrollFrame.current) window.cancelAnimationFrame(scrollFrame.current);
    if (scrollSettleTimer.current) window.clearTimeout(scrollSettleTimer.current);
  }, []);
  const handleConversationScroll = () => {
    const node = conversationScroll.current;
    if (!node) return;
    conversationScrollPositions.set(detail.job.id, node.scrollTop);
    if (autoFollowing.current) {
      if (isChatNearBottom(node)) setShowJumpToLatest(false);
      return;
    }
    userIsNearBottom.current = isChatNearBottom(node);
    setShowJumpToLatest(!userIsNearBottom.current);
  };
  const stopAutoFollowing = () => {
    autoFollowing.current = false;
    if (scrollSettleTimer.current) window.clearTimeout(scrollSettleTimer.current);
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
  const runtimeState = resolveAgentRuntimeState({ activity, task, approvals: detail.approvals, error });
  return <>
    <main className="main-pane agent-workspace-v2">
      <header className="task-header"><div><span>{detail.job.company}</span><h1>{detail.job.role}</h1></div><nav className="workspace-tabs"><button className={tab === "conversation" ? "active" : ""} onClick={() => setTab("conversation")}><MessageSquare size={14} />对话</button><button className={tab === "resume" ? "active" : ""} onClick={() => setTab("resume")}><FileText size={14} />简历</button><button className={tab === "interview" ? "active" : ""} onClick={() => setTab("interview")}><BookOpenCheck size={14} />面试</button></nav><div className={`task-meta runtime-${runtimeState.id}`} title={runtimeState.detail}><i className={runtimeState.active ? "running" : ""} />{runtimeState.active || runtimeState.attention ? runtimeState.label : run ? labels[run.current_stage] || run.status : "尚未开始"}</div></header>
      {tab === "resume" ? <div className="content-scroll studio-scroll"><ResumeStudio detail={detail} onSaveResumeEditor={onSaveResumeEditor} onResumePdfSaved={onResumePdfSaved} /></div> : tab === "interview" ? <Suspense fallback={<InterviewLoading />}><InterviewIntelligence detail={detail} activity={activity} busy={busy} error={error} runtime={runtime} onResearch={onResearchInterviews} onOpenConversation={() => setTab("conversation")} /></Suspense> : <>
        <div ref={conversationScroll} onScroll={handleConversationScroll} onWheel={stopAutoFollowing} onTouchStart={stopAutoFollowing} className="content-scroll conversation-scroll-v2"><div ref={conversationStream} className="conversation-stream">
          {!messages.length && !pendingPrompt && <ConversationEmpty job={detail.job} />}
          {settledMessages.map((message) => <AgentMessage key={message.id} message={message} onQuote={setQuotedReply} interviewSources={detail.interview_sources || []} interviewBriefs={detail.interview_briefs || []} />)}
          {pendingPrompt && !pendingAlreadyStored && <AgentMessage message={{ id: "pending-user", role: "user", content: pendingPrompt }} pending />}
          <AgentActivity activity={activity} run={run} task={task} steps={detail.steps} />
          <ToolApprovalInterrupt approvals={detail.approvals || []} busy={busy} onDecision={onApprovalDecision} />
          {queuedMessages.map((message) => <div className="queued-message" key={message.id}><span>{message.status === "processing" ? <LoaderCircle className="spin" size={12} /> : <MessageSquare size={12} />}</span><p>{message.content}</p><small>{message.status === "processing" ? "正在处理" : "已排队"}</small></div>)}
          {streamingMessage && <AgentMessage key={streamingMessage.id} message={streamingMessage} onQuote={setQuotedReply} interviewSources={detail.interview_sources || []} interviewBriefs={detail.interview_briefs || []} />}
          {error && <div className="inline-error"><AlertCircle size={14} />{error}</div>}
        </div></div>
        <AnimatePresence>{showJumpToLatest && <motion.button type="button" className="jump-to-latest" aria-label="返回最新消息" title="返回最新消息" onClick={() => scrollToLatest("smooth")} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}><ArrowDown size={14} /></motion.button>}</AnimatePresence>
        {detail.job.jd_raw && <Composer busy={busy} streaming={activity?.kind === "chat"} queued={taskRunning} runtime={runtime} quote={quotedReply} onClearQuote={() => setQuotedReply(null)} onSend={send} onCancel={onCancelMessage} onAddMaterial={onAddMaterial} onModelActivated={onModelActivated} onManageModels={onOpenModelSettings} />}
      </>}
      <AnimatePresence>{reviewOpen && <ProposalReviewOverlay detail={detail} busy={busy} onClose={() => setReviewOpen(false)} onSubmit={async (decisions) => { const result = await onReview(decisions); if (result) setReviewOpen(false); }} />}</AnimatePresence>
    </main>
    <aside className={`context-rail agent-rail-v2 ${railCollapsed ? "collapsed" : ""}`}>
      {!railCollapsed && <button type="button" className="context-rail-resizer" aria-label="调整任务上下文宽度" title="拖动调整宽度" onPointerDown={beginRailResize} />}
      <div className="rail-head">
        {!railCollapsed && <span>{tab === "interview" ? "面试情报" : run?.current_stage === "awaiting_fact_review" ? "经历决策" : "任务上下文"}</span>}
        <button type="button" className="context-rail-collapse" aria-label={railCollapsed ? "展开任务上下文" : "折叠任务上下文"} title={railCollapsed ? "展开任务上下文" : "折叠任务上下文"} onClick={() => setRailCollapsed((value) => !value)}>{railCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}</button>
      </div>
      {!railCollapsed && (tab === "interview"
        ? <Suspense fallback={<InterviewLoading compact />}><InterviewRail detail={detail} activity={activity} busy={busy} runtime={runtime} onResearch={onResearchInterviews} /></Suspense>
        : run?.current_stage === "awaiting_fact_review"
          ? <ExperienceSelector key={run.id} detail={detail} busy={busy} onSubmit={onFactReview} />
          : <StandardRail detail={detail} runtime={runtime} runtimeState={runtimeState} busy={busy} task={task} onStart={onStart} onRestart={onRestart} onOpenResume={() => setTab("resume")} onOpenInterview={() => setTab("interview")} onOpenReview={() => setReviewOpen(true)} onPublishApproval={onPublishApproval} onFinalize={onFinalize} onRetry={onRetry} onPauseTask={onPauseTask} onResumeTask={onResumeTask} onCancelTask={onCancelTask} onResolveInvocation={onResolveInvocation} onOpenModelSettings={onOpenModelSettings} onImproveAts={() => void send("请读取当前 ATS 文本覆盖缺口，在不新增或夸大事实的前提下提出可审阅的简历改写建议；先说明哪些缺口可以由已有事实补强，哪些不能。", { thinkingLevel: "balanced" })} onGenerateCoverLetter={() => void send("请基于当前 JD、岗位简历和已确认事实生成一份克制、具体、非模板化的求职信草稿。必须调用 save_cover_letter_draft 保存；每段绑定支持它的 fact_id 和 JD 原文证据，不得新增任何数字、日期或经历。", { thinkingLevel: "balanced" })} onOpenCoverLetter={setCoverLetterOpen} />)}
    </aside>
    <AnimatePresence>{coverLetterOpen && <CoverLetterReview material={coverLetterOpen} onClose={() => setCoverLetterOpen(null)} />}</AnimatePresence>
  </>;
}
