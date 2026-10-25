const WEB_READY = Object.freeze({ state: "ready", dataReady: true, agentReady: true, message: "", agentError: "" });

export function normalizeBackendStatus(status = {}) {
  const dataReady = status.dataReady ?? status.state === "ready";
  return {
    ...status,
    dataReady: Boolean(dataReady),
    // Older preload versions only expose state. Explicit false always wins.
    agentReady: Boolean(dataReady && (status.agentReady ?? status.state === "ready")),
  };
}

export async function readBackendStatus(runtime = globalThis.window?.appRuntime) {
  if (!runtime?.getBackendStatus) return WEB_READY;
  return normalizeBackendStatus(await runtime.getBackendStatus());
}

export async function requireAgentReady(runtime = globalThis.window?.appRuntime) {
  const status = await readBackendStatus(runtime);
  if (status.agentReady) return;
  const error = new Error(status.agentError || status.message || "本地 Agent 正在准备，暂时只能浏览已有资料，请稍后重试。");
  error.code = "agent_not_ready";
  throw error;
}

export function withBackendReadiness(request, getRuntime = () => globalThis.window?.appRuntime) {
  return async (path, options = {}) => {
    if (!["GET", "HEAD", "OPTIONS"].includes((options.method || "GET").toUpperCase())) {
      await requireAgentReady(getRuntime());
    }
    return request(path, options);
  };
}
