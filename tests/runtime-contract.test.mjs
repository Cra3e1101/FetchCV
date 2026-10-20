import assert from "node:assert/strict";
import test from "node:test";
import { validateRequest, MAX_RPC_BYTES, publicError } from "../packages/contracts/runtime.mjs";
import { EventJournal, isTrustedFrame, RuntimeRpc } from "../packages/app/runtime-rpc.mjs";

const request = (overrides = {}) => ({ v: 1, id: "synthetic-1", method: "agent.turn", workspaceId: "local", deadlineMs: Date.now() + 60000,
  payload: { jobId: "job-1", content: "hello", quote: { text: "quote", messageId: "msg-1" } }, ...overrides });
test("RPC validates and copies the application request, rejecting SDK and host-only fields", () => {
  const raw = request();
  const parsed = validateRequest(raw, "local");
  raw.payload.content = "changed";
  assert.equal(parsed.payload.content, "hello");
  for (const injected of ["bootstrap", "mode", "provider", "tools", "system_prompt", "requestId"]) {
    const value = request(); value.payload[injected] = {};
    assert.throws(() => validateRequest(value, "local"), { code: "invalid_payload" });
  }
});
test("events have monotonic seq/revisions, explicit replay gaps and bounded critical retention", () => {
  const journal = new EventJournal("stream", { maxEvents: 2 });
  journal.append("status", { label: "a" });
  journal.append("reasoning", { event: { id: "approval", kind: "approval" } });
  journal.append("done", { result: "committed" });
  assert.equal(journal.replay(0).gap, true);
  assert.deepEqual(journal.replay(1).events.map(e => e.seq), [2, 3]);
  assert.equal(journal.replay(1).gap, false);
  assert.equal(journal.replay(4).gap, true);
  assert.throws(() => journal.append("reasoning", {}), { code: "event_backpressure" });
  assert.equal(journal.seq, 3);
  assert.equal(journal.replay(0).events.at(-1).revision, 2);
  journal.acknowledge(3);
  assert.equal(journal.bytes, 0);
  assert.equal(journal.append("reasoning", {}).seq, 4);
});
test("only the exact trusted main frame can call runtime RPC", () => {
  const frame = { url: "file:///app/dist/index.html" };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  assert.ok(isTrustedFrame({ sender, senderFrame: frame }, frame.url));
  assert.equal(isTrustedFrame({ sender, senderFrame: { ...frame } }, frame.url), false);
  assert.equal(isTrustedFrame({ sender, senderFrame: frame }, "file:///app/other.html"), false);
  assert.equal(isTrustedFrame({ sender, senderFrame: { url: "https://example.invalid" } }, frame.url), false);
});
test("runtime ownership, concurrency, observer isolation and cancellation use one invocation", async () => {
  let release; const hold = new Promise(resolve => { release = resolve; });
  let calls = 0; const cancelled = [];
  const host = { run: async (_input, emit) => { calls++; emit("status", {}); await hold; emit("done", {}); return "ok"; }, cancel: id => cancelled.push(id) };
  const rpc = new RuntimeRpc(host);
  const running = rpc.dispatch(request(), 1, () => { throw Error("observer"); });
  assert.equal((await rpc.dispatch(request({ id: "other" }), 2)).error.code, "conversation_busy");
  const cancel = request({ id: "cancel", method: "agent.cancel", payload: { requestId: "synthetic-1" } });
  assert.equal((await rpc.dispatch(cancel, 2)).error.code, "stream_not_found");
  assert.equal((await rpc.dispatch(cancel, 1)).ok, true);
  rpc.disposeOwner(1);
  assert.equal((await rpc.dispatch(request({ id: "third" }), 1)).error.code, "conversation_busy");
  release();
  assert.deepEqual(await running, { ok: true, result: "ok" });
  assert.equal(calls, 1); assert.equal(cancelled.length, 2);
  assert.equal((await rpc.dispatch(request({ id: "replay", method: "agent.events", payload: { streamId: "synthetic-1", afterSeq: 0 } }), 2)).ok, false);
});
test("RPC refuses wrong version, scope, method, expired deadlines and oversize input", () => {
  for (const [override, code] of [
    [{ v: 2 }, "protocol_version"], [{ workspaceId: "foreign" }, "workspace_mismatch"],
    [{ method: "sql.execute" }, "method_not_allowed"], [{ deadlineMs: 0 }, "deadline_invalid"],
    [{ payload: { content: "x".repeat(MAX_RPC_BYTES) } }, "payload_too_large"],
  ]) assert.throws(() => validateRequest(request(override), "local"), { code });
});
test("provider errors cannot carry credentials or raw SDK payloads to renderer", () => {
  const error = Object.assign(new Error("Bearer synthetic-secret-value"), { code: "secret-value", payload: { apiKey: "secret" } });
  assert.deepEqual(publicError(error), { code: "runtime_failed", retryable: false, message: "运行失败，请检查模型配置和本地任务状态" });
});
