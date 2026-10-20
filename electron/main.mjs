import {probeProvider} from './pi/provider-probe.mjs';
import {modelProfilesFor, resolveModelProfile} from '../shared/model-profile.mjs';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, shell, utilityProcess } from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModelsUrlCandidates, parseModelsResponse, redactProviderError } from "./provider-utils.mjs";
import { prepareBrowserBridge, startBrowserBridge } from "./browser-bridge.mjs";
import { PiAgentRuntime } from "./pi-agent-runtime.mjs";
import { RuntimeRpc, isTrustedFrame } from "../packages/app/runtime-rpc.mjs";
import { choosePort, startSidecar, stopSidecar } from "./sidecar.mjs";
import { isXiaohongshuUrl } from "./xiaohongshu-adapter.mjs";
import { startWorkspaceApplication } from "./workspace-application.mjs";
import { rendererEntry } from "./renderer-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Stable in development and after bundling the main process into app.asar.
const projectRoot = app.getAppPath();
const renderer = rendererEntry({ projectRoot, isPackaged: app.isPackaged });
let sidecar = null;
let browserBridge = null;
let backendError = null;
let backendState = "starting";
let backendApiBase = "";
const controlToken = randomBytes(32).toString("hex");
const approvalKey = randomBytes(32).toString("hex");
let webApprovalQueue = Promise.resolve();
const piAgentRuntime = new PiAgentRuntime({
  getApiBase: () => sidecar?.apiBase || backendApiBase || "http://127.0.0.1:8766",
  getControlToken: () => controlToken,
  getApprovalKey: () => approvalKey,
  getProviderConfig: () => readProviderConfig({ includeSecret: true }),
  confirmWebTool: ({ toolName, arguments: args, signal }) => {
    const decision = webApprovalQueue.then(async () => {
      signal?.throwIfAborted();
      const owner = BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL() === renderer.url);
      if (!owner) return false;
      const result = await dialog.showMessageBox(owner, {
        type: "question", title: "联网批准",
        message: toolName === "search_web" ? "允许本次搜索网页？" : "允许本次读取网页？",
        detail: String(toolName === "search_web" ? args.query : args.url).slice(0,4096),
        buttons: ["取消", "允许本次"], defaultId: 0, cancelId: 0, noLink: true,
      });
      signal?.throwIfAborted();
      return result.response === 1;
    });
    webApprovalQueue = decision.catch(() => false);
    return decision;
  },
});
const runtimeRpc = new RuntimeRpc(piAgentRuntime);

if (renderer.development) {
  app.setPath("userData", process.env.FETCHCV_DEV_USER_DATA);
  app.setPath("sessionData", process.env.FETCHCV_DEV_SESSION_DATA || path.join(process.env.FETCHCV_DEV_USER_DATA, "session"));
  if (process.env.FETCHCV_DEV_TEMP) app.setPath("temp", process.env.FETCHCV_DEV_TEMP);
} else if (process.env.FETCHCV_E2E_USER_DATA) {
  app.setPath("userData", process.env.FETCHCV_E2E_USER_DATA);
  if (process.env.FETCHCV_E2E_SESSION_DATA) app.setPath("sessionData", process.env.FETCHCV_E2E_SESSION_DATA);
  if (process.env.FETCHCV_E2E_TEMP) app.setPath("temp", process.env.FETCHCV_E2E_TEMP);
}

function isSafeExternal(url, apiBase) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    return parsed.origin === apiBase;
  } catch {
    return false;
  }
}

function importedFileMime(filename) {
  const extension = path.extname(filename).toLowerCase();
  return ({
    ".csv": "text/csv", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".gif": "image/gif", ".html": "text/html", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".json": "application/json",
    ".md": "text/markdown", ".pdf": "application/pdf", ".png": "image/png", ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".txt": "text/plain", ".webp": "image/webp",
    ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".yaml": "application/yaml", ".yml": "application/yaml", ".zip": "application/zip",
  })[extension] || "application/octet-stream";
}

function providerFile() {
  return path.join(app.getPath("userData"), "settings", "model-provider.json");
}

function readProviderStore() {
  try {
    const saved = JSON.parse(fs.readFileSync(providerFile(), "utf8"));
    if (Array.isArray(saved.profiles)) return saved;
    if (saved.providerName || saved.baseUrl || saved.model) {
      return { activeId: "legacy", profiles: [{ id: "legacy", ...saved }] };
    }
  } catch { /* first launch */ }
  return { activeId: "", profiles: [] };
}

function decodeProvider(saved, { includeSecret = false } = {}) {
  let apiKey = "";
  if (saved?.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(saved.encryptedApiKey, "base64"));
    } catch {
      // safeStorage ciphertext cannot be moved between OS users or machines.
      apiKey = "";
    }
  }
  return {
    id: saved?.id || "",
    providerName: saved?.providerName || "",
    protocol: saved?.protocol || "openai",
    baseUrl: saved?.baseUrl || "",
    model: saved?.model || "",
    modelProfiles: modelProfilesFor(saved || {}),
    modelsUrlOverride: saved?.modelsUrlOverride || "",
    availableModels: Array.isArray(saved?.availableModels) ? saved.availableModels : [],
    modelsEndpoint: saved?.modelsEndpoint || "",
    health: saved?.health || "unknown",
    latencyMs: Number.isFinite(saved?.latencyMs) ? saved.latencyMs : null,
    lastTestedAt: saved?.lastTestedAt || "",
    hasApiKey: Boolean(apiKey),
    ...(includeSecret ? { apiKey } : {}),
  };
}

function readProviderConfig({ includeSecret = false } = {}) {
  const store = readProviderStore();
  const saved = store.activeId ? store.profiles.find((item) => item.id === store.activeId) : null;
  if (saved) return decodeProvider(saved, { includeSecret });
  const apiKey = String(process.env.FETCHCV_PROVIDER_API_KEY || "").trim();
  const baseUrl = String(process.env.FETCHCV_PROVIDER_BASE_URL || "").trim();
  const model = String(process.env.FETCHCV_PROVIDER_MODEL || "").trim();
  if (!apiKey || !baseUrl || !model) return null;
  return {
    id: "environment",
    ...(process.env.FETCHCV_PROVIDER_CONTEXT_WINDOW?{contextWindow:Number(process.env.FETCHCV_PROVIDER_CONTEXT_WINDOW),maxOutputTokens:Number(process.env.FETCHCV_PROVIDER_MAX_OUTPUT_TOKENS||2048)}:{}),
    providerName: String(process.env.FETCHCV_PROVIDER_NAME || "Environment provider").trim(),
    protocol: String(process.env.FETCHCV_PROVIDER_PROTOCOL || "openai").trim(),
    baseUrl,
    model,
    modelsUrlOverride: "",
    availableModels: [{ id: model, ownedBy: "environment" }],
    modelsEndpoint: "",
    health: "healthy",
    latencyMs: null,
    lastTestedAt: "",
    hasApiKey: true,
    ...(includeSecret ? { apiKey } : {}),
  };
}

function listProviderConfigs() {
  const store = readProviderStore();
  return { activeId: store.activeId, profiles: store.profiles.map((item) => decodeProvider(item)) };
}

function storedApiKeyFor(config) {
  const store = readProviderStore();
  const saved = store.profiles.find((item) => item.id === config?.id);
  return saved ? decodeProvider(saved, { includeSecret: true }).apiKey : "";
}

function validateProviderConfig(config, { requireModel = true } = {}) {
  const protocol = String(config.protocol || "").toLowerCase();
  if (!new Set(["openai", "anthropic"]).has(protocol)) throw new Error("请选择 OpenAI-compatible 或 Anthropic-compatible 协议");
  let parsed;
  try { parsed = new URL(String(config.baseUrl || "")); } catch { throw new Error("请输入有效的 Base URL，例如 https://api.example.com"); }
  if (parsed.username || parsed.password) throw new Error("Base URL 不能包含用户名或密码");
  const localHttp = parsed.protocol === "http:" && new Set(["127.0.0.1", "localhost"]).has(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) throw new Error("远程模型地址必须使用 HTTPS");
  const apiKey = String(config.apiKey || storedApiKeyFor(config) || "").trim();
  if (!apiKey) throw new Error("请输入 API Key");
  if (requireModel && !String(config.model || "").trim()) throw new Error("请输入模型名称");
  return {
    id: String(config.id || ""),
    providerName: String(config.providerName || "Custom provider").trim() || "Custom provider",
    protocol,
    baseUrl: parsed.toString().replace(/\/$/, ""),
    apiKey,
    model: String(config.model).trim(),
    modelProfiles: modelProfilesFor(config),
    modelsUrlOverride: String(config.modelsUrlOverride || "").trim(),
    modelsEndpoint: String(config.modelsEndpoint || "").trim(),
    availableModels: Array.isArray(config.availableModels)
      ? config.availableModels.map((item) => typeof item === "string" ? { id: item, ownedBy: "" } : item).filter((item) => item?.id).slice(0, 500)
      : [],
  };
}



function providerErrorDetail(raw, apiKey) {
  return redactProviderError(raw, apiKey);
}

async function testProviderConnection(input) {
  const config = validateProviderConfig(input);
  resolveModelProfile(config);
  const started=Date.now(),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try {
    const capabilities=await probeProvider(config,{signal:controller.signal});
    return {ok:true,latencyMs:Date.now()-started,providerName:config.providerName,protocol:config.protocol,model:config.model,config,capabilities,message:capabilities.message};
  } catch(error) {
    throw new Error(providerErrorDetail(error?.message||'连接诊断失败',config.apiKey));
  } finally {clearTimeout(timer);}
}

async function fetchProviderModels(input) {
  const config = validateProviderConfig(input, { requireModel: false });
  let candidates;
  try {
    candidates = buildModelsUrlCandidates(config.baseUrl, { modelsUrlOverride: config.modelsUrlOverride });
  } catch {
    throw new Error("无法从 Base URL 推导模型列表地址，请填写自定义 Models URL");
  }
  let lastError = "没有可用的模型列表端点";
  for (const endpoint of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...(config.protocol === "anthropic" ? { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" } : {}),
        },
        signal: controller.signal,
        redirect: "error",
      });
      const raw = await response.text();
      if (response.ok) {
        let payload;
        try { payload = JSON.parse(raw); } catch { throw new Error("模型列表返回了无法解析的内容"); }
        const models = parseModelsResponse(payload);
        if (!models.length) throw new Error("服务返回了空模型列表，可继续手动填写模型名");
        return { ok: true, endpoint, candidates, models };
      }
      const detail = providerErrorDetail(raw, config.apiKey);
      lastError = `HTTP ${response.status}${detail ? ` · ${detail}` : ""}`;
      if (![404, 405].includes(response.status)) break;
    } catch (error) {
      lastError = error?.name === "AbortError" ? "连接超时" : error.message;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`未能读取模型列表（${lastError}）。你仍可以手动填写模型名称。`);
}

function saveProviderConfig(config, metadata = {}) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法使用安全凭据存储，已拒绝保存明文密钥");
  const target = providerFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const store = readProviderStore();
  const id = config.id || randomUUID();
  const previous = store.profiles.find((item) => item.id === id);
  const saved = {
    id,
    providerName: config.providerName,
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    model: config.model,
    modelProfiles: modelProfilesFor(config),
    modelsUrlOverride: config.modelsUrlOverride || "",
    availableModels: config.availableModels || [],
    modelsEndpoint: config.modelsEndpoint || metadata.modelsEndpoint || "",
    health: metadata.health || "healthy",
    latencyMs: Number.isFinite(metadata.latencyMs) ? metadata.latencyMs : previous?.latencyMs ?? null,
    lastTestedAt: metadata.lastTestedAt || new Date().toISOString(),
    encryptedApiKey: safeStorage.encryptString(config.apiKey).toString("base64"),
  };
  const index = store.profiles.findIndex((item) => item.id === id);
  if (index >= 0) store.profiles[index] = saved; else store.profiles.push(saved);
  store.activeId = id;
  writeProviderStore(store);
  return id;
}

function writeProviderStore(store) {
  const target = providerFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch { /* Windows ACLs are managed by the OS. */ }
}

function updateProviderMetadata(id, metadata) {
  if (!id) return;
  const store = readProviderStore();
  const profile = store.profiles.find((item) => item.id === id);
  if (!profile) return;
  Object.assign(profile, metadata);
  writeProviderStore(store);
}

function providerEnvironment(config) {
  if (!config?.apiKey) return {};
  return {
    FETCHCV_AGENT_RUNTIME: "compatible",
    FETCHCV_PROVIDER_NAME: config.providerName,
    FETCHCV_PROVIDER_PROTOCOL: config.protocol,
    FETCHCV_PROVIDER_BASE_URL: config.baseUrl,
    FETCHCV_PROVIDER_API_KEY: config.apiKey,
    FETCHCV_PROVIDER_MODEL: config.model,
  };
}

async function applyProviderToSidecar(config) {
  if (!sidecar?.apiBase) throw new Error("本地 Agent 服务尚未启动");
  const response = await fetch(`${sidecar.apiBase}/api/runtime/configure`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fetchcv-control-token": controlToken },
    body: JSON.stringify({ provider_name: config.providerName, protocol: config.protocol, base_url: config.baseUrl, api_key: config.apiKey, model: config.model }),
  });
  if (!response.ok) throw new Error(`本地 Agent 切换模型失败 (${response.status})`);
  return response.json();
}

async function disconnectProviderFromSidecar() {
  if (!sidecar?.apiBase) throw new Error("本地 Agent 服务尚未启动");
  const response = await fetch(`${sidecar.apiBase}/api/runtime/disconnect`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fetchcv-control-token": controlToken },
    body: "{}",
  });
  if (!response.ok) throw new Error(`本地 Agent 断开模型失败 (${response.status})`);
  return response.json();
}

function registerIpc() {
  const trusted = event => isTrustedFrame(event, renderer.url);
  const handle = (channel, callback) => ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error("sender_denied");
    return callback(event, ...args);
  });
  const on = (channel, callback) => ipcMain.on(channel, (event, ...args) => {
    if (trusted(event)) callback(event, ...args);
  });
  on("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  on("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize(); else window.maximize();
  });
  on("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  handle("backend:get-status", () => ({ state: backendState, apiBase: backendApiBase, message: backendError || "" }));
  handle("runtime:request", (event, request) => {
    const allowed = renderer.url;
    if (!isTrustedFrame(event, allowed)) return { ok: false, error: { code: "sender_denied", message: "运行请求来源不受信任", retryable: false } };
    return runtimeRpc.dispatch(request, event.sender, item => {
      if (!event.sender.isDestroyed()) event.sender.send(`runtime:event:${request.id}`, item);
    });
  });
  handle("clipboard:read-text", () => clipboard.readText());
  handle("xiaohongshu:begin-login", () => {
    if (!browserBridge) throw new Error("浏览器尚未就绪，请稍后重试");
    return browserBridge.beginLogin();
  });
  handle("xiaohongshu:finish-login", () => {
    if (!browserBridge) throw new Error("浏览器尚未就绪，请稍后重试");
    return browserBridge.finishLogin();
  });
  handle("source:open-external", async (_event, input) => {
    const url = String(input?.url || "");
    const title = String(input?.title || "").slice(0, 300);
    if (!isSafeExternal(url, backendApiBase)) throw new Error("面经原帖地址无效");
    const isXhs = isXiaohongshuUrl(url);
    const resolved = isXhs
      ? await browserBridge?.resolveExternal?.(url, {
        title,
        company: String(input?.company || "").slice(0, 240),
        businessUnit: String(input?.businessUnit || input?.business_unit || "").slice(0, 240),
        role: String(input?.role || "").slice(0, 240),
      }) || url
      : url;
    if (!isSafeExternal(resolved, backendApiBase)) throw new Error("面经原帖地址无效");
    const diagnostics = isXhs ? browserBridge?.externalResolutionStatus?.() || null : null;
    if (isXhs && diagnostics && diagnostics.accessRestored === false) {
      return {
        opened: false,
        unavailable: true,
        reason: "xiaohongshu_source_unavailable",
        diagnostics,
      };
    }
    if (process.env.FETCHCV_E2E_CAPTURE_EXTERNAL === "1") {
      return {
        opened: false,
        accessRefreshed: resolved !== url,
        url: resolved,
        diagnostics,
      };
    }
    await shell.openExternal(resolved);
    return { opened: true, accessRefreshed: resolved !== url };
  });
  handle("dialog:select-resume-pdf", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 PDF 简历",
      properties: ["openFile"],
      filters: [{ name: "PDF 简历", extensions: ["pdf"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("dialog:select-job-description", async () => {
    const result = await dialog.showOpenDialog({
      title: "导入岗位描述",
      buttonLabel: "导入",
      properties: ["openFile"],
      filters: [{ name: "岗位描述", extensions: ["txt", "md"] }],
    });
    if (result.canceled) return null;
    const sourcePath = result.filePaths[0];
    const stat = fs.statSync(sourcePath);
    if (stat.size > 2 * 1024 * 1024) throw new Error("岗位描述文件不能超过 2MB");
    return { name: path.basename(sourcePath), text: fs.readFileSync(sourcePath, "utf8") };
  });
  handle("dialog:import-workspace-files", async () => {
    const result = await dialog.showOpenDialog({
      title: "添加到 FetchCV 工作区",
      buttonLabel: "添加",
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) return [];
    const batch = randomUUID();
    const workspaceRoot = path.join(app.getPath("userData"), "workspace");
    const destinationRoot = path.join(workspaceRoot, "imports", batch);
    fs.mkdirSync(destinationRoot, { recursive: true });
    return result.filePaths.map((sourcePath) => {
      const name = path.basename(sourcePath);
      const destination = path.join(destinationRoot, name);
      fs.copyFileSync(sourcePath, destination, fs.constants.COPYFILE_EXCL);
      const stat = fs.statSync(destination);
      return {
        name,
        workspacePath: path.relative(workspaceRoot, destination).split(path.sep).join("/"),
        sizeBytes: stat.size,
        mimeType: importedFileMime(name),
      };
    });
  });
  handle("dialog:select-legacy-workspace", async () => {
    const result = await dialog.showOpenDialog({
      title: "从旧版简历编辑器迁移",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  const fetchResumeSnapshot = async (resumeId) => {
    if (!/^[a-z0-9_-]{8,128}$/i.test(String(resumeId || ""))) throw new Error("简历版本 ID 无效");
    if (!sidecar?.apiBase) throw new Error("本地简历服务尚未启动");
    const response = await fetch(`${sidecar.apiBase}/api/resumes/${encodeURIComponent(String(resumeId))}`, {
      headers: { "x-fetchcv-control-token": controlToken },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || payload?.detail || `读取简历失败 (${response.status})`);
    const snapshot = payload?.content_json?.editor_snapshot;
    if (!snapshot?.profile || !Array.isArray(snapshot?.sections)) throw new Error("当前简历缺少可编辑快照");
    return snapshot;
  };
  handle("resume:get-snapshot", (_event, resumeId) => fetchResumeSnapshot(resumeId));
  handle("resume:render-pdf", async (_event, resumeId) => {
    const snapshot = await fetchResumeSnapshot(resumeId);
    const renderWindow = new BrowserWindow({
      width: 980,
      height: 1320,
      show: false,
      backgroundColor: "#ffffff",
      webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false },
    });
    try {
      const query = { embedded: "1", preview: "1", resumeId: String(resumeId), apiBase: sidecar.apiBase, apiToken: controlToken };
      if (renderer.development) {
        const editorURL = new URL("resume-editor/index.html", renderer.url);
        editorURL.search = new URLSearchParams(query).toString();
        await renderWindow.loadURL(editorURL.href);
      } else {
        await renderWindow.loadFile(path.join(projectRoot, "dist", "resume-editor", "index.html"), { query });
      }
      const serializedSnapshot = JSON.stringify(snapshot);
      await renderWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
          const bridge = window.fetchCVBridge;
          if (bridge) {
            bridge.loadSnapshot(${serializedSnapshot});
            const status = bridge.status();
            const expectedName = ${JSON.stringify(String(snapshot.profile?.name || ""))};
            if (status.loaded && document.querySelector('#previewName')?.textContent === expectedName) {
              clearInterval(timer);
              Promise.resolve(document.fonts?.ready).then(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            } else if (status.error) {
              clearInterval(timer);
              reject(new Error(status.error));
            }
          }
          if (Date.now() - started > 20000) { clearInterval(timer); reject(new Error('简历渲染器加载超时')); }
        }, 80);
      })`);
      const metrics = await renderWindow.webContents.executeJavaScript(`(() => {
        const page = document.querySelector('#resumePage');
        if (!page) throw new Error('找不到正式简历页面');
        const style = document.createElement('style');
        style.textContent = '@page{size:A4;margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important}.resume-section.selected-section{outline:none!important;box-shadow:none!important}.resume-section{cursor:default!important}section,article,.section-item{break-inside:avoid}';
        document.head.appendChild(style);
        document.body.replaceChildren(page);
        Object.assign(document.body.style, { display:'block', width:'794px', height:'auto', minHeight:'1123px', overflow:'visible' });
        Object.assign(page.style, { position:'relative', left:'auto', top:'auto', width:'794px', minHeight:'1123px', margin:'0', transform:'none', boxShadow:'none' });
        return { height: Math.max(page.scrollHeight, 1123) };
      })()`);
      const pageCount = Math.max(1, Math.ceil(Number(metrics?.height || 1123) / 1123));
      const pdf = await renderWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: "A4", margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      const response = await fetch(`${sidecar.apiBase}/api/resumes/${encodeURIComponent(String(resumeId))}/pdf`, {
        method: "PUT",
        headers: { "content-type": "application/pdf", "x-fetchcv-page-count": String(pageCount), "x-fetchcv-control-token": controlToken },
        body: pdf,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || payload?.detail || `正式 PDF 保存失败 (${response.status})`);
      return { ok: true, pageCount, pdfUrl: payload.pdf_url };
    } finally {
      if (!renderWindow.isDestroyed()) renderWindow.destroy();
    }
  });
  handle("provider:get", async () => readProviderConfig() || { providerName: "", protocol: "openai", baseUrl: "", model: "", hasApiKey: false });
  handle("provider:list", async () => listProviderConfigs());
  handle("provider:test", async (_event, input) => {
    try {
      const result = await testProviderConnection(input || {});
      updateProviderMetadata(input?.id, { health: result.capabilities.tools === "verified" ? "healthy" : "tools_unverified", latencyMs: result.latencyMs, lastTestedAt: new Date().toISOString() });
      return { ok: result.ok, latencyMs: result.latencyMs, providerName: result.providerName, protocol: result.protocol, model: result.model, capabilities:result.capabilities, message:result.message };
    } catch (error) {
      updateProviderMetadata(input?.id, { health: "error", lastTestedAt: new Date().toISOString() });
      throw error;
    }
  });
  handle("provider:fetch-models", async (_event, input) => fetchProviderModels(input || {}));
  handle("provider:save", async (_event, input) => {
    const result = await testProviderConnection(input || {});
    const runtime = await applyProviderToSidecar(result.config);
    let id;
    try {
      id = saveProviderConfig(
        { ...result.config, id: input?.id },
        { health: result.capabilities.tools === "verified" ? "healthy" : "tools_unverified", latencyMs: result.latencyMs, modelsEndpoint: input?.modelsEndpoint, lastTestedAt: new Date().toISOString() },
      );
    } catch (error) {
      const previous = readProviderConfig({ includeSecret: true });
      if (previous?.apiKey) await applyProviderToSidecar(previous).catch(() => {});
      else await disconnectProviderFromSidecar().catch(() => {});
      throw error;
    }
    return { ok: true, latencyMs: result.latencyMs, runtime, provider: readProviderConfig(), activeId: id, store: listProviderConfigs() };
  });
  handle("provider:activate", async (_event, id, model) => {
    const store = readProviderStore();
    const raw = store.profiles.find((item) => item.id === id);
    if (!raw) throw new Error("模型连接不存在");
    raw.modelProfiles = modelProfilesFor(raw);
    delete raw.contextWindow; delete raw.maxOutputTokens;
    if (String(model || "").trim()) raw.model = String(model).trim();
    const config = decodeProvider(raw, { includeSecret: true });
    if (!config.apiKey) throw new Error("这个连接的密钥无法在当前 Mac 解密，请重新填写 API Key");
    const runtime = await applyProviderToSidecar(config);
    store.activeId = id;
    writeProviderStore(store);
    return { runtime, provider: decodeProvider(raw), store: listProviderConfigs() };
  });
  handle("provider:delete", async (_event, id) => {
    const store = readProviderStore();
    const wasActive = store.activeId === id;
    store.profiles = store.profiles.filter((item) => item.id !== id);
    let runtime = null;
    if (wasActive) {
      const next = store.profiles[0];
      const nextConfig = next ? decodeProvider(next, { includeSecret: true }) : null;
      if (nextConfig?.apiKey) {
        store.activeId = next.id;
        runtime = await applyProviderToSidecar(nextConfig);
      } else {
        store.activeId = "";
        runtime = await disconnectProviderFromSidecar();
      }
    }
    writeProviderStore(store);
    return { ...listProviderConfigs(), runtime };
  });
}

function revealWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

function createWindow(preferredApiBase = "") {
  const apiBase = preferredApiBase || sidecar?.apiBase || backendApiBase || "http://127.0.0.1:8766";
  const isMac = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 1060,
    minHeight: 700,
    show: false,
    ...(isMac
      ? { frame: true, titleBarStyle: "hiddenInset", trafficLightPosition: { x: 15, y: 12 } }
      : { frame: false }),
    backgroundColor: "#faf9f5",
    title: renderer.development ? "FetchCV · 开发版" : "FetchCV",
    icon: path.join(projectRoot, "FetchCV_LOGO.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      plugins: true,
      additionalArguments: [`--fetchcv-api-url=${apiBase}`, `--fetchcv-api-token=${controlToken}`, `--fetchcv-api-error=${encodeURIComponent(backendError || "")}`],
    },
  });

  void (renderer.development ? window.loadURL(renderer.url) : window.loadFile(path.join(projectRoot, "dist", "index.html"))).catch((error) => {
    console.error("Desktop UI load failed:", error instanceof Error ? error.message : String(error));
    revealWindow(window);
  });
  // The app menu stays hidden; macOS keeps its native traffic lights while
  // Windows uses the renderer-owned window controls. Keep text editing
  // shortcuts available in the main document and embedded editor iframe.
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.meta || input.control)) return;
    const key = String(input.key || "").toLowerCase();
    if (key === "a") {
      event.preventDefault();
      void window.webContents.executeJavaScript(`(() => {
        const selectEditable = (doc) => {
          const active = doc.activeElement;
          if (active?.matches?.('textarea, input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])')) {
            active.select?.();
            return true;
          }
          const editor = active?.closest?.('[contenteditable="true"]');
          if (editor) {
            const selection = doc.getSelection();
            const range = doc.createRange();
            range.selectNodeContents(editor);
            selection?.removeAllRanges();
            selection?.addRange(range);
            return true;
          }
          if (active?.contentDocument) return selectEditable(active.contentDocument);
          return false;
        };
        selectEditable(document);
      })()`).catch(() => {});
      return;
    }
    if (key !== "v") return;
    const text = clipboard.readText();
    if (!text) return;
    event.preventDefault();
    void window.webContents.insertText(text);
  });
  const revealTimer = setTimeout(() => revealWindow(window), 1500);
  revealTimer.unref?.();
  const revealLoadedWindow = () => {
    clearTimeout(revealTimer);
    revealWindow(window);
  };
  window.once("ready-to-show", revealLoadedWindow);
  window.webContents.once("did-finish-load", revealLoadedWindow);
  window.once("closed", () => clearTimeout(revealTimer));
  const owner = window.webContents;
  owner.once("destroyed", () => runtimeRpc.disposeOwner(owner));
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`Desktop UI failed to load (${errorCode}): ${errorDescription}`);
    revealLoadedWindow();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url, apiBase)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== renderer.url) event.preventDefault();
  });
  return window;
}

Menu.setApplicationMenu(null);

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else if (!app.isPackaged && process.env.FETCHCV_V2_STORAGE_ROOT) {
  // Workspace selection is host-owned. No legacy Python writer, HTTP token,
  // legacy Pi persistence adapter starts on this branch. APP owns the V2 host.
  app.on("second-instance", () => revealWindow(BrowserWindow.getAllWindows()[0]));
  app.whenReady().then(() => startWorkspaceApplication({ app, BrowserWindow, ipcMain, utilityProcess, dialog,
    root: process.env.FETCHCV_V2_STORAGE_ROOT, projectRoot, runtimeDir: __dirname,
    getProviderConfig: () => readProviderConfig({ includeSecret: true }),
  })).catch(() => { console.error("Workspace startup failed; legacy fallback is disabled."); app.quit(); });
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    revealWindow(window);
  });

  // Begin the independent Python boot while Electron itself is still becoming
  // ready. Waiting for app.whenReady() first serialized two cold-start paths
  // and left the CPU idle during part of the launch.
  const requestedPort = Number(process.env.FETCHCV_API_PORT || 8766);
  const preferredPort = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535 ? requestedPort : 8766;
  const portChoicePromise = choosePort(preferredPort);
  const browserOptionsPromise = prepareBrowserBridge().catch((error) => {
    console.error("Controlled browser bridge port reservation failed:", error instanceof Error ? error.message : String(error));
    return null;
  });
  let earlyProvider = null;
  try { earlyProvider = readProviderConfig({ includeSecret: true }); } catch { /* safeStorage may not be ready yet */ }
  const sidecarStartup = Promise.all([portChoicePromise, browserOptionsPromise]).then(([portChoice, browserOptions]) => {
    backendApiBase = `http://127.0.0.1:${portChoice.port}`;
    return startSidecar({
      isPackaged: app.isPackaged,
      projectRoot,
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath("userData"),
      port: portChoice.port,
      onSpawn: (launched) => { sidecar = launched; },
      env: {
        ...process.env,
        FETCHCV_CONTROL_TOKEN: controlToken,
        FETCHCV_APPROVAL_KEY: approvalKey,
        ...(renderer.development ? { FETCHCV_ALLOWED_ORIGINS: new URL(renderer.url).origin } : {}),
        ...(browserOptions ? { FETCHCV_BROWSER_BRIDGE_URL: browserOptions.url, FETCHCV_BROWSER_BRIDGE_TOKEN: browserOptions.token } : {}),
        ...providerEnvironment(earlyProvider),
      },
    });
  }).then((value) => ({ value }), (error) => ({ error }));

  app.whenReady().then(async () => {
    registerIpc();
    fs.mkdirSync(path.join(app.getPath("userData"), "data"), { recursive: true });
    const [portChoice, browserOptions] = await Promise.all([portChoicePromise, browserOptionsPromise]);
    backendApiBase = `http://127.0.0.1:${portChoice.port}`;
    createWindow(backendApiBase);

    // The desktop shell is visible before the Python runtime imports, opens
    // the database and completes its health check. Browser and API bootstrap
    // continue in the background while the renderer shows a quiet ready state.
    const browserPromise = browserOptions
      ? startBrowserBridge({
        ...browserOptions,
        accessCacheFile: path.join(app.getPath("userData"), "settings", "xiaohongshu-public-links.bin"),
      }).catch((error) => {
        console.error("Controlled browser bridge failed to start:", error instanceof Error ? error.message : String(error));
        return null;
      })
      : Promise.resolve(null);
    try {
      const [startedBrowser, sidecarResult] = await Promise.all([browserPromise, sidecarStartup]);
      if (sidecarResult.error) throw sidecarResult.error;
      browserBridge = startedBrowser;
      sidecar = sidecarResult.value;
      const savedProvider = readProviderConfig({ includeSecret: true });
      if (savedProvider?.apiKey && !earlyProvider?.apiKey) await applyProviderToSidecar(savedProvider);
      await piAgentRuntime.reconcileTasks();
      backendState = "ready";
      // Load Pi after the window and local API are ready. This keeps click-to-
      // window latency low while avoiding a first-message module import pause.
      setTimeout(() => void piAgentRuntime.warm().catch(() => {}), 1200);
    } catch (error) {
      backendState = "error";
      backendError = error instanceof Error ? error.message : String(error);
      console.error("Local API startup failed:", backendError);
    }
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on("before-quit", () => {
  browserBridge?.stop();
  stopSidecar(sidecar);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
