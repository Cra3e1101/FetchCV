import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { prepareBrowserBridge, startBrowserBridge } from "../electron/browser-bridge-service.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function request(bridge, payload, overrides = {}) {
  const response = await fetch(`${bridge.url}/command`, {
    method: "POST",
    headers: { authorization: `Bearer ${bridge.token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    ...overrides,
  });
  return { status: response.status, body: await response.json() };
}

function fakeRuntime() {
  return {
    command: async (payload) => ({ command: payload.command }),
    accessStatus: () => ({ remaining_requests: 2 }),
    externalResolutionStatus: () => ({ cacheHit: true }),
    beginLogin: async () => ({ opened: true }),
    finishLogin: async () => ({ connected: true }),
    resolveExternal: async (value) => value,
    stop() {},
  };
}

test("listener starts on prepared loopback endpoint without initializing Chromium", async (t) => {
  let calls = 0;
  const options = await prepareBrowserBridge();
  const bridge = await startBrowserBridge(options, () => { calls++; return fakeRuntime(); });
  t.after(() => bridge.stop());
  assert.equal(bridge.url, options.url);
  assert.equal(bridge.token, options.token);
  assert.equal(options.token.length, 64);
  assert.equal(calls, 0);
  const status = await request(bridge, { command: "status" });
  assert.equal(status.status, 200);
  assert.equal(status.body.result.open, false);
  assert.equal(status.body.result.initializing, false);
  assert.equal((await request(bridge, { command: "close" })).body.result.open, false);
  assert.equal(bridge.accessStatus(), null);
  assert.equal(bridge.externalResolutionStatus(), null);
  assert.equal(calls, 0);
});

test("auth, routes, JSON and command validation run before expensive initialization", async (t) => {
  let calls = 0;
  const bridge = await startBrowserBridge({}, () => { calls++; return fakeRuntime(); });
  t.after(() => bridge.stop());
  for (const authorization of ["", "Bearer wrong-token"]) {
    assert.equal((await request(bridge, { command: "open", url: "https://example.com" }, { headers: { authorization } })).status, 403);
  }
  assert.equal((await fetch(`${bridge.url}/command`)).status, 404);
  assert.equal((await request(bridge, { command: "unknown" })).body.error, "browser_command_invalid");
  assert.equal((await request(bridge, {}, { body: "{" })).status, 400);
  // The body cap may close the underlying request stream; either way it must
  // reject the request without allocating a session or decrypting local data.
  const oversized = await request(bridge, { command: "open", url: "x".repeat(20 * 1024) }).catch(() => null);
  if (oversized) assert.equal(oversized.body.error, "request_too_large");
  assert.equal(calls, 0);
});

test("concurrent first requests share initialization and status remains responsive", async (t) => {
  const entered = deferred();
  const release = deferred();
  const events = [];
  let calls = 0;
  const bridge = await startBrowserBridge({ onStartupEvent: (stage) => events.push(stage) }, async () => {
    calls++;
    entered.resolve();
    await release.promise;
    return fakeRuntime();
  });
  t.after(() => { release.resolve(); bridge.stop(); });
  const first = request(bridge, { command: "open" });
  await entered.promise;
  const second = bridge.beginLogin();
  const status = await request(bridge, { command: "status" });
  assert.equal(status.body.result.initializing, true);
  assert.equal(calls, 1);
  release.resolve();
  assert.equal((await first).body.result.command, "open");
  assert.deepEqual(await second, { opened: true });
  assert.equal(calls, 1);
  assert.deepEqual(events, ["browser.runtime_start", "browser.runtime_ready"]);
  assert.deepEqual(bridge.accessStatus(), { remaining_requests: 2 });
});

test("failed browser initialization is isolated and can be retried", async (t) => {
  let calls = 0;
  const events = [];
  const bridge = await startBrowserBridge({ onStartupEvent: (stage) => events.push(stage) }, () => {
    if (++calls === 1) throw new Error("browser_init_failed");
    return fakeRuntime();
  });
  t.after(() => bridge.stop());
  assert.equal((await request(bridge, { command: "read" })).body.error, "browser_init_failed");
  assert.equal((await request(bridge, { command: "status" })).status, 200);
  assert.equal((await request(bridge, { command: "read" })).status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(events, ["browser.runtime_start", "browser.runtime_failed", "browser.runtime_start", "browser.runtime_ready"]);
});

test("shutdown during pending initialization disposes late runtime and rejects work", async () => {
  const entered = deferred();
  const release = deferred();
  let stopCount = 0;
  let workCount = 0;
  let signal;
  const bridge = await startBrowserBridge({}, async (options) => {
    signal = options.signal;
    entered.resolve();
    await release.promise;
    return { ...fakeRuntime(), beginLogin: () => { workCount++; }, stop: () => { stopCount++; } };
  });
  const pending = bridge.beginLogin();
  const rejection = assert.rejects(pending, /browser_bridge_stopped/);
  await entered.promise;
  bridge.stop();
  assert.equal(signal.aborted, true);
  release.resolve();
  await rejection;
  bridge.stop();
  await assert.rejects(bridge.initialize(), /browser_bridge_stopped/);
  assert.equal(stopCount, 1);
  assert.equal(workCount, 0);
});

test("shutdown before initialization microtask does not start runtime", async () => {
  let calls = 0;
  const bridge = await startBrowserBridge({}, () => { calls++; return fakeRuntime(); });
  const pending = bridge.initialize();
  bridge.stop();
  await assert.rejects(pending, /browser_bridge_stopped/);
  assert.equal(calls, 0);
});

test("startup event sink failures cannot break browser functionality", async (t) => {
  const bridge = await startBrowserBridge({ onStartupEvent: () => { throw new Error("telemetry_error"); } }, fakeRuntime);
  t.after(() => bridge.stop());
  assert.equal((await request(bridge, { command: "read" })).status, 200);
});

test("lazy runtime retains URL and subresource restrictions before creating a window", async () => {
  // Bundle the actual implementation with only the native Electron surface
  // substituted, so the real URL validator and request handlers execute.
  const bundle = await build({
    stdin: {
      contents: 'export { createBrowserRuntime } from "../electron/browser-bridge.mjs"; export { state } from "electron";',
      resolveDir: import.meta.dirname,
    },
    platform: "node", format: "esm", bundle: true, write: false,
    plugins: [{
      name: "fake-electron",
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "test" }));
        build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `
          export const state = { windows: 0, sessionCount: 0, beforeRequest: null, permission: null };
          export class BrowserWindow { constructor() { state.windows++; throw new Error("unexpected_window"); } }
          export const safeStorage = { isEncryptionAvailable: () => false };
          export const session = { fromPartition() {
            state.sessionCount++;
            return {
              setPermissionRequestHandler(handler) { state.permission = handler; },
              on() {},
              webRequest: { onBeforeRequest(handler) { state.beforeRequest = handler; } }
            };
          } };
        ` }));
      },
    }],
  });
  const { createBrowserRuntime, state } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  assert.equal(state.sessionCount, 0);
  const runtime = await createBrowserRuntime();
  try {
    assert.equal(state.sessionCount, 1);
    for (const url of ["http://example.com", "https://user@example.com", "https://example.com:8443", "https://localhost", "https://127.0.0.1", "https://10.0.0.1", "https://192.168.1.1"]) {
      await assert.rejects(runtime.command({ command: "open", url }), /browser_(url|host|private_address)_denied/);
      const decision = await new Promise((resolve) => state.beforeRequest({ url }, resolve));
      assert.deepEqual(decision, { cancel: true });
    }
    let granted;
    state.permission(null, "camera", (allowed) => { granted = allowed; });
    assert.equal(granted, false);
    assert.equal(state.windows, 0);
  } finally {
    runtime.stop();
  }
  await assert.rejects(runtime.command({ command: "open", url: "https://example.com" }), /browser_bridge_stopped/);
  assert.equal(state.windows, 0);
});
