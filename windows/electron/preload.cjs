const { contextBridge, ipcRenderer } = require("electron");

const apiArg = process.argv.find((item) => item.startsWith("--fetchcv-api-url="));
const tokenArg = process.argv.find((item) => item.startsWith("--fetchcv-api-token="));
const errorArg = process.argv.find((item) => item.startsWith("--fetchcv-api-error="));

contextBridge.exposeInMainWorld("appRuntime", {
  apiBase: apiArg ? apiArg.slice("--fetchcv-api-url=".length) : "http://127.0.0.1:8766",
  apiToken: tokenArg ? tokenArg.slice("--fetchcv-api-token=".length) : "",
  startupError: errorArg ? decodeURIComponent(errorArg.slice("--fetchcv-api-error=".length)) : "",
  getBackendStatus: () => ipcRenderer.invoke("backend:get-status"),
  streamPiMessage: (input, onEvent) => new Promise((resolve, reject) => {
    const requestId = String(input?.requestId || "");
    const channel = `pi-agent:event:${requestId}`;
    const cleanup = () => ipcRenderer.removeListener(channel, listener);
    const listener = (_event, item) => {
      if (item?.kind === "event") {
        onEvent?.(item.name, item.payload);
        return;
      }
      cleanup();
      if (item?.kind === "complete") {
        resolve(item.result);
        return;
      }
      const error = new Error(item?.error?.message || "Pi Agent 运行失败");
      error.name = item?.error?.name || "Error";
      error.code = item?.error?.code || "pi_agent_failed";
      error.payload = item?.error?.payload || null;
      reject(error);
    };
    ipcRenderer.on(channel, listener);
    ipcRenderer.send("pi-agent:start", input);
  }),
  cancelPiMessage: (requestId) => ipcRenderer.send("pi-agent:cancel", requestId),
  startPiTask: (runId, kind) => ipcRenderer.invoke("pi-agent:start-task", { runId, kind }),
  steerPiTask: (runId, input) => ipcRenderer.invoke("pi-agent:steer-task", { runId, ...input }),
  selectResumePdf: () => ipcRenderer.invoke("dialog:select-resume-pdf"),
  selectJobDescriptionFile: () => ipcRenderer.invoke("dialog:select-job-description"),
  importWorkspaceFiles: () => ipcRenderer.invoke("dialog:import-workspace-files"),
  selectLegacyWorkspace: () => ipcRenderer.invoke("dialog:select-legacy-workspace"),
  getModelProvider: () => ipcRenderer.invoke("provider:get"),
  listModelProviders: () => ipcRenderer.invoke("provider:list"),
  testModelProvider: (config) => ipcRenderer.invoke("provider:test", config),
  fetchModelProviderModels: (config) => ipcRenderer.invoke("provider:fetch-models", config),
  saveModelProvider: (config) => ipcRenderer.invoke("provider:save", config),
  activateModelProvider: (id, model) => ipcRenderer.invoke("provider:activate", id, model),
  deleteModelProvider: (id) => ipcRenderer.invoke("provider:delete", id),
  readClipboardText: () => ipcRenderer.invoke("clipboard:read-text"),
  openInterviewSource: (source) => ipcRenderer.invoke("source:open-external", source),
  getResumeSnapshot: (resumeId) => ipcRenderer.invoke("resume:get-snapshot", resumeId),
  renderResumePdf: (resumeId) => ipcRenderer.invoke("resume:render-pdf", resumeId),
});

contextBridge.exposeInMainWorld("desktopWindow", {
  platform: process.platform,
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
});
