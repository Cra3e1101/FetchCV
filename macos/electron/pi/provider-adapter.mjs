export const THINKING_LEVEL = { fast: "low", balanced: "medium", deep: "high" };

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function normalizeBaseUrl(value, protocol) {
  let baseUrl = String(value || "").trim().replace(/\/+$/, "");
  if (protocol === "anthropic") return baseUrl.replace(/\/v1\/messages$/i, "").replace(/\/messages$/i, "");
  return baseUrl.replace(/\/v1\/chat\/completions$/i, "/v1").replace(/\/chat\/completions$/i, "");
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
  const model = {
    id: provider.model,
    name: provider.model,
    api,
    provider: providerId,
    baseUrl: normalizeBaseUrl(provider.baseUrl, protocol),
    reasoning: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: 128000,
    maxTokens: 16384,
    ...(protocol === "openai" ? { compat: { supportsStore: false } } : {}),
  };
  const streams = protocol === "anthropic" ? anthropicModule.anthropicMessagesApi() : openAiModule.openAICompletionsApi();
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
    api: streams,
  }));
  return {
    protocol,
    model,
    models,
    streamOptions: {
      timeoutMs: 90000,
      maxRetries: 2,
      maxRetryDelayMs: 12000,
      metadata: { runtime: "fetchcv-pi-harness" },
    },
  };
}
