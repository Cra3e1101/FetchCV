import { createHttpClient } from "./http-client";
export const API_BASE = window.appRuntime?.apiBase || import.meta.env.VITE_FETCHCV_API || "http://127.0.0.1:8766";
const API_TOKEN = window.appRuntime?.apiToken || "";

const request = createHttpClient({ baseUrl: API_BASE, token: API_TOKEN });

function desktopAgentRequired() {
  const error = new Error("当前环境不支持 Agent 执行，请在 FetchCV 桌面应用中操作");
  error.code = "desktop_agent_required";
  return error;
}

function startPiTask(runId, kind) {
  if (!runId || !window.appRuntime?.startPiTask) return Promise.reject(desktopAgentRequired());
  return window.appRuntime.startPiTask(runId, kind);
}

async function streamPiMessage(jobId, content, options = {}) {
  if (!window.appRuntime?.streamPiMessage) throw desktopAgentRequired();
  const requestId = crypto.randomUUID();
  const cancel = () => window.appRuntime.cancelPiMessage?.(requestId);
  if (options.signal?.aborted) {
    const error = new Error("已停止生成");
    error.name = "AbortError";
    throw error;
  }
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await window.appRuntime.streamPiMessage({
      requestId,
      ...(options.conversationId ? { conversationId: options.conversationId } : { jobId }),
      content,
      thinkingLevel: options.thinkingLevel || "balanced",
      taskKind: options.taskKind || null,
      attachmentPaths: options.attachmentPaths || [],
      quote: options.quote || null,
    }, options.onEvent);
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}

async function followEvents(path, { signal, onEvent } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "text/event-stream", ...(API_TOKEN ? { "X-FetchCV-Control-Token": API_TOKEN } : {}) },
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`事件流连接失败 (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const name = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
      const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data) onEvent?.(name, JSON.parse(data));
    }
    if (done) return;
  }
}

const json = (method, body, headers) => ({ method, body: JSON.stringify(body), headers });

export const api = {
  base: API_BASE,
  conversations: () => request("/api/conversations"),
  createConversation: () => request("/api/conversations", json("POST", {})),
  conversation: (id) => request(`/api/conversations/${id}`),
  deleteConversation: (id) => request(`/api/conversations/${id}`, {method: "DELETE"}),
  linkConversation: (id, jobId) => request(`/api/conversations/${id}`, json("PATCH", {job_id: jobId || null})),
  streamConversation: (id, content, options = {}) => streamPiMessage(null, content, {...options, conversationId: id}),
  allInterviewKnowledge: () => request("/api/interview-knowledge"),
  health: () => request("/health"),
  runtime: () => request("/api/runtime/status"),
  workspace: () => request("/api/workspace"),
  candidateLibrary: (candidateId) => request(`/api/candidates/${candidateId}/library`),
  interviewKnowledge: (candidateId, query = "") => request(`/api/candidates/${candidateId}/interview-knowledge?q=${encodeURIComponent(query)}`),
  confirmInterviewOcr: (sourceId, reviewedText) => request(`/api/interview-sources/${sourceId}/confirm-ocr`, { method: "POST", body: JSON.stringify({ confirmed: true, reviewed_text: reviewedText }) }),
  interviewSource: (sourceId) => request(`/api/interview-sources/${sourceId}`),
  deleteInterviewSource: (sourceId) => request(`/api/interview-sources/${sourceId}`, { method: "DELETE" }),
  deleteInterviewBrief: (briefId) => request(`/api/interview-briefs/${briefId}`, { method: "DELETE" }),
  createMaterial: (candidateId, body) => request(`/api/candidates/${candidateId}/materials`, json("POST", body)),
  importLegacyWorkspace: (sourcePath) => request("/api/imports/legacy-resume", json("POST", { source_path: sourcePath })),
  previewResumePdf: (sourcePath, options = {}) => request("/api/imports/resume-pdf/preview", { ...json("POST", { source_path: sourcePath, ai_enhanced: options.aiEnhanced ?? false }), signal: options.signal }),
  importResumePdf: (body) => request("/api/imports/resume-pdf", json("POST", body)),
  jobWorkspace: (jobId) => request(`/api/jobs/${jobId}/workspace`),
  sendMessage: (jobId, content, options = {}) => streamPiMessage(jobId, content, options),
  streamMessage: (jobId, content, options = {}) => streamPiMessage(jobId, content, options),
  createJob: (body) => request("/api/jobs", json("POST", body)),
  updateJob: (jobId, body) => request(`/api/jobs/${jobId}`, json("PATCH", body)),
  deleteJob: (jobId) => request(`/api/jobs/${jobId}`, { method: "DELETE" }),
  searchWeb: (query, maxResults = 5) => request("/api/web/search", json("POST", { query, max_results: maxResults })),
  readWebPage: (url, maxChars = 20000) => request("/api/web/read", json("POST", { url, max_chars: maxChars })),
  previewJobPosting: (url) => request("/api/web/job-posting/preview", json("POST", { url })),
  importJobPage: (jobId, url, overwrite = false) => request(`/api/jobs/${jobId}/import-web`, json("POST", { url, overwrite })),
  permissionSettings: () => request("/api/settings/permissions"),
  updatePermissionSettings: (body) => request("/api/settings/permissions", json("PATCH", body)),
  generalSettings: () => request("/api/settings/general"),
  updateGeneralSettings: (body) => request("/api/settings/general", json("PATCH", body)),
  createFact: (candidateId, body) => request(`/api/candidates/${candidateId}/facts`, json("POST", body)),
  verifyFact: (factId, body) => request(`/api/facts/${factId}/verification`, json("PATCH", body)),
  createRun: (body) => request("/api/agent-runs", json("POST", body, { "Idempotency-Key": crypto.randomUUID() })),
  enqueueTask: (runId, body = {}) => startPiTask(runId, body.kind || "resume"),
  pauseTask: (taskId) => request(`/api/agent-tasks/${taskId}/pause`, json("POST", {})),
  resumeTask: (_taskId, runId) => startPiTask(runId, "resume"),
  retryTask: (_taskId, runId) => startPiTask(runId, "retry"),
  cancelTask: (taskId) => request(`/api/agent-tasks/${taskId}/cancel`, json("POST", {})),
  followRunEvents: (runId, options = {}) => followEvents(`/api/agent-runs/${runId}/events?follow=true&after_sequence=${options.afterSequence || 0}`, options),
  cancelQueuedMessage: (messageId) => request(`/api/queued-messages/${messageId}`, { method: "DELETE" }),
  steerTask: (runId, content, options = {}) => window.appRuntime?.steerPiTask
    ? window.appRuntime.steerPiTask(runId, { content, attachmentPaths: options.attachmentPaths || [], quote: options.quote || null })
    : Promise.reject(desktopAgentRequired()),
  skills: () => request("/api/skills"),
  reloadSkills: () => request("/api/skills/reload", json("POST", {})),
  updateSkill: (skillId, enabled) => request(`/api/skills/${skillId}`, json("PATCH", { enabled })),
  mcpServers: () => request("/api/mcp/servers"),
  createMcpServer: (body) => request("/api/mcp/servers", json("POST", body)),
  approveMcpServer: (serverId) => request(`/api/mcp/servers/${serverId}/approve`, json("POST", {})),
  probeMcpServer: (serverId) => request(`/api/mcp/servers/${serverId}/probe`, json("POST", {})),
  updateMcpServer: (serverId, body) => request(`/api/mcp/servers/${serverId}`, json("PATCH", body)),
  approveMcpWriteTool: (serverId, toolName, body) => request(`/api/mcp/servers/${serverId}/tools/${encodeURIComponent(toolName)}/approve-write`, json("POST", body)),
  revokeMcpWriteTool: (serverId, toolName) => request(`/api/mcp/servers/${serverId}/tools/${encodeURIComponent(toolName)}/approve-write`, { method: "DELETE" }),
  deleteMcpServer: (serverId) => request(`/api/mcp/servers/${serverId}`, { method: "DELETE" }),
  resumeRun: (runId) => startPiTask(runId, "resume"),
  retryRun: (runId) => startPiTask(runId, "retry"),
  cancelRun: (runId) => request(`/api/agent-runs/${runId}/cancel`, json("POST", {})),
  review: (runId, body) => request(`/api/agent-runs/${runId}/proposals/review`, json("POST", body)),
  saveApprovalDraft: (runId, approvalId, body) => request(`/api/agent-runs/${runId}/approvals/${approvalId}/draft`, json("PATCH", body)),
  reviewFacts: (runId, body) => request(`/api/agent-runs/${runId}/facts/review`, json("POST", body)),
  approvePublish: (runId, body) => request(`/api/agent-runs/${runId}/publish-approval`, json("POST", body)),
  approveJobImport: (runId, body) => request(`/api/agent-runs/${runId}/job-import-approval`, json("POST", body)),
  decideToolApproval: (runId, approvalId, decision) => request(`/api/agent-runs/${runId}/approvals/${approvalId}/decision`, json("POST", { decision, decided_by: "local_user" })),
  resolveToolInvocation: (operationId, decision) => request(`/api/tool-invocations/${encodeURIComponent(operationId)}/resolve`, json("POST", { decision, decided_by: "local_user" })),
  renderResume: (resumeId, runId) => request(`/api/resumes/${resumeId}/render`, json("POST", { run_id: runId })),
  uploadResumePdf: (resumeId, pdfBytes, pageCount = 1) => request(`/api/resumes/${resumeId}/pdf`, { method: "PUT", body: pdfBytes, headers: { "Content-Type": "application/pdf", "X-FetchCV-Page-Count": String(pageCount) } }),
  getResume: (resumeId) => request(`/api/resumes/${resumeId}`),
  updateResumeEditor: (resumeId, editorSnapshot) => request(`/api/resumes/${resumeId}/editor`, json("PATCH", { editor_snapshot: editorSnapshot })),
  createPortfolio: (jobId, body) => request(`/api/jobs/${jobId}/portfolios`, json("POST", body)),
  buildPortfolio: (portfolioId, runId) => request(`/api/portfolios/${portfolioId}/build`, json("POST", { run_id: runId, mode: "mock" })),
  publishPortfolio: (portfolioId, runId) => request(`/api/portfolios/${portfolioId}/publish`, json("POST", { run_id: runId })),
  createApplication: (body) => request("/api/applications", json("POST", body)),
  assetUrl: (path) => {
    if (path?.startsWith("http") && !path.startsWith(API_BASE)) return path;
    const url = new URL(path?.startsWith("http") ? path : `${API_BASE}${path}`);
    if (API_TOKEN) url.searchParams.set("fetchcv_token", API_TOKEN);
    return url.toString();
  },
};
