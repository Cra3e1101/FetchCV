import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, BookOpen, Check, CheckCircle2, Clipboard, Eye, EyeOff, FolderLock, Globe2,
  KeyRound, LoaderCircle, LockKeyhole, Plus, RefreshCw, Search, Server, Settings2,
  ShieldCheck, SlidersHorizontal, Trash2, UserRound, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

const empty = {
  id: "", providerName: "", protocol: "openai", baseUrl: "", model: "", apiKey: "", hasApiKey: false,
  modelsUrlOverride: "", modelsEndpoint: "", availableModels: [], health: "unknown", latencyMs: null, lastTestedAt: "",
};

const presets = [
  { name: "DeepSeek", protocol: "openai", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  { name: "OpenAI-compatible", protocol: "openai", baseUrl: "", model: "" },
  { name: "Anthropic-compatible", protocol: "anthropic", baseUrl: "", model: "" },
];

const emptyMcpForm = {
  name: "", transport: "stdio", command: "", args: [""], envKeys: [""], cwd: "",
};

const accentOptions = [
  { id: "coral", label: "珊瑚", color: "#c96f52" },
  { id: "sage", label: "鼠尾草", color: "#688b78" },
  { id: "slate", label: "石板", color: "#6d7c8b" },
  { id: "amber", label: "琥珀", color: "#b8884a" },
];

function applyAccent(accent) {
  const value = accentOptions.find((item) => item.id === accent) || accentOptions[0];
  const root = document.documentElement;
  root.style.setProperty("--coral", value.color);
  root.style.setProperty("--coral-dark", value.color);
  root.style.setProperty("--coral-soft", `${value.color}18`);
}

const settingsSections = [
  { id: "general", label: "常规", icon: Settings2, group: "个人" },
  { id: "models", label: "模型 API", icon: SlidersHorizontal, group: "集成" },
  { id: "skills", label: "Skills", icon: BookOpen, group: "集成" },
  { id: "mcp", label: "MCP Servers", icon: Server, group: "集成" },
  { id: "permissions", label: "权限与浏览器", icon: ShieldCheck, group: "安全" },
];

function healthCopy(profile) {
  if (profile.health === "healthy") return profile.latencyMs ? `${profile.latencyMs} ms` : "已验证";
  if (profile.health === "error") return "需检查";
  return "未验证";
}

function McpServerRow({ server, busy, onConnect, onDisable, onApproveWrite, onRevokeWrite }) {
  const writeTools = (server.discovered_tools || []).filter((tool) => !tool.read_only);
  const [drafts, setDrafts] = useState({});
  const draftFor = (tool) => {
    const properties = Object.keys(tool.input_schema?.properties || {});
    const inferred = properties.find((name) => /^(resume|portfolio)(_version)?_id$/.test(name)) || properties.find((name) => name.endsWith("_id")) || "";
    return drafts[tool.name] || { targetType: inferred.startsWith("portfolio") ? "portfolio" : "resume", targetArg: inferred };
  };
  const updateDraft = (tool, patch) => setDrafts((current) => ({ ...current, [tool.name]: { ...draftFor(tool), ...patch } }));
  return <div className="mcp-server-row">
    <div className="mcp-server-head"><span><strong>{server.name}</strong><small>{server.status} · {(server.allowed_tools || []).length} 只读 · {Object.keys(server.tool_policies || {}).length} 写入</small></span>{server.enabled ? <button type="button" onClick={() => onDisable(server)}>停用</button> : <button type="button" disabled={busy} onClick={() => onConnect(server)}>批准并连接</button>}</div>
    {!!writeTools.length && <div className="mcp-write-tools">{writeTools.map((tool) => {
      const policy = server.tool_policies?.[tool.name];
      const draft = draftFor(tool);
      return <div key={tool.name}><span><LockKeyhole size={11} /><i><strong>{tool.name}</strong><small>{policy?.approved ? `${policy.target_type} · ${policy.target_id_argument} · 每次运行仍需审批` : "写入工具默认关闭"}</small></i></span>{policy?.approved ? <button type="button" onClick={() => onRevokeWrite(server, tool)}>撤销</button> : <div className="mcp-write-scope"><select aria-label={`${tool.name} 目标类型`} value={draft.targetType} onChange={(event) => updateDraft(tool, { targetType: event.target.value })}><option value="resume">简历</option><option value="portfolio">作品集</option></select><input aria-label={`${tool.name} 目标参数`} value={draft.targetArg} onChange={(event) => updateDraft(tool, { targetArg: event.target.value })} placeholder="resume_id" /><button type="button" disabled={busy || !draft.targetArg} onClick={() => onApproveWrite(server, tool, draft)}>批准写入</button></div>}</div>;
    })}</div>}
  </div>;
}

export function ModelSettingsDialog({ open, user, runtime, stats = {}, onClose, onSaved }) {
  const [form, setForm] = useState(empty);
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [activeSection, setActiveSection] = useState("general");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [skills, setSkills] = useState([]);
  const [mcpServers, setMcpServers] = useState([]);
  const [mcpForm, setMcpForm] = useState(emptyMcpForm);
  const [permissionSettings, setPermissionSettings] = useState({
    web_access: "allow", workspace_read: "allow", workspace_write: "ask", file_delete: "ask", browser_bridge: "deny",
  });
  const [generalSettings, setGeneralSettings] = useState({ accent: "coral", density: "comfortable" });
  const statusTimer = useRef(null);

  const load = async () => {
    const store = await window.appRuntime?.listModelProviders?.();
    if (store) {
      setProfiles(store.profiles || []);
      setActiveId(store.activeId || "");
      const active = store.profiles?.find((item) => item.id === store.activeId) || store.profiles?.[0];
      setForm(active ? { ...empty, ...active, apiKey: "" } : empty);
      return;
    }
    const value = await window.appRuntime?.getModelProvider?.();
    setForm({ ...empty, ...value, apiKey: "" });
  };

  useEffect(() => {
    if (!open) return undefined;
    setStatus(null); setShowKey(false); setModelQuery(""); setSettingsQuery(""); setActiveSection("general");
    load().catch((error) => setStatus({ type: "error", message: error.message }));
    Promise.all([api.skills(), api.mcpServers(), api.permissionSettings(), api.generalSettings()]).then(([nextSkills, nextServers, nextPermissions, nextGeneral]) => {
      setSkills(nextSkills); setMcpServers(nextServers); setPermissionSettings(nextPermissions); setGeneralSettings(nextGeneral); applyAccent(nextGeneral.accent);
    }).catch((error) => setStatus({ type: "error", message: error.message }));
    const escape = (event) => { if (event.key === "Escape" && !busy && !fetchingModels) onClose(); };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); window.clearTimeout(statusTimer.current); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(["baseUrl", "protocol", "modelsUrlOverride"].includes(field) ? { availableModels: [], modelsEndpoint: "" } : {}),
    }));
    setStatus(null);
  };
  const choosePreset = (preset) => {
    setForm({ ...empty, ...preset });
    setStatus(null); setModelQuery("");
  };
  const applyClipboardText = (value) => {
    const text = String(value || "").trim();
    if (!text) return false;
    update("apiKey", text);
    return true;
  };
  const pasteApiKey = async () => {
    try {
      const text = await window.appRuntime?.readClipboardText?.();
      if (!applyClipboardText(text)) setStatus({ type: "error", message: "剪贴板没有可用内容，请使用右键粘贴或手动输入" });
    } catch {
      setStatus({ type: "error", message: "无法读取系统剪贴板，请使用右键粘贴或手动输入" });
    }
  };
  const handleKeyPaste = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
      event.preventDefault();
      pasteApiKey();
    }
  };
  const handlePaste = (event) => {
    const text = event.clipboardData?.getData("text");
    if (text) { event.preventDefault(); applyClipboardText(text); }
  };
  const payload = () => ({
    id: form.id, providerName: form.providerName, protocol: form.protocol, baseUrl: form.baseUrl,
    model: form.model, apiKey: form.apiKey, modelsUrlOverride: form.modelsUrlOverride,
    modelsEndpoint: form.modelsEndpoint, availableModels: form.availableModels,
  });
  const discoverModels = async () => {
    setFetchingModels(true); setStatus({ type: "testing", message: "正在读取服务提供的模型…" });
    try {
      const result = await window.appRuntime.fetchModelProviderModels(payload());
      setForm((current) => ({
        ...current,
        availableModels: result.models || [],
        modelsEndpoint: result.endpoint || "",
        model: current.model || result.models?.[0]?.id || "",
      }));
      setStatus({ type: "success", message: `已从服务读取 ${result.models.length} 个模型。` });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally { setFetchingModels(false); }
  };
  const test = async () => {
    setBusy(true); setStatus({ type: "testing", message: "正在发送最小测试请求…" });
    try {
      const result = await window.appRuntime.testModelProvider(payload());
      setStatus({ type: "success", message: `连接成功 · ${result.model} · ${result.latencyMs} ms` });
    } catch (error) { setStatus({ type: "error", message: error.message }); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setStatus({ type: "testing", message: "正在验证并安全保存…" });
    try {
      const result = await window.appRuntime.saveModelProvider(payload());
      setStatus({ type: "success", message: "连接已保存并设为当前模型。" });
      setProfiles(result.store?.profiles || []); setActiveId(result.activeId || result.store?.activeId || "");
      const saved = result.store?.profiles?.find((item) => item.id === result.activeId);
      setForm((current) => ({ ...current, ...saved, id: result.activeId || current.id, apiKey: "", hasApiKey: true }));
      onSaved?.(result.runtime);
    } catch (error) { setStatus({ type: "error", message: error.message }); } finally { setBusy(false); }
  };
  const activate = async (profile) => {
    setBusy(true); setStatus(null);
    try {
      const result = await window.appRuntime.activateModelProvider(profile.id, profile.model);
      setActiveId(profile.id); setForm({ ...empty, ...result.provider, apiKey: "" }); onSaved?.(result.runtime);
    } catch (error) { setStatus({ type: "error", message: error.message }); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    try {
      const store = await window.appRuntime.deleteModelProvider(id);
      setProfiles(store.profiles || []); setActiveId(store.activeId || "");
      if (store.runtime) onSaved?.(store.runtime);
      if (form.id === id) {
        const next = store.profiles?.find((item) => item.id === store.activeId) || store.profiles?.[0];
        setForm(next ? { ...empty, ...next, apiKey: "" } : empty);
      }
    } catch (error) { setStatus({ type: "error", message: error.message }); }
  };

  const modelOptions = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    return (form.availableModels || []).filter((item) => !query || item.id.toLowerCase().includes(query)).slice(0, 60);
  }, [form.availableModels, modelQuery]);
  const valid = form.providerName && form.baseUrl && form.model && (form.apiKey || form.hasApiKey);
  const canDiscover = form.baseUrl && (form.apiKey || form.hasApiKey);
  const refreshExtensions = async () => {
    const [nextSkills, nextServers] = await Promise.all([api.reloadSkills(), api.mcpServers()]);
    setSkills(nextSkills); setMcpServers(nextServers);
  };
  const toggleSkill = async (skill) => {
    const updated = await api.updateSkill(skill.id, !skill.enabled);
    setSkills((items) => items.map((item) => item.id === updated.id ? updated : item));
  };
  const updateMcpField = (field, value) => setMcpForm((current) => ({ ...current, [field]: value }));
  const updateMcpListField = (field, index, value) => setMcpForm((current) => ({
    ...current,
    [field]: current[field].map((item, itemIndex) => itemIndex === index ? value : item),
  }));
  const addMcpListField = (field) => setMcpForm((current) => ({ ...current, [field]: [...current[field], ""] }));
  const removeMcpListField = (field, index) => setMcpForm((current) => {
    const next = current[field].filter((_, itemIndex) => itemIndex !== index);
    return { ...current, [field]: next.length ? next : [""] };
  });
  const addMcp = async () => {
    setBusy(true); setStatus({ type: "testing", message: "正在验证 MCP 启动配置…" });
    try {
      const created = await api.createMcpServer({
        name: mcpForm.name.trim(), transport: mcpForm.transport, command: mcpForm.command.trim(),
        args: mcpForm.transport === "stdio" ? mcpForm.args.map((item) => item.trim()).filter(Boolean) : [], cwd: mcpForm.transport === "stdio" ? (mcpForm.cwd.trim() || null) : null,
        env_keys: [...new Set(mcpForm.envKeys.map((item) => item.trim()).filter(Boolean))],
      });
      setMcpServers((items) => [...items, created]); setMcpForm(emptyMcpForm);
      setStatus({ type: "success", message: "MCP 配置已保存；启动前仍需明确批准。" });
    } catch (error) { setStatus({ type: "error", message: error.message }); } finally { setBusy(false); }
  };
  const approveAndEnableMcp = async (server) => {
    setBusy(true); setStatus({ type: "testing", message: `正在启动并检查 ${server.name}…` });
    try {
      if (!server.approved) await api.approveMcpServer(server.id);
      const probed = await api.probeMcpServer(server.id);
      const allowed = (probed.discovered_tools || []).filter((tool) => tool.read_only).map((tool) => tool.name);
      const enabled = await api.updateMcpServer(server.id, { allowed_tools: allowed, enabled: true });
      setMcpServers((items) => items.map((item) => item.id === enabled.id ? enabled : item));
      setStatus({ type: "success", message: `${server.name} 已启用 ${allowed.length} 个只读工具。` });
    } catch (error) { setStatus({ type: "error", message: error.message }); } finally { setBusy(false); }
  };
  const disableMcp = async (server) => {
    const updated = await api.updateMcpServer(server.id, { enabled: false });
    setMcpServers((items) => items.map((item) => item.id === updated.id ? updated : item));
  };
  const approveMcpWrite = async (server, tool, draft) => {
    setBusy(true);
    try {
      const updated = await api.approveMcpWriteTool(server.id, tool.name, { target_type: draft.targetType, target_id_argument: draft.targetArg, confirmation: "approve_write_tool" });
      setMcpServers((items) => items.map((item) => item.id === updated.id ? updated : item));
      setStatus({ type: "success", message: `${tool.name} 已限定到 ${draft.targetArg}；实际调用仍需逐次审批。` });
    } catch (error) { setStatus({ type: "error", message: error.message }); } finally { setBusy(false); }
  };
  const revokeMcpWrite = async (server, tool) => {
    const updated = await api.revokeMcpWriteTool(server.id, tool.name);
    setMcpServers((items) => items.map((item) => item.id === updated.id ? updated : item));
  };
  const updatePermission = async (patch) => {
    const previous = permissionSettings;
    const next = { ...previous, ...patch };
    setPermissionSettings(next);
    setStatus({ type: "testing", message: "正在保存权限策略…" });
    try {
      const saved = await api.updatePermissionSettings(patch);
      setPermissionSettings(saved);
      setStatus({ type: "success", message: "权限策略已保存；新的 Agent 任务将按此策略运行。" });
      window.clearTimeout(statusTimer.current);
      statusTimer.current = window.setTimeout(() => setStatus(null), 2600);
    } catch (error) {
      setPermissionSettings(previous);
      setStatus({ type: "error", message: error.message });
      window.clearTimeout(statusTimer.current);
      statusTimer.current = window.setTimeout(() => setStatus(null), 3200);
    }
  };
  const updateGeneral = async (patch) => {
    const next = { ...generalSettings, ...patch };
    setGeneralSettings(next); applyAccent(next.accent);
    try {
      const saved = await api.updateGeneralSettings(patch);
      setGeneralSettings(saved); applyAccent(saved.accent);
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    }
  };

  const visibleSections = settingsSections.filter((item) => item.label.toLowerCase().includes(settingsQuery.trim().toLowerCase()));
  const enabledSkills = skills.filter((item) => item.enabled).length;
  const enabledMcp = mcpServers.filter((item) => item.enabled).length;
  const activeProfile = profiles.find((item) => item.id === activeId);
  const validMcpName = /^[A-Za-z0-9_-]+$/.test(mcpForm.name.trim());
  const validMcpCommand = mcpForm.transport === "stdio"
    ? Boolean(mcpForm.command.trim())
    : /^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(mcpForm.command.trim());
  const validMcp = validMcpName && validMcpCommand;

  return <AnimatePresence>{open && <motion.div className="model-settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && !fetchingModels && onClose()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.section role="dialog" aria-modal="true" aria-labelledby="model-settings-title" className="model-settings-dialog settings-window" initial={{ opacity: 0, y: 8, scale: .995 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: .995 }} transition={{ duration: .16 }}>
      <aside className="settings-sidebar">
        <button type="button" className="settings-back" onClick={onClose}><ArrowLeft size={16} />返回应用</button>
        <label className="settings-search"><Search size={14} /><input aria-label="搜索设置" value={settingsQuery} onChange={(event) => setSettingsQuery(event.target.value)} placeholder="搜索设置" /></label>
        <nav aria-label="设置分类">{["个人", "集成", "安全"].map((group) => {
          const items = visibleSections.filter((item) => item.group === group);
          return items.length ? <section key={group}><small>{group}</small>{items.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={activeSection === item.id ? "active" : ""} aria-current={activeSection === item.id ? "page" : undefined} onClick={() => { setActiveSection(item.id); setStatus(null); }}><Icon size={16} /><span>{item.label}</span>{item.id === "models" && <i className={runtime?.configured ? "online" : ""} />}</button>; })}</section> : null;
        })}{!visibleSections.length && <p className="settings-search-empty">没有匹配的设置</p>}</nav>
        <div className="settings-sidebar-profile"><span>{(user?.name || "本").trim().slice(0, 1)}</span><div><strong>{user?.name || "本地用户"}</strong><small>本地工作区</small></div></div>
      </aside>

      <main className="settings-content">
        <button type="button" className="modal-close" onClick={onClose} disabled={busy || fetchingModels} aria-label="关闭"><X size={17} /></button>
        <h1 id="model-settings-title" className="sr-only">设置</h1>

        {activeSection === "general" && <section className="settings-pane" aria-labelledby="settings-general-title">
          <header><p>个人</p><h2 id="settings-general-title">常规</h2><span>调整 FetchCV 的外观和工作区偏好。</span></header>
          <div className="settings-profile-row"><span>{(user?.name || "本").trim().slice(0, 1)}</span><div><strong>{user?.name || "本地用户"}</strong><small>{user?.title || "当前求职资料库"}</small></div><UserRound size={18} /></div>
          <div className="settings-group"><h3>外观</h3><div className="settings-detail-row settings-accent-row"><span><strong>主题色</strong><small>用于按钮、状态和当前任务标记</small></span><div className="accent-swatches">{accentOptions.map((item) => <button type="button" key={item.id} className={generalSettings.accent === item.id ? "active" : ""} aria-label={item.label} title={item.label} onClick={() => updateGeneral({ accent: item.id })}><i style={{ background: item.color }} /></button>)}</div></div><div className="settings-detail-row"><span><strong>界面密度</strong><small>调整岗位列表和设置页的留白</small></span><select aria-label="界面密度" value={generalSettings.density} onChange={(event) => updateGeneral({ density: event.target.value })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></div></div>
          <div className="settings-group settings-workspace-overview"><h3>工作区</h3><div className="settings-overview-grid"><div><strong>{stats.jobs ?? 0}</strong><small>岗位项目</small></div><div><strong>{stats.resumes ?? user?.resume_count ?? 0}</strong><small>简历版本</small></div><div><strong>{stats.materials ?? user?.material_count ?? 0}</strong><small>资料</small></div></div></div>
          <footer className="settings-version">FetchCV Desktop · 0.2.24</footer>
        </section>}

        {activeSection === "models" && <section className="settings-pane provider-manager" aria-labelledby="settings-model-title">
          <header><p>集成</p><h2 id="settings-model-title">模型 API</h2><span>连接兼容 OpenAI 或 Anthropic 协议的模型服务。</span></header>
          <div className="settings-current-status"><span className={`provider-status-dot ${runtime?.configured ? "online" : ""}`} /><div><strong>{activeProfile?.providerName || runtime?.provider_name || "尚未连接模型"}</strong><small>{activeProfile?.model || runtime?.model || "Agent 需要模型连接后才能执行任务"}</small></div><b>{runtime?.configured ? "当前" : "未连接"}</b></div>
          {profiles.length > 0 && <section className="provider-list-section"><div className="provider-section-label"><span>已保存</span><small>{profiles.length} 个连接</small></div><div className="provider-list">{profiles.map((profile) => <div role="button" tabIndex={0} className={`provider-row ${profile.id === activeId ? "active" : ""}`} key={profile.id} onClick={() => !busy && activate(profile)} onKeyDown={(event) => event.key === "Enter" && !busy && activate(profile)}><span className={`provider-health ${profile.health}`}><Server size={13} /></span><div><strong>{profile.providerName}</strong><small>{profile.model} · {(profile.availableModels || []).length ? `${profile.availableModels.length} 个模型` : profile.protocol}</small></div><em>{profile.id === activeId ? "当前" : healthCopy(profile)}</em><button type="button" className="provider-delete" onClick={(event) => { event.stopPropagation(); remove(profile.id); }} aria-label={`删除 ${profile.providerName} 连接`}><Trash2 size={13} /></button></div>)}</div></section>}
          <div className="provider-form-head"><strong>{form.id ? "编辑连接" : "添加连接"}</strong><button type="button" onClick={() => { setForm(empty); setStatus(null); setModelQuery(""); }}><Plus size={13} />新连接</button></div>
          <div className="provider-presets">{presets.map((preset) => <button type="button" key={preset.name} onClick={() => choosePreset(preset)} className={form.providerName === preset.name && form.protocol === preset.protocol ? "active" : ""}><span>{preset.name}</span><small>{preset.protocol === "anthropic" ? "Anthropic 协议" : "OpenAI 协议"}</small></button>)}</div>
          <div className="model-form">
            <label><span>连接名称</span><input aria-label="连接名称" value={form.providerName} onChange={(event) => update("providerName", event.target.value)} placeholder="例如 DeepSeek / OpenRouter" /></label>
            <fieldset className="protocol-field"><legend>兼容协议</legend><div className="protocol-segments"><button type="button" aria-pressed={form.protocol === "openai"} className={form.protocol === "openai" ? "active" : ""} onClick={() => update("protocol", "openai")}>OpenAI</button><button type="button" aria-pressed={form.protocol === "anthropic"} className={form.protocol === "anthropic" ? "active" : ""} onClick={() => update("protocol", "anthropic")}>Anthropic</button></div></fieldset>
            <label className="full"><span>Base URL</span><input aria-label="Base URL" value={form.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} placeholder="https://api.example.com" /></label>
            <label className="full"><span>Models URL <em>可选，仅在自动发现失败时填写</em></span><input aria-label="Models URL" value={form.modelsUrlOverride} onChange={(event) => update("modelsUrlOverride", event.target.value)} placeholder="自动从 Base URL 推导" /></label>
            <label className="model-name-field"><span>模型名称</span><div className="model-input-row"><input aria-label="模型名称" value={form.model} onChange={(event) => update("model", event.target.value)} placeholder="provider-model-name" /><button type="button" disabled={!canDiscover || fetchingModels} onClick={discoverModels}>{fetchingModels ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}读取模型</button></div></label>
            <label><span>API Key</span><div className="secret-input"><KeyRound size={13} /><input aria-label="API Key" type={showKey ? "text" : "password"} autoComplete="off" value={form.apiKey} onKeyDown={handleKeyPaste} onPaste={handlePaste} onChange={(event) => update("apiKey", event.target.value)} placeholder={form.hasApiKey ? "已安全保存；留空继续使用" : "粘贴 API Key"} /><div className="secret-actions"><button type="button" onClick={pasteApiKey} aria-label="粘贴 API Key" title="从系统剪贴板粘贴"><Clipboard size={14} /></button><button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} title={showKey ? "隐藏 API Key" : "显示 API Key"}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></div></label>
          </div>
          {!!form.availableModels?.length && <section className="model-catalog"><header><div><strong>服务提供的模型</strong><small>{form.availableModels.length} 个</small></div><label><Search size={13} /><input aria-label="搜索模型" value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="搜索模型" /></label></header><div>{modelOptions.map((item) => <button type="button" key={item.id} className={form.model === item.id ? "active" : ""} onClick={() => update("model", item.id)}><span>{item.id}</span>{item.ownedBy && <small>{item.ownedBy}</small>}{form.model === item.id && <Check size={13} />}</button>)}</div>{modelQuery && !modelOptions.length && <p>没有匹配的模型</p>}</section>}
          <div className="provider-privacy"><ShieldCheck size={16} /><p><strong>密钥只在本机系统凭据中加密</strong><span>模型列表由服务端点读取；读取失败时仍可手动填写模型名称。</span></p></div>
          {status && <div role="status" className={`provider-status ${status.type}`}>{status.type === "testing" ? <LoaderCircle className="spin" size={14} /> : status.type === "success" ? <CheckCircle2 size={14} /> : <X size={14} />}<span>{status.message}</span></div>}
          <footer className="settings-actions"><button className="text-button" onClick={test} disabled={busy || fetchingModels || !valid}>{busy ? "正在连接" : "测试连接"}</button><button className="primary-button" onClick={save} disabled={busy || fetchingModels || !valid}>{busy ? <LoaderCircle className="spin" size={15} /> : <Server size={15} />}保存并启用</button></footer>
        </section>}

        {activeSection === "skills" && <section className="settings-pane" aria-labelledby="settings-skills-title">
          <header><p>集成</p><h2 id="settings-skills-title">Skills</h2><span>加载可复用的工作说明，让 Agent 按指定流程处理任务。</span></header>
          <div className="settings-section-toolbar"><span><strong>{enabledSkills} 个已启用</strong><small>从项目目录与用户目录读取 SKILL.md</small></span><button type="button" onClick={refreshExtensions}><RefreshCw size={13} />重新扫描</button></div>
          <div className="skill-switches settings-skill-list">{skills.map((skill) => <button type="button" key={skill.id} aria-pressed={skill.enabled} onClick={() => toggleSkill(skill)}><span><strong>{skill.name}</strong><small>{skill.description || "只读工作说明"}</small></span><i /></button>)}{!skills.length && <p>未在项目或用户目录发现 SKILL.md</p>}</div>
        </section>}

        {activeSection === "mcp" && <section className="settings-pane" aria-labelledby="settings-mcp-title">
          <header><p>集成</p><h2 id="settings-mcp-title">MCP Servers</h2><span>连接外部工具。只读能力可单独启用，写入能力仍需逐次批准。</span></header>
          <div className="settings-section-toolbar"><span><strong>{enabledMcp} 个已连接</strong><small>{mcpServers.length} 个已保存的服务器</small></span></div>
          <div className="mcp-list settings-mcp-list">{mcpServers.map((server) => <McpServerRow key={server.id} server={server} busy={busy} onConnect={approveAndEnableMcp} onDisable={disableMcp} onApproveWrite={approveMcpWrite} onRevokeWrite={revokeMcpWrite} />)}{!mcpServers.length && <p className="settings-empty-state">还没有 MCP Server。添加后会先验证配置，再请求连接批准。</p>}</div>
          <form className="mcp-config-form" onSubmit={(event) => { event.preventDefault(); addMcp(); }}>
            <div className="mcp-form-title"><span><strong>连接自定义 MCP</strong><small>添加后先验证配置，再由你批准启动与工具权限。</small></span></div>
            <section className="mcp-form-section mcp-identity-section">
              <label><span>名称</span><input aria-label="MCP 名称" value={mcpForm.name} onChange={(event) => updateMcpField("name", event.target.value)} placeholder="例如 notion 或 local_tools" />{mcpForm.name && !validMcpName && <small>只可使用字母、数字、短横线和下划线</small>}</label>
              <div className="mcp-transport-row"><strong>类型</strong><div className="mcp-transport-switch" role="group" aria-label="MCP 连接类型"><button type="button" className={mcpForm.transport === "stdio" ? "active" : ""} aria-pressed={mcpForm.transport === "stdio"} onClick={() => updateMcpField("transport", "stdio")}>STDIO</button><button type="button" className={mcpForm.transport === "streamable_http" ? "active" : ""} aria-pressed={mcpForm.transport === "streamable_http"} onClick={() => updateMcpField("transport", "streamable_http")}>流式 HTTP</button></div></div>
            </section>
            <section className="mcp-form-section">
              <label><span>{mcpForm.transport === "stdio" ? "启动命令" : "服务器 URL"}</span><input aria-label={mcpForm.transport === "stdio" ? "MCP 可执行文件" : "MCP 服务器 URL"} value={mcpForm.command} onChange={(event) => updateMcpField("command", event.target.value)} placeholder={mcpForm.transport === "stdio" ? "可执行文件绝对路径，例如 /opt/homebrew/bin/npx" : "https://mcp.example.com/mcp"} /></label>
              {mcpForm.transport === "stdio" && <div className="mcp-repeat-field"><div className="mcp-field-label"><strong>参数</strong><small>每项作为一个独立参数传入</small></div>{mcpForm.args.map((argument, index) => <div className="mcp-repeat-row" key={`argument-${index}`}><input aria-label={`MCP 参数 ${index + 1}`} value={argument} onChange={(event) => updateMcpListField("args", index, event.target.value)} placeholder={index === 0 ? "例如 -y" : "参数"} /><button type="button" onClick={() => removeMcpListField("args", index)} aria-label={`删除 MCP 参数 ${index + 1}`}><Trash2 size={14} /></button></div>)}<button type="button" className="mcp-add-row" onClick={() => addMcpListField("args")}><Plus size={14} />添加参数</button></div>}
            </section>
            {mcpForm.transport === "stdio" && <section className="mcp-form-section">
              <div className="mcp-repeat-field"><div className="mcp-field-label"><strong>环境变量传递</strong><small>只填写变量名；值从 FetchCV 启动时的系统环境读取，不保存密钥</small></div>{mcpForm.envKeys.map((envKey, index) => <div className="mcp-repeat-row" key={`environment-${index}`}><input aria-label={`MCP 环境变量 ${index + 1}`} value={envKey} onChange={(event) => updateMcpListField("envKeys", index, event.target.value)} placeholder={index === 0 ? "例如 GITHUB_TOKEN" : "环境变量名"} /><button type="button" onClick={() => removeMcpListField("envKeys", index)} aria-label={`删除 MCP 环境变量 ${index + 1}`}><Trash2 size={14} /></button></div>)}<button type="button" className="mcp-add-row" onClick={() => addMcpListField("envKeys")}><Plus size={14} />添加环境变量</button></div>
              <label><span>工作目录 <em>可选</em></span><input aria-label="MCP 工作目录" value={mcpForm.cwd} onChange={(event) => updateMcpField("cwd", event.target.value)} placeholder="绝对路径，例如 /Users/name/code" /></label>
            </section>}
            <footer><span><ShieldCheck size={14} />保存配置不会自动启动 Server</span><button type="submit" disabled={!validMcp || busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}添加 Server</button></footer>
          </form>
          {status && <div role="status" className={`provider-status ${status.type}`}>{status.type === "testing" ? <LoaderCircle className="spin" size={14} /> : status.type === "success" ? <CheckCircle2 size={14} /> : <X size={14} />}<span>{status.message}</span></div>}
        </section>}

        {activeSection === "permissions" && <section className="settings-pane" aria-labelledby="settings-permissions-title">
          <header><p>安全</p><h2 id="settings-permissions-title">权限与浏览器</h2><span>查看 Agent 能访问的范围，以及哪些操作必须由你确认。</span></header>
          <div className="settings-capabilities">
            <div><Globe2 size={17} /><span><strong>网页搜索与读取</strong><small>公开 HTTPS 页面在 Agent 内部读取，不会自动打开外部窗口。</small></span><select aria-label="网页访问权限" value={permissionSettings.web_access} onChange={(event) => updatePermission({ web_access: event.target.value })}><option value="allow">允许</option><option value="ask">每次询问</option><option value="deny">关闭</option></select></div>
            <div><FolderLock size={17} /><span><strong>本地资料读取</strong><small>只读取 FetchCV 隔离工作区中的简历、作品和岗位资料。</small></span><select aria-label="本地资料读取权限" value={permissionSettings.workspace_read} onChange={(event) => updatePermission({ workspace_read: event.target.value })}><option value="allow">允许</option><option value="ask">每次询问</option><option value="deny">关闭</option></select></div>
            <div><ShieldCheck size={17} /><span><strong>写入与移动文件</strong><small>即使允许，具体文件操作也必须逐次审批；关闭后 Agent 只能读取。</small></span><select aria-label="文件写入权限" value={permissionSettings.workspace_write} onChange={(event) => updatePermission({ workspace_write: event.target.value })}><option value="ask">每次询问</option><option value="deny">始终拒绝</option></select></div>
            <div><Trash2 size={17} /><span><strong>删除文件</strong><small>删除会先创建可恢复备份，并在执行前请求批准。</small></span><select aria-label="文件删除权限" value={permissionSettings.file_delete} onChange={(event) => updatePermission({ file_delete: event.target.value })}><option value="ask">每次询问</option><option value="deny">始终拒绝</option></select></div>
            <div><Globe2 size={17} /><span><strong>登录浏览器</strong><small>默认关闭。公开招聘网页使用内置读取器，不需要弹出浏览器。</small></span><select aria-label="登录浏览器权限" value={permissionSettings.browser_bridge} onChange={(event) => updatePermission({ browser_bridge: event.target.value })}><option value="allow">允许</option><option value="ask">每次询问</option><option value="deny">关闭</option></select></div>
            {status && <div className="settings-inline-status" role="status">{status.message}</div>}
          </div>
        </section>}
      </main>
    </motion.section>
  </motion.div>}</AnimatePresence>;
}
