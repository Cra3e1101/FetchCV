const { contextBridge, ipcRenderer } = require("electron");

const apiArg = process.argv.find((item) => item.startsWith("--fetchcv-api-url="));
const tokenArg = process.argv.find((item) => item.startsWith("--fetchcv-api-token="));
const errorArg = process.argv.find((item) => item.startsWith("--fetchcv-api-error="));

let requestSequence = 0;
const nextId = () => `ipc-${Date.now()}-${++requestSequence}`;
async function runtimeRequest(method, payload, id = nextId()) {
  const response = await ipcRenderer.invoke("runtime:request", { v: 1, id, method, workspaceId: "local", deadlineMs: Date.now() + 15 * 60 * 1000, payload });
  if (response?.ok) return response.result;
  const error = new Error(response?.error?.message || "Agent 运行失败");
  error.code = response?.error?.code || "runtime_failed";
  if (error.code === "cancelled") error.name = "AbortError";
  throw error;
}

contextBridge.exposeInMainWorld("appRuntime", {
  apiBase: apiArg ? apiArg.slice("--fetchcv-api-url=".length) : "http://127.0.0.1:8766",
  apiToken: tokenArg ? tokenArg.slice("--fetchcv-api-token=".length) : "",
  startupError: errorArg ? decodeURIComponent(errorArg.slice("--fetchcv-api-error=".length)) : "",
  getBackendStatus: () => ipcRenderer.invoke("backend:get-status"),
  streamPiMessage: async (input, onEvent) => {
    const requestId = String(input?.requestId || "");
    const channel = `runtime:event:${requestId}`;
    let sequence = 0;
    const listener = (_event, item) => {
      if (item?.v !== 1 || item.streamId !== requestId || !Number.isSafeInteger(item.seq) || item.seq <= sequence) return;
      if (item.seq !== sequence + 1) onEvent?.("gap", { afterSeq: sequence, nextSeq: item.seq, requiresSnapshot: true });
      sequence = item.seq;
      onEvent?.(item.name, item.payload);
      void runtimeRequest("agent.ack", { streamId: requestId, afterSeq: sequence }).catch(() => {});
    };
    ipcRenderer.on(channel, listener);
    try {
      const { requestId: _REQUEST_ID, ...payload } = input;
      return await runtimeRequest("agent.turn", payload, requestId);
    } finally { ipcRenderer.removeListener(channel, listener); }
  },
  cancelPiMessage: (requestId) => runtimeRequest("agent.cancel", { requestId }),
  startPiTask: (runId, kind) => runtimeRequest("agent.task", { runId, kind }),
  steerPiTask: (runId, input) => runtimeRequest("agent.steer", { runId, ...input }),
  getAgentEvents: (streamId, afterSeq) => runtimeRequest("agent.events", { streamId, afterSeq }),
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
  beginXiaohongshuLogin: () => ipcRenderer.invoke("xiaohongshu:begin-login"),
  finishXiaohongshuLogin: () => ipcRenderer.invoke("xiaohongshu:finish-login"),
  getResumeSnapshot: (resumeId) => ipcRenderer.invoke("resume:get-snapshot", resumeId),
  renderResumePdf: (resumeId) => ipcRenderer.invoke("resume:render-pdf", resumeId),
});

contextBridge.exposeInMainWorld("desktopWindow", {
  platform: process.platform,
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
});
