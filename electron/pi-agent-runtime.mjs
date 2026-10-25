import { randomUUID } from "node:crypto";
import {providerPrivateLiterals} from '../shared/provider-settings.mjs';
import {assertProviderCompletion,emptyProviderResponse,providerFailure} from './pi/provider-failure.mjs';

import { createAgentEvent, updateAgentEvent } from "../shared/agent-events.mjs";
import { toolActivity } from "../shared/tool-activity.mjs";
import { sanitizeOutboundValue, trimToolResult } from "./pi/context-policy.mjs";
import { createFetchCVHarness } from "./pi/fetchcv-harness.mjs";
import { requestConversationTool } from "./pi/conversation-tools.mjs";

const TOOL_LABELS = {
  search_web: "搜索网页",
  read_web_page: "读取网页",
  open_browser_page: "打开网页",
  read_browser_page: "读取当前网页",
  list_workspace_files: "查看工作区文件",
  read_workspace_file: "读取工作区文件",
  search_workspace_text: "搜索工作区",
  read_job_workspace_context: "读取岗位与简历上下文",
  search_interview_knowledge: "检索面试知识库",
  read_interview_source: "读取面经原文",
  discover_interview_sources: "发现面经来源",
  capture_interview_source: "读取面经原文",
  analyze_interview_source: "提取面试问题",
  build_interview_brief: "生成面试简报",
  activate_interview_research: "切换到面试调研",
  inspect_application_workspace: "读取求职工作区",
  prepare_job_review: "形成岗位理解与经历建议",
  prepare_resume_review: "生成简历策略与改写补丁",
  apply_and_verify_resume: "应用并验证简历新版本",
  finalize_resume_version: "完成简历版本",
  write_workspace_file: "写入工作区文件",
  move_workspace_file: "移动工作区文件",
  delete_workspace_file: "删除工作区文件",
  read_skill: "读取 Skill",
};

function toolLabel(name) {
  return TOOL_LABELS[name] || String(name || "调用工具").replaceAll("_", " ");
}

function conciseToolDetail(name, args = {}) {
  const compact = (value, limit = 100) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  };
  if (name === "search_web") return `搜索“${compact(args.query)}”`;
  if (name === "capture_interview_source") return "正在读取并核验一篇公开面经";
  if (name === "discover_interview_sources") return "正在查找与当前公司和岗位相关的公开面经";
  if (name === "analyze_interview_source") return "正在提取有原文依据的面试问题";
  if (name === "build_interview_brief") return "正在归纳共性问题、准备建议与原始链接";
  if (["read_web_page", "open_browser_page"].includes(name)) {
    try { return `读取 ${new URL(String(args.url || "")).hostname}`; } catch { return compact(args.url); }
  }
  if (["read_workspace_file", "write_workspace_file", "delete_workspace_file"].includes(name)) return compact(args.path);
  if (name === "move_workspace_file") return `${compact(args.source_path)} → ${compact(args.destination_path)}`;
  if (name === "search_workspace_text") return `搜索“${compact(args.query)}”`;
  if (name === "read_job_workspace_context") return `读取 ${(args.sections || []).join("、") || "当前岗位"}资料`;
  return compact(Object.values(args)[0]) || "正在执行受控工具";
}

function textFromMessage(message) {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content.filter((item) => item?.type === "text").map((item) => item.text || "").join("");
}

function usageFromMessage(message) {
  const usage = message?.role === "assistant" ? message.usage : null;
  if (!usage) return {};
  return {
    input_tokens: usage.input || 0,
    output_tokens: usage.output || 0,
    reasoning_tokens: usage.reasoning || 0,
    cache_read_tokens: usage.cacheRead || 0,
    cache_write_tokens: usage.cacheWrite || 0,
    total_tokens: usage.totalTokens || 0,
    cost: usage.cost || {},
  };
}

function mergeUsage(total, next) {
  const output = { ...total };
  for (const key of ["input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens"]) {
    output[key] = Number(output[key] || 0) + Number(next[key] || 0);
  }
  output.cost = {
    input: Number(total.cost?.input || 0) + Number(next.cost?.input || 0),
    output: Number(total.cost?.output || 0) + Number(next.cost?.output || 0),
    cacheRead: Number(total.cost?.cacheRead || 0) + Number(next.cost?.cacheRead || 0),
    cacheWrite: Number(total.cost?.cacheWrite || 0) + Number(next.cost?.cacheWrite || 0),
    total: Number(total.cost?.total || 0) + Number(next.cost?.total || 0),
  };
  return output;
}

function toolOutcomeDetail(event) {
  const toolName = event?.toolName || event?.details?.tool_name || event?.result?.details?.tool_name;
  if (toolName === "capture_interview_source") return event?.isError ? "该来源未能读取，失败已记录；后续处理以实际工具结果为准。" : "已保存一篇可核查面经；原文不在过程区展开。";
  if (toolName === "discover_interview_sources") return event?.isError ? "本轮来源发现未完成。" : "候选来源已返回，正在去重和核验。";
  if (toolName === "analyze_interview_source") return event?.isError ? "该来源的问题提取未完成。" : "已提取有原文依据的问题。";
  if (toolName === "build_interview_brief") return event?.isError ? "面试简报尚未生成。" : "共性问题、准备建议和来源链接已形成简报。";
  const details = event?.details || event?.result?.details || {};
  const result = details?.result || details;
  const summary = String(result?.summary || result?.message || "").replace(/\s+/g, " ").trim();
  if (summary) return summary.slice(0, 220);
  if (event?.isError) return "工具执行失败，模型会根据错误调整下一步。";
  const artifacts = Array.isArray(result?.artifacts) ? result.artifacts.length : 0;
  return artifacts ? `工具已返回真实结果，并登记 ${artifacts} 项可追溯记录。` : "工具已返回真实结果。";
}

const TOOL_ERROR_DETAIL_FIELDS = new Set([
  "source_id", "source_ids", "content_hash", "invalid_source_ids", "ready_source_ids", "partial_source_ids",
  "rejected_questions", "question_index", "field", "reason", "preserved_question_count", "missing_coverage",
  "repair_attempts_used", "repair_attempt_limit", "repair_attempts_remaining", "next_action", "recovery_hint",
  "patch_index", "patch_indices", "proposal_id", "proposal_ids", "fact_id", "fact_ids", "claim_index",
  "issues", "fact_issues", "errors", "code", "message", "loc", "type", "msg", "details",
  "unsupported", "missing_qualifiers", "follow_up", "value", "role_escalations", "matches",
  "match_count", "request_id", "current_revision", "expected_revision", "operation_id", "source_run_id",
  "status", "retry_after_ms", "cooldown_until", "rollback_proven", "read_cache_may_remain",
]);
const TOOL_STOP_CODES = new Set(["tool_outcome_unknown", "tool_refresh_failed", "task_not_running", "task_scope_mismatch", "runtime_record_inactive"]);

function errorDetails(value, depth = 0, budget = {remaining: 12000}) {
  if (depth > 6 || budget.remaining <= 0) return undefined;
  if (typeof value === "string") { const text = value.slice(0, Math.min(1200, budget.remaining)); budget.remaining -= text.length; return text; }
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || value === null) { budget.remaining -= 16; return value; }
  if (Array.isArray(value)) return value.slice(0, 80).map(item => errorDetails(item, depth + 1, budget)).filter(item => item !== undefined);
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) => TOOL_ERROR_DETAIL_FIELDS.has(key))
    .map(([key, item]) => { budget.remaining -= key.length; return [key, errorDetails(item, depth + 1, budget)]; }).filter(([, item]) => item !== undefined));
}

// The SDK turns a thrown Error.message into an isError tool result. A normal
// return would incorrectly mark a rejected operation as successful.
export function modelToolFailure(error, toolName, args = {}, privacy = {}) {
  const schemaErrors = Array.isArray(error?.payload?.detail) ? error.payload.detail : null;
  const payload = schemaErrors ? {code: "tool_input_invalid", message: "工具参数不符合 Schema，请按 loc 修改对应字段。",
    retryable: true, details: {errors: schemaErrors}} : error?.payload?.error || error?.payload?.detail || error?.payload || {};
  const code = String(payload?.code || error?.code || "tool_request_failed").slice(0, 120);
  const details = errorDetails(payload?.details) || {};
  if (toolName === "analyze_interview_source" && typeof args.source_id === "string" && !details.source_id) details.source_id = args.source_id.slice(0, 80);
  let nextAction = details.next_action;
  if (!nextAction && code === "tool_permission_denied") nextAction = "await_user_permission";
  if (!nextAction && /approval_required|approval_denied|approval_revision_conflict/.test(code)) nextAction = "await_user_review";
  if (!nextAction && /ocr/.test(code)) nextAction = "await_user_ocr_review";
  if (!nextAction && /public_access|cooldown|captcha|login|rate_limit/.test(code)) nextAction = "continue_other_sources_after_access_stop";
  if (!nextAction && /source_not_found|source_unreadable/.test(code)) nextAction = "continue_other_sources";
  if (TOOL_STOP_CODES.has(code)) nextAction = "stop_and_reconcile";
  const nonRetryable = TOOL_STOP_CODES.has(code) || /permission_denied|approval|verified_fact_required|ocr|public_access|cooldown|captcha|login|rate_limit|source_not_found/.test(code);
  const safe = sanitizeOutboundValue({
    code, message: String(payload?.message || error?.message || "工具请求失败").slice(0, 1600),
    retryable: payload?.retryable === true && !nonRetryable, tool_name: toolName,
    details: {...details, ...(nextAction ? {next_action: nextAction} : {})},
  }, {...privacy, mode: "redacted_remote"});
  return Object.assign(new Error(JSON.stringify(safe)), {code, payload: safe});
}

async function apiRequest(apiBase, controlToken, path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-fetchcv-control-token": controlToken,
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { message: raw }; }
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.detail || payload?.error?.message || `本地 Agent 服务返回 ${response.status}`);
    error.code = payload?.code || payload?.error?.code || "pi_bridge_failed";
    error.payload = payload;
    throw error;
  }
  return payload;
}

export class FetchCVAgentHost {
  constructor({ getApiBase = () => '', getControlToken = () => '', getApprovalKey = () => '', getProviderConfig, loadModules = null, request = apiRequest, confirmWebTool = null }) {
    this.getApiBase = getApiBase;
    this.getControlToken = getControlToken;
    this.getApprovalKey = getApprovalKey;
    this.getProviderConfig = getProviderConfig;
    this.loadModules = loadModules;
    this.request = request;
    this.confirmWebTool = confirmWebTool;
    this.active = new Map();
    this.activeTasks = new Map();
    this.taskInputs = new Map();
    this.taskInputReferences = new Map();
    this.cancelledRequests = new Set();
    this.modulesPromise = null;
    this.hostId = `electron:${randomUUID()}`;
  }

  warm() {
    this.modulesPromise ||= this.loadModules
      ? this.loadModules()
      : Promise.all([
        import("@earendil-works/pi-agent-core"),
        import("@earendil-works/pi-agent-core/node"),
        import("@earendil-works/pi-ai"),
        import("@earendil-works/pi-ai/api/openai-completions.lazy"),
        import("@earendil-works/pi-ai/api/anthropic-messages.lazy"),
      ]);
    return this.modulesPromise;
  }

  async reconcileTasks() {
    return this.request(this.getApiBase(), this.getControlToken(), "/api/pi/hosts/reconcile", {
      method: "POST",
      body: JSON.stringify({ host_id: this.hostId }),
    });
  }

  cancel(requestId) {
    this.cancelledRequests.add(requestId);
    void this.active.get(requestId)?.abort();
  }

  async startTask({ runId, kind = "resume", requestId = randomUUID(), onSettled = () => {} }, emit = () => {}) {
    const apiBase = this.getApiBase();
    const controlToken = this.getControlToken();
    const provider = this.getProviderConfig(requestId);
    if (!provider?.apiKey || !provider?.model || !provider?.baseUrl) throw new Error("请先在设置中连接并启用一个模型");
    const bootstrap = await this.request(apiBase, controlToken, `/api/pi/runs/${encodeURIComponent(runId)}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        kind,
        request_id: requestId,
        host_id: this.hostId,
        provider: {
          provider_name: provider.providerName || "Custom provider",
          protocol: provider.protocol || "openai",
          base_url: provider.baseUrl,
          model: provider.model,
        },
      }),
    });
    void this.run({ requestId, mode: "task", runId, kind, bootstrap, thinkingLevel: "deep" }, emit).catch(() => {}).finally(onSettled);
    return bootstrap.task;
  }

  async steerTask(runId, input) {
    const harness = this.activeTasks.get(runId);
    if (!harness) throw new Error("当前任务已经停下，请作为新消息发送");
    const apiBase = this.getApiBase();
    const controlToken = this.getControlToken();
    const stored = await this.request(apiBase, controlToken, `/api/pi/runs/${encodeURIComponent(runId)}/steer`, {
      method: "POST",
      body: JSON.stringify({
        content: input.content,
        attachment_paths: input.attachmentPaths || [],
        quoted_text: input.quote?.text || null,
        quoted_message_id: input.quote?.messageId || null,
      }),
    });
    const acknowledge = (state) => this.request(apiBase, controlToken, `/api/pi/inputs/${encodeURIComponent(stored.message.id)}/state`, {
      method: "POST", body: JSON.stringify({ state }),
    });
    if (this.activeTasks.get(runId) !== harness) {
      await acknowledge("unconsumed");
      throw new Error("当前任务已经停下，补充内容已保存，请作为新消息发送");
    }
    const pending = this.taskInputs.get(runId);
    const marker = `[FetchCV input ${stored.message.id}]`;
    pending.set(stored.message.id, { marker, acknowledge });
    const text=`${marker}\n${stored.prompt}`;
    this.taskInputReferences.get(runId).set(stored.message.id,{id:stored.message.id,text});
    try { await harness.steer(text); }
    catch (error) { await acknowledge("unconsumed"); pending.delete(stored.message.id); throw error; }
    return stored;
  }

  async run(input, emit) {
    const startedAt = Date.now();
    const apiBase = this.getApiBase();
    const controlToken = this.getControlToken();
    const provider = this.getProviderConfig(input.requestId);
    if (!provider?.apiKey || !provider?.model || !provider?.baseUrl) throw new Error("请先在设置中连接并启用一个模型");

    const taskMode = input.mode === "task";
    let effectiveTaskKind = input.taskKind || null;
    const turnPath = input.conversationId ? `/api/pi/conversations/${encodeURIComponent(input.conversationId)}/turns` : `/api/pi/jobs/${encodeURIComponent(input.jobId)}/turns`;
    const bootstrap = input.bootstrap || await this.request(apiBase, controlToken, turnPath, {
      method: "POST",
      body: JSON.stringify({
        content: input.content,
        request_id: input.requestId,
        host_id: this.hostId,
        thinking_level: input.thinkingLevel || "balanced",
        task_kind: input.taskKind || null,
        attachment_paths: input.attachmentPaths || [],
        quoted_text: input.quote?.text || null,
        quoted_message_id: input.quote?.messageId || null,
        provider: {
          provider_name: provider.providerName || "Custom provider",
          protocol: provider.protocol || "openai",
          base_url: provider.baseUrl,
          model: provider.model,
        },
      }),
    });
    let harness;
    let setRecoveryState = () => {};
    let recoveryRequestsInFlight = 0;
    let recoveryRefreshFailed = false;
    let capabilityRefreshError = null;
    let fatalToolError = null;
    let checkpointTimer = null;
    let taskControlTimer = null;
    let taskControlSignal = null;
    let persistCheckpoint;
    let unsubscribe;
    const pendingInputs = new Map();
    const inputReferences = new Map();
    try {
      bootstrap.outbound_privacy = {
        ...(bootstrap.outbound_privacy || {}),
        literals: [...new Set([...(bootstrap.outbound_privacy?.literals || []), ...providerPrivateLiterals(provider,{sensitiveOnly:true})].filter(Boolean))],
      };
      if (!taskMode) emit("user", { message: bootstrap.user });

      const modules = await this.warm();
      const Type = modules[2].Type;

      const processing = new Map();
      const toolNames = new Map();
      const traceOrder = [];
      const reasoningBuffers = new Map();
      let turnNumber = 0;
      let streamedText = "";
      let turnText = "";
      let turnHadTool = false;
      let usage = {};
      const toolReceipts = [];
      let checkpointSequence = Number(bootstrap.prior_checkpoint?.sequence || 0);
      let checkpointPhase = "starting";
      let eventSequence = 0;
      const eventScope = () => ({
        thread_id: bootstrap.job_id || bootstrap.run_id,
        run_id: bootstrap.run_id,
        turn_id: `${bootstrap.user?.id || bootstrap.task_id || input.requestId}:${turnNumber || 1}`,
      });

      persistCheckpoint = async (phase = checkpointPhase, immediate = false) => {
        if (!taskMode) return;
        checkpointPhase = phase;
        const save = async () => {
          checkpointTimer = null;
          checkpointSequence += 1;
          await this.request(apiBase, controlToken, `/api/pi/tasks/${encodeURIComponent(bootstrap.task_id)}/checkpoint`, {
            method: "POST",
            body: JSON.stringify({
              sequence: checkpointSequence,
              turn_number: turnNumber,
              phase: checkpointPhase,
              partial_text: streamedText.slice(-12000),
              processing_trace: traceOrder.slice(-40).map((id) => processing.get(id)),
              tool_receipts: toolReceipts.slice(-400),
              capability_fingerprint: bootstrap.capability_fingerprint || undefined,
            }),
          });
        };
        if (immediate) {
          if (checkpointTimer) clearTimeout(checkpointTimer);
          checkpointTimer = null;
          await save();
          return;
        }
        if (!checkpointTimer) {
          checkpointTimer = setTimeout(() => { void save().catch(() => {}); }, 280);
        }
      };

      const updateTrace = (id, patch) => {
        const current = processing.get(id);
        const next = current
          ? updateAgentEvent(current, patch, eventScope())
          : createAgentEvent(
            { id, ...patch, sequence: ++eventSequence },
            { ...eventScope(), sequence: eventSequence },
          );
        if (!current) traceOrder.push(id);
        processing.set(id, next);
        emit("reasoning", { event: next });
        void persistCheckpoint(next.status === "active" ? "working" : "observing");
        return next;
      };
      const completeActiveModelStep = (detail) => {
        const id = `model-turn-${turnNumber}`;
        const current = processing.get(id);
        if (current?.status === "active") updateTrace(id, { status: "completed", detail: detail || current.detail });
      };
      const updateToolReceipt = (toolCallId, patch) => {
        const index = toolReceipts.findIndex((item) => item.tool_call_id === toolCallId);
        const receipt = {
          tool_call_id: toolCallId,
          tool_name: toolNames.get(toolCallId) || "tool",
          status: "running",
          summary: "",
          artifacts: [],
          requires_user_action: false,
          ...(index < 0 ? {} : toolReceipts[index]),
          ...patch,
        };
        if (index < 0) toolReceipts.push(receipt);
        else toolReceipts[index] = receipt;
        emit("tool_receipt", { receipt });
        return receipt;
      };
      const recordToolReceipt = (event) => {
        // A backend operation may have succeeded before the tool-list refresh
        // failed. The SDK's subsequent error must not erase that real outcome.
        if (toolReceipts.some((item) => item.tool_call_id === event.toolCallId && item.status === "completed_refresh_failed")) return;
        const result = event?.result?.details?.result || event?.details?.result || event?.result?.details || event?.details || {};
        const reference = event?.result?.details?.result_reference || event?.details?.result_reference;
        const recordedActivity = toolReceipts.find(item => item.tool_call_id === event.toolCallId)?.activity;
        const activity = recordedActivity || toolActivity(event.toolName || toolNames.get(event.toolCallId), {}, sanitizeOutboundValue(result, bootstrap.outbound_privacy));
        updateToolReceipt(event.toolCallId, {
          ...(activity ? {activity} : {}),
          tool_name: event.toolName || toolNames.get(event.toolCallId) || event?.details?.tool_name || "tool",
          status: event.isError ? "failed" : "completed",
          summary: String(result?.summary || result?.message || toolOutcomeDetail(event)).slice(0, 500),
          artifacts: Array.isArray(result?.artifacts) ? result.artifacts.slice(0, 24) : [],
          requires_user_action: Boolean(result?.requires_user_action),
          ...(reference ? { result_reference: reference } : {}),
        });
      };

      const makeTools = (definitions) => (definitions || []).map((definition) => {
        const outboundDefinition = sanitizeOutboundValue(definition, bootstrap.outbound_privacy);
        return ({
        name: outboundDefinition.name,
        label: toolLabel(outboundDefinition.name),
        description: outboundDefinition.description || outboundDefinition.name,
        parameters: typeof Type.Unsafe === "function" ? Type.Unsafe(outboundDefinition.input_schema || { type: "object" }) : outboundDefinition.input_schema,
        executionMode: definition.side_effect ? "sequential" : "parallel",
        execute: async (toolCallId, args, signal, onUpdate) => {
          if (capabilityRefreshError) throw capabilityRefreshError;
          if (fatalToolError) throw fatalToolError;
          signal?.throwIfAborted();
          let recoveryRefreshed = false;
          if (taskMode) {
            if (!recoveryRequestsInFlight) recoveryRefreshFailed = false;
            recoveryRequestsInFlight += 1;
            setRecoveryState(undefined, { stale: true });
          }
          try {
          onUpdate?.({ content: [{ type: "text", text: "工具已通过参数校验，正在执行。" }], details: { phase: "executing" } });
          const toolScope = taskMode ? "task-tools" : "tools";
          const requestTool = (payload) => {
            if (payload.approval_token) {
              emit("status", { label: toolLabel(definition.name) });
              onUpdate?.({ content: [{ type: "text", text: "已获批准，正在执行工具。" }], details: { phase: "executing" } });
            }
            return this.request(apiBase, controlToken, (bootstrap.standalone ? `/api/pi/chat-tools/${encodeURIComponent(bootstrap.user.id)}/${encodeURIComponent(definition.name)}` : `/api/pi/runs/${encodeURIComponent(bootstrap.run_id)}/${toolScope}/${encodeURIComponent(definition.name)}`), {
              method: "POST",
              body: JSON.stringify(payload),
              signal,
            });
          };
          const payload = {
              arguments: args,
              idempotency_key: `pi:${taskMode ? bootstrap.task_id : bootstrap.user.id}:${toolCallId}`,
              tool_revision: definition.revision,
              ...(taskMode ? { task_id: bootstrap.task_id } : { task_kind: effectiveTaskKind }),
          };
          let response;
          try {
            response = bootstrap.standalone
              ? await requestConversationTool({ request: requestTool, toolName: definition.name, payload, signal, confirm: this.confirmWebTool,
              approvalKey: this.getApprovalKey(), messageId: bootstrap.user.id,
              onWaiting: () => {
                emit("status", { label: "等待联网批准" });
                onUpdate?.({ content: [{ type: "text", text: "等待用户批准本次联网。" }], details: { phase: "awaiting_approval" } });
              } })
              : await requestTool(payload);
          } catch (error) {
            if (error?.name === "AbortError" || signal?.aborted) throw error;
            const failure = modelToolFailure(error, definition.name, args, bootstrap.outbound_privacy);
            if (TOOL_STOP_CODES.has(failure.code)) {
              fatalToolError = failure;
              void harness?.abort();
            }
            throw failure;
          }
          if (taskMode || (response.task_kind && Array.isArray(response.tools))) {
            try {
              // tool_result is a Harness hook, not a subscribe event. Refresh
              // here, before the next turn is prepared; preserve current-batch semantics.
              const refreshed = Array.isArray(response.tools) ? response :
                await this.request(apiBase, controlToken, `/api/pi/runs/${encodeURIComponent(bootstrap.run_id)}/task-tools`, {signal});
              const definitions = refreshed.tools;
              if (!Array.isArray(definitions)) throw new Error("工具清单响应无效");
              if (!taskMode) effectiveTaskKind = response.task_kind;
              const nextTools = makeTools(definitions);
              await harness.setTools(nextTools, nextTools.map((tool) => tool.name));
              if (taskMode && refreshed.recovery_state && typeof refreshed.recovery_state === "object" && !Array.isArray(refreshed.recovery_state)) {
                recoveryRefreshed = setRecoveryState(refreshed.recovery_state, { stale: true });
              }
            } catch (error) {
              // A completed side effect must never be hidden by continuing
              // with stale tools. Stop the loop; backend receipts remain authoritative.
              capabilityRefreshError = Object.assign(new Error("工具已返回，但能力清单刷新失败；请核对执行记录后继续", {cause:error}),
                {code:"tool_refresh_failed"});
              updateToolReceipt(toolCallId, {
                tool_name: definition.name,
                status: "completed_refresh_failed",
                summary: String(response.result?.summary || "后端工具已完成，后续能力刷新失败").slice(0, 500),
                artifacts: response.result?.artifacts || [],
                requires_user_action: Boolean(response.result?.requires_user_action),
                ...(response.result_reference ? { result_reference: response.result_reference } : {}),
              });
              void harness?.abort();
              throw capabilityRefreshError;
            }
          }
          return {
            content: [{ type: "text", text: trimToolResult(response.result, 50000, response.result_reference || null) }],
            details: {
              tool_name: definition.name,
              result: response.result,
              next_tools: response.tools,
              task_kind: response.task_kind,
              result_reference: response.result_reference,
            },
          };
          } finally {
            if (taskMode) {
              recoveryRequestsInFlight -= 1;
              if (!recoveryRefreshed) recoveryRefreshFailed = true;
              setRecoveryState(undefined, { stale: recoveryRequestsInFlight > 0 || recoveryRefreshFailed });
            }
          }
        },
      });
      });
      const tools = makeTools(bootstrap.tools);

      const created = await createFetchCVHarness({
        bootstrap,
        provider,
        thinkingLevel: input.thinkingLevel,
        tools,
        modules,
        taskMode,
        getInputReferences: () => [...inputReferences.values()],
        assertCapabilities: () => { if (capabilityRefreshError) throw capabilityRefreshError; if (fatalToolError) throw fatalToolError; },
        recordRequest: async record => {
          if (this.cancelledRequests.has(input.requestId) || taskControlSignal) throw Object.assign(new Error("已停止生成"), { name: "AbortError" });
          const kind = taskMode ? "task" : "turn";
          const id = taskMode ? bootstrap.task_id : bootstrap.user.id;
          await this.request(apiBase, controlToken, (bootstrap.standalone ? `/api/pi/chat-records/${encodeURIComponent(id)}/requests` : `/api/pi/records/${kind}/${encodeURIComponent(id)}/requests`), {
            method: "POST", body: JSON.stringify({ sequence: record.sequence, record }),
          });
        },
        onContext: async messages => {
          // A queue count change alone is not proof of consumption. Confirm
          // the application's unique input ID in the actual model context.
          const visible = JSON.stringify(messages);
          for (const [id, item] of pendingInputs) {
            if (!visible.includes(item.marker)) continue;
            await item.acknowledge("consumed"); pendingInputs.delete(id);
          }
        },
      });
      harness = created.harness;
      setRecoveryState = created.setRecoveryState;
      const { protocol } = created;
      this.active.set(input.requestId, harness);
      if (taskMode) { this.activeTasks.set(bootstrap.run_id, harness); this.taskInputs.set(bootstrap.run_id, pendingInputs); this.taskInputReferences.set(bootstrap.run_id,inputReferences); }
      let taskControlBusy = false;
      taskControlTimer = taskMode ? setInterval(() => {
        if (taskControlBusy || taskControlSignal) return;
        taskControlBusy = true;
        void this.request(apiBase, controlToken, `/api/pi/tasks/${encodeURIComponent(bootstrap.task_id)}/control`)
          .then((state) => {
            if (state.signal) {
              taskControlSignal = state.signal;
              void harness.abort();
            }
          })
          .catch(() => {})
          .finally(() => { taskControlBusy = false; });
      }, 350) : null;
      unsubscribe = harness.subscribe(async (event) => {
        if (event.type === "turn_start") {
          turnNumber += 1;
          turnText = "";
          turnHadTool = false;
          const label = turnNumber === 1 ? "正在分析请求" : "正在核对工具结果";
          const detail = turnNumber === 1 ? "结合当前对话判断是否需要调用工具。" : "根据刚取得的真实结果决定下一步。";
          updateTrace(`model-turn-${turnNumber}`, { kind: "model", label, detail, status: "active" });
          emit("status", { label });
        }
        if (event.type === "message_update") {
          const update = event.assistantMessageEvent;
          if (update.type === "thinking_delta") {
            const id = `model-turn-${turnNumber}`;
            const previous = Number(reasoningBuffers.get(id) || 0);
            reasoningBuffers.set(id, previous + String(update.delta || "").length);
            updateTrace(id, {
              kind: "model",
              label: "模型正在推理",
              detail: "正在结合目标、上下文和最新工具结果决定下一步。",
              status: "active",
            });
          }
          if (update.type === "text_delta") {
            completeActiveModelStep("已形成回答方向，正在组织内容。");
            turnText += update.delta;
            emit("status", { label: "正在生成回答" });
            void persistCheckpoint("responding");
          }
        }
        if (event.type === "tool_execution_start") {
          turnHadTool = true;
          turnText = "";
          toolNames.set(event.toolCallId, event.toolName);
          completeActiveModelStep(`已决定调用“${toolLabel(event.toolName)}”。`);
          updateTrace(`tool-${event.toolCallId}`, {
            kind: "tool",
            label: toolLabel(event.toolName),
            detail: conciseToolDetail(event.toolName, event.args),
            status: "active",
          });
          updateToolReceipt(event.toolCallId, {
            tool_name: event.toolName,
            status: "running",
            activity: toolActivity(event.toolName, sanitizeOutboundValue(event.args || {}, bootstrap.outbound_privacy)),
            summary: conciseToolDetail(event.toolName, event.args),
          });
          emit("status", { label: toolLabel(event.toolName) });
        }
        if (event.type === "tool_execution_update") {
          const waiting = event.partialResult?.details?.phase === "awaiting_approval";
          const detail = waiting ? "等待用户批准本次联网。" : conciseToolDetail(event.toolName, event.args);
          updateTrace(`tool-${event.toolCallId}`, { kind: "tool", status: "active", detail });
          updateToolReceipt(event.toolCallId, {
            tool_name: event.toolName || toolNames.get(event.toolCallId) || "tool",
            status: waiting ? "awaiting_approval" : "running",
            summary: detail,
            requires_user_action: waiting,
          });
        }
        if (event.type === "tool_execution_end") {
          updateTrace(`tool-${event.toolCallId}`, {
            kind: "tool",
            status: toolReceipts.some(item => item.tool_call_id === event.toolCallId && item.status === "completed_refresh_failed")
              ? "completed" : event.isError ? "failed" : "completed",
            detail: toolOutcomeDetail(event),
          });
          recordToolReceipt(event);
        }
        if (event.type === "queue_update") {
          emit("queue", {
            steering: event.steer?.length || 0,
            follow_up: event.followUp?.length || 0,
            next_turn: event.nextTurn?.length || 0,
          });
        }
        if (event.type === "turn_end") {
          usage = mergeUsage(usage, usageFromMessage(event.message));
          if (!turnHadTool) {
            const answer = textFromMessage(event.message).trim() || turnText.trim();
            if (answer) {
              streamedText = answer;
              emit("delta", { text: answer });
            }
          }
        }
      });

      emit("status", { label: `正在由 ${provider.providerName || provider.model} 执行本轮任务` });
      const checkCancelled = () => {
        if (this.cancelledRequests.has(input.requestId) || taskControlSignal) {
          const error = new Error("已停止生成");
          error.name = "AbortError";
          throw error;
        }
      };
      checkCancelled();
      let finalMessage;
      try { finalMessage = await harness.prompt(bootstrap.prompt); }
      catch (error) { if (capabilityRefreshError) throw capabilityRefreshError; if (fatalToolError) throw fatalToolError; created.assertAssembly?.(); throw providerFailure(error); }
      if (capabilityRefreshError) throw capabilityRefreshError;
      if (fatalToolError) throw fatalToolError;
      created.assertAssembly?.();
      // Harness.abort() can settle normally. A resolved prompt is not proof
      // of completion, and short tasks may finish before the control timer.
      if (taskMode) {
        const state = await this.request(apiBase, controlToken, `/api/pi/tasks/${encodeURIComponent(bootstrap.task_id)}/control`);
        taskControlSignal ||= state.signal;
      }
      checkCancelled();
      assertProviderCompletion(finalMessage);
      completeActiveModelStep("本轮处理完成。");
      let finalText = streamedText.trim();
      if (!finalText) {
        finalText = textFromMessage(finalMessage).trim();
        if (finalText) emit("delta", { text: finalText });
      }
      if (!finalText) throw emptyProviderResponse();
      await persistCheckpoint("finalizing", true);
      checkCancelled();
      const completionPath = taskMode
        ? `/api/pi/tasks/${encodeURIComponent(bootstrap.task_id)}/complete`
        : `/api/pi/${bootstrap.standalone ? "chat-turns" : "turns"}/${encodeURIComponent(bootstrap.user.id)}/complete`;
      const completed = await this.request(apiBase, controlToken, completionPath, {
        method: "POST",
        body: JSON.stringify({
          content: finalText,
          usage: { ...usage, provider: provider.providerName, model: provider.model, protocol, runtime: "pi" },
          processing_trace: traceOrder.map((id) => processing.get(id)),
          tool_receipts: toolReceipts,
          processing_duration_ms: Math.max(1, Date.now() - startedAt),
          ...(taskMode ? {} : { task_kind: effectiveTaskKind }),
        }),
      });
      emit("done", completed);
      return completed;
    } catch (error) {
      const cancelled = this.cancelledRequests.has(input.requestId) || taskControlSignal === "pause" || taskControlSignal === "cancel" || error?.name === "AbortError";
      if (taskMode) {
        if (persistCheckpoint) await persistCheckpoint(cancelled ? "interrupted" : "failed", true).catch(() => {});
        await this.request(apiBase, controlToken, `/api/pi/tasks/${encodeURIComponent(bootstrap.task_id)}/fail`, {
          method: "POST",
          body: JSON.stringify({ status: taskControlSignal === "pause" ? "paused" : taskControlSignal === "cancel" || cancelled ? "cancelled" : "failed", message: sanitizeOutboundValue(String(error?.message || error), { mode: "redacted_remote", literals: providerPrivateLiterals(provider) }) }),
        }).catch(() => {});
      } else {
        await this.request(apiBase, controlToken, `/api/pi/${bootstrap.standalone ? "chat-turns" : "turns"}/${encodeURIComponent(bootstrap.user.id)}/fail`, {
          method: "POST",
          body: JSON.stringify({ delivery_status: cancelled ? "cancelled" : "failed", message: sanitizeOutboundValue(String(error?.message || error), { mode: "redacted_remote", literals: providerPrivateLiterals(provider) }) }),
        }).catch(() => {});
      }
      if (cancelled) {
        const abortError = new Error("已停止生成");
        abortError.name = "AbortError";
        throw abortError;
      }
      throw error;
    } finally {
      if (checkpointTimer) clearTimeout(checkpointTimer);
      if (taskControlTimer) clearInterval(taskControlTimer);
      if (typeof unsubscribe === "function") unsubscribe();
      const inputState = this.cancelledRequests.has(input.requestId) || taskControlSignal ? "cancelled" : "unconsumed";
      try {
        for (const item of pendingInputs.values()) await item.acknowledge(inputState);
      } finally {
        this.active.delete(input.requestId);
        this.cancelledRequests.delete(input.requestId);
        if (taskMode && this.activeTasks.get(bootstrap.run_id) === harness) { this.activeTasks.delete(bootstrap.run_id); this.taskInputs.delete(bootstrap.run_id); this.taskInputReferences.delete(bootstrap.run_id); }
      }
    }
  }
}

// Backward-compatible export for the Electron bootstrap and existing tests.
// The runtime is now an application host around Pi Core, not a replacement
// implementation of Pi's agent loop.
export { FetchCVAgentHost as PiAgentRuntime };

export function createPiRequestId() {
  return randomUUID();
}
