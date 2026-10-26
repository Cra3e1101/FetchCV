import { resolveModelProfile } from "../../shared/model-profile.mjs";

const tokenCount = value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const contextSnapshot = message => message?.metadata_json?.context_usage
  ?? message?.metadata_json?.usage?.context_usage ?? message?.metadata_json?.runtime?.context_usage;

// Billing is cumulative across a turn; window pressure is a separate snapshot
// of the latest request. Never infer the latter from historical billing totals.
export function getComposerContextUsage(messages = [], runtime, activeProfile, liveContext = null) {
  const currentModel = runtime?.model || activeProfile?.model || null;
  let contextWindow = null;
  if (activeProfile && currentModel) {
    try {
      contextWindow = resolveModelProfile({ ...activeProfile, model: currentModel }, { strict: false }).contextWindow;
    } catch { /* Invalid or incomplete provider settings leave the limit unknown. */ }
  }

  const newestFirst = [...(Array.isArray(messages) ? messages : [])].reverse();
  const latest = newestFirst.find(message =>
    message?.role === "assistant" && (!message.metadata_json?.delivery_status || message.metadata_json.delivery_status === "completed"));
  const reported = latest?.metadata_json?.usage ?? latest?.metadata_json?.runtime;
  const counters = {
    input: tokenCount(reported?.input_tokens),
    output: tokenCount(reported?.output_tokens),
    cacheRead: tokenCount(reported?.cache_read_tokens),
    cacheWrite: tokenCount(reported?.cache_write_tokens),
    total: tokenCount(reported?.total_tokens),
  };
  const usage = Object.values(counters).some(value => value !== null) ? counters : null;
  const usageModel = typeof reported?.model === "string" && reported.model.trim() ? reported.model : null;
  const latestContextMessage = newestFirst.find(message => message?.role === "assistant"
    && (message.metadata_json?.delivery_status !== "streaming" || contextSnapshot(message)));
  const snapshot = liveContext ?? contextSnapshot(latestContextMessage);
  const modelMatches = Boolean(snapshot?.model) && (!currentModel || snapshot.model === currentModel);
  const providerId = runtime?.provider_id || activeProfile?.id;
  const protocol = activeProfile?.protocol || runtime?.protocol;
  const routeMatches = modelMatches && (!providerId || !snapshot.provider_id || providerId === snapshot.provider_id)
    && (!protocol || !snapshot.protocol || protocol === snapshot.protocol);
  const usedTokens = tokenCount(snapshot?.used_tokens);
  const inputTokens = tokenCount(snapshot?.input_tokens);
  const snapshotWindow = tokenCount(snapshot?.context_window);
  let context = null;
  if (routeMatches && snapshot?.version === 1 && ["reported", "estimated"].includes(snapshot.source)
      && usedTokens !== null && inputTokens !== null && usedTokens === inputTokens) {
    // A persisted request also carries its resolved limit, so history remains
    // readable while provider profiles are still loading in the renderer.
    contextWindow ??= snapshotWindow > 0 ? snapshotWindow : null;
    if (contextWindow > 0) context = {
      usedTokens, inputTokens, outputTokens: tokenCount(snapshot.output_tokens), window: contextWindow,
      ratio: usedTokens / contextWindow,
      percent: Math.min(100, Math.round(usedTokens / contextWindow * 100)),
      source: snapshot.source, calibrated: Boolean(snapshot.calibrated), model: snapshot.model,
      requestSequence: tokenCount(snapshot.request_sequence),
      outputReserve: tokenCount(snapshot.output_reserve), safetyReserve: tokenCount(snapshot.safety_reserve),
    };
  }
  return {
    contextWindow,
    usage,
    usageModel,
    modelMismatch: Boolean(currentModel && usageModel && currentModel !== usageModel),
    context,
  };
}
