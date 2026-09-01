import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { PiAgentRuntime } from "../electron/pi-agent-runtime.mjs";

const usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 2,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

let capturedHarnessOptions = null;
let capturedSessionMessages = [];

class FakeHarness {
  constructor(options) {
    capturedHarnessOptions = options;
    this.options = options;
    this.listeners = [];
    this.handlers = new Map();
  }

  subscribe(listener) { this.listeners.push(listener); }
  on(type, handler) { this.handlers.set(type, handler); }
  async abort() {}
  async steer() {}
  async setTools(tools) { this.options.tools = tools; }

  async emit(event) {
    for (const listener of this.listeners) await listener(event);
  }

  async prompt() {
    const tool = this.options.tools[0];
    await this.emit({ type: "turn_start" });
    await this.emit({
      type: "message_update",
      message: null,
      assistantMessageEvent: { type: "thinking_delta", delta: "需要读取真实岗位信息。" },
    });
    await this.emit({ type: "message_update", message: null, assistantMessageEvent: { type: "text_delta", delta: "让我先读取材料并检查参数。" } });
    await this.emit({ type: "tool_execution_start", toolCallId: "call-1", toolName: tool.name, args: { sections: ["job"] } });
    const result = await tool.execute("call-1", { sections: ["job"] }, undefined, () => {});
    await this.emit({ type: "tool_execution_end", toolCallId: "call-1", toolName: tool.name, result, isError: false });
    await this.emit({ type: "turn_end", message: { role: "assistant", usage }, toolResults: [] });
    await this.emit({ type: "turn_start" });
    await this.emit({ type: "message_update", message: null, assistantMessageEvent: { type: "text_delta", delta: "已读取真实岗位信息。" } });
    const assistant = { role: "assistant", content: [{ type: "text", text: "已读取真实岗位信息。" }], usage };
    await this.emit({ type: "turn_end", message: assistant, toolResults: [] });
    return assistant;
  }
}

class FakeSession {
  async appendMessage(message) { capturedSessionMessages.push(message); }
}

class FakeSessionRepo {
  async create() { return new FakeSession(); }
}

test("Pi runtime owns the loop while FetchCV gateway owns tool execution and persistence", async (t) => {
  let completedPayload = null;
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    response.setHeader("content-type", "application/json");
    if (request.url.endsWith("/turns")) {
      response.end(JSON.stringify({
        run_id: "run-1",
        session_id: "pi:run-1",
        user: { id: "msg-user", role: "user", content: body.content, metadata_json: { agent_runtime: "pi" } },
        prompt: `<user_message>${body.content}</user_message>`,
        system_prompt: "Use real tools.",
        history: [
          { role: "user", content: "Earlier question", timestamp: 1 },
          { role: "assistant", content: "Earlier answer", timestamp: 2 },
        ],
        tools: [{
          name: "read_job_workspace_context",
          description: "Read current job",
          input_schema: { type: "object", properties: { sections: { type: "array", items: { type: "string" } } }, required: ["sections"] },
          side_effect: false,
        }],
      }));
      return;
    }
    if (request.url.includes("/tools/read_job_workspace_context")) {
      assert.equal(request.headers["x-fetchcv-control-token"], "token");
      assert.match(body.idempotency_key, /^pi:msg-user:call-1$/);
      response.end(JSON.stringify({ result: { summary: "job loaded", data: { job: { role: "Analyst" } } } }));
      return;
    }
    if (request.url.endsWith("/complete")) {
      completedPayload = body;
      response.end(JSON.stringify({ assistant: { id: "msg-assistant", role: "assistant", content: body.content, metadata_json: { agent_runtime: "pi" } } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const events = [];
  const runtime = new PiAgentRuntime({
    getApiBase: () => `http://127.0.0.1:${address.port}`,
    getControlToken: () => "token",
    getProviderConfig: () => ({ providerName: "Test", protocol: "openai", baseUrl: "https://api.example.com", model: "test-model", apiKey: "secret" }),
    loadModules: async () => [
      { AgentHarness: FakeHarness, InMemorySessionRepo: FakeSessionRepo },
      { NodeExecutionEnv: class {} },
      {
        Type: { Unsafe: (schema) => schema },
        createModels: () => ({ setProvider() {} }),
        createProvider: (input) => input,
      },
      { openAICompletionsApi: () => ({ streamSimple: () => { throw new Error("not used by fake agent"); } }) },
      { anthropicMessagesApi: () => ({ streamSimple: () => { throw new Error("not used by fake agent"); } }) },
    ],
  });
  const result = await runtime.run({ requestId: "12345678-1234-1234-1234-123456789abc", jobId: "job-1", content: "读取岗位", thinkingLevel: "balanced" }, (name, payload) => events.push({ name, payload }));
  assert.equal(result.assistant.content, "已读取真实岗位信息。");
  assert.equal(capturedSessionMessages.length, 2);
  assert.equal(capturedSessionMessages[0].role, "user");
  assert.equal(capturedSessionMessages[1].content[0].text, "Earlier answer");
  assert.equal(capturedHarnessOptions.systemPrompt, "Use real tools.");
  assert.equal(completedPayload.content, "已读取真实岗位信息。");
  assert.equal(completedPayload.usage.runtime, "pi");
  assert.ok(completedPayload.processing_trace.some((item) => item.label === "读取岗位与简历上下文" && item.status === "completed"));
  assert.deepEqual(completedPayload.tool_receipts.map((item) => ({ tool_name: item.tool_name, summary: item.summary })), [
    { tool_name: "read_job_workspace_context", summary: "job loaded" },
  ]);
  assert.ok(events.some((item) => item.name === "user"));
  assert.ok(events.some((item) => item.name === "delta" && item.payload.text === "已读取真实岗位信息。"));
  assert.ok(!events.some((item) => item.name === "delta" && item.payload.text.includes("检查参数")));
  assert.ok(events.some((item) => item.name === "done"));
});
