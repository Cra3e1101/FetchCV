import test from "node:test";
import assert from "node:assert/strict";
import { requestConversationTool } from "../electron/pi/conversation-tools.mjs";

const payload = { arguments: { query: "synthetic query" }, idempotency_key: "synthetic-call" };
const approvalError = () => Object.assign(new Error("approval required"), { code: "web_approval_required" });

test("allowed tools do not prompt; ask tools only retry after confirmation", async () => {
  assert.deepEqual(await requestConversationTool({ request: async () => ({ result: [] }), toolName: "search_web", payload,
    confirm: () => assert.fail("unexpected prompt") }), { result: [] });
  const calls = [];
  const result = await requestConversationTool({
    toolName: "search_web", payload, approvalKey: "synthetic-secret", messageId: "turn-one",
    request: async body => { calls.push(body); if (!body.approval_token) throw approvalError(); return { result: [] }; },
    confirm: async info => { assert.equal(info.arguments.query, "synthetic query"); return true; },
  });
  assert.deepEqual(result, { result: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].approval_confirmed, undefined);
  assert.match(calls[1].approval_token, /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
  assert.equal(payload.approval_confirmed, undefined);
});

test("denial or missing approval handler never retries network", async () => {
  for (const confirm of [undefined, async () => false]) {
    let calls = 0;
    await assert.rejects(requestConversationTool({ toolName: "read_web_page", payload, confirm,
      request: async () => { calls++; throw approvalError(); } }), { code: "web_approval_denied" });
    assert.equal(calls, 1);
  }
});

test("cancellation while approval is open prevents execution", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(requestConversationTool({ toolName: "search_web", payload, signal: controller.signal,
    request: async () => { calls++; throw approvalError(); },
    confirm: async () => { controller.abort(); return true; } }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("other errors and tools cannot gain a web approval retry", async () => {
  for (const [toolName, code] of [["search_web", "tool_permission_denied"], ["read_workspace_file", "web_approval_required"]]) {
    await assert.rejects(requestConversationTool({ toolName, payload,
      request: async () => { throw Object.assign(new Error("rejected"), { code }); },
      confirm: () => assert.fail("must not prompt") }), { code });
  }
});
