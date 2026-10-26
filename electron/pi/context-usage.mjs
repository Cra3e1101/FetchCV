// Inspired by DeepSeek Harness token-meter estimate.ts / projection.ts at
// 22ddee3792402c3e70ec5f86a63c3e3e895a2f60. This is display telemetry only;
// context-budget.mjs still owns conservative request admission and pruning.
import { createHash } from "node:crypto";

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const textTokens = text => Math.ceil(text.length / 4);
const json = value => { try { return JSON.stringify(value) ?? ""; } catch { return null; } };
const mediaTypes = new Set(["image", "image_url", "input_image", "audio", "input_audio", "video", "document", "file", "input_file"]);

function blockTokens(block) {
  if (typeof block === "string") return textTokens(block) + 4;
  if (!block || typeof block !== "object") return 0;
  // Image/audio token costs depend on provider processing. Never estimate the
  // base64 transport as text or imply that an omitted image costs zero tokens.
  if (mediaTypes.has(block.type) || block.source?.type === "base64") return null;
  if (typeof block.text === "string") return textTokens(block.text) + 4;
  if (typeof block.thinking === "string") return textTokens(block.thinking) + 4;
  if (["tool_use", "toolCall", "function"].includes(block.type) || block.function) {
    const call = block.function || block;
    const args = typeof call.arguments === "string" ? call.arguments : json(call.arguments ?? call.input ?? {});
    if (args === null) return null;
    return textTokens(String(call.name || "")) + textTokens(args) + 4;
  }
  if (block.type === "tool_result") {
    const nested = contentTokens(block.content);
    return nested === null ? null : nested + 4;
  }
  const serialized = json(block);
  return serialized === null ? null : textTokens(serialized) + 4;
}

function contentTokens(content) {
  if (content == null) return 0;
  if (typeof content === "string") return textTokens(content) + 4;
  if (!Array.isArray(content)) return blockTokens(content);
  let total = 0;
  for (const block of content) {
    const tokens = blockTokens(block);
    if (tokens === null) return null;
    total += tokens;
  }
  return total;
}

function systemTokens(content) {
  if (content == null) return 0;
  const blocks = Array.isArray(content) ? content : [content];
  let chars = 0;
  for (const block of blocks) {
    if (block && typeof block === "object" && (mediaTypes.has(block.type) || block.source?.type === "base64")) return null;
    const text = typeof block === "string" ? block : typeof block?.text === "string" ? block.text : json(block);
    if (text === null) return null;
    chars += text.length;
  }
  return chars ? Math.ceil(chars / 4) + 4 : 0;
}

export function estimateRequestInputTokens(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.messages)) return null;
  let total = systemTokens(payload.system);
  if (total === null) return null;
  for (const message of payload.messages) {
    if (!message || typeof message !== "object") return null;
    if (message.role === "system" || message.role === "developer") {
      const tokens = systemTokens(message.content);
      if (tokens === null) return null;
      total += tokens;
      continue;
    }
    const tokens = contentTokens(message.content);
    if (tokens === null) return null;
    total += tokens + 4; // Per-message role framing, separate from block framing.
    if (typeof message.reasoning_content === "string") total += textTokens(message.reasoning_content) + 4;
    for (const call of message.tool_calls || []) {
      const tokens = blockTokens(call);
      if (tokens === null) return null;
      total += tokens;
    }
    if (message.function_call) {
      const tokens = blockTokens({ type: "function", ...message.function_call });
      if (tokens === null) return null;
      total += tokens;
    }
  }
  if (payload.tools?.length) {
    const tools = json(payload.tools);
    if (tools === null) return null;
    total += textTokens(tools) + 4;
  }
  return count(total);
}

export function createContextUsageTracker({ model, providerId = null, protocol = "openai", previousSnapshot = null }) {
  let currentModel = model;
  const routeKey = value => json([providerId, protocol, value?.provider, value?.id, value?.api, value?.baseUrl]);
  let route = routeKey(model);
  let sequence = 0;
  let envelope = null;
  let estimate = null;
  let anchor = null;
  let snapshot = null;
  const previous = previousSnapshot?.calibration;
  if (previousSnapshot?.version === 1 && previousSnapshot.scope === "request_input"
    && previousSnapshot.model === model?.id && previousSnapshot.provider_id === providerId && previousSnapshot.protocol === protocol
    && count(previous?.prompt_tokens) > 0 && count(previous?.estimated_tokens) !== null
    && typeof previous?.envelope_hash === "string" && /^[a-f0-9]{64}$/.test(previous.envelope_hash)) {
    envelope = previous.envelope_hash;
    anchor = { prompt: previous.prompt_tokens, estimate: previous.estimated_tokens, envelope };
  }
  const makeSnapshot = (input, output, source, calibrated) => ({
    version: 1,
    model: currentModel?.id || null,
    provider_id: providerId,
    protocol,
    context_window: count(currentModel?.contextWindow),
    input_tokens: input,
    output_tokens: output,
    used_tokens: input,
    source,
    request_sequence: sequence,
    output_reserve: count(currentModel?.maxTokens),
    safety_reserve: count(currentModel?.contextWindow) ? Math.max(1024, Math.ceil(currentModel.contextWindow * .05)) : null,
    calibrated,
    scope: "request_input",
    ...(anchor?.estimate != null && anchor.envelope ? { calibration: {
      prompt_tokens: anchor.prompt, estimated_tokens: anchor.estimate, envelope_hash: anchor.envelope,
    } } : {}),
  });
  return {
    recordRequest(record, payload = record?.payload) {
      currentModel = { ...currentModel,
        id: record?.model?.id ?? currentModel?.id,
        provider: record?.model?.provider ?? currentModel?.provider,
        contextWindow: record?.model?.contextWindow ?? currentModel?.contextWindow,
        maxTokens: record?.model?.maxOutputTokens ?? currentModel?.maxTokens,
      };
      const nextRoute = routeKey(currentModel);
      if (route !== nextRoute) anchor = null;
      route = nextRoute;
      // Tool schemas and provider options can change hidden framing. Only
      // system/messages are eligible for the signed visible-surface delta.
      const header = payload && typeof payload === "object"
        ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "messages" && key !== "system")) : null;
      const encodedEnvelope = json({ route, toolsHash: record?.toolsHash || null, header });
      const nextEnvelope = encodedEnvelope === null ? null : createHash("sha256").update(encodedEnvelope).digest("hex");
      if (envelope !== nextEnvelope || nextEnvelope === null) anchor = null;
      envelope = nextEnvelope;
      sequence = count(record?.sequence) ?? sequence + 1;
      estimate = estimateRequestInputTokens(payload);
      const calibrated = estimate !== null && anchor?.estimate != null;
      const projected = estimate === null ? null : calibrated ? Math.max(0, anchor.prompt + estimate - anchor.estimate) : estimate;
      snapshot = makeSnapshot(count(projected), 0, "estimated", calibrated);
      return snapshot;
    },
    observeResponse(message) {
      if (message?.role !== "assistant" || ["error", "aborted"].includes(message.stopReason)) return snapshot;
      const usage = message.usage;
      const input = count(usage?.input);
      const read = count(usage?.cacheRead ?? 0);
      const write = count(usage?.cacheWrite ?? 0);
      const output = count(usage?.output);
      const prompt = input !== null && read !== null && write !== null ? count(input + read + write) : null;
      // Pi initializes all counters to zero when a compatible endpoint omits
      // usage. A nonempty request cannot establish a zero-token prompt anchor.
      if (prompt === null || prompt === 0) {
        if (snapshot) snapshot = { ...snapshot, output_tokens: output };
        return snapshot;
      }
      anchor = { prompt, estimate, envelope };
      snapshot = makeSnapshot(prompt, output, "reported", true);
      return snapshot;
    },
  };
}
