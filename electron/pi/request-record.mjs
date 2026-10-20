import { createHash } from "node:crypto";
import { sanitizeOutboundValue } from "./context-policy.mjs";
import {contextBudget} from './context-budget.mjs';

export function prepareRequestRecord(payload, { model, privacy, tools, sequence, contextManifest=null }) {
  const sanitized = sanitizeOutboundValue(payload, privacy);
  const encoded = JSON.stringify(sanitized);
  const hash = value => createHash("sha256").update(value).digest("hex");
  const exclusions = [];
  const recordView = (value, location = "payload") => {
    if (Array.isArray(value)) return value.flatMap((item, index) => {
      if (["thinking", "redacted_thinking", "reasoning"].includes(item?.type)) { exclusions.push(`${location}[${index}]`); return []; }
      return [recordView(item, `${location}[${index}]`)];
    });
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
      if (["thinking", "reasoning_content", "reasoning_details", "chain_of_thought"].includes(key)) { exclusions.push(`${location}.${key}`); return []; }
      return [[key, recordView(child, `${location}.${key}`)]];
    }));
    return value;
  };
  const recordedPayload = recordView(sanitized);
  // UTF-8 bytes are deliberately a conservative token allowance, not a
  // tokenizer measurement. Reserve the configured output allowance first.
  const budget=contextBudget(model),inputAllowance=budget.inputAllowance;
  if (!Number.isFinite(inputAllowance) || inputAllowance <= 0 || Buffer.byteLength(encoded) > inputAllowance) {
    const error = new Error("当前输入和工具定义超出模型预算，请减少输入或选择已确认的大窗口模型");
    error.code = "context_overflow";
    throw error;
  }
  return { payload: sanitized, record: {
    v: 1, sequence, model: { id: model.id, provider: model.provider, contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens },
    profileRevision: model.profileRevision||"explicit-model-profile-v1", redactionRevision: "fetchcv-redaction-v1", budgetEstimator: budget.estimator,
    budget:{...budget,actualPayloadBytes:Buffer.byteLength(encoded)},contextManifest,
    toolsHash: hash(JSON.stringify(tools.map(tool => ({ name: tool.name, parameters: tool.parameters })))),
    payloadHash: hash(encoded), payload: recordedPayload, exclusions,
    reconstruction: exclusions.length ? "unavailable_internal_reasoning_excluded" : "exact_redacted_payload",
  } };
}
