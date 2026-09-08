export class ApiError extends Error {
  constructor(message, { status = 0, payload, cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function errorMessage(payload, status) {
  const detail = payload?.error?.message || payload?.detail || payload?.message;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg || "输入内容不符合要求").join("；");
  return `请求失败 (${status})`;
}

// Keep streaming requests separate: their lifetime belongs to the Agent task.
// Mutations are never automatically retried, as they may already have committed.
export function createHttpClient({ baseUrl, token = "", fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  return async function request(path, options = {}) {
    const controller = new AbortController();
    const { signal, timeoutMs: deadline = timeoutMs, ...init } = options;
    let timedOut = false;
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, deadline);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(token ? { "X-FetchCV-Control-Token": token } : {}), ...init.headers },
      });
      const raw = response.status === 204 ? "" : await response.text();
      let payload = raw;
      if (raw && (response.headers.get("content-type") || "").includes("json")) {
        try { payload = JSON.parse(raw); } catch { /* Preserve malformed server responses for diagnostics. */ }
      }
      if (!response.ok) throw new ApiError(errorMessage(payload, response.status), { status: response.status, payload });
      return payload;
    } catch (error) {
      if (timedOut) throw new ApiError("本地服务响应超时，请稍后重试。", { cause: error });
      if (error instanceof ApiError || signal?.aborted) throw error;
      throw new ApiError("无法连接本地服务，请检查服务状态后重试。", { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  };
}
