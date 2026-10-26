import assert from "node:assert/strict";
import test from "node:test";
import { createContextUsageTracker, estimateRequestInputTokens } from "../electron/pi/context-usage.mjs";

const model = { id: "test-model", provider: "fetchcv-openai", contextWindow: 128000, maxTokens: 8192 };
const request = (text = "abcd", sequence = 1, nextModel = model) => ({
  sequence,
  model: { id: nextModel.id, provider: nextModel.provider, contextWindow: nextModel.contextWindow, maxOutputTokens: nextModel.maxTokens },
  payload: { messages: [{ role: "system", content: "abcd" }, { role: "user", content: text }] },
});
const response = usage => ({ role: "assistant", stopReason: "stop", usage });
const tracker = () => createContextUsageTracker({ model, providerId: "profile-one", protocol: "openai" });

test("DSH text estimates include message, block, system and tool overhead only", () => {
  const payload = request().payload;
  assert.equal(estimateRequestInputTokens(payload), 14);
  assert.equal(estimateRequestInputTokens({ ...payload, temperature: 0.5, max_tokens: 8192, stream: true, metadata: { ignored: "x".repeat(10000) } }), 14);
  const tools = [{ type: "function", function: { name: "read", parameters: { type: "object" } } }];
  assert.equal(estimateRequestInputTokens({ ...payload, tools }), 14 + Math.ceil(JSON.stringify(tools).length / 4) + 4);
  assert.equal(estimateRequestInputTokens({ messages: [{ role: "user", content: "中文测试" }] }), 9);
});

test("both wire formats include required reasoning and tool call arguments", () => {
  assert.equal(estimateRequestInputTokens({ messages: [{ role: "assistant", content: null, reasoning_content: "abcd", tool_calls: [{ type: "function", function: { name: "read", arguments: "{}" } }] }] }), 15);
  assert.equal(estimateRequestInputTokens({ system: [{ type: "text", text: "abcd" }], messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "abcd" }, { type: "tool_use", name: "read", input: {} }] }] }), 20);
});

test("multimodal transport bytes cannot become a fabricated text token count", () => {
  assert.equal(estimateRequestInputTokens({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64," + "x".repeat(10000) } }] }] }), null);
  assert.equal(estimateRequestInputTokens({ messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", data: "abc" } }] }] }), null);
  assert.equal(estimateRequestInputTokens({ messages: [{ role: "user", content: [{ type: "tool_result", content: [{ type: "image", source: { type: "base64", data: "abc" } }] }] }] }), null);
});

test("latest prompt occupancy includes cache exactly once and excludes output and reasoning", () => {
  const meter = tracker();
  const before = meter.recordRequest(request());
  assert.equal(before.used_tokens, 14);
  assert.equal(before.source, "estimated");
  assert.equal(before.calibrated, false);
  const after = meter.observeResponse(response({ input: 100, cacheRead: 40, cacheWrite: 10, output: 200, reasoning: 99, totalTokens: 350 }));
  assert.equal(after.input_tokens, 150);
  assert.equal(after.used_tokens, 150);
  assert.equal(after.output_tokens, 200);
  assert.equal(after.source, "reported");
  assert.equal(after.scope, "request_input");
  assert.equal(after.output_reserve, 8192);
  assert.equal(after.safety_reserve, 6400);
  assert.equal(after.provider_id, "profile-one");
});

test("next request projects provider prompt anchor plus current surface delta", () => {
  const meter = tracker();
  meter.recordRequest(request());
  meter.observeResponse(response({ input: 100, cacheRead: 40, cacheWrite: 10, output: 200 }));
  const larger = meter.recordRequest(request("abcd".repeat(11), 2));
  assert.equal(larger.used_tokens, 160);
  assert.equal(larger.calibrated, true);
  assert.equal(larger.source, "estimated");
  assert.equal(larger.request_sequence, 2);
  const secondResponse = meter.observeResponse(response({ input: 80, cacheRead: 0, cacheWrite: 0, output: 9 }));
  assert.equal(secondResponse.used_tokens, 80, "replace rather than accumulate per-call input");
  assert.equal(meter.recordRequest(request("abcd", 3)).used_tokens, 70);
});

test("compaction lowers projection and a model change discards old calibration", () => {
  const meter = tracker();
  meter.recordRequest(request("abcd".repeat(10)));
  meter.observeResponse(response({ input: 100, cacheRead: 0, cacheWrite: 0, output: 10 }));
  assert.equal(meter.recordRequest(request("abcd", 2)).used_tokens, 91);
  const switched = meter.recordRequest(request("abcd", 3, { ...model, id: "other-model", contextWindow: 64000 }));
  assert.equal(switched.used_tokens, 14);
  assert.equal(switched.calibrated, false);
  assert.equal(switched.context_window, 64000);
});

test("missing, invalid and all-zero default usage preserve the request estimate", () => {
  const meter = tracker();
  meter.recordRequest(request());
  for (const usage of [undefined, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, { input: -1 }, { input: Infinity }, { input: "100" }]) {
    const next = meter.observeResponse(response(usage));
    assert.equal(next.used_tokens, 14);
    assert.equal(next.source, "estimated");
  }
  assert.equal(meter.observeResponse({ ...response({ input: 100 }), stopReason: "error" }).used_tokens, 14);
  assert.equal(meter.observeResponse({ ...response({ input: 100 }), stopReason: "aborted" }).used_tokens, 14);
});

test("tool schema and request option changes invalidate hidden framing calibration", () => {
  const meter = tracker();
  const first = request();
  first.toolsHash = "schema-one";
  meter.recordRequest(first);
  meter.observeResponse(response({ input: 100, output: 10 }));
  const schemaChanged = { ...request("abcd", 2), toolsHash: "schema-two" };
  assert.equal(meter.recordRequest(schemaChanged).calibrated, false);
  meter.observeResponse(response({ input: 100, output: 10 }));
  const optionChanged = { ...schemaChanged, sequence: 3, payload: { ...schemaChanged.payload, tool_choice: "required" } };
  const result = meter.recordRequest(optionChanged);
  assert.equal(result.calibrated, false);
  assert.equal(result.used_tokens, 14);
});

test("provider reports can recover an unsupported estimate without unsafe projection", () => {
  const meter = tracker();
  const unknown = meter.recordRequest({ ...request(), payload: { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", data: "abc" } }] }] } });
  assert.equal(unknown.used_tokens, null);
  assert.equal(meter.observeResponse(response({ input: 500, output: 20 })).used_tokens, 500);
  const next = meter.recordRequest(request("abcd", 2));
  assert.equal(next.used_tokens, 14);
  assert.equal(next.calibrated, false);
});

test("meter retains no request content or reasoning in persisted snapshots", () => {
  const meter = tracker();
  const record = request("private-personal-text");
  record.payload.messages.push({ role: "assistant", reasoning_content: "private-intermediate-text", content: "answer" });
  const snapshot = meter.recordRequest(record);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-personal|private-intermediate|messages/);
});

test("serialized calibration carries the provider anchor into the next user turn", () => {
  const firstTurn = tracker();
  firstTurn.recordRequest(request());
  const saved = JSON.parse(JSON.stringify(firstTurn.observeResponse(response({ input: 100, cacheRead: 40, cacheWrite: 10, output: 200 }))));
  assert.deepEqual(Object.keys(saved.calibration).sort(), ["envelope_hash", "estimated_tokens", "prompt_tokens"]);
  const nextTurn = createContextUsageTracker({ model, providerId: "profile-one", protocol: "openai", previousSnapshot: saved });
  const projected = nextTurn.recordRequest(request("abcd".repeat(11)));
  assert.equal(projected.used_tokens, 160);
  assert.equal(projected.calibrated, true);
  assert.deepEqual(projected.calibration, saved.calibration, "retain the original anchor until the next valid provider report");
});

test("cross-turn anchors reject incompatible routes, envelopes and malformed metadata", () => {
  const firstTurn = tracker();
  firstTurn.recordRequest(request());
  const saved = firstTurn.observeResponse(response({ input: 100, output: 20 }));
  const attempt = (previousSnapshot, options = {}, record = request()) => createContextUsageTracker({ model, providerId: "profile-one", protocol: "openai", previousSnapshot, ...options }).recordRequest(record);
  for (const options of [{ providerId: "other-profile" }, { protocol: "anthropic" }, { model: { ...model, id: "other-model" } }, { model: { ...model, baseUrl: "https://another.example/v1" } }]) {
    const result = attempt(saved, options);
    assert.equal(result.calibrated, false);
    assert.equal(result.used_tokens, 14);
  }
  assert.equal(attempt(saved, {}, { ...request(), toolsHash: "changed-tools" }).calibrated, false);
  for (const invalid of [
    { ...saved, version: 2 }, { ...saved, scope: "billing" },
    { ...saved, calibration: { ...saved.calibration, prompt_tokens: 0 } },
    { ...saved, calibration: { ...saved.calibration, prompt_tokens: -1 } },
    { ...saved, calibration: { ...saved.calibration, estimated_tokens: Infinity } },
    { ...saved, calibration: { ...saved.calibration, estimated_tokens: "14" } },
    { ...saved, calibration: { ...saved.calibration, envelope_hash: "not-a-hash" } },
  ]) assert.equal(attempt(invalid).calibrated, false);
});
