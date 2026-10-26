import assert from "node:assert/strict";
import test from "node:test";
import { getComposerContextUsage } from "../src/lib/composer-context.js";

const response = (usage, delivery_status = "completed") => ({ role: "assistant", metadata_json: { runtime: usage, delivery_status } });
const profile = {
  model: "custom-model", baseUrl: "https://example.com/v1", protocol: "openai",
  modelProfiles: { "custom-model": { contextWindow: 128000, maxOutputTokens: 8192 } },
};

test("unknown telemetry remains unknown instead of showing a zero occupancy", () => {
  assert.deepEqual(getComposerContextUsage([], {}, null), { contextWindow: null, usage: null, usageModel: null, modelMismatch: false, context: null });
});

test("reports latest completed turn without mixing it with live or failed output", () => {
  const result = getComposerContextUsage([
    response({ input_tokens: 10, total_tokens: 12 }),
    response({ model: "custom-model", input_tokens: 280000, output_tokens: 15000, cache_read_tokens: 160000, cache_write_tokens: 2000, total_tokens: 457000 }),
    response({ input_tokens: 3 }, "streaming"),
    response({ input_tokens: 4 }, "failed"),
  ], { model: "custom-model" }, profile);
  assert.equal(result.contextWindow, 128000);
  assert.deepEqual(result.usage, { input: 280000, output: 15000, cacheRead: 160000, cacheWrite: 2000, total: 457000 });
  assert.equal(result.usageModel, "custom-model");
  assert.equal(result.modelMismatch, false);
  assert.equal("percentage" in result, false, "cumulative turn usage must not become a context percentage");
  assert.equal(result.context, null);
});

test("latest completed response without telemetry does not reuse old usage", () => {
  assert.equal(getComposerContextUsage([response({ total_tokens: 500 }), response({ model: "custom-model" })]).usage, null);
});

test("standalone conversation usage is read from the completion payload", () => {
  const result = getComposerContextUsage([{ role: "assistant", metadata_json: {
    delivery_status: "completed", usage: { model: "custom-model", input_tokens: 1250, output_tokens: 420, cache_read_tokens: 800, cache_write_tokens: 0, total_tokens: 2470 },
  } }], { model: "custom-model" }, profile);
  assert.deepEqual(result.usage, { input: 1250, output: 420, cacheRead: 800, cacheWrite: 0, total: 2470 });
  assert.equal(result.usageModel, "custom-model");
});

test("partial counters preserve unknown fields and legitimate reported zeros", () => {
  assert.deepEqual(getComposerContextUsage([response({ input_tokens: 0, output_tokens: 20 })]).usage,
    { input: 0, output: 20, cacheRead: null, cacheWrite: null, total: null });
});

test("invalid counters cannot leak NaN, negative values or fabricated totals into UI", () => {
  assert.equal(getComposerContextUsage([response({ input_tokens: -1, output_tokens: Infinity, cache_read_tokens: "123", total_tokens: NaN })]).usage, null);
});

test("model switch resolves current model window and marks previous model usage", () => {
  const switched = { ...profile, modelProfiles: { ...profile.modelProfiles, "new-model": { contextWindow: 64000, maxOutputTokens: 4096 } } };
  const result = getComposerContextUsage([response({ model: "custom-model", total_tokens: 1200 })], { model: "new-model" }, switched);
  assert.equal(result.contextWindow, 64000);
  assert.equal(result.modelMismatch, true);
  assert.equal(result.usageModel, "custom-model");
});

test("unknown and invalid model limits remain unknown", () => {
  assert.equal(getComposerContextUsage([], { model: "other-model" }, profile).contextWindow, null);
  assert.equal(getComposerContextUsage([], {}, { ...profile, modelProfiles: { "custom-model": { contextWindow: 1 } } }).contextWindow, null);
});

test("provider-reported metadata uses the same resolver as model settings", () => {
  assert.equal(getComposerContextUsage([], {}, {
    ...profile, modelProfiles: {}, availableModels: [{ id: "custom-model", context_length: 256000 }],
  }).contextWindow, 256000);
});

const measured = {
  version: 1, model: "custom-model", provider_id: "provider-a", protocol: "openai", context_window: 128000,
  input_tokens: 64000, output_tokens: 5000, used_tokens: 64000, source: "reported", request_sequence: 3,
  output_reserve: 8192, safety_reserve: 6400, calibrated: true,
};

test("latest request snapshot drives occupancy independently of cumulative billing", () => {
  const result = getComposerContextUsage([response({ total_tokens: 800000, context_usage: measured })], { model: "custom-model", provider_id: "provider-a" }, profile);
  assert.equal(result.usage.total, 800000);
  assert.equal(result.context.usedTokens, 64000);
  assert.equal(result.context.outputTokens, 5000);
  assert.equal(result.context.percent, 50, "do not add output or reserves to prompt occupancy");
  assert.equal(result.context.source, "reported");
});

test("streaming updates replace older context while retaining completed turn billing", () => {
  const result = getComposerContextUsage([
    response({ total_tokens: 800000, context_usage: measured }),
    { role: "assistant", metadata_json: { delivery_status: "streaming", context_usage: { ...measured, used_tokens: 80000, input_tokens: 80000, source: "estimated", request_sequence: 4 } } },
  ], { model: "custom-model" }, profile);
  assert.equal(result.context.usedTokens, 80000);
  assert.equal(result.context.source, "estimated");
  assert.equal(result.context.requestSequence, 4);
  assert.equal(result.usage.total, 800000);
});

test("job live snapshot takes priority and persisted standalone snapshot resolves its limit", () => {
  assert.equal(getComposerContextUsage([], { model: "custom-model" }, null, measured).context.percent, 50);
  const message = { role: "assistant", metadata_json: { usage: { context_usage: measured } } };
  assert.equal(getComposerContextUsage([message], { model: "custom-model" }, null).contextWindow, 128000);
});

test("switching model or provider cannot reuse incompatible pressure", () => {
  for (const runtime of [
    { model: "other-model" }, { model: "custom-model", provider_id: "provider-b" },
    { model: "custom-model", protocol: "anthropic" },
  ]) assert.equal(getComposerContextUsage([], runtime, null, measured).context, null);
});

test("invalid telemetry stays unknown; over-capacity keeps the real count and caps only the gauge", () => {
  for (const change of [{ used_tokens: -1 }, { input_tokens: NaN }, { used_tokens: 5 }, { source: "invented" }, { context_window: 0 }]) {
    assert.equal(getComposerContextUsage([], { model: "custom-model" }, null, { ...measured, ...change }).context, null);
  }
  const result = getComposerContextUsage([], { model: "custom-model" }, profile, { ...measured, input_tokens: 150000, used_tokens: 150000 });
  assert.equal(result.context.usedTokens, 150000);
  assert.equal(result.context.percent, 100);
  assert(result.context.ratio > 1);
});

test("a newer completed response without a snapshot does not resurrect old window usage", () => {
  assert.equal(getComposerContextUsage([response({ context_usage: measured }), response({ total_tokens: 10 })], { model: "custom-model" }, profile).context, null);
});
