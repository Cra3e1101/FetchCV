import { BrowserWindow, session } from "electron";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import net from "node:net";

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT_CHARS = 50000;
const PARTITION = "persist:fetchcv-browser";
const DNS_CACHE_MS = 5 * 60 * 1000;

function publicIpv4(value) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function publicIpv6(value) {
  const normalized = value.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return false;
  if (normalized.startsWith("::ffff:")) return publicIpv4(normalized.slice(7));
  return true;
}

function isPublicIp(value) {
  const family = net.isIP(value);
  if (family === 4) return publicIpv4(value);
  if (family === 6) return publicIpv6(value);
  return false;
}

async function createUrlValidator() {
  const cache = new Map();
  return async (value) => {
    let parsed;
    try { parsed = new URL(String(value || "")); } catch { throw new Error("browser_url_invalid"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) throw new Error("browser_url_denied");
    const host = parsed.hostname.replace(/\.$/, "").toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local")) throw new Error("browser_host_denied");
    const cached = cache.get(host);
    let addresses = cached?.expiresAt > Date.now() ? cached.addresses : null;
    if (!addresses) {
      addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
      cache.set(host, { addresses, expiresAt: Date.now() + DNS_CACHE_MS });
    }
    if (!addresses.length || addresses.some((item) => !isPublicIp(item.address))) throw new Error("browser_private_address_denied");
    return parsed.toString();
  };
}

function jsonResponse(response, status, payload) {
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

function waitForLoad(contents, timeoutMs = 25000) {
  if (!contents.isLoading()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      contents.removeListener("did-stop-loading", done);
      contents.removeListener("did-fail-load", done);
      resolve();
    }
    contents.once("did-stop-loading", done);
    contents.once("did-fail-load", done);
  });
}

export async function startBrowserBridge() {
  const token = randomBytes(32).toString("hex");
  const validateUrl = await createUrlValidator();
  const browserSession = session.fromPartition(PARTITION, { cache: true });
  let browserWindow = null;

  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  browserSession.on("will-download", (event) => event.preventDefault());
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    let protocol = "";
    try { protocol = new URL(details.url).protocol; } catch { callback({ cancel: true }); return; }
    // Electron creates a hidden document before the first real navigation.
    // Blocking this internal page makes loadURL fail with ERR_ABORTED before
    // the requested recruitment page is even reached.
    if (details.url === "about:blank") { callback({ cancel: false }); return; }
    if (protocol === "data:" || protocol === "blob:") { callback({ cancel: false }); return; }
    validateUrl(details.url).then(() => callback({ cancel: false })).catch(() => callback({ cancel: true }));
  });

  function ensureWindow() {
    if (browserWindow && !browserWindow.isDestroyed()) return browserWindow;
    browserWindow = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 800,
      minHeight: 560,
      show: false,
      title: "FetchCV Browser",
      backgroundColor: "#faf9f5",
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    browserWindow.webContents.on("will-navigate", (event, url) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    browserWindow.on("closed", () => { browserWindow = null; });
    return browserWindow;
  }

  async function snapshot() {
    if (!browserWindow || browserWindow.isDestroyed()) return { open: false, loading: false, url: "", title: "", login_required: false, user_action: "" };
    const contents = browserWindow.webContents;
    const page = await contents.executeJavaScript(`(() => {
      const clean = (root) => {
        const copy = root?.cloneNode(true);
        copy?.querySelectorAll('header, nav, footer, aside, form, script, style, noscript, svg, canvas, template').forEach((node) => node.remove());
        return String(copy?.innerText || '').replace(/\\s+/g, ' ').trim();
      };
      const roots = Array.from(document.querySelectorAll('main, article, [role="main"], #app, #root, .job-detail, .job-detail-content, .job-info, .job-description, [class*="jobDetail" i], [class*="job-detail" i], [class*="jobInfo" i], [class*="job-info" i]'));
      const candidates = roots.map(clean).filter(Boolean);
      candidates.push(clean(document.body));
      const jobSignal = (value) => /岗位职责|工作职责|工作内容|职位描述|任职要求|职位要求|岗位要求|实习内容|responsibilities|qualifications|requirements|job description/i.test(value);
      const text = candidates.sort((left, right) => ((jobSignal(right) ? 100000 : 0) + right.length) - ((jobSignal(left) ? 100000 : 0) + left.length))[0] || '';
      const visible = (node) => Boolean(node && (node.getClientRects().length || node.offsetWidth || node.offsetHeight));
      const password = Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
      const captcha = Array.from(document.querySelectorAll('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i], [class*="verify" i]')).some(visible) || /验证码|人机验证|captcha|verify you are human|security check/i.test(text.slice(0, 12000));
      return { text: text.slice(0, ${MAX_TEXT_CHARS}), password, captcha, job_ready: jobSignal(text) && text.length >= 180 };
    })()`, true).catch(() => ({ text: "", password: false, captcha: false, job_ready: false }));
    const loginRequired = Boolean(page.password || page.captcha);
    return {
      open: true,
      loading: contents.isLoading(),
      url: contents.getURL(),
      title: contents.getTitle(),
      login_required: loginRequired,
      user_action: page.captcha ? "captcha" : page.password ? "login" : "",
      text: page.text,
      job_ready: Boolean(page.job_ready),
      truncated: page.text.length >= MAX_TEXT_CHARS,
    };
  }

  async function command(payload) {
    const action = String(payload?.command || "");
    if (action === "status") return snapshot();
    if (action === "close") {
      if (browserWindow && !browserWindow.isDestroyed()) browserWindow.destroy();
      return { open: false };
    }
    if (action === "open") {
      const url = await validateUrl(payload?.url);
      const window = ensureWindow();
      // Web reads stay inside the agent. A visible window is reserved for an
      // explicit future user-login flow, so background tool calls never steal focus.
      window.hide();
      // A newly-created BrowserWindow can still be completing its implicit
      // about:blank navigation. Wait for that document before navigating so
      // Electron does not surface its cancellation as the requested page's
      // load error.
      await waitForLoad(window.webContents, 3000);
      try {
        await window.loadURL(url);
      } catch (error) {
        if (!String(error?.message || error).includes("about:blank")) throw error;
        await waitForLoad(window.webContents, 3000);
        await window.loadURL(url);
      }
      await waitForLoad(window.webContents);
      // SPA recruitment pages often finish network loading before rendering
      // the job body. Poll the hidden page briefly instead of returning the
      // navigation shell as if it were a valid posting.
      let state = await snapshot();
      for (let index = 0; index < 15 && !state.login_required && !state.job_ready; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        state = await snapshot();
      }
      return state;
    }
    if (action === "read") {
      const state = await snapshot();
      if (!state.open) throw new Error("browser_not_open");
      return state;
    }
    throw new Error("browser_command_invalid");
  }

  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/command") { jsonResponse(response, 404, { error: "not_found" }); return; }
    if (request.headers.authorization !== `Bearer ${token}`) { jsonResponse(response, 403, { error: "forbidden" }); return; }
    try {
      jsonResponse(response, 200, { ok: true, result: await command(await readBody(request)) });
    } catch (error) {
      jsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "browser_command_failed" });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  return {
    url: `http://${HOST}:${address.port}`,
    token,
    stop() {
      if (browserWindow && !browserWindow.isDestroyed()) browserWindow.destroy();
      server.close();
    },
  };
}
