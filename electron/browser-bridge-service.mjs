import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 16 * 1024;
const COMMANDS = new Set(["status", "close", "open", "read", "ocr_result"]);

function jsonResponse(response, status, payload) {
  if (response.destroyed) return;
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.length, "cache-control": "no-store" });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function loadRuntime(options) {
  const { createBrowserRuntime } = await import("./browser-bridge.mjs");
  if (options.signal.aborted) throw new Error("browser_bridge_stopped");
  return createBrowserRuntime(options);
}

export async function prepareBrowserBridge() {
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen({ host: HOST, port: 0, exclusive: true }, () => {
      const address = probe.address();
      probe.close(() => typeof address === "object" && address?.port ? resolve(address.port) : reject(new Error("browser_bridge_port_unavailable")));
    });
  });
  const token = randomBytes(32).toString("hex");
  return { port, token, url: `http://${HOST}:${port}` };
}

// The loopback listener can start with the sidecar. Importing Electron browser
// code, opening its persistent session, and decrypting its cache happen only
// when authenticated browser work is requested. The factory parameter lets the
// listener/lifecycle contract be tested without starting Chromium.
export async function startBrowserBridge(options = {}, runtimeFactory = loadRuntime) {
  const token = options.token || randomBytes(32).toString("hex");
  let runtime = null;
  let runtimePromise = null;
  let stopped = false;
  const lifecycle = new AbortController();
  const mark = (stage) => {
    try { options.onStartupEvent?.(stage); } catch { /* Telemetry cannot block browser work. */ }
  };
  function assertRunning() {
    if (stopped) throw new Error("browser_bridge_stopped");
  }
  async function initialize() {
    assertRunning();
    if (!runtimePromise) {
      runtimePromise = Promise.resolve().then(async () => {
        assertRunning();
        mark("browser.runtime_start");
        const created = await runtimeFactory({ ...options, signal: lifecycle.signal });
        if (stopped) {
          created.stop();
          throw new Error("browser_bridge_stopped");
        }
        runtime = created;
        mark("browser.runtime_ready");
        return created;
      }).catch((error) => {
        runtimePromise = null;
        mark("browser.runtime_failed");
        throw error;
      });
    }
    return runtimePromise;
  }
  async function command(payload) {
    assertRunning();
    const action = String(payload?.command || "");
    if (!COMMANDS.has(action)) throw new Error("browser_command_invalid");
    if (!runtime && action === "status") {
      return { open: false, loading: false, url: "", title: "", login_required: false, user_action: "", initializing: Boolean(runtimePromise) };
    }
    if (!runtime && !runtimePromise && action === "close") return { open: false };
    const ready = await initialize();
    assertRunning();
    return ready.command(payload);
  }
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/command") { jsonResponse(response, 404, { error: "not_found" }); return; }
    if (request.headers.authorization !== `Bearer ${token}`) { jsonResponse(response, 403, { error: "forbidden" }); return; }
    try {
      jsonResponse(response, 200, { ok: true, result: await command(await readBody(request)) });
    } catch (error) {
      console.error("Controlled browser command failed:", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      jsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "browser_command_failed", code: error?.code || "", details: error?.details || {} });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(options.port) || 0, HOST, resolve);
  });
  const address = server.address();
  return {
    url: `http://${HOST}:${address.port}`,
    token,
    initialize,
    accessStatus() { return runtime?.accessStatus() ?? null; },
    externalResolutionStatus() { return runtime?.externalResolutionStatus() ?? null; },
    async beginLogin() { return (await initialize()).beginLogin(); },
    async finishLogin() { return (await initialize()).finishLogin(); },
    async resolveExternal(value, context = {}) { return (await initialize()).resolveExternal(value, context); },
    stop() {
      if (stopped) return;
      stopped = true;
      lifecycle.abort();
      runtime?.stop();
      server.close();
      server.closeAllConnections();
    },
  };
}
