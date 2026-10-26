import { WorkspaceRail } from "./ui/WorkspaceRail";
import { WorkspaceSidebar } from "./ui/WorkspaceSidebar";
import { PanelLeft } from "lucide-react";
import { motion } from "framer-motion";
import {
  AlertCircle, BriefcaseBusiness, CheckCircle2, FileText, FileUp,
  FolderKanban, Globe2, LoaderCircle, Minus, Plus,
  Square, Trash2, X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { conversationSessions } from "./lib/conversation-sessions";
const ConversationWorkspace = lazy(() => import("./components/ConversationWorkspace").then(module => ({ default: module.ConversationWorkspace })));
const InterviewKnowledgeView = lazy(() => import("./components/InterviewKnowledgeView").then(module => ({default: module.InterviewKnowledgeView})));
const CommandMenu = lazy(() => import("./ui/CommandMenu").then((module) => ({ default: module.CommandMenu })));
const ImportResumeDialog = lazy(() => import("./components/ImportResumeDialog").then((module) => ({ default: module.ImportResumeDialog })));
const LibraryView = lazy(() => import("./components/LibraryView").then((module) => ({ default: module.LibraryView })));
const LibraryRail = lazy(() => import("./components/LibraryView").then((module) => ({ default: module.LibraryRail })));
const ModelSettingsDialog = lazy(() => import("./components/ModelSettingsDialog").then((module) => ({ default: module.ModelSettingsDialog })));
import { WorkspaceBoundary } from "./components/WorkspaceBoundary";
const AgentWorkspace = lazy(() => import("./components/AgentWorkspace").then((module) => ({ default: module.AgentWorkspace })));
import { api } from "./lib/api";
import { normalizeBackendStatus, readBackendStatus } from "./lib/backend-readiness";
import { applyAppearance, DEFAULT_APPEARANCE, watchSystemTheme } from "./lib/appearance";
import { jobPostingPreviewState, normalizeJobContext, splitJobDescriptions } from "./lib/job-description";
import { JobContextEditor } from "./components/JobContextCard";
import { installSelectAllShortcut } from "./lib/keyboard";
import { mergeProcessingEvent } from "./lib/processing";
import { shareWorkspaceSnapshot } from "./lib/workspace-snapshot";
import { useAgentMotion } from "./ui/motion";



function WindowBar() {
  const desktop = window.desktopWindow;
  const isMac = desktop?.platform === "darwin";
  return <div className={`windowbar ${isMac ? "macos" : "custom-controls"}`}>
    <div className="window-drag" aria-label="窗口拖动区域" />
    {desktop && !isMac && <div className="window-actions">
      <button onClick={desktop.minimize} aria-label="最小化"><Minus size={14} /></button>
      <button onClick={desktop.toggleMaximize} aria-label="最大化"><Square size={11} /></button>
      <button className="window-close" onClick={desktop.close} aria-label="关闭"><X size={14} /></button>
    </div>}
  </div>;
}


function EmptyWorkspace({ onNew, onImport, offline, hasProfile, busy }) {
  return <div className="center-empty">
    <div className="empty-orbit"><BriefcaseBusiness size={25} /></div>
    <p className="eyebrow">{offline ? "LOCAL API OFFLINE" : hasProfile ? "PROFILE READY" : "FIRST THINGS FIRST"}</p>
    <h1>{offline ? "本地服务未能启动" : hasProfile ? "接下来，选择一个目标岗位" : "先建立你的求职资料库"}</h1>
    <p>{offline ? "客户端无法读取本机数据。请重新打开应用；若仍失败，检查本地服务日志。" : hasProfile ? "个人资料已存在。新建岗位并粘贴 JD，Agent 会在原简历上形成岗位化改写。" : "先存入基础简历、项目经历和作品材料。之后每个岗位只需要提供 JD。"}</p>
    {!offline && <div className="empty-actions">
      {!hasProfile && <button className="primary-button" disabled={busy} onClick={onImport}>{busy ? <LoaderCircle className="spin" size={15} /> : <FileText size={16} />}选择 PDF 简历</button>}
      {hasProfile && <button className="primary-button" onClick={onNew}><Plus size={16} />新增岗位</button>}
    </div>}
  </div>;
}

function StartupWorkspace() {
  return <main className="startup-workspace" aria-live="polite" aria-label="正在启动 FetchCV">
    <div className="startup-brand"><img src="./FetchCV_LOGO.png" alt="" /></div>
    <strong>FetchCV</strong>
    <span><i />正在读取本地资料</span>
  </main>;
}

function reportAfterPaint(name) {
  let secondFrame;
  const firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(() => {
      window.appRuntime?.reportStartupMilestone?.(name);
    });
  });
  return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
}

// Inside Suspense: this effect runs after the actual workspace commits, rather
// than timing the fallback that is shown while its module downloads.
function InteractiveMilestone() {
  useEffect(() => reportAfterPaint("renderer-interactive"), []);
  return null;
}

function NewJobModal({ open, candidates, preferredCandidateId, onClose, onCreate, busy }) {
  const { enter, transition } = useAgentMotion();
  const [form, setForm] = useState({ candidate_id: "", company: "", role: "", jd_raw: "", source_type: "manual", source_url: "", context_json: normalizeJobContext(), jd_provenance: {} });
  const [inputMode, setInputMode] = useState("url");
  const [webPreview, setWebPreview] = useState(null);
  const [webBusy, setWebBusy] = useState(false);
  const [importedJobs, setImportedJobs] = useState([]);
  const [importedIndex, setImportedIndex] = useState(0);
  const [importedName, setImportedName] = useState("");
  const [importError, setImportError] = useState("");
  const [contextExpanded, setContextExpanded] = useState(false);
  const previewController = useRef(null);
  useEffect(() => {
    previewController.current?.abort();
    if (open) {
      setForm({ candidate_id: candidates.find(item => item.id === preferredCandidateId)?.id || candidates[0]?.id || "", company: "", role: "", jd_raw: "", source_type: "manual", source_url: "", context_json: normalizeJobContext(), jd_provenance: {} });
      setImportedJobs([]); setImportedIndex(0); setImportedName(""); setImportError("");
      setInputMode("url"); setWebPreview(null); setWebBusy(false);
      setContextExpanded(false);
    }
    return () => previewController.current?.abort();
  }, [open, candidates, preferredCandidateId]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, busy, onClose]);
  const importJobFile = async () => {
    setImportError("");
    try {
      const file = await window.appRuntime?.selectJobDescriptionFile?.();
      if (!file) return;
      previewController.current?.abort(); setWebBusy(false); setWebPreview(null); setInputMode("text");
      setContextExpanded(false);
      const jobs = splitJobDescriptions(file.text);
      setImportedName(file.name); setImportedJobs(jobs); setImportedIndex(0);
      if (jobs.length) {
        const first = jobs[0];
        setForm((current) => ({ ...current, company: first.company, role: first.role, jd_raw: first.jd, source_type: "file_import", source_url: "", context_json: normalizeJobContext(), jd_provenance: {} }));
      } else {
        setForm((current) => ({ ...current, jd_raw: file.text.trim(), source_type: "file_import", source_url: "", context_json: normalizeJobContext(), jd_provenance: {} }));
      }
    } catch (error) { setImportError(error.message || "岗位文件读取失败"); }
  };
  const chooseImportedJob = (value) => {
    const index = Number(value);
    const job = importedJobs[index];
    if (!job) return;
    setImportedIndex(index);
    setContextExpanded(false);
    setForm((current) => ({ ...current, company: job.company, role: job.role, jd_raw: job.jd, source_type: "file_import", source_url: "", context_json: normalizeJobContext(), jd_provenance: {} }));
  };
  const importJobPage = async () => {
    const url = form.source_url.trim();
    if (!url) return;
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setImportError(""); setWebBusy(true); setWebPreview(null);
    try {
      const posting = await api.previewJobPosting(url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setWebPreview(posting);
      const preview = jobPostingPreviewState(posting);
      if (preview.usable) {
        const context = normalizeJobContext(posting.context_json, preview.body);
        setForm((current) => ({ ...current, company: posting.company || current.company, role: posting.title || current.role, jd_raw: preview.body, source_type: "web_import", source_url: posting.source_url || url, context_json: context, jd_provenance: posting.jd_provenance || {} }));
        setContextExpanded(Object.values(context.fields).some(field => field.value));
      }
    } catch (error) { if (!controller.signal.aborted) setImportError(error.message || "招聘网页读取失败"); }
    finally { if (previewController.current === controller) setWebBusy(false); }
  };
  const preview = webPreview && jobPostingPreviewState(webPreview);
  if (!open) return null;
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <motion.form role="dialog" aria-modal="true" aria-labelledby="new-job-title" className="job-modal job-context-modal new-job-modal" initial={enter()} animate={{ opacity: 1, y: 0 }} transition={transition("enter")} onSubmit={(event) => { event.preventDefault(); if (!webBusy) onCreate(form); }}>
      <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="关闭"><X size={16} /></button>
      <header className="new-job-header"><h2 id="new-job-title">新增岗位项目</h2></header>
      <div className="new-job-body">
        <label>候选人<select value={form.candidate_id} onChange={(event) => setForm({ ...form, candidate_id: event.target.value })}>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
        <div className="jd-input-tabs" role="tablist" aria-label="岗位描述来源"><button type="button" role="tab" aria-selected={inputMode === "url"} className={inputMode === "url" ? "active" : ""} onClick={() => setInputMode("url")}>网页导入</button><button type="button" role="tab" aria-selected={inputMode === "text"} className={inputMode === "text" ? "active" : ""} onClick={() => setInputMode("text")}>导入文本</button><button type="button" onClick={importJobFile}><FileUp size={14} />文件</button></div>
        {inputMode === "url" && <div className="jd-url-import"><input aria-label="招聘网页 URL" type="url" value={form.source_url} onChange={(event) => { previewController.current?.abort(); setWebBusy(false); setWebPreview(null); setForm({ ...form, source_url: event.target.value, source_type: "manual", jd_provenance: {} }); }} placeholder="粘贴招聘链接" /><button type="button" disabled={webBusy || !form.source_url.trim()} onClick={importJobPage}>{webBusy ? <LoaderCircle className="spin" size={14} /> : <Globe2 size={14} />}读取网页</button></div>}
        {inputMode === "text" && importedName && <div className="jd-file-import"><span>{importedName}</span></div>}
        {importedJobs.length > 1 && <label className="jd-import-picker">检测到 {importedJobs.length} 个岗位<select aria-label="选择导入的岗位" value={importedIndex} onChange={(event) => chooseImportedJob(event.target.value)}>{importedJobs.map((job, index) => <option value={index} key={`${job.company}-${job.role}-${index}`}>{job.company} · {job.role}</option>)}</select></label>}
        {importError && <div className="dialog-error" role="alert">{importError}</div>}
        {preview && <><div className={`jd-web-preview${preview.usable ? "" : " preview-warning"}`} role="status"><strong>{preview.label}</strong><span>{preview.usable ? "预览尚未保存" : "请补充完整 JD 正文后再创建岗位"}</span></div>{preview.warningMessages.length > 0 && <p className="jd-preview-notice">{preview.warningMessages.join(" ")}</p>}</>}
        <div className="form-row">
          <label>公司<input required value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="例如：字节跳动" /></label>
          <label>岗位<input required value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} placeholder="例如：AI 产品经理" /></label>
        </div>
        <label>岗位描述<textarea aria-label="岗位描述" required value={form.jd_raw} onChange={(event) => setForm({ ...form, jd_raw: event.target.value, context_json: normalizeJobContext(form.context_json, event.target.value) })} placeholder="岗位职责与任职要求" /></label>
        <details className="job-context-disclosure" open={contextExpanded} onToggle={event => setContextExpanded(event.currentTarget.open)}>
          <summary>补充信息</summary>
          <JobContextEditor value={form.context_json} body={form.jd_raw} onChange={context_json => setForm(current => ({ ...current, context_json }))} disabled={busy || webBusy} />
        </details>
      </div>
      <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || webBusy || !form.candidate_id}>{busy && <LoaderCircle className="spin" size={15} />}创建项目</button></div>
    </motion.form>
  </div>;
}

function JobManageDialog({ job, busy, onClose, onSave, onDelete }) {
  const { enter, transition } = useAgentMotion();
  const [form, setForm] = useState({ company: "", role: "", jd_raw: "", context_json: normalizeJobContext() });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => {
    if (job) {
      setForm({ company: job.company || "", role: job.role || "", jd_raw: job.jd_raw || "", context_json: normalizeJobContext(job.context_json, job.jd_raw) });
      setConfirmingDelete(false);
    }
  }, [job]);
  useEffect(() => {
    if (!job) return undefined;
    const close = (event) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [job, busy, onClose]);
  if (!job) return null;
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <motion.form className="job-modal job-manage-dialog job-context-modal" role="dialog" aria-modal="true" aria-labelledby="manage-job-title" initial={enter()} animate={{ opacity: 1, y: 0 }} transition={transition("enter")} onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
      <button type="button" className="modal-close" aria-label="关闭" disabled={busy} onClick={onClose}><X size={16} /></button>
      <p className="eyebrow">JOB PROJECT</p><h2 id="manage-job-title">管理岗位项目</h2><p>正文或关键语境改变后，旧岗位判断与面试简报会标为过期，需重新分析。</p>
      <div className="form-row"><label>公司<input required value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></label><label>岗位<input required value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} /></label></div>
      <label>岗位描述<textarea aria-label="岗位描述" required value={form.jd_raw} onChange={(event) => setForm({ ...form, jd_raw: event.target.value, context_json: normalizeJobContext(form.context_json, event.target.value) })} /></label>
      <JobContextEditor value={form.context_json} body={form.jd_raw} onChange={context_json => setForm(current => ({ ...current, context_json }))} disabled={busy} />
      {confirmingDelete && <div className="delete-warning"><AlertCircle size={15} /><p><strong>确定删除这个岗位项目？</strong><span>这个动作无法撤销，但不会删除基础简历和个人经历。</span></p></div>}
      <div className="modal-actions manage-actions"><button type="button" className={confirmingDelete ? "danger-confirm" : "danger-button"} disabled={busy} onClick={() => confirmingDelete ? onDelete() : setConfirmingDelete(true)}><Trash2 size={14} />{confirmingDelete ? "再次点击确认删除" : "删除项目"}</button><span />{confirmingDelete && <button type="button" className="text-button" disabled={busy} onClick={() => setConfirmingDelete(false)}>取消删除</button>}<button type="button" className="text-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !form.company.trim() || !form.role.trim() || !form.jd_raw.trim()}>保存修改</button></div>
    </motion.form>
  </div>;
}

function FreezeConfirm({ open, detail, busy, onClose, onConfirm }) {
  const { enter, transition } = useAgentMotion();
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, busy, onClose]);
  if (!open) return null;
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <motion.section role="alertdialog" aria-modal="true" aria-labelledby="freeze-title" className="confirm-dialog" initial={enter()} animate={{ opacity: 1, y: 0 }} transition={transition("enter")}>
      <span className="confirm-icon"><CheckCircle2 size={21} /></span><p className="eyebrow">SUBMISSION RECORD</p><h2 id="freeze-title">记录这次实际投递？</h2>
      <p>FetchCV 会为 <strong>{detail.job.company} · {detail.job.role}</strong> 保存当时使用的简历版本快照。这个动作不会阻止你继续修改和生成新版本。</p>
      <div className="confirm-assets"><span><FileText size={14} />{detail.resumes[0]?.name}</span>{detail.portfolios[0] && <span><Globe2 size={14} />岗位作品集</span>}</div>
      <div className="modal-actions"><button className="text-button" disabled={busy} onClick={onClose}>返回检查</button><button className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={14} />}确认已投递</button></div>
    </motion.section>
  </div>;
}

export default function App() {
  const motionStyle = useAgentMotion();
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [chatSelection, setChatSelection] = useState({key: "draft", id: null});
  const [sidebarOpen,setSidebarOpen] = useState(true);
  const [commandOpen,setCommandOpen] = useState(false);
  const [workspace, setWorkspace] = useState({ candidates: [], jobs: [] });
  const [detail, setDetail] = useState(null);
  const [library, setLibrary] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [activeCandidateId, setActiveCandidateId] = useState(null);
  const [activeView, setActiveView] = useState("home");
  const [requestedTab, setRequestedTab] = useState(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const librarySequence = useRef(0);
  const [runtime, setRuntime] = useState(null);
  const [backendStatus, setBackendStatus] = useState(() => ({
    dataReady: !window.appRuntime?.getBackendStatus,
    agentReady: !window.appRuntime?.getBackendStatus,
  }));
  const [initializing, setInitializing] = useState(true);
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const agentRefreshNeeded = useRef(false);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const continueToJobAfterImport = useRef(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [managedJob, setManagedJob] = useState(null);
  const [agentActivity, setAgentActivity] = useState(null);
  const [jobConversationStates, setJobConversationStates] = useState({});
  const conversationControllers = useRef(new Map());
  const streamingBuffers = useRef(new Map());
  const streamingFrames = useRef(new Map());
  const streamingLive = useRef(true);
  const runEventAbort = useRef(null);
  const activeJobRef = useRef(null);
  const detailRequestSequence = useRef(new Map());
  const detailRequests = useRef(new Map());
  const detailCache = useRef(new Map());
  const appearanceRef = useRef(DEFAULT_APPEARANCE);
  const refreshConversations = useCallback(() => api.conversations().then(setConversations).catch(e => setNotice({type: "error", message: e.message})), []);
  const closeCompactSidebar = () => {
    if (window.matchMedia("(max-width: 759px)").matches) setSidebarOpen(false);
  };
  const openConversation = (id = null) => {
    closeCompactSidebar();
    setActiveConversationId(id); setChatSelection({key: id || crypto.randomUUID(), id}); setActiveView("home"); setError("");
  };
  const deleteConversation = async (chat) => {
    if (!window.confirm(`删除“${chat.title}”及其对话记录、工具结果？上传的原始资料不会删除。`)) return;
    try {
      await conversationSessions.remove(chat.id);
      await api.deleteConversation(chat.id);
      if (activeConversationId === chat.id) openConversation();
      await refreshConversations();
    } catch (error) { setNotice({type: "error", message: error.message}); }
  };
  const updateJobConversation = useCallback((jobId, patch) => {
    setJobConversationStates((current) => {
      const previous = current[jobId] || { busy: false, activity: null, error: "" };
      const next = typeof patch === "function" ? patch(previous) : { ...previous, ...patch };
      if (next === previous) return current;
      return { ...current, [jobId]: next };
    });
  }, []);
  const clearStreamingDelta = useCallback((jobId) => {
    const frame = streamingFrames.current.get(jobId);
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    streamingFrames.current.delete(jobId);
    streamingBuffers.current.delete(jobId);
  }, []);
  const updateJobDetail = useCallback((jobId, update) => {
    const current = detailCache.current.get(jobId);
    if (!current) return;
    const next = update(current);
    if (next === current) return;
    // Local stream/trace updates also belong to detached jobs. An older read
    // must not replace newer output when the user returns to the conversation.
    detailRequestSequence.current.set(jobId, (detailRequestSequence.current.get(jobId) || 0) + 1);
    detailCache.current.set(jobId, next);
    if (activeJobRef.current === jobId) setDetail(next);
  }, []);
  const flushStreamingDelta = useCallback((jobId, controller) => {
    if (!streamingLive.current || controller?.signal.aborted || conversationControllers.current.get(jobId) !== controller) return;
    streamingFrames.current.delete(jobId);
    const text = streamingBuffers.current.get(jobId) || "";
    streamingBuffers.current.delete(jobId);
    if (!text) return;
    updateJobDetail(jobId, (current) => {
      if (current?.job?.id !== jobId || controller.signal.aborted || conversationControllers.current.get(jobId) !== controller) return current;
      const exists = current.messages.some((item) => item.id === "streaming-assistant");
      const messages = exists
        ? current.messages.map((item) => item.id === "streaming-assistant" ? { ...item, content: item.content + text } : item)
        : [...current.messages, { id: "streaming-assistant", role: "assistant", content: text, metadata_json: { delivery_status: "streaming" } }];
      return { ...current, messages };
    });
  }, [updateJobDetail]);
  const queueStreamingDelta = useCallback((jobId, text, controller) => {
    if (!text || !streamingLive.current || controller.signal.aborted || conversationControllers.current.get(jobId) !== controller) return;
    streamingBuffers.current.set(jobId, `${streamingBuffers.current.get(jobId) || ""}${text}`);
    if (streamingFrames.current.has(jobId)) return;
    streamingFrames.current.set(jobId, window.requestAnimationFrame(() => flushStreamingDelta(jobId, controller)));
  }, [flushStreamingDelta]);

  useEffect(() => installSelectAllShortcut(), []);
  useEffect(() => {
    const compact = window.matchMedia("(max-width: 759px)");
    const collapse = () => { if (compact.matches) setSidebarOpen(false); };
    collapse();
    compact.addEventListener("change", collapse);
    return () => compact.removeEventListener("change", collapse);
  }, []);
  useEffect(() => {
    streamingLive.current = true;
    const controllers = conversationControllers.current;
    const frames = streamingFrames.current;
    const buffers = streamingBuffers.current;
    return () => {
      streamingLive.current = false;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
      frames.clear();
      buffers.clear();
    };
  }, []);

  useEffect(() => {
    applyAppearance(appearanceRef.current);
    const stopWatching = watchSystemTheme(() => appearanceRef.current);
    const onAppearanceChanged = (event) => {
      appearanceRef.current = applyAppearance(event.detail || appearanceRef.current);
    };
    window.addEventListener("fetchcv:appearance", onAppearanceChanged);
    return () => {
      stopWatching();
      window.removeEventListener("fetchcv:appearance", onAppearanceChanged);
    };
  }, []);

  useEffect(() => {
    if (!backendStatus.dataReady) return;
    let mounted = true;
    void api.generalSettings().then(appearance => {
      if (mounted) appearanceRef.current = applyAppearance(appearance);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [backendStatus.dataReady]);

  useEffect(() => {
    const onNotice = (event) => {
      const detail = event?.detail || {};
      setNotice({
        type: detail.type === "success" ? "success" : "error",
        message: String(detail.message || "操作未完成"),
      });
    };
    window.addEventListener("fetchcv:notice", onNotice);
    return () => window.removeEventListener("fetchcv:notice", onNotice);
  }, []);

  useEffect(() => {
    if (notice?.type !== "success") return undefined;
    const timer = setTimeout(() => setNotice(null), 3600);
    return () => clearTimeout(timer);
  }, [notice]);

  const loadDetail = useCallback((jobId, { reusePending = false } = {}) => {
    if (!jobId) return Promise.resolve();
    if (reusePending && detailRequests.current.has(jobId)) return detailRequests.current.get(jobId);
    const sequence = (detailRequestSequence.current.get(jobId) || 0) + 1;
    detailRequestSequence.current.set(jobId, sequence);
    const request = api.jobWorkspace(jobId).then((value) => {
      if (detailRequestSequence.current.get(jobId) === sequence) {
        const snapshot = shareWorkspaceSnapshot(detailCache.current.get(jobId), value);
        detailCache.current.delete(jobId);
        detailCache.current.set(jobId, snapshot);
        // Keep recent workspaces in memory; never evict the selected job or a
        // running conversation whose stream is still updating its snapshot.
        for (const cachedId of detailCache.current.keys()) {
          if (detailCache.current.size <= 12) break;
          if (cachedId !== activeJobRef.current && !conversationControllers.current.has(cachedId)) detailCache.current.delete(cachedId);
        }
        if (activeJobRef.current === jobId) setDetail(snapshot);
      }
      return detailCache.current.get(jobId) || value;
    }).finally(() => {
      if (detailRequests.current.get(jobId) === request) detailRequests.current.delete(jobId);
    });
    detailRequests.current.set(jobId, request);
    return request;
  }, []);
  const loadLibrary = useCallback(async (candidateId) => {
    const sequence = ++librarySequence.current;
    if (!candidateId) { setLibrary(null); return; }
    const value = await api.candidateLibrary(candidateId);
    if (sequence === librarySequence.current) setLibrary(value);
  }, []);
  useEffect(() => {
    const changed = async event => {
      const reads = [loadDetail(activeJobRef.current)];
      if (activeCandidateId && (!event.detail?.candidateId || event.detail.candidateId === activeCandidateId)) {
        reads.push(loadLibrary(activeCandidateId));
      }
      const results = await Promise.allSettled(reads);
      if (results.some(result => result.status === "rejected")) {
        setNotice({type: "error", message: "核验已保存，简报刷新失败，请重新打开岗位。"});
      }
    };
    window.addEventListener("fetchcv:interview-evidence-changed", changed);
    return () => window.removeEventListener("fetchcv:interview-evidence-changed", changed);
  }, [activeCandidateId, loadDetail, loadLibrary]);
  const load = useCallback(async ({ progressive = false } = {}) => {
    const selectionAtStart = activeJobRef.current;
    try {
      const runtimeRequest = api.runtime().then((value) => ({ value }), (requestError) => ({ error: requestError }));
      const nextWorkspace = await api.workspace();
      setWorkspace(nextWorkspace); setOffline(false);
      const conversationsRequest = refreshConversations();
      // The job/library shell is already useful once the workspace index is
      // available. The conversation list and runtime metadata hydrate in the
      // background without keeping the home composer behind secondary queries.
      if (progressive) setInitializing(false);
      let [runtimeResult] = await Promise.all([runtimeRequest, conversationsRequest]);
      // The parallel read can race the sidecar's initial socket bind while
      // workspace succeeds moments later. Retry this read once after readiness.
      if (progressive && runtimeResult.error?.status === 0) {
        runtimeResult = await api.runtime().then((value) => ({ value }), (requestError) => ({ error: requestError }));
      }
      if (runtimeResult.error) {
        setRuntime(null);
        setNotice({ type: "error", message: "模型状态暂时无法读取，个人资料和岗位仍可使用。" });
      } else setRuntime(runtimeResult.value);
      if (activeJobRef.current !== selectionAtStart) return true;
      const candidateId = activeCandidateId || nextWorkspace.candidates[0]?.id;
      if (candidateId) { setActiveCandidateId(candidateId); await loadLibrary(candidateId).catch((error) => setNotice({ type: "error", message: error.message })); } else setLibrary(null);
      const jobId = activeId && nextWorkspace.jobs.some((item) => item.id === activeId) ? activeId : nextWorkspace.jobs[0]?.id;
      if (activeJobRef.current !== selectionAtStart) return true;
      if (jobId) { activeJobRef.current = jobId; setActiveId(jobId); await loadDetail(jobId).catch((error) => setNotice({ type: "error", message: error.message })); }
      else { setDetail(null); }
      return true;
    } catch (loadError) {
      setOffline(true); setError(loadError.message);
      return false;
    }
  }, [activeCandidateId, activeId, loadDetail, loadLibrary, refreshConversations]);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => reportAfterPaint("renderer-first-paint"), []);
  useEffect(() => {
    let cancelled = false;
    const update = status => { if (!cancelled) setBackendStatus(normalizeBackendStatus(status)); };
    const unsubscribe = window.appRuntime?.onBackendStatus?.(update);
    void readBackendStatus().then(update).catch(() => {});
    // Current preload pushes transitions. Poll only for older preload builds.
    const timer = window.appRuntime?.getBackendStatus && !unsubscribe
      ? setInterval(() => { void readBackendStatus().then(update).catch(() => {}); }, 250)
      : null;
    return () => { cancelled = true; unsubscribe?.(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!backendStatus.agentReady) { agentRefreshNeeded.current = true; return; }
    if (!bootstrapComplete || !agentRefreshNeeded.current) return;
    agentRefreshNeeded.current = false;
    // Reconcile can add legacy experiences and restore task state. Refresh
    // after the initial load completes so stale startup reads cannot win.
    void loadRef.current();
  }, [backendStatus.agentReady, bootstrapComplete]);
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const deadline = Date.now() + 30000;
      let startupError = "";
      while (!cancelled && Date.now() < deadline) {
        try {
          const backend = await readBackendStatus();
          if (cancelled) return;
          setBackendStatus(backend);
          if (backend.state === "error" && !backend.dataReady) {
            startupError = backend.message || "本地服务启动失败";
            break;
          }
          if (backend.dataReady) {
            agentRefreshNeeded.current = !backend.agentReady;
            const loaded = await loadRef.current({ progressive: true });
            if (loaded && !cancelled) {
              setBootstrapComplete(true);
              setInitializing(false);
              return;
            }
          }
        } catch (healthError) {
          startupError = healthError.message;
        }
        // During the normal cold-start window poll densely enough that a ready
        // sidecar is reflected immediately. The old 280 ms interval could add
        // a visible quarter-second after the API was already usable.
        const remaining = deadline - Date.now();
        await new Promise((resolve) => setTimeout(resolve, remaining > 25000 ? 50 : 250));
      }
      if (!cancelled) {
        setOffline(true);
        setError(startupError || "本地 Agent 服务启动超时");
        setInitializing(false);
      }
    };
    void bootstrap();
    return () => { cancelled = true; };
  }, []);

  const runId = detail?.run?.id;
  const runStage = detail?.run?.current_stage;
  const latestTask = detail?.tasks?.at(-1) || null;
  const taskActive = ["queued", "running"].includes(latestTask?.status);
  const proposalRewritePending = detail?.approvals?.some(item => item.status === "pending"
    && item.action_type === "apply_resume_changes" && item.decision_payload?.rework_request?.status === "pending");
  useEffect(() => {
    const terminalStages = ["awaiting_fact_review", "awaiting_user_review", "awaiting_publish_approval", "ready_to_publish", "published", "frozen", "failed", "blocked", "cancelled"];
    if (!runId || (terminalStages.includes(runStage) && !taskActive && !proposalRewritePending)) return undefined;
    const timer = setInterval(() => loadDetail(activeId).catch(() => {}), 1800);
    return () => clearInterval(timer);
  }, [activeId, runId, runStage, taskActive, proposalRewritePending, loadDetail]);
  useEffect(() => {
    runEventAbort.current?.abort();
    if (!runId || !taskActive) return undefined;
    const controller = new AbortController();
    runEventAbort.current = controller;
    api.followRunEvents(runId, {
      signal: controller.signal,
      afterSequence: 0,
      onEvent: (name, payload) => {
        if (name !== "trace") return;
        updateJobDetail(activeId, (current) => {
          if (current?.run?.id !== runId) return current;
          const steps = [...(current.steps || []).filter((item) => item.id !== payload.id), payload].sort((a, b) => a.sequence - b.sequence);
          return { ...current, steps };
        });
      },
    }).then(() => loadDetail(activeId)).catch((eventError) => {
      if (eventError.name !== "AbortError") loadDetail(activeId).catch(() => {});
    });
    return () => controller.abort();
  }, [activeId, runId, taskActive, latestTask?.id, loadDetail, updateJobDetail]);

  const act = async (operation, success) => {
    setBusy(true); setError("");
    try {
      const result = await operation();
      await load();
      if (success) setNotice({ type: "success", message: success });
      return result;
    } catch (operationError) {
      setError(operationError.message); setNotice({ type: "error", message: operationError.message });
      return null;
    } finally { setBusy(false); }
  };
  const runWithActivity = async (kind, operation, success) => {
    const descriptor = typeof kind === "string" ? { kind } : kind;
    const jobId = detail?.job?.id || activeJobRef.current;
    setAgentActivity({ ...descriptor, jobId, startedAt: Date.now() });
    try { return await act(operation, success); }
    finally { setAgentActivity((current) => current?.jobId === jobId ? null : current); }
  };
  const selectJob = async (id, tab = null) => {
    closeCompactSidebar();
    const cached = detailCache.current.get(id);
    setRequestedTab(tab ? { jobId: id, tab, nonce: Date.now() } : null);
    setSelectionLoading(!cached);
    setDetail(cached || null);
    activeJobRef.current = id;
    setActiveView("job"); setActiveId(id); setError("");
    if (cached) {
      setActiveCandidateId(cached.candidate.id);
      // A live turn owns its in-memory messages until the final persisted read.
      // Re-reading history here could erase output that has not been saved yet.
      if (conversationControllers.current.has(id)) { setOffline(false); return; }
    }
    try {
      const value = await loadDetail(id, { reusePending: true });
      if (activeJobRef.current !== id) return;
      setActiveCandidateId(value.candidate.id); setOffline(false);
      // The job response already contains its candidate and materials. The
      // full library is loaded by selectLibrary, not on the navigation path.
    } catch (selectionError) { if (activeJobRef.current === id) setError(selectionError.message); }
    finally { if (activeJobRef.current === id) setSelectionLoading(false); }
  };
  const selectLibrary = () => {
    closeCompactSidebar();
    setActiveView("library"); setError("");
    const id = activeCandidateId || workspace.candidates[0]?.id;
    if (id) loadLibrary(id).catch((loadError) => setError(loadError.message));
  };
  const openNewJob = () => {
    if (!workspace.candidates.some((item) => item.fact_count > 0 || item.resume_count > 0)) { continueToJobAfterImport.current = true; setImportOpen(true); return; }
    setNewOpen(true);
  };
  const createJob = async (form) => {
    setBusy(true); setError("");
    try {
      const job = await api.createJob({ ...form, source_type: form.source_type || "manual", status: "draft" });
      const nextWorkspace = await api.workspace();
      setWorkspace(nextWorkspace); activeJobRef.current = job.id; setActiveId(job.id); setActiveCandidateId(job.candidate_id); setActiveView("job"); setNewOpen(false);
      await loadDetail(job.id);
      setNotice({ type: "success", message: "岗位已创建，下一步让 Agent 理解 JD。" });
    } catch (createError) { setError(createError.message); }
    finally { setBusy(false); }
  };
  const start = () => runWithActivity("job", async () => {
    const run = await api.createRun({ candidate_id: detail.candidate.id, job_id: detail.job.id, auto_start: false });
    await api.enqueueTask(run.id, { kind: "start" });
  }, "Agent 已开始理解岗位。");
  const restart = () => runWithActivity("job", async () => {
    const run = await api.createRun({ candidate_id: detail.candidate.id, job_id: detail.job.id, auto_start: false });
    await api.enqueueTask(run.id, { kind: "revision" });
  }, "已保留当前版本，并开始一轮新的岗位规划。");
  const reviewFacts = (factIds) => runWithActivity("strategy", async () => {
    const approval = detail.approvals.find((item) => item.action_type === "confirm_relevant_facts" && item.status === "pending");
    await api.reviewFacts(detail.run.id, { approval_id: approval.id, fact_ids: factIds, approved_by: "local_user" });
    await api.enqueueTask(detail.run.id, { kind: "resume" });
  }, "经历组合已确认，Agent 将继续生成策略。");
  const importLegacy = async () => {
    if (!window.appRuntime?.selectLegacyWorkspace) { setError("请在桌面客户端中迁移旧工作区。"); return; }
    const sourcePath = await window.appRuntime.selectLegacyWorkspace();
    if (!sourcePath) return;
    const result = await act(() => api.importLegacyWorkspace(sourcePath), "旧版简历工作区已迁移。");
    if (result) { setImportOpen(false); setActiveView("library"); }
  };
  const handleImported = async (result) => {
    setActiveCandidateId(result.candidate_id); setActiveView("library");
    setWorkspace(await api.workspace());
    await loadLibrary(result.candidate_id);
    setNotice({ type: "success", message: result.duplicate ? "简历已存在，内容已同步。" : `简历已导入 · ${result.preview?.experiences?.length || result.facts_created} 项经历` });
    if (continueToJobAfterImport.current) { continueToJobAfterImport.current = false; setImportOpen(false); setNewOpen(true); }
  };
  const importWorkspaceMaterials = async () => {
    if (!window.appRuntime?.importWorkspaceFiles) {
      setNotice({ type: "error", message: "请在桌面客户端中添加本地文件。" });
      return [];
    }
    try {
      const files = await window.appRuntime.importWorkspaceFiles();
      if (!files?.length) return [];
      const candidateId = (activeView === "library" ? activeCandidateId : detail?.candidate?.id) || activeCandidateId || workspace.candidates[0]?.id;
      if (candidateId) {
        await Promise.all(files.map((file) => api.createMaterial(candidateId, {
          kind: file.mimeType === "application/zip" ? "repository"
            : /^(application\/pdf|application\/vnd\.|image\/|video\/)/.test(file.mimeType || "") ? "portfolio"
              : "attachment",
          name: file.name,
          source_path: file.workspacePath,
          mime_type: file.mimeType,
          metadata_json: { size_bytes: file.sizeBytes, imported_from: activeView === "library" ? "library" : "composer" },
        })));
        await loadLibrary(candidateId);
      }
      setNotice({ type: "success", message: `已添加 ${files.length} 个文件到本地工作区。` });
      return files;
    } catch (importError) {
      setNotice({ type: "error", message: importError.message || "文件添加失败。" });
      return [];
    }
  };
  const decideToolApproval = async (approvalId, decision) => {
    if (!detail?.run?.id) return;
    setBusy(true); setError("");
    try {
      await api.decideToolApproval(detail.run.id, approvalId, decision);
      await loadDetail(detail.job.id);
      setNotice({ type: "success", message: decision === "approved" ? "操作已授权；Agent 将从当前步骤继续。" : "操作已拒绝，未修改本地文件。" });
    } catch (approvalError) {
      setError(approvalError.message);
      setNotice({ type: "error", message: approvalError.message });
    } finally { setBusy(false); }
  };
  const resolveToolInvocation = async (operationId, decision) => {
    if (!detail?.job?.id) return;
    setBusy(true); setError("");
    try {
      await api.resolveToolInvocation(operationId, decision);
      await loadDetail(detail.job.id);
      const message = decision === "completed"
        ? "已记录为人工核对成功，不会重复执行。"
        : decision === "not_executed"
          ? "已确认未执行；下一次重试将作为新的显式操作继续。"
          : "已保持停止，稍后仍可回来核对。";
      setNotice({ type: "success", message });
    } catch (resolutionError) {
      setError(resolutionError.message);
      setNotice({ type: "error", message: resolutionError.message });
    } finally { setBusy(false); }
  };
  const proposalAction = async (context, operation, success) => {
    const jobId = context.job_id;
    setBusy(true); setError("");
    setAgentActivity({ kind: "review", jobId, startedAt: Date.now() });
    try {
      const result = await operation();
      await loadDetail(jobId);
      setNotice({ type: result?.pause_warning ? "error" : "success", message: typeof success === "function" ? success(result) : success });
      return result || true;
    } catch (operationError) {
      // A mutation may have succeeded before task startup or refresh failed.
      // Read the complete batch so pending/cancelled rewrites stay actionable.
      await loadDetail(jobId).catch(() => {});
      const code = operationError?.payload?.code || operationError?.code;
      const message = code === "approval_revision_conflict"
        ? "审阅已在其他窗口更新，请重新载入最新建议后继续。"
        : code === "approval_target_changed" ? "简历正文已变更，请重新载入并核对本轮审阅。" : operationError.message;
      setError(message); setNotice({ type: "error", message });
      throw operationError;
    } finally {
      setBusy(false);
      setAgentActivity(current => current?.jobId === jobId ? null : current);
    }
  };
  const review = (decisions, context) => proposalAction(context, async () => {
    const result = await api.review(context.run_id, {
      approval_id: context.approval_id, approved_by: "local_user",
      expected_revision: context.expected_revision, expected_target_content_hash: context.expected_target_content_hash,
      decisions: Object.entries(decisions).map(([proposal_id, value]) => ({ proposal_id, ...value })),
    });
    await api.enqueueTask(context.run_id, { kind: "resume" });
    return result;
  }, "修改已确认，Agent 将继续校验和生成版本。");
  const rewriteProposals = (proposalIds, instruction, context) => proposalAction(context, async () => {
    const approval = await api.rewriteProposals(context.run_id, {
      approval_id: context.approval_id, proposal_ids: proposalIds, instruction, requested_by: "local_user",
      expected_revision: context.expected_revision, expected_target_content_hash: context.expected_target_content_hash,
    });
    await api.enqueueTask(context.run_id, { kind: "resume" });
    return approval;
  }, "已提交选中条目的修改意见，重写完成后请重新审阅。");
  const cancelProposalRewrite = (requestId, context) => proposalAction(context, async () => {
    const approval = await api.cancelProposalRewrite(context.run_id, {
      approval_id: context.approval_id, request_id: requestId,
      expected_revision: context.expected_revision, expected_target_content_hash: context.expected_target_content_hash,
    });
    const currentTask = detailCache.current.get(context.job_id)?.tasks?.at(-1);
    if (currentTask && ["queued", "running"].includes(currentTask.status)) {
      try { await api.pauseTask(currentTask.id); }
      catch { return { ...approval, pause_warning: true }; }
    }
    return approval;
  }, result => result?.pause_warning ? "已取消重写并保留原建议和审批决定；旧任务暂停未成功，请等待当前任务结束后再继续。" : "已取消重写并保留原建议和审批决定。");
  const resumeProposalRewrite = context => proposalAction(context, () => {
    const currentTask = detailCache.current.get(context.job_id)?.tasks?.at(-1);
    return api.resumeTask(currentTask?.id, context.run_id);
  }, "已继续本次重写，原有修改意见和审批决定会保留。");
  const reloadProposalReview = () => loadDetail(detail.job.id);
  const approvePublish = () => act(async () => {
    const approval = detail.approvals.find((item) => item.action_type === "publish_assets" && item.status === "pending");
    await api.approvePublish(detail.run.id, { approval_id: approval.id, approved_by: "local_user" });
    await api.enqueueTask(detail.run.id, { kind: "resume" });
  }, "最终检查已确认，Agent 将准备可导出版本。");
  const finalize = () => act(async () => {
    const portfolio = detail.portfolios[0];
    if (portfolio?.status === "draft") await api.publishPortfolio(portfolio.id, detail.run.id);
    await api.createApplication({ run_id: detail.run.id, resume_version_id: detail.resumes[0].id, portfolio_version_id: portfolio?.id || null, status: "submitted" });
    setFreezeOpen(false);
  }, "已记录本次实际投递版本；你仍可继续生成新修订。");
  const sendMessage = async (content, options) => {
    const jobId = detail.job.id;
    if (conversationControllers.current.has(jobId)) return;
    updateJobConversation(jobId, { error: "" });
    if (taskActive) {
      try {
        const steered = await api.steerTask(detail.run?.id, content, options);
        updateJobDetail(jobId, (current) => ({ ...current, messages: [...current.messages, steered.message] }));
        setNotice({ type: "success", message: "补充内容已交给当前 Agent，将在下一步决策前读取。" });
      } catch (queueError) { updateJobConversation(jobId, { error: queueError.message }); }
      return;
    }
    const controller = new AbortController();
    conversationControllers.current.set(jobId, controller);
    clearStreamingDelta(jobId);
    let finished = false;
    const cancelPendingOutput = () => {
      if (conversationControllers.current.get(jobId) !== controller) return;
      clearStreamingDelta(jobId);
      if (streamingLive.current) updateJobConversation(jobId, (state) => ({
        ...state,
        activity: state.activity ? { ...state.activity, stopping: true, label: "正在停止生成" } : null,
      }));
    };
    controller.signal.addEventListener("abort", cancelPendingOutput, { once: true });
    updateJobConversation(jobId, {
      busy: true,
      activity: {
        kind: "chat",
        jobId,
        taskKind: options?.taskKind || "conversation",
        thinkingLevel: options?.thinkingLevel || "balanced",
        label: "正在理解你的问题",
        startedAt: Date.now(),
        events: [],
      },
    });
    try {
      await api.streamMessage(jobId, content, {
        ...options,
        signal: controller.signal,
        onEvent: (eventName, payload) => {
          if (finished || !streamingLive.current || controller.signal.aborted || conversationControllers.current.get(jobId) !== controller) return;
          if (eventName === "status") updateJobConversation(jobId, (state) => {
            const current = state.activity;
            if (!current) return state;
            const label = payload.label === "正在等待模型响应"
              ? "等待当前模型返回结果"
              : payload.label || current.label;
            return label === current.label ? state : { ...state, activity: { ...current, label } };
          });
          if (eventName === "reasoning") updateJobConversation(jobId, (state) => state.activity ? {
            ...state,
            activity: {
              ...state.activity,
              label: payload.event?.label || state.activity.label,
              events: mergeProcessingEvent(state.activity.events || [], payload.event),
            },
          } : state);
          if (eventName === "context_usage") updateJobConversation(jobId, (state) => state.activity ? {
            ...state, activity: { ...state.activity, contextUsage: payload.usage },
          } : state);
          if (eventName === "user") updateJobDetail(jobId, (current) => ({ ...current, messages: [...current.messages.filter((item) => item.id !== payload.message.id), payload.message] }));
          if (eventName === "delta") queueStreamingDelta(jobId, payload.text, controller);
          if (eventName === "done") {
            finished = true;
            clearStreamingDelta(jobId);
            updateJobConversation(jobId, state => ({ ...state, activity: state.activity ? { ...state.activity, finished: true, label: "已完成" } : null }));
            updateJobDetail(jobId, (current) => ({ ...current, messages: [...current.messages.filter((item) => item.id !== "streaming-assistant" && item.id !== payload.assistant.id), payload.assistant] }));
          }
        },
      });
      flushStreamingDelta(jobId, controller);
      finished = true;
      clearStreamingDelta(jobId);
      if (!streamingLive.current) return;
      updateJobConversation(jobId, state => ({ ...state, activity: state.activity ? { ...state.activity, finished: true, label: controller.signal.aborted ? "已停止" : "已完成" } : null }));
      await loadDetail(jobId);
    } catch (streamError) {
      finished = true;
      clearStreamingDelta(jobId);
      if (!streamingLive.current) return;
      updateJobConversation(jobId, state => ({ ...state, activity: state.activity ? { ...state.activity, finished: true, failed: !controller.signal.aborted, label: controller.signal.aborted ? "已停止" : "处理失败" } : null }));
      await loadDetail(jobId).catch(() => {});
      if (streamError.name === "AbortError") setNotice({ type: "success", message: "已停止生成；你的问题仍保留在对话中。" });
      else { updateJobConversation(jobId, { error: streamError.message }); setNotice({ type: "error", message: streamError.message }); }
    } finally {
      controller.signal.removeEventListener("abort", cancelPendingOutput);
      if (conversationControllers.current.get(jobId) === controller) {
        clearStreamingDelta(jobId);
        conversationControllers.current.delete(jobId);
        if (streamingLive.current) updateJobConversation(jobId, { busy: false, activity: null });
      }
    }
  };
  const researchInterviews = () => sendMessage(
    `请为当前岗位开展可追溯的多站点面经调研，默认来源包含小红书和牛客网。先读取岗位并检索本地面试知识库，优先复用已核验正文；若尚无相关牛客来源，即使已有足够小红书来源也要检索牛客。小红书只在共享访问预算内少量读取，优先使用缓存和已加载页面；遵守工具返回的 cooldown_until、retry_after_ms、discovery_exhausted 和未完成原因。不得为了追求来源数连续换词、重试、滚动刷页或切换抓取通道。小红书受限后立即停止该站点，本轮继续读取牛客，不把受限说成没有帖子；随后再检索牛客、知乎、CSDN 的公开原文补齐证据。检索公司、已确认业务线与核心岗位，可适度扩展岗位称谓。每个候选原帖都必须经过 capture_interview_source 和 analyze_interview_source，搜索摘要不能作为证据，只保留有原文引文支持的问题。图片未做 OCR 时标记待识别，不臆造图片问题。区分真实面试问题与准备建议，按真实独立来源归纳频次，结合 JD 和已验证简历事实形成简报。原帖链接是主入口，本地快照只是备用。按时间倒序列出实际使用的原帖，明确牛客与小红书各自实际读取数和受限原因；若牛客没有可验证结果如实说明，不编造来源。不登录、不点赞、不评论、不关注、不发布。`,
    { thinkingLevel: "deep", taskKind: "interview_research" },
  );
  const deleteInterviewSource = (sourceId) => act(
    () => api.deleteInterviewSource(sourceId),
    "面经来源已从本地知识库移除，相关频次已重新计算。",
  );
  const deleteInterviewBrief = (briefId) => act(
    () => api.deleteInterviewBrief(briefId),
    "面试简报已删除，原始面经仍保留在知识库。",
  );
  const handleRuntimeChanged = (value) => {
    setRuntime(value);
    setNotice({ type: "success", message: value?.configured ? `${value.provider_name || value.model} 已连接。` : "模型连接已断开。" });
  };
  const saveResumeEditor = async (resumeId, snapshot) => { await api.updateResumeEditor(resumeId, snapshot); await loadDetail(detail.job.id); };
  const refreshResumeArtifact = async () => { await loadDetail(detail.job.id); setNotice({ type: "success", message: "正式 PDF 已保存，内容与当前预览完全一致。" }); };
  const saveManagedJob = (form) => act(async () => {
    const job = await api.updateJob(managedJob.id, form);
    updateJobDetail(job.id, (current) => ({ ...current, job }));
    await loadDetail(job.id);
    setManagedJob(null);
  }, "岗位项目已更新。");
  const deleteManagedJob = () => act(async () => {
    const deletingId = managedJob.id;
    await api.deleteJob(deletingId); setManagedJob(null);
    detailRequestSequence.current.set(deletingId, (detailRequestSequence.current.get(deletingId) || 0) + 1);
    detailCache.current.delete(deletingId);
    detailRequests.current.delete(deletingId);
    if (activeId === deletingId) { activeJobRef.current = null; setActiveId(null); setDetail(null); setActiveView("library"); }
  }, "岗位项目已删除，个人资料库未受影响。");
  const pauseTask = () => act(() => api.pauseTask(latestTask.id), "已请求暂停；当前模型请求结束后会停下。");
  const resumeTask = () => act(() => api.resumeTask(latestTask.id, latestTask.run_id), "任务已恢复。");
  const cancelTask = () => act(() => api.cancelTask(latestTask.id), "已请求取消当前任务。");
  const retryTask = () => act(
    () => latestTask?.status === "failed" ? api.retryTask(latestTask.id, latestTask.run_id) : api.enqueueTask(detail.run.id, { kind: "retry" }),
    "已从最近的可恢复阶段重试。",
  );
  const jobs = useMemo(() => workspace.jobs, [workspace.jobs]);
  useEffect(() => {
    const shortcut = event => {
      if (!(event.ctrlKey || event.metaKey) || event.isComposing) return;
      // Do not let a global shortcut discard an in-progress modal form.
      if (document.querySelector('[role="dialog"]') && !commandOpen) return;
      if (event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(value=>!value); }
      if (event.key === ",") { event.preventDefault(); setCommandOpen(false); setModelSettingsOpen(true); }
    };
    window.addEventListener("keydown",shortcut);
    return ()=>window.removeEventListener("keydown",shortcut);
  },[commandOpen]);
  if (initializing) return <div className="app-shell"><WindowBar /><StartupWorkspace /></div>;
  const currentUser = detail?.candidate
    || library?.candidate
    || workspace.candidates.find((item) => item.id === activeCandidateId)
    || workspace.candidates[0]
    || { name: "本地用户" };
  const activeConversationState = detail?.job?.id ? (jobConversationStates[detail.job.id] || { busy: false, activity: null, error: "" }) : { busy: false, activity: null, error: "" };
  const taskProvider = taskActive ? latestTask?.payload_json?.provider_snapshot : null;
  const workspaceRuntime = taskProvider ? {
    ...runtime,
    model: taskProvider.model,
    provider_name: taskProvider.provider_name,
    provider_protocol: taskProvider.protocol,
    provider_base_url: taskProvider.base_url,
  } : runtime;



  return <div className="app-shell">
    <WindowBar />
    <div className={`app-grid source-grid ${sidebarOpen ? "" : "source-nav-closed"}`}>
      <WorkspaceRail
        activeView={modelSettingsOpen ? "settings" : activeView}
        onHome={() => { setModelSettingsOpen(false); openConversation(); }}
        onLibrary={() => { setModelSettingsOpen(false); selectLibrary(); }}
        onKnowledge={() => { setModelSettingsOpen(false); setActiveView("knowledge"); setError(""); }}
        onSettings={() => setModelSettingsOpen(true)}
        onSearch={() => { setModelSettingsOpen(false); setCommandOpen(true); }}
      />
      {!sidebarOpen && <button type="button" className="source-open-sidebar source-icon" aria-label="打开侧栏" onClick={() => setSidebarOpen(true)}><PanelLeft size={17}/></button>}
      {sidebarOpen && <WorkspaceSidebar onCollapse={() => setSidebarOpen(false)} jobs={jobs} activeId={activeId} activeView={activeView} onHome={() => openConversation()} conversations={conversations} activeConversationId={activeConversationId} onConversation={openConversation} onDeleteConversation={deleteConversation} onKnowledge={() => { setActiveView("knowledge"); setError(""); }} onLibrary={selectLibrary} onSelect={selectJob} onNew={openNewJob} onManage={setManagedJob} onSettings={() => setModelSettingsOpen(true)} user={currentUser} hasProfile={workspace.candidates.length > 0} />}
      <WorkspaceBoundary resetKey={`${activeView}:${activeId}`}><Suspense fallback={<main className="workspace-recovery" role="status"><LoaderCircle className="spin" size={24} /><p>正在打开工作区…</p></main>}>
      {offline
        ? <EmptyWorkspace offline />
        : activeView === "home"
          ? <ConversationWorkspace key={chatSelection.key} sessionKey={chatSelection.key} conversationId={chatSelection.id} jobs={jobs} runtime={runtime} agentReady={backendStatus.agentReady} startupMessage={backendStatus.agentError} onCreated={id => { setActiveConversationId(id); refreshConversations(); }} onChanged={refreshConversations} onModelActivated={handleRuntimeChanged} onManageModels={(section = "models") => setModelSettingsOpen(section)} onAnalyzeJob={openNewJob} hasProfile={workspace.candidates.some(item => item.fact_count > 0 || item.resume_count > 0)} />
        : activeView === "knowledge"
          ? <InterviewKnowledgeView />
        : activeView === "library"
          ? library ? <LibraryView library={library} busy={busy} onImportResume={() => setImportOpen(true)} onAddMaterial={importWorkspaceMaterials} onNewJob={openNewJob} onDeleteInterviewSource={deleteInterviewSource} onDeleteInterviewBrief={deleteInterviewBrief} /> : <EmptyWorkspace onImport={() => setImportOpen(true)} offline={false} hasProfile={false} busy={busy} />
          : selectionLoading
            ? <main className="workspace-recovery" role="status"><LoaderCircle className="spin" size={24} /><p>正在读取岗位资料…</p></main>
          : !detail && error
            ? <main className="workspace-recovery" role="alert"><AlertCircle size={24} /><h2>岗位资料暂时无法读取</h2><p>{error}</p><button className="primary-button" onClick={() => selectJob(activeId)}>重试</button></main>
          : !detail
            ? <EmptyWorkspace onNew={openNewJob} onImport={() => setImportOpen(true)} offline={false} hasProfile={workspace.candidates.length > 0} busy={busy} />
            : <AgentWorkspace key={detail.job.id} requestedTab={requestedTab} detail={detail} runtime={workspaceRuntime} agentReady={backendStatus.agentReady} startupMessage={backendStatus.agentError} busy={busy || activeConversationState.busy || !backendStatus.agentReady} error={activeConversationState.error || error} activity={activeConversationState.activity || (agentActivity?.jobId === detail.job.id ? agentActivity : null)} task={latestTask} onStart={start} onRestart={restart} onFactReview={reviewFacts} onReview={review} onRewriteProposals={rewriteProposals} onCancelProposalRewrite={cancelProposalRewrite} onResumeProposalRewrite={resumeProposalRewrite} onReloadReview={reloadProposalReview} onPublishApproval={approvePublish} onRetry={retryTask} onPauseTask={pauseTask} onResumeTask={resumeTask} onCancelTask={cancelTask} onResolveInvocation={resolveToolInvocation} onFinalize={() => setFreezeOpen(true)} onSendMessage={sendMessage} onResearchInterviews={researchInterviews} onCancelMessage={() => conversationControllers.current.get(detail.job.id)?.abort()} onAddMaterial={importWorkspaceMaterials} onApprovalDecision={decideToolApproval} onModelActivated={handleRuntimeChanged} onOpenModelSettings={(section = "models") => setModelSettingsOpen(section)} onSaveResumeEditor={saveResumeEditor} onResumePdfSaved={refreshResumeArtifact} onEditJob={() => setManagedJob(detail.job)} />}
      {!offline && <InteractiveMilestone />}
      </Suspense></WorkspaceBoundary>
      {activeView === "library" ? <Suspense fallback={null}><LibraryRail library={library} /></Suspense> : activeView === "job" && !detail && !selectionLoading && !error ? <aside className="context-blank"><FolderKanban size={19} /><span>岗位上下文会显示在这里</span></aside> : null}
    </div>
    {commandOpen && <Suspense fallback={null}><CommandMenu conversations={conversations} jobs={jobs} onConversation={openConversation} onJob={selectJob} onNew={() => openConversation()} onImport={() => setImportOpen(true)} onSettings={() => setModelSettingsOpen(true)} onClose={() => setCommandOpen(false)}/></Suspense>}
    <NewJobModal open={newOpen} candidates={workspace.candidates} preferredCandidateId={activeCandidateId} onClose={() => setNewOpen(false)} onCreate={createJob} busy={busy} />
    <JobManageDialog job={managedJob} busy={busy} onClose={() => setManagedJob(null)} onSave={saveManagedJob} onDelete={deleteManagedJob} />
    {importOpen && <Suspense fallback={null}><ImportResumeDialog open={importOpen} candidates={workspace.candidates} preferredCandidateId={activeCandidateId} onClose={() => { continueToJobAfterImport.current = false; setImportOpen(false); }} onImported={handleImported} onLegacyImport={importLegacy} /></Suspense>}
    <FreezeConfirm open={freezeOpen} detail={detail} busy={busy} onClose={() => setFreezeOpen(false)} onConfirm={finalize} />
    {modelSettingsOpen && <Suspense fallback={null}><ModelSettingsDialog initialSection={typeof modelSettingsOpen === "string" ? modelSettingsOpen : "general"} open={Boolean(modelSettingsOpen)} user={currentUser} runtime={runtime} stats={{ jobs: workspace.jobs.filter((item) => item.candidate_id === currentUser?.id).length, resumes: currentUser?.resume_count, materials: currentUser?.material_count }} onClose={() => setModelSettingsOpen(false)} onSaved={handleRuntimeChanged} /></Suspense>}
    {notice && <motion.div role="status" className={`app-notice ${notice.type}`} initial={motionStyle.enter()} animate={{ opacity: 1, y: 0 }} transition={motionStyle.transition("enter")}><span>{notice.type === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{notice.message}</span><button onClick={() => setNotice(null)} aria-label="关闭通知"><X size={13} /></button></motion.div>}
  </div>;
}
