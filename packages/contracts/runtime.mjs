export const RPC_VERSION = 1;
export const MAX_RPC_BYTES = 2 * 1024 * 1024;
export const METHODS = Object.freeze(["agent.turn", "agent.cancel", "agent.task", "agent.steer", "agent.events", "agent.ack"]);

export class ContractError extends Error {
  constructor(code, message = code) { super(message); this.name = "ContractError"; this.code = code; this.retryable = false; }
}
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new ContractError("invalid_payload");
}
function string(value, max, optional = false) {
  if (optional && value === undefined) return;
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ContractError("invalid_payload");
}
function userInput(value) {
  string(value.content, 12000);
  if (value.attachmentPaths !== undefined && (!Array.isArray(value.attachmentPaths) || value.attachmentPaths.length > 10)) throw new ContractError("invalid_attachments");
  for (const path of value.attachmentPaths || []) string(path, 1024);
  if (value.quote != null) {
    keys(value.quote, ["text", "messageId"]);
    string(value.quote.text, 4000); string(value.quote.messageId, 80);
  }
}

export function validateRequest(raw, workspaceId, now = Date.now()) {
  let encoded;
  try { encoded = JSON.stringify(raw); } catch { throw new ContractError("invalid_payload"); }
  if (!encoded || Buffer.byteLength(encoded) > MAX_RPC_BYTES) throw new ContractError("payload_too_large");
  keys(raw, ["v", "id", "method", "workspaceId", "deadlineMs", "payload"]);
  if (raw.v !== RPC_VERSION) throw new ContractError("protocol_version");
  string(raw.id, 80);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(raw.id)) throw new ContractError("invalid_request_id");
  if (!METHODS.includes(raw.method)) throw new ContractError("method_not_allowed");
  if (raw.workspaceId !== workspaceId) throw new ContractError("workspace_mismatch");
  if (!Number.isSafeInteger(raw.deadlineMs) || raw.deadlineMs <= now || raw.deadlineMs > now + 30 * 60 * 1000) throw new ContractError("deadline_invalid");
  const payload = raw.payload;
  const allowed = {
    "agent.turn": ["jobId", "conversationId", "content", "thinkingLevel", "taskKind", "attachmentPaths", "quote"],
    "agent.task": ["runId", "kind"],
    "agent.steer": ["runId", "content", "attachmentPaths", "quote"],
    "agent.cancel": ["requestId"], "agent.events": ["streamId", "afterSeq"], "agent.ack": ["streamId", "afterSeq"],
  };
  keys(payload, allowed[raw.method]);
  if (["agent.turn", "agent.steer"].includes(raw.method)) userInput(payload);
  if (raw.method === "agent.turn") {
    if(Boolean(payload.jobId)===Boolean(payload.conversationId)) throw new ContractError("invalid_target");
    if(payload.conversationId) string(payload.conversationId,80); else string(payload.jobId, 80);
    if (payload.taskKind !== null) string(payload.taskKind, 80, true);
    if (payload.thinkingLevel !== undefined && !["fast", "balanced", "deep"].includes(payload.thinkingLevel)) throw new ContractError("invalid_thinking_level");
  }
  if (["agent.task", "agent.steer"].includes(raw.method)) string(payload.runId, 80);
  if (raw.method === "agent.task" && !["start", "resume", "retry"].includes(payload.kind)) throw new ContractError("invalid_task_kind");
  if (raw.method === "agent.cancel") string(payload.requestId, 80);
  if (["agent.events", "agent.ack"].includes(raw.method)) {
    string(payload.streamId, 80);
    if (!Number.isSafeInteger(payload.afterSeq) || payload.afterSeq < 0) throw new ContractError("invalid_sequence");
  }
  return structuredClone(raw);
}

export function publicError(error) {
  if(error?.code==='model_profile_required')return {code:error.code,retryable:false,message:'请在设置 → 模型 API 中填写此模型的上下文窗口；输入已保留'};
  if(error?.code==='invalid_model_profile')return {code:error.code,retryable:false,message:'模型参数无效，请检查上下文窗口和最大输出'};
  if(error?.code==='context_overflow')return {code:'context_overflow',retryable:false,message:'当前输入或工具定义超出模型预算；输入已保留，请缩短输入或配置已验证的大窗口模型'};
  if (error?.name === "AbortError") return { code: "cancelled", retryable: false, message: "已停止生成" };
  if (error instanceof ContractError) return { code: error.code, retryable: false, message: error.message };
  // Provider exceptions may echo request bodies/credentials. No SDK error or
  // HTTP payload is an application protocol object.
  return { code: "runtime_failed", retryable: false, message: "运行失败，请检查模型配置和本地任务状态" };
}
