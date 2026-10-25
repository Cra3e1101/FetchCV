import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("missing preload rejects Agent operations without HTTP fallback; desktop dispatch still works", async t => {
  const oldWindow = globalThis.window;
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.window = oldWindow; globalThis.fetch = oldFetch; });
  globalThis.window = { appRuntime: { apiBase: "http://127.0.0.1:1" } };
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("unexpected fallback"); };
  // Resolve the extensionless Vite import for Node; execute the actual API
  // module unchanged otherwise, without a duplicate test implementation.
  const source = (await readFile(new URL("../src/lib/api.js", import.meta.url), "utf8"))
    .replace('"./http-client"', JSON.stringify(new URL("../src/lib/http-client.js", import.meta.url).href))
    .replace('"./backend-readiness.js"', JSON.stringify(new URL("../src/lib/backend-readiness.js", import.meta.url).href));
  const { api } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  delete window.appRuntime;
  for (const operation of [() => api.streamMessage("j", "hello"), () => api.sendMessage("j", "hello"),
    () => api.enqueueTask("r"), () => api.resumeTask("t", "r"), () => api.retryTask("t", "r"),
    () => api.resumeRun("r"), () => api.retryRun("r"), () => api.steerTask("r", "hello")]) {
    await assert.rejects(operation(), { code: "desktop_agent_required" });
  }
  assert.equal(requests, 0);
  const calls = [];
  window.appRuntime = {
    startPiTask: async (...args) => { calls.push(args); return { status: "running" }; },
    streamPiMessage: async (...args) => { calls.push(args); return { assistant: { content: "ok" } }; },
  };
  assert.equal((await api.enqueueTask("r", { kind: "start" })).status, "running");
  assert.deepEqual(calls[0], ["r", "start"]);
  assert.equal((await api.streamMessage("j", "hello")).assistant.content, "ok");
  assert.equal(requests, 0);
  window.appRuntime.getBackendStatus = async () => ({ state: "ready", dataReady: true, agentReady: false });
  window.appRuntime.steerPiTask = async (...args) => calls.push(args);
  const dispatched = calls.length;
  for (const operation of [() => api.streamMessage("j", "hello"), () => api.enqueueTask("r"),
    () => api.steerTask("r", "hello"), () => api.createConversation()]) {
    await assert.rejects(operation(), { code: "agent_not_ready" });
  }
  assert.equal(calls.length, dispatched);
  assert.equal(requests, 0);
});
