const { contextBridge, ipcRenderer } = require("electron");

const apiArg = process.argv.find((item) => item.startsWith("--fetchcv-api-url="));
const tokenArg = process.argv.find((item) => item.startsWith("--fetchcv-api-token="));
const errorArg = process.argv.find((item) => item.startsWith("--fetchcv-api-error="));

contextBridge.exposeInMainWorld("appRuntime", {
  apiBase: apiArg ? apiArg.slice("--fetchcv-api-url=".length) : "http://127.0.0.1:8766",
  apiToken: tokenArg ? tokenArg.slice("--fetchcv-api-token=".length) : "",
  startupError: errorArg ? decodeURIComponent(errorArg.slice("--fetchcv-api-error=".length)) : "",
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
  getResumeSnapshot: (resumeId) => ipcRenderer.invoke("resume:get-snapshot", resumeId),
  renderResumePdf: (resumeId) => ipcRenderer.invoke("resume:render-pdf", resumeId),
});

contextBridge.exposeInMainWorld("desktopWindow", {
  platform: process.platform,
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
});
