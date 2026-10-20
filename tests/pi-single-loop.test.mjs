import assert from "node:assert/strict";
import test from "node:test";
import * as ai from "@earendil-works/pi-ai";
import * as core from "@earendil-works/pi-agent-core";
import * as node from "@earendil-works/pi-agent-core/node";
import { createFetchCVHarness } from "../electron/pi/fetchcv-harness.mjs";

const provider = { providerName: "Synthetic", protocol: "openai", baseUrl: "https://example.invalid", model: "fixture", apiKey: "synthetic-key" };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function message(model, content, stopReason = "stop") {
  return { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage, stopReason, timestamp: Date.now() };
}
async function fixture(streamSimple, tools = [], extra = {}) {
  const api = { streamSimple, stream: streamSimple };
  return createFetchCVHarness({ bootstrap: { session_id: "m2-fixture", system_prompt: "Use supplied tools." }, provider, tools,
    modules: [core, node, ai, { openAICompletionsApi: () => api }, { anthropicMessagesApi: () => api }], ...extra });
}

test("real Harness final payload hook records the exact redacted provider body", async () => {
  const recorded = []; let sent;
  const { harness } = await fixture((model, context, options) => {
    const stream = ai.createAssistantMessageEventStream();
    queueMicrotask(async () => {
      try {
        sent = await options.onPayload({ model: model.id, messages: context.messages, system: "payload-stage synthetic-key" }, model);
        const answer = message(model, [{ type: "text", text: "done" }]);
        stream.push({ type: "done", reason: "stop", message: answer });
      } catch (error) {
        stream.push({ type: "error", reason: "error", error: { ...message(model, [], "error"), errorMessage: error.message } });
      }
    });
    return stream;
  }, [], { bootstrap: { session_id: "m3-payload", system_prompt: "Policy", outbound_privacy: { mode: "redacted_remote", literals: ["synthetic-key"] } },
    recordRequest: async record => { recorded.push(structuredClone(record)); } });
  await harness.prompt("Read the attached evidence");
  assert.equal(recorded.length, 1);
  assert.deepEqual(sent, recorded[0].payload);
  assert.equal(JSON.stringify(sent).includes("synthetic-key"), false);
  assert.equal(recorded[0].sequence, 1);
});

test("real AgentHarness executes model-tool-model and settles after session writes", { timeout: 10000 }, async () => {
  const contexts = [];
  const events = [];
  let executions = 0;
  const tool = { name: "read_evidence", description: "synthetic evidence", parameters: ai.Type.Object({}),
    execute: async () => { executions++; return { content: [{ type: "text", text: "SOURCE-42" }] }; } };
  const { harness, session } = await fixture((model, context) => {
    contexts.push(structuredClone(context.messages));
    const stream = ai.createAssistantMessageEventStream();
    const first = contexts.length === 1;
    const answer = message(model, first ? [{ type: "toolCall", id: "call-1", name: tool.name, arguments: {} }] : [{ type: "text", text: "SOURCE-42 verified" }], first ? "toolUse" : "stop");
    queueMicrotask(() => { stream.push({ type: "start", partial: answer }); stream.push({ type: "done", reason: answer.stopReason, message: answer }); });
    return stream;
  }, [tool]);
  harness.subscribe(async event => {
    if (["save_point", "settled"].includes(event.type)) events.push({ type: event.type, messages: (await session.buildContext()).messages.length });
  });
  await harness.prompt("Read evidence then answer");
  assert.equal(executions, 1);
  assert.equal(contexts.length, 2);
  assert.ok(contexts[1].some(m => m.role === "toolResult" && JSON.stringify(m.content).includes("SOURCE-42")));
  const saved = (await session.buildContext()).messages;
  assert.ok(saved.some(m => m.role === "toolResult"));
  assert.ok(events.some(e => e.type === "save_point"));
  assert.equal(events.at(-1).type, "settled");
  assert.equal(events.at(-1).messages, saved.length);
});

test("real Harness abort clears steer/followUp but preserves nextTurn; host must discard stopped sessions", { timeout: 10000 }, async () => {
  let ready;
  const entered = new Promise(resolve => { ready = resolve; });
  let calls = 0;
  const { harness } = await fixture((model, _context, options) => {
    calls++;
    const stream = ai.createAssistantMessageEventStream();
    const aborted = () => stream.push({ type: "error", reason: "aborted", error: { ...message(model, [], "aborted"), errorMessage: "synthetic stop" } });
    options.signal.addEventListener("abort", aborted, { once: true });
    if (options.signal.aborted) aborted();
    ready();
    return stream;
  });
  const queues = [];
  harness.subscribe(event => { if (event.type === "queue_update") queues.push(event); });
  const running = harness.prompt("hold").catch(error => error);
  await entered;
  await harness.steer("steer-input");
  await harness.followUp("followup-input");
  await harness.nextTurn("next-input");
  const stopped = await harness.abort();
  await running;
  assert.equal(calls, 1);
  assert.equal(stopped.clearedSteer.length, 1);
  assert.equal(stopped.clearedFollowUp.length, 1);
  assert.equal(queues.at(-1).steer.length, 0);
  assert.equal(queues.at(-1).followUp.length, 0);
  assert.equal(queues.at(-1).nextTurn.length, 1);
  // FetchCV exposes steering only and creates a fresh Harness on every run;
  // no product path prompts this stopped instance again.
});
