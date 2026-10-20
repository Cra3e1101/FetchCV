import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import * as ai from "@earendil-works/pi-ai";
import * as core from "@earendil-works/pi-agent-core";
import * as node from "@earendil-works/pi-agent-core/node";
import { FetchCVAgentHost } from "../electron/pi-agent-runtime.mjs";
import { RuntimeRpc } from "../packages/app/runtime-rpc.mjs";

const usage = { input: 1, output: 1, totalTokens: 2, cost: {} };
const answer = model => ({ role: "assistant", content: [{ type: "text", text: "synthetic result" }],
  api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop", timestamp: Date.now() });
class FakeHarness {
  constructor(options) { this.options = options; this.hooks = new Map(); this.listener = () => {}; }
  on(type, hook) { this.hooks.set(type, hook); }
  subscribe(listener) { this.listener = listener; return () => { this.listener = () => {}; }; }
  async prompt(text) {
    const model = this.options.model;
    await this.hooks.get("before_provider_payload")({ model, payload: { messages: [{ role: "user", content: text }] } });
    await this.listener({ type: "turn_start" });
    const result = answer(model);
    await this.listener({ type: "turn_end", message: result });
    return result;
  }
  async abort() {}
}

for (const runtime of ["fake", "real"]) test(`${runtime} Pi satisfies the same public RPC, event and request-record contract`, async t => {
  const records = [];
  const server = http.createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    assert.equal(request.headers["x-fetchcv-control-token"], "synthetic-control");
    let result;
    if (request.url.endsWith("/turns")) result = { user: { id: "message-1" }, run_id: "run-1", job_id: "job-1", session_id: "session-1",
      prompt: "selected quote and attachment synthetic-key", system_prompt: "Policy", tools: [], outbound_privacy: { mode: "redacted_remote" } };
    else if (request.url.endsWith("/requests")) { records.push(body.record); result = { saved: true }; }
    else if (request.url.endsWith("/complete")) result = { assistant: { id: "assistant-1", content: body.content } };
    else { response.writeHead(404).end("{}"); return; }
    response.setHeader("content-type", "application/json"); response.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const streamSimple = (model, context, options) => {
    const stream = ai.createAssistantMessageEventStream();
    queueMicrotask(async () => {
      try {
        await options.onPayload({ messages: context.messages }, model);
        stream.push({ type: "done", reason: "stop", message: answer(model) });
      } catch (error) { stream.push({ type: "error", reason: "error", error: { ...answer(model), stopReason: "error", errorMessage: error.message } }); }
    });
    return stream;
  };
  const host = new FetchCVAgentHost({
    getApiBase: () => `http://127.0.0.1:${server.address().port}`, getControlToken: () => "synthetic-control",
    getProviderConfig: () => ({ model: "fixture", baseUrl: "https://example.invalid", apiKey: "synthetic-key" }),
    loadModules: async () => [runtime === "real" ? core : { ...core, AgentHarness: FakeHarness }, node, ai,
      { openAICompletionsApi: () => ({ stream: streamSimple, streamSimple }) }, {}],
  });
  const rpc = new RuntimeRpc(host); const events = [];
  const result = await rpc.dispatch({ v: 1, id: `parity-${runtime}`, method: "agent.turn", workspaceId: "local", deadlineMs: Date.now() + 30000,
    payload: { jobId: "job-1", content: "synthetic" } }, "window-1", event => events.push(event));
  assert.equal(result.ok, true);
  assert.equal(result.result.assistant.content, "synthetic result");
  assert.deepEqual(events.map(event => event.seq), events.map((_, index) => index + 1));
  assert.ok(events.some(event => event.name === "done"));
  assert.equal(records.length, 1);
  assert.equal(JSON.stringify(records).includes("synthetic-key"), false);
  assert.equal(host.active.size, 0);
  assert.equal(rpc.scopes.size, 0);
});
