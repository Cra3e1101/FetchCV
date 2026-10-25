import {resolveModelProfile} from '../../shared/model-profile.mjs';
import {resolveProviderEndpoint} from '../../shared/provider-endpoint.mjs';
import {providerRequestHeaders} from '../../shared/provider-settings.mjs';
export const THINKING_LEVEL = { fast: "low", balanced: "medium", deep: "high" };

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function thinkingOptions(model) {
  if (model.api !== "anthropic-messages" || !model.reasoning) return {};
  // Keep room for visible text/tool arguments inside the configured cap.
  // Smaller models retain half the budget; never invent a larger model limit.
  const reserve = Math.min(8192, Math.floor(model.maxTokens / 2));
  const available = Math.max(0, model.maxTokens - reserve);
  return {thinkingBudgets: Object.fromEntries(Object.entries({
    minimal: 1024, low: 2048, medium: 8192, high: 16384,
  }).map(([level, budget]) => [level, Math.min(budget, available)]))};
}

function createCredentialStore(providerId, apiKey) {
  let credential = { type: "api_key", key: apiKey };
  return {
    async read(id) { return id === providerId ? credential : undefined; },
    async list() { return credential ? [{ providerId, type: "api_key" }] : []; },
    async modify(id, update) {
      if (id !== providerId) return undefined;
      const next = await update(credential);
      if (next !== undefined) credential = next;
      return credential;
    },
    async delete(id) { if (id === providerId) credential = undefined; },
  };
}

export function createProviderAdapter(provider, aiModule, openAiModule, anthropicModule) {
  const protocol = provider.protocol === "anthropic" ? "anthropic" : "openai";
  const api = protocol === "anthropic" ? "anthropic-messages" : "openai-completions";
  const providerId = `fetchcv-${protocol}`;
  const profile = resolveModelProfile(provider);
  const contextWindow = profile.contextWindow, maxTokens = profile.maxOutputTokens;
  const model = {
    id: provider.model,
    name: provider.displayName || provider.model,
    api,
    provider: providerId,
    baseUrl: resolveProviderEndpoint(provider.baseUrl, protocol).sdkBaseUrl,
    reasoning: profile.reasoning,
    input: profile.input,
    cost: ZERO_COST,
    contextWindow,
    maxTokens,
    profileRevision: profile.profileRevision,
    ...(protocol === "openai" ? { compat: { supportsStore: false, ...profile.compat } } : {}),
  };
  const streams = protocol === "anthropic" ? anthropicModule.anthropicMessagesApi() : openAiModule.openAICompletionsApi();
  // Harness 0.80.10 forwards a fixed option list and drops thinkingBudgets.
  // Apply the policy at the registered provider API boundary, where both the
  // harness and the standalone connection probe reach the real SDK.
  const providerApi = typeof streams.streamSimple === "function" ? {
    ...streams,
    streamSimple: (requestModel, context, options) => streams.streamSimple(
      requestModel, context, {...options, ...thinkingOptions(requestModel), headers:{...options?.headers,...providerRequestHeaders(provider,{sdk:true})}},
    ),
  } : streams;
  const models = aiModule.createModels({ credentials: createCredentialStore(providerId, provider.apiKey) });
  models.setProvider(aiModule.createProvider({
    id: providerId,
    name: provider.providerName || "FetchCV provider",
    baseUrl: model.baseUrl,
    models: [model],
    auth: {
      apiKey: {
        name: `${provider.providerName || "FetchCV"} API key`,
        async resolve({ credential }) {
          return credential?.key ? { auth: { apiKey: credential.key }, source: "FetchCV encrypted settings" } : undefined;
        },
      },
    },
    api: providerApi,
  }));
  return {
    protocol,
    model,
    models,
    streamOptions: {
      ...thinkingOptions(model),
      timeoutMs: 90000,
      maxRetries: 2,
      maxRetryDelayMs: 12000,
      metadata: { runtime: "fetchcv-pi-harness" },
    },
  };
}
