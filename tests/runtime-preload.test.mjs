import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { validateRequest } from "../packages/contracts/runtime.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isTrustedFrame } from "../packages/app/runtime-rpc.mjs";

function preload(invoke) {
  const exposed = {};
  const ipc = new EventEmitter(); ipc.invoke = (...args) => invoke(ipc, ...args);
  vm.runInNewContext(fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8"), {
    require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } } }),
    process: { argv: [], platform: "win32" },
  });
  return { api: exposed.appRuntime, ipc };
}
test("real preload sends versioned requests, filters duplicate seq, signals gaps and releases subscription", async () => {
  const observed = [];
  const { api, ipc } = preload(async (emitter, channel, raw) => {
    assert.equal(channel, "runtime:request");
    const request = validateRequest(raw, "local");
    if (request.method === "agent.ack") return { ok: true, result: { acknowledged: request.payload.afterSeq } };
    assert.equal(request.method, "agent.turn");
    for (const seq of [1, 1, 3]) emitter.emit(`runtime:event:${request.id}`, {}, { v: 1, streamId: request.id, seq, name: "status", payload: { seq } });
    return { ok: true, result: "settled" };
  });
  assert.equal(await api.streamPiMessage({ requestId: "test-1", jobId: "job-1", content: "hi", taskKind: null, quote: null, attachmentPaths: [] }, (name, value) => observed.push([name, value])), "settled");
  assert.deepEqual(observed.map(([name]) => name), ["status", "gap", "status"]);
  assert.equal(ipc.listenerCount("runtime:event:test-1"), 0);
});
test("preload failure retains error code and cleans listener", async () => {
  const { api, ipc } = preload(async () => ({ ok: false, error: { code: "cancelled", message: "stopped" } }));
  await assert.rejects(api.streamPiMessage({ requestId: "test-2" }), { name: "AbortError", code: "cancelled" });
  assert.equal(ipc.listenerCount("runtime:event:test-2"), 0);
});
test("every actual main-process IPC handler rejects a foreign frame before side effects", () => {
  const source = fs.readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function registerIpc() {");
  const end = source.indexOf("\nfunction ", start + 1);
  const handlers = new Map(), listeners = new Map();
  vm.runInNewContext(`${source.slice(start, end)}\nregisterIpc();`, {
    path, pathToFileURL, isTrustedFrame, projectRoot: process.cwd(),
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => listeners.set(name, handler) },
    backendState: "ready", backendApiBase: "synthetic", backendError: null,
  });
  const frame = { url: pathToFileURL(path.join(process.cwd(), "dist", "index.html")).href };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  const foreign = { sender, senderFrame: { ...frame } };
  assert.equal(handlers.size, 19);
  assert.equal(listeners.size, 3);
  for (const [name, handler] of handlers) assert.throws(() => handler(foreign), /sender_denied/, name);
  for (const handler of listeners.values()) assert.doesNotThrow(() => handler(foreign));
  assert.equal(handlers.get("backend:get-status")({ sender, senderFrame: frame }).state, "ready");
});
