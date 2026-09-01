import { motion } from "framer-motion";
import {
  AlertCircle, BriefcaseBusiness, Building2, CheckCircle2, ChevronRight, FileText, FileUp,
  FolderKanban, Globe2, LoaderCircle, Minus, MoreHorizontal, Plus,
  Search, Settings, Square, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { ImportResumeDialog } from "./components/ImportResumeDialog";
import { LibraryRail, LibraryView } from "./components/LibraryView";
import { ModelSettingsDialog } from "./components/ModelSettingsDialog";
import { api } from "./lib/api";
import { applyAppearance, DEFAULT_APPEARANCE, watchSystemTheme } from "./lib/appearance";
import { splitJobDescriptions } from "./lib/job-description";
import { installSelectAllShortcut } from "./lib/keyboard";
import { mergeProcessingEvent } from "./lib/processing";

const stageLabels = {
  created: "准备任务", input_validating: "核对输入", jd_analyzing: "理解岗位",
  facts_matching: "寻找相关经历", awaiting_fact_review: "确认相关经历", strategy_generating: "形成策略",
  draft_generating: "起草改写", awaiting_user_review: "等待你审核", approved_changes_applying: "应用改写",
  fact_validating: "校验事实", portfolio_building: "组织作品集", consistency_checking: "一致性检查",
  awaiting_publish_approval: "等待最终检查", ready_to_publish: "待检查", published: "已导出",
  frozen: "已记录投递", failed: "运行失败", blocked: "已阻止", cancelled: "已取消",
};

function WindowBar() {
  const desktop = window.desktopWindow;
  const isMac = desktop?.platform === "darwin";
  return <div className={`windowbar ${isMac ? "macos" : "custom-controls"}`}>
    <div className="window-drag"><img className="window-logo" src="./FetchCV_LOGO.png" alt="" />FetchCV</div>
    {desktop && !isMac && <div className="window-actions">
      <button onClick={desktop.minimize} aria-label="最小化"><Minus size={14} /></button>
      <button onClick={desktop.toggleMaximize} aria-label="最大化"><Square size={11} /></button>
      <button className="window-close" onClick={desktop.close} aria-label="关闭"><X size={14} /></button>
    </div>}
  </div>;
}

function JobSidebar({ jobs, activeId, activeView, onLibrary, onSelect, onNew, onSettings, onManage, user, hasProfile }) {
  const [query, setQuery] = useState("");
  const [collapsedCompanies, setCollapsedCompanies] = useState(() => new Set());
  const filtered = jobs.filter((job) => `${job.company}${job.role}`.toLowerCase().includes(query.toLowerCase()));
  const companyGroups = useMemo(() => {
    const groups = new Map();
    filtered.forEach((job) => {
      const company = job.company?.trim() || "未命名公司";
      if (!groups.has(company)) groups.set(company, []);
      groups.get(company).push(job);
    });
    return [...groups.entries()].map(([company, companyJobs]) => ({ company, jobs: companyJobs }));
  }, [filtered]);
  useEffect(() => {
    const activeCompany = jobs.find((job) => job.id === activeId)?.company?.trim();
    if (!activeCompany) return;
    setCollapsedCompanies((current) => {
      if (!current.has(activeCompany)) return current;
      const next = new Set(current);
      next.delete(activeCompany);
      return next;
    });
  }, [activeId, jobs]);
  const toggleCompany = (company) => setCollapsedCompanies((current) => {
    const next = new Set(current);
    next.has(company) ? next.delete(company) : next.add(company);
    return next;
  });
  return <aside className="sidebar">
    <div className="sidebar-head">
      <div className="workspace-title"><img src="./FetchCV_LOGO.png" alt="" /><span>FetchCV</span></div>
      <button className="icon-button" onClick={onNew} title={hasProfile ? "新增岗位" : "先导入简历"}><Plus size={17} /></button>
    </div>
    <button className={`library-nav ${activeView === "library" ? "active" : ""}`} onClick={onLibrary}>
      <FolderKanban size={15} /><span><strong>个人资料库</strong><small>{hasProfile ? "简历与经历" : "等待导入简历"}</small></span><ChevronRight size={14} />
    </button>
    <div className="search-field"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索岗位" /></div>
    <div className="sidebar-label">岗位项目 <span>{filtered.length}</span></div>
    <nav className="job-list">
      {companyGroups.map(({ company, jobs: companyJobs }) => {
        const collapsed = !query.trim() && collapsedCompanies.has(company);
        return <section key={company} className={`company-job-group ${collapsed ? "collapsed" : ""}`}>
          <button type="button" className="company-group-toggle" aria-expanded={!collapsed} aria-label={`${collapsed ? "展开" : "收起"} ${company} 岗位`} onClick={() => toggleCompany(company)}>
            <Building2 size={14} /><span>{company}</span><small>{companyJobs.length}</small><ChevronRight size={13} />
          </button>
          <div className="company-job-list">{companyJobs.map((job) => {
            const stage = job.latest_run?.current_stage;
            return <div key={job.id} className={`job-row-shell ${job.id === activeId ? "active" : ""}`}>
              <button className="job-row" aria-label={`${job.company} ${job.role}`} onClick={() => onSelect(job.id)}>
                <span className={`job-dot ${["published", "frozen"].includes(stage) ? "done" : stage ? "working" : ""}`} />
                <span className="job-copy"><strong>{job.role}</strong><small>{stage ? stageLabels[stage] || "处理中" : "尚未开始"}</small></span>
              </button>
              <button className="job-row-menu" aria-label={`管理 ${job.company} 岗位`} onClick={() => onManage(job)}><MoreHorizontal size={14} /></button>
            </div>;
          })}</div>
        </section>;
      })}
      {!filtered.length && <div className="empty-list">{jobs.length ? "没有匹配的岗位" : "还没有岗位项目"}</div>}
    </nav>
    <button type="button" className="sidebar-foot" onClick={onSettings} title="打开设置">
      <span className="sidebar-user-avatar" aria-hidden="true">{(user?.name || "本").trim().slice(0, 1)}</span>
      <div><strong>{user?.name || "本地用户"}</strong><small>个人资料</small></div>
      <Settings size={14} />
    </button>
  </aside>;
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
    <span><i />正在准备本地 Agent</span>
  </main>;
}

function NewJobModal({ open, candidates, onClose, onCreate, busy }) {
  const [form, setForm] = useState({ candidate_id: "", company: "", role: "", jd_raw: "", source_type: "manual", source_url: "" });
  const [inputMode, setInputMode] = useState("url");
  const [webPreview, setWebPreview] = useState(null);
  const [webBusy, setWebBusy] = useState(false);
  const [importedJobs, setImportedJobs] = useState([]);
  const [importedIndex, setImportedIndex] = useState(0);
  const [importedName, setImportedName] = useState("");
  const [importError, setImportError] = useState("");
  useEffect(() => {
    if (open) {
      setForm({ candidate_id: candidates[0]?.id || "", company: "", role: "", jd_raw: "", source_type: "manual", source_url: "" });
      setImportedJobs([]); setImportedIndex(0); setImportedName(""); setImportError("");
      setInputMode("url"); setWebPreview(null); setWebBusy(false);
    }
  }, [open, candidates]);
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
      const jobs = splitJobDescriptions(file.text);
      setImportedName(file.name); setImportedJobs(jobs); setImportedIndex(0);
      if (jobs.length) {
        const first = jobs[0];
        setForm((current) => ({ ...current, company: first.company, role: first.role, jd_raw: first.jd, source_type: "file_import" }));
      } else {
        setForm((current) => ({ ...current, jd_raw: file.text.trim(), source_type: "file_import" }));
      }
    } catch (error) { setImportError(error.message || "岗位文件读取失败"); }
  };
  const chooseImportedJob = (value) => {
    const index = Number(value);
    const job = importedJobs[index];
    if (!job) return;
    setImportedIndex(index);
    setForm((current) => ({ ...current, company: job.company, role: job.role, jd_raw: job.jd, source_type: "file_import" }));
  };
  const importJobPage = async () => {
    const url = form.source_url.trim();
    if (!url) return;
    setImportError(""); setWebBusy(true); setWebPreview(null);
    try {
      const posting = await api.previewJobPosting(url);
      setWebPreview(posting);
      setForm((current) => ({ ...current, company: posting.company || current.company, role: posting.title || current.role, jd_raw: posting.description || current.jd_raw, source_type: "web_import", source_url: posting.source_url || url }));
    } catch (error) { setImportError(error.message || "招聘网页读取失败"); }
    finally { setWebBusy(false); }
  };
  if (!open) return null;
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <motion.form role="dialog" aria-modal="true" aria-labelledby="new-job-title" className="job-modal" initial={{ opacity: 0, scale: .98, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} onSubmit={(event) => { event.preventDefault(); onCreate(form); }}>
      <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="关闭"><X size={16} /></button>
      <p className="eyebrow">NEW JOB</p><h2 id="new-job-title">新增岗位项目</h2><p>填写岗位信息后，Agent 会先解释对 JD 的理解，再给出经历与改写建议。</p>
      <label>候选人<select value={form.candidate_id} onChange={(event) => setForm({ ...form, candidate_id: event.target.value })}>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
      <div className="jd-input-tabs" role="tablist" aria-label="岗位描述来源"><button type="button" role="tab" aria-selected={inputMode === "url"} className={inputMode === "url" ? "active" : ""} onClick={() => setInputMode("url")}>网页导入</button><button type="button" role="tab" aria-selected={inputMode === "text"} className={inputMode === "text" ? "active" : ""} onClick={() => setInputMode("text")}>导入文本</button><button type="button" onClick={importJobFile}><FileUp size={14} />文件</button></div>
      {inputMode === "url" && <div className="jd-url-import"><input aria-label="招聘网页 URL" type="url" value={form.source_url} onChange={(event) => setForm({ ...form, source_url: event.target.value, source_type: "web_import" })} placeholder="https://talent.example.com/jobs/..." /><button type="button" disabled={webBusy || !form.source_url.trim()} onClick={importJobPage}>{webBusy ? <LoaderCircle className="spin" size={14} /> : <Globe2 size={14} />}读取网页</button></div>}
      {inputMode === "text" && <div className="jd-file-import"><span>{importedName || "粘贴或输入岗位描述文本"}</span></div>}
      {importedJobs.length > 1 && <label className="jd-import-picker">检测到 {importedJobs.length} 个岗位<select aria-label="选择导入的岗位" value={importedIndex} onChange={(event) => chooseImportedJob(event.target.value)}>{importedJobs.map((job, index) => <option value={index} key={`${job.company}-${job.role}-${index}`}>{job.company} · {job.role}</option>)}</select></label>}
      {importError && <div className="dialog-error" role="alert">{importError}</div>}
      {webPreview && <div className="jd-web-preview"><strong>{webPreview.title || "已读取招聘页面"}</strong><span>{webPreview.structured_data ? "已识别结构化职位信息" : "已读取页面正文"} · {Math.round((webPreview.description || "").length / 10) / 100}k 字符</span></div>}
      <div className="form-row">
        <label>公司<input required value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="例如：字节跳动" /></label>
        <label>岗位<input required value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} placeholder="例如：AI 产品经理" /></label>
      </div>
      <label>岗位描述<textarea required value={form.jd_raw} onChange={(event) => setForm({ ...form, jd_raw: event.target.value, source_type: inputMode === "url" ? "web_import" : "manual" })} placeholder={inputMode === "url" ? "读取网页后会填充正文，也可以手动修正…" : "粘贴完整岗位职责与任职要求…"} /></label>
      <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !form.candidate_id}>{busy && <LoaderCircle className="spin" size={15} />}创建项目</button></div>
    </motion.form>
  </div>;
}

function JobManageDialog({ job, busy, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({ company: "", role: "", jd_raw: "" });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => {
    if (job) {
      setForm({ company: job.company || "", role: job.role || "", jd_raw: job.jd_raw || "" });
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
    <motion.form className="job-modal job-manage-dialog" role="dialog" aria-modal="true" aria-labelledby="manage-job-title" initial={{ opacity: 0, scale: .985, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
      <button type="button" className="modal-close" aria-label="关闭" disabled={busy} onClick={onClose}><X size={16} /></button>
      <p className="eyebrow">JOB PROJECT</p><h2 id="manage-job-title">管理岗位项目</h2><p>修改岗位信息会影响下一轮分析。删除岗位不会删除个人资料库。</p>
      <div className="form-row"><label>公司<input required value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></label><label>岗位<input required value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} /></label></div>
      <label>岗位描述<textarea required value={form.jd_raw} onChange={(event) => setForm({ ...form, jd_raw: event.target.value })} /></label>
      {confirmingDelete && <div className="delete-warning"><AlertCircle size={15} /><p><strong>确定删除这个岗位项目？</strong><span>这个动作无法撤销，但不会删除基础简历和个人经历。</span></p></div>}
      <div className="modal-actions manage-actions"><button type="button" className={confirmingDelete ? "danger-confirm" : "danger-button"} disabled={busy} onClick={() => confirmingDelete ? onDelete() : setConfirmingDelete(true)}><Trash2 size={14} />{confirmingDelete ? "再次点击确认删除" : "删除项目"}</button><span />{confirmingDelete && <button type="button" className="text-button" disabled={busy} onClick={() => setConfirmingDelete(false)}>取消删除</button>}<button type="button" className="text-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !form.company.trim() || !form.role.trim() || !form.jd_raw.trim()}>保存修改</button></div>
    </motion.form>
  </div>;
}

function FreezeConfirm({ open, detail, busy, onClose, onConfirm }) {
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, busy, onClose]);
  if (!open) return null;
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <motion.section role="alertdialog" aria-modal="true" aria-labelledby="freeze-title" className="confirm-dialog" initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}>
      <span className="confirm-icon"><CheckCircle2 size={21} /></span><p className="eyebrow">SUBMISSION RECORD</p><h2 id="freeze-title">记录这次实际投递？</h2>
      <p>FetchCV 会为 <strong>{detail.job.company} · {detail.job.role}</strong> 保存当时使用的简历版本快照。这个动作不会阻止你继续修改和生成新版本。</p>
      <div className="confirm-assets"><span><FileText size={14} />{detail.resumes[0]?.name}</span>{detail.portfolios[0] && <span><Globe2 size={14} />岗位作品集</span>}</div>
      <div className="modal-actions"><button className="text-button" disabled={busy} onClick={onClose}>返回检查</button><button className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={14} />}确认已投递</button></div>
    </motion.section>
  </div>;
}

export default function App() {
  const [workspace, setWorkspace] = useState({ candidates: [], jobs: [] });
  const [detail, setDetail] = useState(null);
  const [library, setLibrary] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [activeCandidateId, setActiveCandidateId] = useState(null);
  const [activeView, setActiveView] = useState("job");
  const [runtime, setRuntime] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [managedJob, setManagedJob] = useState(null);
  const [agentActivity, setAgentActivity] = useState(null);
  const [jobConversationStates, setJobConversationStates] = useState({});
  const conversationControllers = useRef(new Map());
  const streamingBuffers = useRef(new Map());
  const streamingFrames = useRef(new Map());
  const runEventAbort = useRef(null);
  const activeJobRef = useRef(null);
  const detailRequestSequence = useRef(new Map());
  const appearanceRef = useRef(DEFAULT_APPEARANCE);
  const updateJobConversation = useCallback((jobId, patch) => {
    setJobConversationStates((current) => {
      const previous = current[jobId] || { busy: false, activity: null, error: "" };
      const next = typeof patch === "function" ? patch(previous) : { ...previous, ...patch };
      return { ...current, [jobId]: next };
    });
  }, []);
  const flushStreamingDelta = useCallback((jobId) => {
    streamingFrames.current.delete(jobId);
    const text = streamingBuffers.current.get(jobId) || "";
    streamingBuffers.current.delete(jobId);
    if (!text) return;
    setDetail((current) => {
      if (current?.job?.id !== jobId) return current;
      const exists = current.messages.some((item) => item.id === "streaming-assistant");
      const messages = exists
        ? current.messages.map((item) => item.id === "streaming-assistant" ? { ...item, content: item.content + text } : item)
        : [...current.messages, { id: "streaming-assistant", role: "assistant", content: text, metadata_json: { delivery_status: "streaming" } }];
      return { ...current, messages };
    });
  }, []);
  const queueStreamingDelta = useCallback((jobId, text) => {
    if (!text) return;
    streamingBuffers.current.set(jobId, `${streamingBuffers.current.get(jobId) || ""}${text}`);
    if (streamingFrames.current.has(jobId)) return;
    streamingFrames.current.set(jobId, window.requestAnimationFrame(() => flushStreamingDelta(jobId)));
  }, [flushStreamingDelta]);

  useEffect(() => installSelectAllShortcut(), []);
  useEffect(() => () => {
    streamingFrames.current.forEach((frame) => window.cancelAnimationFrame(frame));
    streamingFrames.current.clear();
    streamingBuffers.current.clear();
  }, []);

  useEffect(() => {
    let mounted = true;
    applyAppearance(appearanceRef.current);
    api.generalSettings().then((appearance) => {
      if (!mounted) return;
      appearanceRef.current = applyAppearance(appearance);
    }).catch(() => {});
    const stopWatching = watchSystemTheme(() => appearanceRef.current);
    const onAppearanceChanged = (event) => {
      appearanceRef.current = applyAppearance(event.detail || appearanceRef.current);
    };
    window.addEventListener("fetchcv:appearance", onAppearanceChanged);
    return () => {
      mounted = false;
      stopWatching();
      window.removeEventListener("fetchcv:appearance", onAppearanceChanged);
    };
  }, []);

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

  const loadDetail = useCallback(async (jobId) => {
    if (!jobId) return;
    const sequence = (detailRequestSequence.current.get(jobId) || 0) + 1;
    detailRequestSequence.current.set(jobId, sequence);
    const value = await api.jobWorkspace(jobId);
    if (activeJobRef.current === jobId && detailRequestSequence.current.get(jobId) === sequence) {
      setDetail(value);
    }
    return value;
  }, []);
  const loadLibrary = useCallback(async (candidateId) => {
    if (!candidateId) { setLibrary(null); return; }
    setLibrary(await api.candidateLibrary(candidateId));
  }, []);
  const load = useCallback(async ({ progressive = false } = {}) => {
    try {
      const runtimeRequest = api.runtime().then((value) => ({ value }), (requestError) => ({ error: requestError }));
      const nextWorkspace = await api.workspace();
      setWorkspace(nextWorkspace); setOffline(false);
      // The job/library shell is already useful once the workspace index is
      // available. Hydrate runtime metadata and the selected detail next,
      // instead of holding the whole application behind secondary queries.
      if (progressive) setInitializing(false);
      const runtimeResult = await runtimeRequest;
      if (runtimeResult.error) throw runtimeResult.error;
      setRuntime(runtimeResult.value);
      const candidateId = activeCandidateId || nextWorkspace.candidates[0]?.id;
      if (candidateId) { setActiveCandidateId(candidateId); await loadLibrary(candidateId); } else setLibrary(null);
      const jobId = activeId && nextWorkspace.jobs.some((item) => item.id === activeId) ? activeId : nextWorkspace.jobs[0]?.id;
      if (jobId) { activeJobRef.current = jobId; setActiveId(jobId); await loadDetail(jobId); }
      else { setDetail(null); setActiveView("library"); }
      return true;
    } catch (loadError) {
      setOffline(true); setError(loadError.message);
      return false;
    }
  }, [activeCandidateId, activeId, loadDetail, loadLibrary]);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const deadline = Date.now() + 30000;
      let startupError = "";
      while (!cancelled && Date.now() < deadline) {
        try {
          const loaded = await loadRef.current({ progressive: true });
          if (loaded && !cancelled) {
            setInitializing(false);
            return;
          }
        } catch (healthError) {
          startupError = healthError.message;
        }
        const backend = await window.appRuntime?.getBackendStatus?.().catch(() => null);
        if (backend?.state === "error") {
          startupError = backend.message || startupError || "本地 Agent 服务启动失败";
          break;
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
  useEffect(() => {
    const terminalStages = ["awaiting_fact_review", "awaiting_user_review", "awaiting_publish_approval", "ready_to_publish", "published", "frozen", "failed", "blocked", "cancelled"];
    if (!runId || terminalStages.includes(runStage)) return undefined;
    const timer = setInterval(() => loadDetail(activeId).catch(() => {}), 1800);
    return () => clearInterval(timer);
  }, [activeId, runId, runStage, loadDetail]);
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
        setDetail((current) => {
          if (current?.run?.id !== runId) return current;
          const steps = [...(current.steps || []).filter((item) => item.id !== payload.id), payload].sort((a, b) => a.sequence - b.sequence);
          return { ...current, steps };
        });
      },
    }).then(() => loadDetail(activeId)).catch((eventError) => {
      if (eventError.name !== "AbortError") loadDetail(activeId).catch(() => {});
    });
    return () => controller.abort();
  }, [activeId, runId, taskActive, latestTask?.id, loadDetail]);

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
  const selectJob = async (id) => {
    activeJobRef.current = id;
    setActiveView("job"); setActiveId(id); setError("");
    try {
      const value = await loadDetail(id);
      if (activeJobRef.current !== id) return;
      setActiveCandidateId(value.candidate.id); setOffline(false);
      await loadLibrary(value.candidate.id);
    } catch (selectionError) { setError(selectionError.message); }
  };
  const selectLibrary = () => {
    setActiveView("library"); setError("");
    const id = activeCandidateId || workspace.candidates[0]?.id;
    if (id) loadLibrary(id).catch((loadError) => setError(loadError.message));
  };
  const openNewJob = () => {
    if (!workspace.candidates.some((item) => item.fact_count > 0 || item.resume_count > 0)) { setImportOpen(true); return; }
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
    setNotice({ type: "success", message: result.duplicate ? "这份 PDF 已在资料库中，完整经历已同步。" : `简历已导入，整理出 ${result.preview?.experiences?.length || result.facts_created} 项完整经历。` });
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
  const review = (decisions) => runWithActivity("review", async () => {
    const approval = detail.approvals.find((item) => item.action_type === "apply_resume_changes" && item.status === "pending");
    await api.review(detail.run.id, { approval_id: approval.id, approved_by: "local_user", decisions: Object.entries(decisions).map(([proposal_id, value]) => ({ proposal_id, ...value })) });
    await api.enqueueTask(detail.run.id, { kind: "resume" });
  }, "修改已确认，Agent 将继续校验和生成版本。");
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
    const controller = new AbortController();
    const jobId = detail.job.id;
    conversationControllers.current.set(jobId, controller);
    updateJobConversation(jobId, { error: "" });
    if (taskActive) {
      try {
        if (window.appRuntime?.steerPiTask && detail.run?.id) {
          const steered = await api.steerTask(detail.run.id, content, options);
          setDetail((current) => current?.job?.id === jobId ? { ...current, messages: [...current.messages, steered.message] } : current);
          setNotice({ type: "success", message: "补充内容已交给当前 Agent，将在下一步决策前读取。" });
          return;
        }
        const queued = await api.queueMessage(jobId, content, options);
        setDetail((current) => current?.job?.id === jobId ? { ...current, queued_messages: [...(current.queued_messages || []), queued] } : current);
        setNotice({ type: "success", message: "消息已加入队列，将在当前任务停下后处理。" });
      } catch (queueError) { updateJobConversation(jobId, { error: queueError.message }); }
      return;
    }
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
          if (eventName === "user") setDetail((current) => current?.job?.id === jobId ? { ...current, messages: [...current.messages.filter((item) => item.id !== payload.message.id), payload.message] } : current);
          if (eventName === "delta") queueStreamingDelta(jobId, payload.text);
          if (eventName === "done") {
            const frame = streamingFrames.current.get(jobId);
            if (frame) window.cancelAnimationFrame(frame);
            streamingFrames.current.delete(jobId);
            streamingBuffers.current.delete(jobId);
            setDetail((current) => current?.job?.id === jobId ? { ...current, messages: [...current.messages.filter((item) => item.id !== "streaming-assistant" && item.id !== payload.assistant.id), payload.assistant] } : current);
          }
        },
      });
      await loadDetail(jobId);
    } catch (streamError) {
      await loadDetail(jobId).catch(() => {});
      if (streamError.name === "AbortError") setNotice({ type: "success", message: "已停止生成；你的问题仍保留在对话中。" });
      else { updateJobConversation(jobId, { error: streamError.message }); setNotice({ type: "error", message: streamError.message }); }
    } finally {
      if (conversationControllers.current.get(jobId) === controller) conversationControllers.current.delete(jobId);
      updateJobConversation(jobId, { busy: false, activity: null });
    }
  };
  const researchInterviews = () => sendMessage(
    `请为当前岗位开展一次可追溯的面试情报调研。先读取岗位上下文并检索本地面试知识库；证据不足时先完整检索小红书：第一层优先搜索“同公司 + 已确认事业部 + 核心岗位”，第二层再搜索“同公司 + 同岗位”，允许来自其他事业部或没有注明事业部。不要以固定条数提前停止，应持续发现到结果耗尽、连续结果均重复或平台访问保护触发；随后再检索牛客、知乎、CSDN 等公开原文作为补充证据。精确岗位标题没有结果时，从完整标题中提取职能称谓并扩展常见写法，例如“两轮车事业部-策略运营”继续检索“策略运营”“运营策略”，同时保留“两轮车”“青桔”等业务线词。若用户提供公开原帖链接，应直接读取。每个候选链接必须先验证正文可读，失效、扫码、登录、导航和搜索结果页不得进入最终来源清单。只把有原文引文支持的问题写入知识库；图片中的问题未经 OCR 不得臆造。按真实来源数归纳共性问题，结合 JD 和已验证简历事实给出准备建议。最终回答强调问题和准备建议，并按时间倒序列出实际使用的原帖；原帖链接是主入口，本地快照只是备用。若平台要求验证或页面不可读，停止该来源，不进行点赞、评论、关注或发布。`,
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
  const saveManagedJob = (form) => act(async () => { await api.updateJob(managedJob.id, form); setManagedJob(null); }, "岗位项目已更新。");
  const deleteManagedJob = () => act(async () => {
    const deletingId = managedJob.id;
    await api.deleteJob(deletingId); setManagedJob(null);
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
    <div className="app-grid">
      <JobSidebar jobs={jobs} activeId={activeId} activeView={activeView} onLibrary={selectLibrary} onSelect={selectJob} onNew={openNewJob} onManage={setManagedJob} onSettings={() => setModelSettingsOpen(true)} user={currentUser} hasProfile={workspace.candidates.length > 0} />
      {offline
        ? <EmptyWorkspace offline />
        : activeView === "library"
          ? library ? <LibraryView library={library} busy={busy} onImportResume={() => setImportOpen(true)} onAddMaterial={importWorkspaceMaterials} onNewJob={openNewJob} onDeleteInterviewSource={deleteInterviewSource} onDeleteInterviewBrief={deleteInterviewBrief} /> : <EmptyWorkspace onImport={() => setImportOpen(true)} offline={false} hasProfile={false} busy={busy} />
          : !detail
            ? <EmptyWorkspace onNew={openNewJob} onImport={() => setImportOpen(true)} offline={false} hasProfile={workspace.candidates.length > 0} busy={busy} />
            : <AgentWorkspace detail={detail} runtime={workspaceRuntime} busy={busy || activeConversationState.busy} error={activeConversationState.error || error} activity={activeConversationState.activity || (agentActivity?.jobId === detail.job.id ? agentActivity : null)} task={latestTask} onStart={start} onRestart={restart} onFactReview={reviewFacts} onReview={review} onPublishApproval={approvePublish} onRetry={retryTask} onPauseTask={pauseTask} onResumeTask={resumeTask} onCancelTask={cancelTask} onResolveInvocation={resolveToolInvocation} onFinalize={() => setFreezeOpen(true)} onSendMessage={sendMessage} onResearchInterviews={researchInterviews} onCancelMessage={() => conversationControllers.current.get(detail.job.id)?.abort()} onAddMaterial={importWorkspaceMaterials} onApprovalDecision={decideToolApproval} onModelActivated={handleRuntimeChanged} onOpenModelSettings={() => setModelSettingsOpen(true)} onSaveResumeEditor={saveResumeEditor} onResumePdfSaved={refreshResumeArtifact} />}
      {activeView === "library" ? <LibraryRail library={library} /> : !detail ? <aside className="context-blank"><FolderKanban size={19} /><span>岗位上下文会显示在这里</span></aside> : null}
    </div>
    <NewJobModal open={newOpen} candidates={workspace.candidates} onClose={() => setNewOpen(false)} onCreate={createJob} busy={busy} />
    <JobManageDialog job={managedJob} busy={busy} onClose={() => setManagedJob(null)} onSave={saveManagedJob} onDelete={deleteManagedJob} />
    <ImportResumeDialog open={importOpen} candidates={workspace.candidates} preferredCandidateId={activeCandidateId} onClose={() => setImportOpen(false)} onImported={handleImported} onLegacyImport={importLegacy} />
    <FreezeConfirm open={freezeOpen} detail={detail} busy={busy} onClose={() => setFreezeOpen(false)} onConfirm={finalize} />
    <ModelSettingsDialog open={modelSettingsOpen} user={currentUser} runtime={runtime} stats={{ jobs: workspace.jobs.filter((item) => item.candidate_id === currentUser?.id).length, resumes: currentUser?.resume_count, materials: currentUser?.material_count }} onClose={() => setModelSettingsOpen(false)} onSaved={handleRuntimeChanged} />
    {notice && <motion.div role="status" className={`app-notice ${notice.type}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><span>{notice.type === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{notice.message}</span><button onClick={() => setNotice(null)} aria-label="关闭通知"><X size={13} /></button></motion.div>}
  </div>;
}
