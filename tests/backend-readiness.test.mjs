import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBackendStatus, readBackendStatus, requireAgentReady, withBackendReadiness } from "../src/lib/backend-readiness.js";

test("data readiness allows browsing but blocks writes until reconciliation finishes", async () => {
  let status = { state: "ready", dataReady: true, agentReady: false };
  const runtime = { getBackendStatus: async () => status };
  const calls = [];
  const request = withBackendReadiness(async (...args) => { calls.push(args); return "ok"; }, () => runtime);
  assert.equal(await request("/api/workspace"), "ok");
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
    await assert.rejects(request("/api/example", { method }), { code: "agent_not_ready" });
  }
  assert.equal(calls.length, 1, "blocked requests must never reach the API");
  status = { ...status, agentReady: true };
  assert.equal(await request("/api/example", { method: "POST" }), "ok");
  assert.equal(calls.length, 2);
  status = { ...status, agentReady: false, agentError: "恢复任务失败" };
  await assert.rejects(request("/api/example", { method: "DELETE" }), /恢复任务失败/);
  assert.equal(await request("/api/workspace"), "ok");
});

test("unavailable status fails closed, browser preview and legacy preload remain compatible", async () => {
  assert.equal((await readBackendStatus({})).agentReady, true);
  assert.equal(normalizeBackendStatus({ state: "ready" }).agentReady, true);
  assert.equal(normalizeBackendStatus({ state: "ready", agentReady: false }).agentReady, false);
  assert.equal(normalizeBackendStatus({ dataReady: false, agentReady: true }).agentReady, false);
  assert.equal(normalizeBackendStatus({}).agentReady, false);
  await assert.rejects(requireAgentReady({ getBackendStatus: async () => { throw Error("IPC unavailable"); } }), /IPC unavailable/);
});
