import {ProviderConnectionForm} from "./ProviderConnectionForm";
import {ProviderPresetPicker} from "./ProviderPresetPicker";
import {createProviderDraft, PROVIDER_PRESETS} from "../../shared/provider-presets.mjs";
import "../ui/settings.css";
import {InterfaceThemePicker} from "../ui/InterfaceThemePicker";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen, CheckCircle2,
  LoaderCircle, LockKeyhole, Plus, RefreshCw, Server, Settings2,
  ShieldCheck, SlidersHorizontal, Trash2, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { applyAppearance, DEFAULT_APPEARANCE } from "../lib/appearance";
import { useModalFocusTrap } from "../lib/modal-focus";

const empty = createProviderDraft();

const emptyMcpForm = {
  name: "", transport: "stdio", command: "", args: [""], envKeys: [""], cwd: "",
};



const settingsSections = [
  { id: "general", label: "常规", icon: Settings2, group: "个人" },
  { id: "models", label: "模型 API", icon: SlidersHorizontal, group: "集成" },
  { id: "skills", label: "Skills", icon: BookOpen, group: "集成" },
  { id: "mcp", label: "MCP Servers", icon: Server, group: "集成" },
  { id: "permissions", label: "权限与浏览器", icon: ShieldCheck, group: "安全" },
];

function publishAppearance(value) {
  const appearance = applyAppearance(value);
  window.dispatchEvent(new CustomEvent("fetchcv:appearance", { detail: appearance }));
  return appearance;
}

function healthCopy(profile) {
  if (profile.health === "healthy") return profile.latencyMs ? `${profile.latencyMs} ms` : "已验证";
  if (profile.health === "error") return "需检查";
  return "未验证";
}

function McpServerRow({ server, busy, onConnect, onDisable, onToggleRead, onApproveWrite, onRevokeWrite }) {
  const readTools = (server.discovered_tools || []).filter((tool) => tool.read_only);
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
    {!!readTools.length && <div className="mcp-read-tools"><small>只读工具</small>{readTools.map((tool) => {
      const allowed = (server.allowed_tools || []).includes(tool.name);
      return <button type="button" key={tool.name} aria-pressed={allowed} disabled={busy || !server.enabled} onClick={() => onToggleRead(server, tool, !allowed)}><span><strong>{tool.name}</strong>{tool.description && <small title={tool.description}>{tool.description}</small>}</span><i /></button>;
    })}</div>}
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
  const [providerDraftValid, setProviderDraftValid] = useState(true);
  const [selectedPresetId, setSelectedPresetId] = useState('custom');
  const [draftRevision, setDraftRevision] = useState(0);
  const [activeSection, setActiveSection] = useState("general");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [skills, setSkills] = useState([]);
  const [mcpServers, setMcpServers] = useState([]);
  const [mcpForm, setMcpForm] = useState(emptyMcpForm);
  const [permissionSettings, setPermissionSettings] = useState({
    web_access: "allow", workspace_read: "allow", workspace_write: "ask", file_delete: "ask", browser_bridge: "allow",
  });
  const [generalSettings, setGeneralSettings] = useState(DEFAULT_APPEARANCE);
  const statusTimer = useRef(null);
  const dialog = useRef(null);
  const inFlight = useRef(false);
  useEffect(()=>{inFlight.current=busy || fetchingModels;},[busy,fetchingModels]);
  useModalFocusTrap(dialog, open);

  const load = async () => {
    setSelectedPresetId('custom');
    setDraftRevision(current => current + 1);
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
      setSkills(nextSkills); setMcpServers(nextServers); setPermissionSettings(nextPermissions); setGeneralSettings(nextGeneral); publishAppearance(nextGeneral);
    }).catch((error) => setStatus({ type: "error", message: error.message }));
    const escape = (event) => { if (event.key === "Escape" && !inFlight.current) onClose(); };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); window.clearTimeout(statusTimer.current); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "model" && value !== current.model ? {displayName:""} : {}),
      ...(["baseUrl", "protocol", "modelsUrlOverride"].includes(field) ? { availableModels: [], modelsEndpoint: "" } : {}),
    }));
    setStatus(null);
  };
  const choosePreset = (presetId) => {
    setForm(createProviderDraft(presetId));
    setSelectedPresetId(presetId);
    // Remount local JSON editors too: invalid/unapplied text can contain secrets.
    setDraftRevision(current => current + 1);
    setProviderDraftValid(true);
    setShowKey(false); setStatus(null); setModelQuery("");
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
    modelsEndpoint: form.modelsEndpoint, availableModels: form.availableModels, modelProfiles: form.modelProfiles,
    notes:form.notes, website:form.website, displayName:form.displayName, authMode:form.authMode, userAgent:form.userAgent, requestHeaders:form.requestHeaders, requestBody:form.requestBody,
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
      setStatus({ type: "success", message: `${result.message || "连接成功"} · ${result.model} · ${result.latencyMs} ms` });
    } catch (error) { setStatus({ type: "error", message: error.message }); } finally { setBusy(false); }
  };
  const save = async (activate = true) => {
    setBusy(true); setStatus({ type: "testing", message: "正在验证并安全保存…" });
    try {
      const result = await window.appRuntime.saveModelProvider({...payload(),activate});
      setStatus({ type: "success", message: activate ? "连接已保存并设为当前模型。" : "连接已保存，当前模型未切换。" });
      setProfiles(result.store?.profiles || []); setActiveId(result.activeId || result.store?.activeId || "");
      const saved = result.provider || result.store?.profiles?.find((item) => item.id === (result.savedId || result.activeId));
      setForm((current) => ({ ...current, ...saved, id: result.savedId || saved?.id || result.activeId || current.id, apiKey: "", hasApiKey: true }));
      if (result.runtime) onSaved?.(result.runtime);
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
    setBusy(true);
    try {
      const store = await window.appRuntime.deleteModelProvider(id);
      setProfiles(store.profiles || []); setActiveId(store.activeId || "");
      if (store.runtime) onSaved?.(store.runtime);
      if (form.id === id) {
        const next = store.profiles?.find((item) => item.id === store.activeId) || store.profiles?.[0];
        setForm(next ? { ...empty, ...next, apiKey: "" } : empty);
      }
    } catch (error) { setStatus({ type: "error", message: error.message }); } finally {setBusy(false);}
  };

  const modelOptions = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    return (form.availableModels || []).filter((item) => !query || item.id.toLowerCase().includes(query)).slice(0, 60);
  }, [form.availableModels, modelQuery]);
  const valid = providerDraftValid && form.providerName && form.baseUrl && form.model && (form.apiKey || form.hasApiKey);
  const canDiscover = providerDraftValid && form.baseUrl && (form.apiKey || form.hasApiKey);
  const refreshExtensions = async () => {
    setBusy(true); setStatus(null);
    try {
      setSkills(await api.reloadSkills());
    } catch (error) {
      setStatus({ type: "error", message: error.message || "扫描失败，请重试。" });
    } finally { setBusy(false); }
  };
  const toggleSkill = async (skill) => {
    setBusy(true);
    setStatus(null);
    try {
      const updated = await api.updateSkill(skill.id, !skill.enabled, skill.content_hash);
      setSkills((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (error) {
      const messages = { skill_content_changed: "Skill 内容已变化，请重新扫描并确认后启用。", skill_shadowed: "该 Skill 已被同名来源替代，请重新扫描。", skill_file_unavailable: "Skill 文件已不可用，请重新扫描。" };
      setStatus({type:"error",message:messages[error.message] || error.message || "设置未保存，请重试。"});
    } finally { setBusy(false); }
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
      const declaredReadTools = new Set((probed.discovered_tools || []).filter((tool) => tool.read_only).map((tool) => tool.name));
      const allowed = (server.allowed_tools || []).filter((name) => declaredReadTools.has(name));
      const enabled = await api.updateMcpServer(server.id, { allowed_tools: allowed, enabled: true });
      setMcpServers((items) => items.map((item) => item.id === enabled.id ? enabled : item));
      setStatus({ type: "success", message: `${server.name} 已连接；请逐项启用你信任的只读工具。` });
    } catch (error) { setStatus({ type: "error", message: error.message }); } finally { setBusy(false); }
  };
  const toggleMcpRead = async (server, tool, enabled) => {
    setBusy(true);
    try {
      const allowed = new Set(server.allowed_tools || []);
      if (enabled) allowed.add(tool.name); else allowed.delete(tool.name);
      const updated = await api.updateMcpServer(server.id, { allowed_tools: [...allowed], enabled: true });
      setMcpServers((items) => items.map((item) => item.id === updated.id ? updated : item));
      setStatus({ type: "success", message: `${tool.name} 已${enabled ? "授权" : "停用"}；Server 的只读声明不等同于 FetchCV 信任。` });
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
    setGeneralSettings(next); publishAppearance(next);
    try {
      const saved = await api.updateGeneralSettings(patch);
      setGeneralSettings(saved); publishAppearance(saved);
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
    <motion.section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="model-settings-title" className="model-settings-dialog settings-window" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .2, ease: [.23,1,.32,1] }}>
      <aside className="settings-sidebar">
        <div className="rp-set-navhead">
        <div className="settings-sidebar-title">设置</div>
        <label className="settings-search"><span className="rp-set-searchicon" aria-hidden="true">⌕</span><input aria-label="搜索设置" value={settingsQuery} onChange={(event) => setSettingsQuery(event.target.value)} placeholder="搜索" /></label>
        </div>
        <nav aria-label="设置分类">{["个人", "集成", "安全"].map((group) => {
          const items = visibleSections.filter((item) => item.group === group);
          return items.length ? <section key={group}>{items.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={activeSection === item.id ? "active" : ""} aria-current={activeSection === item.id ? "page" : undefined} onClick={() => { setActiveSection(item.id); setStatus(null); }}><Icon size={16} /><span>{item.label}</span>{item.id === "models" && <i className={runtime?.configured ? "online" : ""} />}</button>; })}</section> : null;
        })}{!visibleSections.length && <p className="settings-search-empty">没有匹配的设置</p>}</nav>
        <button type="button" className="settings-back" onClick={onClose} disabled={busy || fetchingModels} aria-label="关闭">返回应用</button><div className="settings-sidebar-profile"><span>{(user?.name || "本").trim().slice(0, 1)}</span><div><strong>{user?.name || "本地用户"}</strong></div></div>
      </aside>

      <main className="settings-content">
        <button type="button" className="modal-close" onClick={onClose} disabled={busy || fetchingModels} aria-label="关闭设置"><X size={17} /></button>
        <h1 id="model-settings-title" className="sr-only">设置</h1>

        {activeSection === "general" && <section className="settings-pane" aria-labelledby="settings-general-title">
          <header><h2 id="settings-general-title">常规</h2></header>
          <div className="settings-group"><h3>外观</h3><div className="rp-set-card"><div className="rp-set-row"><span><strong>主题</strong></span><InterfaceThemePicker compact/></div><div className="rp-set-row"><span><strong>界面密度</strong></span><select aria-label="界面密度" value={generalSettings.density} onChange={(event) => updateGeneral({ density: event.target.value })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></div></div></div>
          <div className="settings-group settings-workspace-overview"><h3>工作区</h3><div className="rp-set-card">{[["岗位项目",stats.jobs],["简历版本",stats.resumes ?? user?.resume_count],["资料",stats.materials ?? user?.material_count]].map(([label,value])=><div className="rp-set-row" key={label}><span><strong>{label}</strong></span><output className="rp-set-value">{value ?? "—"}</output></div>)}</div></div>
        </section>}

        {activeSection === "models" && <section className="settings-pane provider-manager" aria-labelledby="settings-model-title">
          <header className="settings-page-heading"><h2 id="settings-model-title">模型 API</h2><button type="button" disabled={busy || fetchingModels} onClick={() => choosePreset('custom')}><Plus size={13} />新连接</button></header>
          {!profiles.length && <div className="settings-current-status"><span className={`provider-status-dot ${runtime?.configured ? "online" : ""}`} /><div><strong>{activeProfile?.providerName || runtime?.provider_name || "尚未连接模型"}</strong>{(activeProfile?.model || runtime?.model) && <small>{activeProfile?.model || runtime?.model}</small>}</div></div>}
          {profiles.length > 0 && <section className="provider-list-section"><div className="provider-section-label"><span>连接</span></div><div className="provider-list">{profiles.map(profile=><div className={`provider-row ${profile.id===activeId?'active':''} ${profile.id===form.id?'editing':''}`} key={profile.id}>
            <button type="button" className="provider-edit" aria-label={`编辑 ${profile.providerName}`} disabled={busy || fetchingModels} onClick={()=>{setForm({...empty,...profile,apiKey:""});setShowKey(false);setStatus(null);setModelQuery("");}}><Server size={16}/><span><strong>{profile.providerName}</strong><small>{profile.notes || profile.displayName || profile.model}</small></span></button>
            <em>{healthCopy(profile)}</em><button type="button" className="provider-enable" disabled={busy || fetchingModels || profile.id===activeId} onClick={()=>activate(profile)}>{profile.id===activeId?'当前使用':'启用'}</button>
            <button type="button" className="provider-delete" disabled={busy || fetchingModels} aria-label={`删除 ${profile.providerName} 连接`} onClick={()=>remove(profile.id)}><Trash2 size={14}/></button>
          </div>)}</div></section>}

          {!form.id && <ProviderPresetPicker selectedId={selectedPresetId} disabled={busy || fetchingModels} onSelect={choosePreset}/>}
          <ProviderConnectionForm key={form.id || `new-${draftRevision}`} form={form} setForm={setForm} update={update} busy={busy || fetchingModels} showKey={showKey} setShowKey={setShowKey} pasteApiKey={pasteApiKey} handleKeyPaste={handleKeyPaste} handlePaste={handlePaste} canDiscover={canDiscover} fetchingModels={fetchingModels} discoverModels={discoverModels} modelQuery={modelQuery} setModelQuery={setModelQuery} modelOptions={modelOptions} onValidityChange={setProviderDraftValid} modelHint={!form.id ? PROVIDER_PRESETS.find(preset => preset.id === selectedPresetId)?.modelHint : undefined}/>
          {status && <div role="status" className={`provider-status ${status.type}`}>{status.type === "testing" ? <LoaderCircle className="spin" size={14} /> : status.type === "success" ? <CheckCircle2 size={14} /> : <X size={14} />}<span>{status.message}</span></div>}
          <footer className="settings-actions"><button className="text-button" onClick={test} disabled={busy || fetchingModels || !valid}>{busy ? "正在连接" : "测试连接"}</button>{form.id !== activeId && <button className="text-button" onClick={()=>save(false)} disabled={busy || fetchingModels || !valid}>仅保存</button>}<button className="primary-button" onClick={()=>save(true)} disabled={busy || fetchingModels || !valid}>{busy ? <LoaderCircle className="spin" size={15} /> : <Server size={15} />}保存并启用</button></footer>
        </section>}

        {activeSection === "skills" && <section className="settings-pane" aria-labelledby="settings-skills-title">
          <header><h2 id="settings-skills-title">Skills</h2></header>
          <div className="settings-section-toolbar"><span><strong>{enabledSkills} 个已启用</strong></span><button type="button" disabled={busy} onClick={refreshExtensions}><RefreshCw size={13} />{busy ? "处理中…" : "重新扫描"}</button></div>
          {status && <p className="settings-inline-status" role="alert">{status.message}</p>}
          <div className="skill-switches settings-skill-list">{skills.map((skill) => <button type="button" key={skill.id} role="switch" disabled={busy} aria-checked={skill.enabled} aria-pressed={skill.enabled} onClick={() => toggleSkill(skill)}><span><strong title={[skill.path, ...(skill.metadata_json?.shadowed_paths || []).map((path) => `已覆盖：${path}`)].filter(Boolean).join("\n")}>{skill.name}</strong>{skill.description && <small title={skill.description}>{skill.description}</small>}{skill.metadata_json?.change_reason && <small className="skill-change-reason">{skill.metadata_json.change_reason}</small>}</span><i /></button>)}{!skills.length && <p>未发现可用的 SKILL.md</p>}</div>
        </section>}

        {activeSection === "mcp" && <section className="settings-pane" aria-labelledby="settings-mcp-title">
          <header><h2 id="settings-mcp-title">MCP Servers</h2></header>
          {!!mcpServers.length && <div className="settings-section-toolbar"><span><strong>{enabledMcp} 个已连接</strong></span></div>}
          <div className="mcp-list settings-mcp-list">{mcpServers.map((server) => <McpServerRow key={server.id} server={server} busy={busy} onConnect={approveAndEnableMcp} onDisable={disableMcp} onToggleRead={toggleMcpRead} onApproveWrite={approveMcpWrite} onRevokeWrite={revokeMcpWrite} />)}</div>
          <form className="mcp-config-form" onSubmit={(event) => { event.preventDefault(); addMcp(); }}>
            <div className="mcp-form-title"><span><strong>添加服务器</strong></span></div>
            <section className="mcp-form-section mcp-identity-section">
              <label><span>名称</span><input aria-label="MCP 名称" value={mcpForm.name} onChange={(event) => updateMcpField("name", event.target.value)} placeholder="例如 local_tools" />{mcpForm.name && !validMcpName && <small>只可使用字母、数字、短横线和下划线</small>}</label>
              <div className="mcp-transport-row"><strong>类型</strong><div className="mcp-transport-switch" role="group" aria-label="MCP 连接类型"><button type="button" className={mcpForm.transport === "stdio" ? "active" : ""} aria-pressed={mcpForm.transport === "stdio"} onClick={() => updateMcpField("transport", "stdio")}>STDIO</button><button type="button" className={mcpForm.transport === "streamable_http" ? "active" : ""} aria-pressed={mcpForm.transport === "streamable_http"} onClick={() => updateMcpField("transport", "streamable_http")}>流式 HTTP</button></div></div>
            </section>
            <section className="mcp-form-section">
              <label><span>{mcpForm.transport === "stdio" ? "启动命令" : "服务器 URL"}</span><input aria-label={mcpForm.transport === "stdio" ? "MCP 可执行文件" : "MCP 服务器 URL"} value={mcpForm.command} onChange={(event) => updateMcpField("command", event.target.value)} placeholder={mcpForm.transport === "stdio" ? "可执行文件的绝对路径" : "https://mcp.example.com/mcp"} /></label>
              {mcpForm.transport === "stdio" && <div className="mcp-repeat-field"><div className="mcp-field-label"><strong>参数</strong></div>{mcpForm.args.map((argument, index) => <div className="mcp-repeat-row" key={`argument-${index}`}><input aria-label={`MCP 参数 ${index + 1}`} value={argument} onChange={(event) => updateMcpListField("args", index, event.target.value)} placeholder={index === 0 ? "例如 -y" : "参数"} /><button type="button" onClick={() => removeMcpListField("args", index)} aria-label={`删除 MCP 参数 ${index + 1}`}><Trash2 size={14} /></button></div>)}<button type="button" className="mcp-add-row" onClick={() => addMcpListField("args")}><Plus size={14} />添加参数</button></div>}
            </section>
            {mcpForm.transport === "stdio" && <section className="mcp-form-section">
              <div className="mcp-repeat-field"><div className="mcp-field-label"><strong>环境变量名</strong><small>值从系统环境读取</small></div>{mcpForm.envKeys.map((envKey, index) => <div className="mcp-repeat-row" key={`environment-${index}`}><input aria-label={`MCP 环境变量 ${index + 1}`} value={envKey} onChange={(event) => updateMcpListField("envKeys", index, event.target.value)} placeholder={index === 0 ? "例如 GITHUB_TOKEN" : "环境变量名"} /><button type="button" onClick={() => removeMcpListField("envKeys", index)} aria-label={`删除 MCP 环境变量 ${index + 1}`}><Trash2 size={14} /></button></div>)}<button type="button" className="mcp-add-row" onClick={() => addMcpListField("envKeys")}><Plus size={14} />添加环境变量</button></div>
              <label><span>工作目录</span><input aria-label="MCP 工作目录" value={mcpForm.cwd} onChange={(event) => updateMcpField("cwd", event.target.value)} placeholder="绝对路径（可选）" /></label>
            </section>}
            <footer><button type="submit" disabled={!validMcp || busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}添加 Server</button></footer>
          </form>
          {status && <div role="status" className={`provider-status ${status.type}`}>{status.type === "testing" ? <LoaderCircle className="spin" size={14} /> : status.type === "success" ? <CheckCircle2 size={14} /> : <X size={14} />}<span>{status.message}</span></div>}
        </section>}

        {activeSection === "permissions" && <section className="settings-pane" aria-labelledby="settings-permissions-title">
          <header><h2 id="settings-permissions-title">权限与浏览器</h2></header>
          <div className="settings-capabilities">
            <div><label htmlFor="permission-web-access"><strong>网页搜索与读取</strong></label><select id="permission-web-access" aria-label="网页访问权限" value={permissionSettings.web_access} onChange={(event) => updatePermission({ web_access: event.target.value })}><option value="allow">允许</option><option value="ask">每次询问</option><option value="deny">关闭</option></select></div>
            <div><label htmlFor="permission-workspace-read"><strong>读取工作区资料</strong></label><select id="permission-workspace-read" aria-label="本地资料读取权限" value={permissionSettings.workspace_read} onChange={(event) => updatePermission({ workspace_read: event.target.value })}><option value="allow">允许</option><option value="ask">每次询问</option><option value="deny">关闭</option></select></div>
            <div><label htmlFor="permission-workspace-write"><strong>写入与移动文件</strong></label><select id="permission-workspace-write" aria-label="文件写入权限" value={permissionSettings.workspace_write} onChange={(event) => updatePermission({ workspace_write: event.target.value })}><option value="ask">每次询问</option><option value="deny">始终拒绝</option></select></div>
            <div><label htmlFor="permission-file-delete"><strong>删除文件</strong></label><select id="permission-file-delete" aria-label="文件删除权限" value={permissionSettings.file_delete} onChange={(event) => updatePermission({ file_delete: event.target.value })}><option value="ask">每次询问</option><option value="deny">始终拒绝</option></select></div>
            <div><label htmlFor="permission-browser"><strong>受控浏览器</strong></label><select id="permission-browser" aria-label="受控浏览器权限" value={permissionSettings.browser_bridge} onChange={(event) => updatePermission({ browser_bridge: event.target.value })}><option value="allow">允许</option><option value="ask">每次询问</option><option value="deny">关闭</option></select></div>
          </div>
          {status && <div className="settings-inline-status" role="status">{status.message}</div>}
        </section>}
      </main>
    </motion.section>
  </motion.div>}</AnimatePresence>;
}
