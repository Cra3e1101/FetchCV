import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, shell } from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModelsUrlCandidates, parseModelsResponse, redactProviderError } from "./provider-utils.mjs";
import { startBrowserBridge } from "./browser-bridge.mjs";
import { startSidecar, stopSidecar } from "./sidecar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
let sidecar = null;
let browserBridge = null;
let backendError = null;
const controlToken = randomBytes(32).toString("hex");

if (process.env.FETCHCV_E2E_USER_DATA) {
  app.setPath("userData", process.env.FETCHCV_E2E_USER_DATA);
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
  return saved ? decodeProvider(saved, { includeSecret }) : null;
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
    modelsUrlOverride: String(config.modelsUrlOverride || "").trim(),
    modelsEndpoint: String(config.modelsEndpoint || "").trim(),
    availableModels: Array.isArray(config.availableModels)
      ? config.availableModels.map((item) => typeof item === "string" ? { id: item, ownedBy: "" } : item).filter((item) => item?.id).slice(0, 500)
      : [],
  };
}

function providerEndpoint(config) {
  const parsed = new URL(config.baseUrl);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const suffix = config.protocol === "anthropic" ? "/v1/messages" : "/chat/completions";
  if (pathname.endsWith(suffix)) return parsed.toString().replace(/\/$/, "");
  if (config.protocol === "anthropic" && pathname.endsWith("/v1")) {
    parsed.pathname = `${pathname}/messages`;
  } else if (config.protocol === "openai" && pathname.endsWith("/v1")) {
    parsed.pathname = `${pathname}/chat/completions`;
  } else {
    parsed.pathname = `${pathname}${suffix}`;
  }
  return parsed.toString().replace(/\/$/, "");
}

function providerErrorDetail(raw, apiKey) {
  return redactProviderError(raw, apiKey);
}

async function testProviderConnection(input) {
  const config = validateProviderConfig(input);
  const started = Date.now();
  const endpoint = providerEndpoint(config);
  const headers = config.protocol === "anthropic"
    ? { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }
    : { "content-type": "application/json", Authorization: `Bearer ${config.apiKey}` };
  const body = config.protocol === "anthropic"
    ? { model: config.model, max_tokens: 12, messages: [{ role: "user", content: "只回复 OK" }] }
    : { model: config.model, max_tokens: 12, stream: false, messages: [{ role: "user", content: "只回复 OK" }] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal, redirect: "error" });
    const raw = await response.text();
    if (!response.ok) {
      const detail = providerErrorDetail(raw, config.apiKey);
      const hint = response.status === 401 || response.status === 403
        ? "请检查 API Key 和权限"
        : response.status === 404
          ? "请检查 Base URL、兼容协议和模型 endpoint"
          : "请检查模型名称和请求参数";
      throw new Error(`模型 API 返回 HTTP ${response.status} · ${hint}${detail ? ` · ${detail}` : ""}`);
    }
    return { ok: true, latencyMs: Date.now() - started, providerName: config.providerName, protocol: config.protocol, model: config.model, config };
  } catch (error) {
    const parsedHost = new URL(config.baseUrl).hostname;
    const message = error?.name === "AbortError"
      ? `连接超时（${parsedHost}），请检查网络或 Base URL`
      : error?.message?.startsWith("模型 API 返回")
        ? error.message
        : `无法连接到 ${parsedHost}，请检查网络、Base URL 和兼容协议`;
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
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
    modelsUrlOverride: config.modelsUrlOverride || "",
    availableModels: config.availableModels?.length ? config.availableModels : previous?.availableModels || [],
    modelsEndpoint: metadata.modelsEndpoint || previous?.modelsEndpoint || "",
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
  ipcMain.on("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize(); else window.maximize();
  });
  ipcMain.on("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("clipboard:read-text", () => clipboard.readText());
  ipcMain.handle("dialog:select-resume-pdf", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 PDF 简历",
      properties: ["openFile"],
      filters: [{ name: "PDF 简历", extensions: ["pdf"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("dialog:select-job-description", async () => {
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
  ipcMain.handle("dialog:import-workspace-files", async () => {
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
  ipcMain.handle("dialog:select-legacy-workspace", async () => {
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
  ipcMain.handle("resume:get-snapshot", (_event, resumeId) => fetchResumeSnapshot(resumeId));
  ipcMain.handle("resume:render-pdf", async (_event, resumeId) => {
    const snapshot = await fetchResumeSnapshot(resumeId);
    const renderWindow = new BrowserWindow({
      width: 980,
      height: 1320,
      show: false,
      backgroundColor: "#ffffff",
      webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false },
    });
    try {
      await renderWindow.loadFile(path.join(projectRoot, "dist", "resume-editor", "index.html"), {
        query: { embedded: "1", preview: "1", resumeId: String(resumeId), apiBase: sidecar.apiBase, apiToken: controlToken },
      });
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
  ipcMain.handle("provider:get", async () => readProviderConfig() || { providerName: "", protocol: "openai", baseUrl: "", model: "", hasApiKey: false });
  ipcMain.handle("provider:list", async () => listProviderConfigs());
  ipcMain.handle("provider:test", async (_event, input) => {
    try {
      const result = await testProviderConnection(input || {});
      updateProviderMetadata(input?.id, { health: "healthy", latencyMs: result.latencyMs, lastTestedAt: new Date().toISOString() });
      return { ok: result.ok, latencyMs: result.latencyMs, providerName: result.providerName, protocol: result.protocol, model: result.model };
    } catch (error) {
      updateProviderMetadata(input?.id, { health: "error", lastTestedAt: new Date().toISOString() });
      throw error;
    }
  });
  ipcMain.handle("provider:fetch-models", async (_event, input) => fetchProviderModels(input || {}));
  ipcMain.handle("provider:save", async (_event, input) => {
    const result = await testProviderConnection(input || {});
    const runtime = await applyProviderToSidecar(result.config);
    let id;
    try {
      id = saveProviderConfig(
        { ...result.config, id: input?.id },
        { health: "healthy", latencyMs: result.latencyMs, modelsEndpoint: input?.modelsEndpoint, lastTestedAt: new Date().toISOString() },
      );
    } catch (error) {
      const previous = readProviderConfig({ includeSecret: true });
      if (previous?.apiKey) await applyProviderToSidecar(previous).catch(() => {});
      else await disconnectProviderFromSidecar().catch(() => {});
      throw error;
    }
    return { ok: true, latencyMs: result.latencyMs, runtime, provider: readProviderConfig(), activeId: id, store: listProviderConfigs() };
  });
  ipcMain.handle("provider:activate", async (_event, id, model) => {
    const store = readProviderStore();
    const raw = store.profiles.find((item) => item.id === id);
    if (!raw) throw new Error("模型连接不存在");
    if (String(model || "").trim()) raw.model = String(model).trim();
    const config = decodeProvider(raw, { includeSecret: true });
    if (!config.apiKey) throw new Error("这个连接的密钥无法在当前 Mac 解密，请重新填写 API Key");
    const runtime = await applyProviderToSidecar(config);
    store.activeId = id;
    writeProviderStore(store);
    return { runtime, provider: decodeProvider(raw), store: listProviderConfigs() };
  });
  ipcMain.handle("provider:delete", async (_event, id) => {
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

function createWindow() {
  const apiBase = sidecar?.apiBase || "http://127.0.0.1:8766";
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
    title: "FetchCV",
    icon: path.join(projectRoot, "FetchCV_LOGO.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      sandbox: true,
      plugins: true,
      additionalArguments: [`--fetchcv-api-url=${apiBase}`, `--fetchcv-api-token=${controlToken}`, `--fetchcv-api-error=${encodeURIComponent(backendError || "")}`],
    },
  });

  window.loadFile(path.join(projectRoot, "dist", "index.html"));
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
  window.webContents.once("did-finish-load", () => window.show());
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`Desktop UI failed to load (${errorCode}): ${errorDescription}`);
    if (!window.isVisible()) window.show();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url, apiBase)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) event.preventDefault();
  });
  return window;
}

Menu.setApplicationMenu(null);

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });

  app.whenReady().then(async () => {
    registerIpc();
    fs.mkdirSync(path.join(app.getPath("userData"), "data"), { recursive: true });
    try {
      browserBridge = await startBrowserBridge();
    } catch (error) {
      console.error("Controlled browser bridge failed to start:", error instanceof Error ? error.message : String(error));
    }
    try {
      const savedProvider = readProviderConfig({ includeSecret: true });
      sidecar = await startSidecar({
        isPackaged: app.isPackaged,
        projectRoot,
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath("userData"),
        env: {
          ...process.env,
          FETCHCV_CONTROL_TOKEN: controlToken,
          ...(browserBridge ? { FETCHCV_BROWSER_BRIDGE_URL: browserBridge.url, FETCHCV_BROWSER_BRIDGE_TOKEN: browserBridge.token } : {}),
          ...providerEnvironment(savedProvider),
        },
      });
    } catch (error) {
      backendError = error instanceof Error ? error.message : String(error);
      console.error("Local API startup failed:", backendError);
    }
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on("before-quit", () => {
  browserBridge?.stop();
  stopSidecar(sidecar);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
