import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { PiAgentRuntime } from "../electron/pi-agent-runtime.mjs";
import {publicError} from '../packages/contracts/runtime.mjs';

const usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 2,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

for(const scenario of [
  {name:'HTTP rejection',stopReason:'error',errorMessage:'400 {"error":{"message":"unsupported thinking.display SYNTHETIC_PRIVATE_VALUE"}}',code:'provider_http_400'},
  {name:'partial text followed by error',stopReason:'error',errorMessage:'429 quota SYNTHETIC_PRIVATE_VALUE',text:'incomplete text',code:'provider_http_429'},
  {name:'reasoning-only output limit',stopReason:'length',code:'provider_output_limit'},
  {name:'empty success',stopReason:'stop',code:'provider_empty_response'},
])test(`provider ${scenario.name} is classified safely and never committed as success`,async()=>{
  const requests=[];
  class FailedHarness {
    on(){} subscribe(listener){this.listener=listener;}
    async prompt(){
      const message={role:'assistant',content:scenario.text?[{type:'text',text:scenario.text}]:[],stopReason:scenario.stopReason,errorMessage:scenario.errorMessage,usage};
      await this.listener({type:'turn_end',message});return message;
    }
  }
  const runtime=new PiAgentRuntime({
    request:async(_base,_token,url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {};},
    getProviderConfig:()=>({protocol:'openai',baseUrl:'https://synthetic.invalid',model:'test',contextWindow:128000,apiKey:'SYNTHETIC_PRIVATE_VALUE'}),
    loadModules:async()=>[{AgentHarness:FailedHarness,InMemorySessionRepo:class{async create(){return {appendMessage:async()=>{}};}}},{NodeExecutionEnv:class{}},
      {Type:{Unsafe:x=>x},createModels:()=>({setProvider(){}}),createProvider:x=>x},{openAICompletionsApi:()=>({})},{anthropicMessagesApi:()=>({})}],
  });
  let failure;
  try{await runtime.run({requestId:'failure-test',bootstrap:{user:{id:'u'},session_id:'s',prompt:'hello',system_prompt:'test',tools:[]}},()=>{});}catch(error){failure=error;}
  assert(failure,'failed/empty/truncated response must not complete');
  assert.equal(failure.code,scenario.code);
  const visible=publicError(failure);
  assert.equal(visible.code,scenario.code);
  assert(!JSON.stringify(visible).includes('SYNTHETIC_PRIVATE_VALUE'));
  assert.equal(requests.filter(r=>r.url.endsWith('/complete')).length,0);
  assert.equal(requests.filter(r=>r.url.endsWith('/fail')).length,1);
});

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

for (const standalone of [false, true]) test(`Pi runtime owns tool execution and persistence (standalone=${standalone})`, async (t) => {
  capturedSessionMessages = [];
  let completedPayload = null;
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    response.setHeader("content-type", "application/json");
    if (request.url.endsWith("/turns")) {
      response.end(JSON.stringify({
        standalone,
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
    if (request.url.endsWith("/read_job_workspace_context")) {
      assert.ok(events.some((item) => item.name === "tool_receipt" && item.payload.receipt.status === "running"), "show the tool before its response arrives");
      assert.equal(request.url, standalone ? "/api/pi/chat-tools/msg-user/read_job_workspace_context" : "/api/pi/runs/run-1/tools/read_job_workspace_context");
      assert.equal(request.headers["x-fetchcv-control-token"], "token");
      assert.match(body.idempotency_key, /^pi:msg-user:call-1$/);
      response.end(JSON.stringify({ result: { summary: "job loaded", data: { job: { role: "Analyst" } } } }));
      return;
    }
    if (request.url.endsWith("/complete")) {
      assert.equal(request.url, standalone ? "/api/pi/chat-turns/msg-user/complete" : "/api/pi/turns/msg-user/complete");
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
    getProviderConfig: () => ({ providerName: "Test", protocol: "openai", baseUrl: "https://api.example.com", model: "test-model", contextWindow: 8192, apiKey: "secret" }),
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
  const result = await runtime.run({ requestId: "12345678-1234-1234-1234-123456789abc", ...(standalone ? { conversationId: "chat-1" } : { jobId: "job-1" }), content: "读取岗位", thinkingLevel: "balanced" }, (name, payload) => events.push({ name, payload }));
  assert.equal(result.assistant.content, "已读取真实岗位信息。");
  assert.equal(capturedSessionMessages.length, 2);
  assert.equal(capturedSessionMessages[0].role, "user");
  assert.equal(capturedSessionMessages[1].content[0].text, "Earlier answer");
  assert.equal(capturedHarnessOptions.systemPrompt({activeTools:capturedHarnessOptions.tools}), "Use real tools.");
  assert.equal(completedPayload.content, "已读取真实岗位信息。");
  assert.equal(completedPayload.usage.runtime, "pi");
  assert.equal(completedPayload.usage.input_tokens, 20, "billing usage remains cumulative across both calls");
  assert.equal(completedPayload.usage.context_usage.used_tokens, 10, "window occupancy is the latest request input, not both calls or generated output");
  assert.equal(completedPayload.usage.context_usage.output_tokens, 5);
  assert.equal(completedPayload.usage.context_usage.context_window, 8192);
  assert.equal(completedPayload.usage.context_usage.source, "reported");
  const contextEvents = events.filter(item => item.name === "context_usage");
  assert.equal(contextEvents.length, 2);
  assert.deepEqual(contextEvents.at(-1).payload.usage, completedPayload.usage.context_usage);
  assert.ok(completedPayload.processing_trace.some((item) => item.label === "读取岗位与简历上下文" && item.status === "completed"));
  assert.deepEqual(completedPayload.tool_receipts.map((item) => ({ tool_name: item.tool_name, summary: item.summary })), [
    { tool_name: "read_job_workspace_context", summary: "job loaded" },
  ]);
  assert.ok(events.some((item) => item.name === "user"));
  const liveReceipts = events.filter((item) => item.name === "tool_receipt").map((item) => item.payload.receipt);
  assert.deepEqual(liveReceipts.map((item) => item.status), ["running", "completed"]);
  assert.equal(liveReceipts[0].tool_call_id, "call-1");
  assert.equal(liveReceipts[0].tool_name, "read_job_workspace_context");
  assert.deepEqual(liveReceipts.at(-1), completedPayload.tool_receipts[0]);
  assert.ok(events.some((item) => item.name === "delta" && item.payload.text === "已读取真实岗位信息。"));
  assert.ok(!events.some((item) => item.name === "delta" && item.payload.text.includes("检查参数")));
  assert.ok(events.some((item) => item.name === "done"));
});

for (const approved of [true, false]) test(`live tool receipts track web approval and final outcome (approved=${approved})`, async () => {
  const events = [];
  let completedPayload;
  let attempts = 0;
  class ApprovalHarness extends FakeHarness {
    async prompt() {
      const tool = this.options.tools[0];
      const event = { toolCallId: "web-1", toolName: tool.name, args: { query: "fixture weather" } };
      await this.emit({ type: "turn_start" });
      await this.emit({ type: "tool_execution_start", ...event });
      let result;
      let isError = false;
      try {
        result = await tool.execute(event.toolCallId, event.args, undefined, (partialResult) => {
          void this.emit({ type: "tool_execution_update", ...event, partialResult });
        });
      } catch (error) {
        isError = true;
        result = { content: [{ type: "text", text: error.message }] };
      }
      await this.emit({ type: "tool_execution_end", ...event, result, isError });
      await this.emit({ type: "turn_end", message: { role: "assistant", usage } });
      await this.emit({ type: "turn_start" });
      const message = { role: "assistant", content: [{ type: "text", text: "Finished fixture" }], usage };
      await this.emit({ type: "turn_end", message });
      return message;
    }
  }
  const runtime = new PiAgentRuntime({
    getApprovalKey: () => "synthetic-approval-key",
    getProviderConfig: () => ({ baseUrl: "https://synthetic.invalid", model: "test", contextWindow: 8192, apiKey: "fake" }),
    confirmWebTool: async () => {
      const receipt = events.filter((item) => item.name === "tool_receipt").at(-1).payload.receipt;
      assert.equal(receipt.status, "awaiting_approval");
      assert.deepEqual(receipt.activity, {kind: "search", text: "fixture weather"});
      assert.equal(receipt.requires_user_action, true);
      assert.equal(events.some((item) => item.name === "done"), false);
      return approved;
    },
    request: async (_base, _token, path, options) => {
      const body = JSON.parse(options.body);
      if (path.endsWith("/search_web")) {
        attempts++;
        if (!body.approval_token) throw Object.assign(new Error("approval required"), { code: "web_approval_required" });
        const receipt = events.filter((item) => item.name === "tool_receipt").at(-1).payload.receipt;
        assert.equal(receipt.status, "running", "approval resumes tool progress before the retry resolves");
        assert.equal(receipt.requires_user_action, false);
        return { result: { summary: "Found fixture forecast", artifacts: ["fixture-source"] } };
      }
      if (path.endsWith("/complete")) completedPayload = body;
      return {};
    },
    loadModules: async () => [{ AgentHarness: ApprovalHarness, InMemorySessionRepo: FakeSessionRepo }, { NodeExecutionEnv: class {} },
      { Type: { Unsafe: x => x }, createModels: () => ({ setProvider() {} }), createProvider: x => x },
      { openAICompletionsApi: () => ({}) }, { anthropicMessagesApi: () => ({}) }],
  });
  await runtime.run({ requestId: "approval-test", bootstrap: {
    standalone: true, user: { id: "u" }, session_id: "s", prompt: "hello", system_prompt: "test",
    tools: [{ name: "search_web", input_schema: {} }],
  } }, (name, payload) => events.push({ name, payload }));
  const receipts = events.filter((item) => item.name === "tool_receipt").map((item) => item.payload.receipt);
  assert.deepEqual(receipts.map((item) => item.status), approved
    ? ["running", "running", "awaiting_approval", "running", "completed"]
    : ["running", "running", "awaiting_approval", "failed"]);
  assert.equal(attempts, approved ? 2 : 1);
  assert.equal(completedPayload.tool_receipts.length, 1, "persist only the latest state of each tool call");
  assert.deepEqual(receipts.at(-1), completedPayload.tool_receipts[0]);
  assert.deepEqual(completedPayload.tool_receipts[0].activity, {kind: "search", text: "fixture weather"});
  assert.equal(receipts.at(-1).requires_user_action, false);
  if (approved) {
    assert.equal(receipts.at(-1).summary, "Found fixture forecast");
    assert.deepEqual(receipts.at(-1).artifacts, ["fixture-source"]);
  }
});

test("context estimate is emitted from the final prepared request and replaced by provider prompt usage", async () => {
  const events = [], requests = [];
  class MeteredHarness extends FakeHarness {
    async prompt() {
      await this.emit({ type: "turn_start" });
      await this.handlers.get("context")({ messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] });
      await this.handlers.get("before_provider_payload")({ model: this.options.model, payload: {
        messages: [{ role: "system", content: "test" }, { role: "user", content: "hello" }],
        stream: true, max_tokens: 1024,
      } });
      const message = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done" }], usage: { ...usage, input: 100, output: 80, cacheRead: 40, cacheWrite: 10, totalTokens: 230 } };
      await this.emit({ type: "turn_end", message });
      return message;
    }
  }
  const runtime = new PiAgentRuntime({
    getProviderConfig: () => ({ id: "profile-meter", protocol: "openai", baseUrl: "https://synthetic.invalid", model: "test", contextWindow: 8192, apiKey: "fake" }),
    request: async (_base, _token, url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return {};
    },
    loadModules: async () => [{ AgentHarness: MeteredHarness, InMemorySessionRepo: FakeSessionRepo }, { NodeExecutionEnv: class {} },
      { Type: { Unsafe: x => x }, createModels: () => ({ setProvider() {} }), createProvider: x => x },
      { openAICompletionsApi: () => ({}) }, { anthropicMessagesApi: () => ({}) }],
  });
  await runtime.run({ requestId: "metered-request", bootstrap: { standalone: true, user: { id: "u" }, session_id: "s", prompt: "hello", system_prompt: "test", tools: [] } }, (name, payload) => events.push({ name, payload }));
  const measured = events.filter(item => item.name === "context_usage").map(item => item.payload.usage);
  assert.equal(measured.length, 2);
  assert.equal(measured[0].source, "estimated");
  assert.equal(measured[0].used_tokens, 15);
  assert.equal(measured[0].request_sequence, 1);
  assert.equal(measured[1].source, "reported");
  assert.equal(measured[1].used_tokens, 150);
  assert.equal(measured[1].output_tokens, 80);
  assert.equal(measured[1].provider_id, "profile-meter");
  assert.deepEqual(requests.find(item => item.url.endsWith("/complete")).body.usage.context_usage, measured[1]);
  assert.equal(requests.find(item => item.url.endsWith("/requests")).body.record.sequence, 1);
  await runtime.run({ requestId: "metered-next-turn", bootstrap: {
    standalone: true, user: { id: "u-next" }, session_id: "s-next", prompt: "hello", system_prompt: "test", tools: [],
    previous_context_usage: JSON.parse(JSON.stringify(measured[1])),
  } }, (name, payload) => events.push({ name, payload }));
  const nextEstimate = events.filter(item => item.name === "context_usage")[2].payload.usage;
  assert.equal(nextEstimate.source, "estimated");
  assert.equal(nextEstimate.used_tokens, 150, "next user turn reuses persisted provider calibration");
  assert.equal(nextEstimate.calibrated, true);
});

test("cancelling while prompt resolves never commits completion or reuses a queued harness", async (t) => {
  const requests = [];
  let runtime;
  let instances = 0;
  class ResolvingAbortHarness extends FakeHarness {
    constructor(options) { super(options); instances++; }
    async prompt() {
      runtime.cancel("cancel-request");
      return { role: "assistant", content: [{ type: "text", text: "late answer" }], usage };
    }
  }
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ path: req.url, body: raw ? JSON.parse(raw) : {} });
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  runtime = new PiAgentRuntime({
    getApiBase: () => `http://127.0.0.1:${server.address().port}`,
    getControlToken: () => "synthetic-token",
    getProviderConfig: () => ({ protocol: "openai", baseUrl: "https://example.invalid", model: "test", contextWindow: 8192, apiKey: "fake" }),
    loadModules: async () => [{ AgentHarness: ResolvingAbortHarness, InMemorySessionRepo: FakeSessionRepo }, { NodeExecutionEnv: class {} },
      { Type: { Unsafe: x => x }, createModels: () => ({ setProvider() {} }), createProvider: x => x },
      { openAICompletionsApi: () => ({}) }, { anthropicMessagesApi: () => ({}) }],
  });
  const bootstrap = { run_id: "r", session_id: "s", user: { id: "u" }, system_prompt: "test", prompt: "test", tools: [] };
  for (let i = 0; i < 2; i++) {
    await assert.rejects(runtime.run({ requestId: "cancel-request", bootstrap }, () => {}), { name: "AbortError" });
    assert.equal(runtime.active.size, 0);
    assert.equal(runtime.cancelledRequests.size, 0);
  }
  assert.equal(instances, 2);
  assert.equal(requests.filter(r => r.path.endsWith("/complete")).length, 0);
  assert.equal(requests.filter(r => r.path.endsWith("/fail") && r.body.delivery_status === "cancelled").length, 2);
});

for (const mode of ["conversation", "task"]) {
  test(`SDK initialization failure settles ${mode} instead of leaving it running`, async () => {
    const requests = [];
    // V2 injects the APP transport; isolate settlement from short-lived HTTP
    // listener / pooled socket timing. Real APP + Pi is tested separately.
    const runtime = new PiAgentRuntime({
      request: async (_base, _token, path, options) => {
        requests.push({ path, body: JSON.parse(options.body) });return {};
      },
      getControlToken: () => "synthetic-token",
      getProviderConfig: () => ({ baseUrl: "https://example.invalid", model: "test", contextWindow: 8192, apiKey: "fake" }),
      loadModules: async () => { throw new Error("synthetic SDK load failure"); },
    });
    await assert.rejects(runtime.run({ requestId: "setup-failure", mode, bootstrap: { run_id: "r", user: { id: "u" }, task_id: "t" } }, () => {}), /synthetic SDK load failure/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, mode === "task" ? "/api/pi/tasks/t/fail" : "/api/pi/turns/u/fail");
    assert.equal(requests[0].body[mode === "task" ? "status" : "delivery_status"], "failed");
    assert.equal(runtime.active.size, 0);
    assert.equal(runtime.activeTasks.size, 0);
  });
}

test("short task checks pending pause before completion and includes task identity in tool dispatch", async t => {
  const requests = [];
  class ShortTaskHarness extends FakeHarness {
    async prompt() {
      await this.options.tools[0].execute("call-1", {}, undefined);
      return { role: "assistant", content: [{ type: "text", text: "late answer" }], usage };
    }
  }
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ path: req.url, body: JSON.parse(raw || "{}") });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url.endsWith("/control") ? { signal: "pause" } : { result: { summary: "synthetic" }, tools: [] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const runtime = new PiAgentRuntime({
    getApiBase: () => `http://127.0.0.1:${server.address().port}`, getControlToken: () => "fake",
    getProviderConfig: () => ({ baseUrl: "https://example.invalid", model: "test", contextWindow: 8192, apiKey: "fake" }),
    loadModules: async () => [{ AgentHarness: ShortTaskHarness, InMemorySessionRepo: FakeSessionRepo }, { NodeExecutionEnv: class {} },
      { Type: { Unsafe: x => x }, createModels: () => ({ setProvider() {} }), createProvider: x => x },
      { openAICompletionsApi: () => ({}) }, { anthropicMessagesApi: () => ({}) }],
  });
  await assert.rejects(runtime.run({ requestId: "short-task", mode: "task", bootstrap: { run_id: "r", task_id: "t", session_id: "s", system_prompt: "test", prompt: "test", tools: [{ name: "read", input_schema: {} }] } }, () => {}), { name: "AbortError" });
  assert.equal(requests.find(r => r.path.includes("/task-tools/")).body.task_id, "t");
  assert.equal(requests.filter(r => r.path.endsWith("/complete")).length, 0);
  assert.equal(requests.find(r => r.path.endsWith("/fail")).body.status, "paused");
});
