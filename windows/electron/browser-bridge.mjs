import { BrowserWindow, safeStorage, session } from "electron";
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createLocalNoteOcr } from "./local-note-ocr.mjs";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import {
  canonicalXiaohongshuUrl,
  createXiaohongshuAccessCache,
  createXiaohongshuPublicAccessGuard,
  createBrowserCommandGate,
  extractXiaohongshuNote,
  isXiaohongshuUrl,
  xiaohongshuRecoveryQueries,
} from "./xiaohongshu-adapter.mjs";

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT_CHARS = 50000;
// Research is isolated from account sessions and reuses encrypted local pages.
// Public access is budgeted and stops on restriction; no frequency guarantees safety.
const PARTITION = "persist:fetchcv-public-browser-v2";
const DNS_CACHE_MS = 5 * 60 * 1000;
const XHS_SEARCH_CACHE_MS = 4 * 60 * 60 * 1000;
const XHS_NOTE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

function decryptLocalCredentialFile(filePath) {
  const encrypted = fs.readFileSync(filePath);
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(encrypted);
    } catch {
      // Older FetchCV releases stored a raw Windows DPAPI blob instead of
      // Electron safeStorage's wrapped format. Fall through to the OS API.
    }
  }
  if (process.platform !== "win32") throw new Error("local_credential_decryption_unavailable");
  const powershell = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script = [
    "& { param([string]$credentialPath)",
    "Add-Type -AssemblyName System.Security",
    "$encrypted=[System.IO.File]::ReadAllBytes($credentialPath)",
    "$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
    "[Console]::Write([System.Text.Encoding]::UTF8.GetString($plain))",
    "}",
  ].join("; ");
  const result = spawnSync(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", script, filePath],
    { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 },
  );
  if (result.status !== 0 || !result.stdout) {
    const detail = String(result.stderr || result.error?.message || "").replace(/\s+/g, " ").trim().slice(0, 300);
    throw new Error(`local_credential_decryption_failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout;
}

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

function collectXiaohongshuSearchCandidates(value, output = new Map(), visited = new WeakSet(), depth = 0) {
  if (!value || typeof value !== "object" || depth > 10 || visited.has(value) || output.size >= 80) return output;
  visited.add(value);
  if (!Array.isArray(value)) {
    const card = value.noteCard && typeof value.noteCard === "object"
      ? value.noteCard
      : value.note_card && typeof value.note_card === "object"
        ? value.note_card
        : value;
    const modelType = value.modelType || value.model_type || card.modelType || card.model_type || "";
    const noteId = String(card.noteId || card.note_id || value.noteId || value.note_id || (modelType === "note" ? value.id || card.id : "") || "");
    const accessToken = String(value.xsecToken || value.xsec_token || card.xsecToken || card.xsec_token || "");
    if (/^[a-zA-Z0-9_-]{12,80}$/.test(noteId) && accessToken) {
      const target = new URL(`/explore/${encodeURIComponent(noteId)}`, "https://www.xiaohongshu.com");
      target.searchParams.set("xsec_token", accessToken);
      target.searchParams.set("xsec_source", String(value.xsecSource || value.xsec_source || card.xsecSource || card.xsec_source || "pc_search"));
      output.set(noteId, {
        url: target.toString(),
        title: String(card.displayTitle || card.display_title || card.title || card.desc || card.description || "小红书公开笔记").replace(/\s+/g, " ").trim().slice(0, 300),
      });
    }
  }
  for (const item of Object.values(value)) {
    collectXiaohongshuSearchCandidates(item, output, visited, depth + 1);
    if (output.size >= 80) break;
  }
  return output;
}

function xiaohongshuNoteId(value) {
  try {
    return /^\/(?:explore|discovery\/item)\/([a-zA-Z0-9_-]{12,80})(?:\/|$)/
      .exec(new URL(String(value || "")).pathname)?.[1] || "";
  } catch {
    return "";
  }
}

function hasXiaohongshuAccessGrant(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.hostname.endsWith("xhslink.com") || Boolean(parsed.searchParams.get("xsec_token"));
  } catch {
    return false;
  }
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

export async function startBrowserBridge(options = {}) {
  const token = options.token || randomBytes(32).toString("hex");
  const validateUrl = await createUrlValidator();
  const browserSession = session.fromPartition(PARTITION, { cache: true });
  let storedAccessEntries = [];
  let storedDocument = {};
  if (options.accessCacheFile && safeStorage.isEncryptionAvailable() && fs.existsSync(options.accessCacheFile)) {
    try {
      storedDocument = JSON.parse(decryptLocalCredentialFile(options.accessCacheFile)) || {};
      storedAccessEntries = storedDocument.entries || [];
    } catch {
      storedAccessEntries = [];
    }
  }
  let pendingGuardState = storedDocument.guard || {};
  const xhsPageCache = new Map((storedDocument.pages || []).filter(([, entry]) => entry?.expiresAt > Date.now()).slice(-80));
  let accessCacheWriteTimer = null;
  let pendingAccessEntries = storedAccessEntries;
  const persistAccessEntries = () => {
    if (!options.accessCacheFile || !safeStorage.isEncryptionAvailable()) return;
    fs.mkdirSync(path.dirname(options.accessCacheFile), { recursive: true });
    fs.writeFileSync(
      options.accessCacheFile,
      safeStorage.encryptString(JSON.stringify({ version: 2, entries: pendingAccessEntries, guard: pendingGuardState, pages: [...xhsPageCache].filter(([, entry]) => entry.expiresAt > Date.now()).slice(-80) })),
    );
  };
  const scheduleAccessCacheWrite = (entries) => {
    pendingAccessEntries = entries;
    if (!options.accessCacheFile || !safeStorage.isEncryptionAvailable()) return;
    if (accessCacheWriteTimer) clearTimeout(accessCacheWriteTimer);
    accessCacheWriteTimer = setTimeout(() => {
      accessCacheWriteTimer = null;
      try { persistAccessEntries(); } catch { /* Access cache is an optimization, never a startup blocker. */ }
    }, 120);
  };
  const xhsAccessCache = createXiaohongshuAccessCache({
    initialEntries: storedAccessEntries,
    onChange: scheduleAccessCacheWrite,
  });
  const xhsPublicGuard = createXiaohongshuPublicAccessGuard({ initialState: pendingGuardState, onChange: (state) => {
    pendingGuardState = state;
    try { persistAccessEntries(); } catch { /* Persistence failure must not reset the in-memory guard. */ }
  } });
  const xhsNetworkCandidates = new Map();
  const xhsSearchRequests = new Set();
  const xhsObservedSearchPaths = new Set();
  let lastExternalResolution = null;
  let lastBlockedRequest = null;
  let browserWindow = null;
  let paintedFrame = null;
  const getPaintedFrame = () => paintedFrame;
  let loginWindow = null;
  const imageRequests = new Map();
  const loadedImages = new Map();
  const imageReads = new Set();
  const ocrDirectory = options.accessCacheFile ? path.join(path.dirname(options.accessCacheFile), "interview-ocr") : "";
  const ocrBinary = path.join(process.env.ProgramFiles || "C:\\Program Files", "Tesseract-OCR", "tesseract.exe");
  const localOcr = ocrDirectory && fs.existsSync(ocrBinary) ? createLocalNoteOcr({ directory: ocrDirectory, binary: ocrBinary }) : null;

  // Research uses its own public partition. Never import saved account cookies
  // into background research; rate limiting alone cannot guarantee account safety.

  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  browserSession.on("will-download", (event) => event.preventDefault());
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    let protocol = "";
    let parsedRequest = null;
    try {
      parsedRequest = new URL(details.url);
      protocol = parsedRequest.protocol;
    } catch {
      lastBlockedRequest = { url: String(details.url || "").slice(0, 240), reason: "invalid_url" };
      callback({ cancel: true });
      return;
    }
    // Electron creates a hidden document before the first real navigation.
    // Blocking this internal page makes loadURL fail with ERR_ABORTED before
    // the requested recruitment page is even reached.
    if (details.url === "about:blank") { callback({ cancel: false }); return; }
    if (protocol === "data:" || protocol === "blob:") { callback({ cancel: false }); return; }
    // Xiaohongshu occasionally emits an HTTP location while normalizing
    // /search_result to /search_result/. Keep the strict HTTPS boundary by
    // upgrading only this allow-listed host instead of cancelling the search.
    if (protocol === "http:" && isXiaohongshuUrl(details.url)) {
      parsedRequest.protocol = "https:";
      callback({ redirectURL: parsedRequest.toString() });
      return;
    }
    validateUrl(details.url)
      .then(() => callback({ cancel: false }))
      .catch((error) => {
        lastBlockedRequest = {
          url: String(details.url || "").slice(0, 240),
          reason: String(error?.message || error).slice(0, 160),
        };
        callback({ cancel: true });
      });
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
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    browserWindow.webContents.on("paint", (_event, _dirty, image) => { if (!image.isEmpty()) paintedFrame = image; });
    try {
      browserWindow.webContents.debugger.attach("1.3");
      void browserWindow.webContents.debugger.sendCommand("Network.enable");
      browserWindow.webContents.debugger.on("message", (_event, method, params) => {
        if (method === "Network.responseReceived") {
          const responseUrl = String(params?.response?.url || "");
          if (String(params?.response?.mimeType || "").startsWith("image/") && /\/(?:explore|discovery\/item)\/[^/?]+/.test(browserWindow.webContents.getURL())) {
            if (imageRequests.size < 100) imageRequests.set(params.requestId, responseUrl);
          }
          if (isXiaohongshuUrl(responseUrl) && [401, 403, 429].includes(params?.response?.status)) {
            xhsPublicGuard.afterOpen({ user_action: "rate_limited" });
            if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.stop();
          }
          try {
            const observed = new URL(responseUrl);
            if (observed.hostname.endsWith("xiaohongshu.com") && /search|feed/i.test(observed.pathname)) {
              xhsObservedSearchPaths.add(observed.pathname.slice(0, 240));
            }
          } catch { /* ignore malformed CDP URLs */ }
          if (/xiaohongshu\.com\/api\/sns\/web\/v\d+\/search\/notes/i.test(responseUrl)) {
            xhsSearchRequests.add(params.requestId);
          }
          return;
        }
        if (method === "Network.loadingFinished" && imageRequests.has(params.requestId)) {
          const imageUrl = imageRequests.get(params.requestId);
          imageRequests.delete(params.requestId);
          if (params.encodedDataLength <= 8 * 1024 * 1024) {
            const read = browserWindow.webContents.debugger.sendCommand("Network.getResponseBody", { requestId: params.requestId })
              .then(({ body, base64Encoded }) => {
                const bytes = Buffer.from(body, base64Encoded ? "base64" : "utf8");
                const size = [...loadedImages.values()].reduce((sum, image) => sum + image.length, 0);
                if (bytes.length <= 8 * 1024 * 1024 && size + bytes.length <= 40 * 1024 * 1024) loadedImages.set(imageUrl, bytes);
              }).catch(() => {});
            imageReads.add(read);
            void read.finally(() => imageReads.delete(read));
          }
        }
        if (method !== "Network.loadingFinished" || !xhsSearchRequests.delete(params.requestId)) return;
        void browserWindow.webContents.debugger.sendCommand("Network.getResponseBody", { requestId: params.requestId })
          .then(({ body, base64Encoded }) => {
            const raw = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : String(body || "");
            if (!raw || raw.length > 8 * 1024 * 1024) return;
            const parsed = JSON.parse(raw);
            if ([-104, -102, 300012, 300013].includes(Number(parsed?.code)) || /访问频繁|访问异常|没有权限|验证码/.test(String(parsed?.msg || ""))) {
              xhsPublicGuard.afterOpen({ user_action: "rate_limited" });
              if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.stop();
              return;
            }
            for (const [noteId, candidate] of collectXiaohongshuSearchCandidates(parsed)) {
              xhsNetworkCandidates.set(noteId, candidate);
            }
          })
          .catch(() => {});
      });
    } catch {
      // DOM extraction remains available on Electron builds where the
      // debugging protocol cannot be attached.
    }
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
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const clean = (root, keepAside = false) => {
        const copy = root?.cloneNode(true);
        copy?.querySelectorAll(keepAside ? 'header, nav, footer, form, script, style, noscript, svg, canvas, template' : 'header, nav, footer, aside, form, script, style, noscript, svg, canvas, template').forEach((node) => node.remove());
        return normalize(copy?.innerText);
      };
      const host = location.hostname.toLowerCase();
      const isXhs = host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com') || host === 'xhslink.com' || host.endsWith('.xhslink.com');
      const isXhsNote = isXhs && /^\\/(?:discovery\\/item|explore)\\/[^/]+/.test(location.pathname);
      const isXhsSearch = isXhs && location.pathname.includes('/search_result');
      const roots = Array.from(document.querySelectorAll('main, article, [role="main"], #app, #root, .job-detail, .job-detail-content, .job-info, .job-description, [class*="jobDetail" i], [class*="job-detail" i], [class*="jobInfo" i], [class*="job-info" i]'));
      const candidates = roots.map(clean).filter(Boolean);
      candidates.push(clean(document.body));
      const jobSignal = (value) => /岗位职责|工作职责|工作内容|职位描述|任职要求|职位要求|岗位要求|实习内容|responsibilities|qualifications|requirements|job description/i.test(value);
      let text = candidates.sort((left, right) => ((jobSignal(right) ? 100000 : 0) + right.length) - ((jobSignal(left) ? 100000 : 0) + left.length))[0] || '';
      // Nowcoder's article container excludes the comment feed and recommendations.
      // If its layout changes, leave the body empty instead of persisting page chrome.
      const isNowcoderPost = ['www.nowcoder.com', 'm.nowcoder.com', 'nowcoder.com'].includes(location.hostname) && !location.pathname.startsWith('/search/');
      if (isNowcoderPost) text = clean(document.querySelector('.nc-post-content'));
      const visible = (node) => Boolean(node && (node.getClientRects().length || node.offsetWidth || node.offsetHeight));
      const password = Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
      const captcha = Array.from(document.querySelectorAll('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i], [class*="verify" i]')).some(visible) || /验证码|人机验证|captcha|verify you are human|security check/i.test(text.slice(0, 12000));

      const metaTitle = normalize(document.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.content || document.title);
      const metaDescription = normalize(document.querySelector('meta[property="og:description"], meta[name="description"], meta[name="twitter:description"]')?.content);
      const xhsNoteCandidates = [];
      let xhsPublishedAt = '';
      const normalizePublishedAt = (value) => {
        if (value === null || value === undefined || value === '') return '';
        const raw = String(value).trim();
        let timestamp = Number(raw);
        if (Number.isFinite(timestamp) && /^\\d{10,13}$/.test(raw)) {
          if (raw.length === 10) timestamp *= 1000;
          const date = new Date(timestamp);
          const year = date.getUTCFullYear();
          return year >= 2013 && year <= 2100 ? date.toISOString() : '';
        }
        const matched = raw.match(/(20\\d{2})[-/.年](\\d{1,2})[-/.月](\\d{1,2})/);
        if (matched) {
          const date = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])));
          return Number.isNaN(date.getTime()) ? '' : date.toISOString();
        }
        const date = new Date(raw);
        const year = date.getUTCFullYear();
        return !Number.isNaN(date.getTime()) && year >= 2013 && year <= 2100 ? date.toISOString() : '';
      };
      const rememberPublishedAt = (value) => {
        if (!xhsPublishedAt) xhsPublishedAt = normalizePublishedAt(value);
      };
      const addNoteCandidate = (value) => {
        const normalized = normalize(value);
        if (normalized.length >= 20 && !xhsNoteCandidates.includes(normalized)) xhsNoteCandidates.push(normalized);
      };
      let exactNote = null;
      if (isXhsNote) {
        const noteId = location.pathname.split('/').filter(Boolean).pop();
        try { exactNote = (${extractXiaohongshuNote.toString()})(window.__INITIAL_STATE__, noteId); } catch {}
        if (exactNote) {
          text = normalize([exactNote.title, exactNote.description].filter(Boolean).join(' '));
          rememberPublishedAt(exactNote.publishedAt);
        } else {
          // Only leaf description nodes, never the enclosing note/comment panel.
          document.querySelectorAll('#detail-desc, .note-content .desc, .note-text').forEach((node) => {
            if (visible(node)) addNoteCandidate(clean(node, true));
          });
          text = xhsNoteCandidates.sort((a, b) => b.length - a.length)[0] || '';
          if (text) text = normalize(metaTitle + ' ' + text);
        }
      }

      const seen = new Set();
      const links = Array.from(document.querySelectorAll('a[href]')).map((node) => {
        let href = '';
        try { href = new URL(node.href, location.href).toString(); } catch { return null; }
        if (!href.startsWith('https://') || seen.has(href)) return null;
        seen.add(href);
        const card = isXhs ? node.closest('section, article, [class*="note-item" i], [class*="feed-card" i], [class*="search-result" i]') : null;
        const title = normalize(node.innerText || node.getAttribute('aria-label') || node.title || clean(card, true)).slice(0, 300);
        return { url: href, title };
      }).filter(Boolean).slice(0, 120);
      const xhsCandidates = links.filter((item) => {
        try {
          const target = new URL(item.url);
          return target.hostname.toLowerCase().endsWith('xiaohongshu.com') && (target.pathname.startsWith('/explore/') || target.pathname.startsWith('/discovery/item/'));
        } catch { return false; }
      });
      const xhsCandidateIds = new Set(xhsCandidates.map((item) => {
        try { return new URL(item.url).pathname.split('/').filter(Boolean).pop() || ''; } catch { return ''; }
      }).filter(Boolean));
      const addXhsSearchCandidate = (noteId, title = '', accessToken = '', accessSource = '') => {
        const id = normalize(noteId);
        if (!/^[a-zA-Z0-9_-]{12,80}$/.test(id)) return;
        if (xhsCandidateIds.has(id)) return;
        const target = new URL('/explore/' + encodeURIComponent(id), location.origin);
        const token = normalize(accessToken);
        if (token) target.searchParams.set('xsec_token', token);
        target.searchParams.set('xsec_source', normalize(accessSource) || 'pc_search');
        const url = target.toString();
        xhsCandidateIds.add(id);
        xhsCandidates.push({ url, title: normalize(title).slice(0, 300) || '小红书公开笔记' });
      };
      if (isXhsSearch) {
        document.querySelectorAll('[data-note-id], [data-noteid]').forEach((node) => {
          addXhsSearchCandidate(node.getAttribute('data-note-id') || node.getAttribute('data-noteid'), clean(node, true));
        });
        const visitedSearchState = new WeakSet();
        let visitedSearchCount = 0;
        const inspectSearchState = (value, depth = 0) => {
          if (!value || typeof value !== 'object' || depth > 9 || visitedSearchCount > 9000 || visitedSearchState.has(value)) return;
          visitedSearchState.add(value);
          visitedSearchCount += 1;
          if (!Array.isArray(value)) {
            const card = value.noteCard && typeof value.noteCard === 'object'
              ? value.noteCard
              : value.note_card && typeof value.note_card === 'object'
                ? value.note_card
                : value;
            const modelType = value.modelType || value.model_type || card.modelType || card.model_type || '';
            const noteId = card.noteId || card.note_id || value.noteId || value.note_id || (modelType === 'note' ? value.id || card.id : '');
            const title = card.displayTitle || card.display_title || card.title || card.desc || card.description || '';
            const accessToken = value.xsecToken || value.xsec_token || card.xsecToken || card.xsec_token || '';
            const accessSource = value.xsecSource || value.xsec_source || card.xsecSource || card.xsec_source || '';
            if (noteId) addXhsSearchCandidate(noteId, title, accessToken, accessSource);
          }
          for (const item of Object.values(value)) inspectSearchState(item, depth + 1);
        };
        try { inspectSearchState(window.__INITIAL_STATE__); } catch {}
      }
      const xhsLogin = isXhs && /登录后查看|扫码登录|手机号登录|登录即可|请先登录/.test(clean(document.body).slice(0, 16000)) && !(isXhsNote && /面经|面试|一面|二面|三面|终面|HR面|面试官|复盘|问题|追问|自我介绍|case|群面/i.test(text));
      const imageCount = exactNote ? exactNote.imageCount : isXhsNote ? new Set(Array.from(document.querySelectorAll('.note-detail .swiper img, .note-detail-mask .swiper img')).map(node => node.currentSrc || node.src).filter(Boolean)).size : 0;
      const noteReady = isXhsNote && text.length >= 80 && /面经|面试|一面|二面|三面|终面|HR面|面试官|复盘|问题|追问|自我介绍|case|群面/i.test(text);
      const xhsReady = (isXhsSearch && xhsCandidates.length > 0) || noteReady;
      return {
        text: text.slice(0, ${MAX_TEXT_CHARS}), links, password, captcha, job_ready: jobSignal(text) && text.length >= 180,
        platform: isXhs ? 'xiaohongshu' : '', page_kind: isXhsNote ? 'note' : isXhsSearch ? 'search' : '',
        xhs_candidates: xhsCandidates, xhs_ready: xhsReady, note_ready: noteReady, xhs_login: xhsLogin,
        image_count: imageCount, image_urls: exactNote?.imageUrls || [], image_groups: exactNote?.imageGroups || [], meta_title: metaTitle, meta_description: metaDescription, published_at: xhsPublishedAt,
      };
    })()`, true).catch(() => ({ text: "", links: [], password: false, captcha: false, job_ready: false, xhs_candidates: [] }));
    const loginRequired = Boolean(page.password || page.captcha || page.xhs_login);
    const normalizeLink = (item) => {
      if (!item || typeof item.url !== "string") return null;
      const originalUrl = item.url;
      const relevantGrant = page.page_kind === "search" || (xiaohongshuNoteId(originalUrl) && xiaohongshuNoteId(originalUrl) === xiaohongshuNoteId(contents.getURL()));
      const url = isXiaohongshuUrl(originalUrl) ? relevantGrant ? xhsAccessCache.remember(originalUrl) : canonicalXiaohongshuUrl(originalUrl) : originalUrl;
      return {
        url,
        title: String(item.title || "").slice(0, 300),
        access_grant: isXiaohongshuUrl(originalUrl) && originalUrl !== url,
      };
    };
    const links = (page.links || []).map(normalizeLink).filter(Boolean);
    const rawXhsCandidates = [...xhsNetworkCandidates.values(), ...(page.xhs_candidates || [])];
    const xhsCandidatesByUrl = new Map();
    for (const item of rawXhsCandidates.map(normalizeLink).filter(Boolean)) {
      const current = xhsCandidatesByUrl.get(item.url);
      if (!current || (!current.access_grant && item.access_grant)) xhsCandidatesByUrl.set(item.url, item);
    }
    const xhsCandidates = [...xhsCandidatesByUrl.values()];
    return {
      open: true,
      loading: contents.isLoading(),
      url: contents.getURL(),
      title: contents.getTitle(),
      login_required: loginRequired,
      user_action: page.captcha ? "captcha" : page.password || page.xhs_login ? "login" : "",
      text: page.text,
      links,
      job_ready: Boolean(page.job_ready),
      platform: page.platform || "",
      page_kind: page.page_kind || "",
      note_ready: Boolean(page.note_ready),
      xhs_ready: Boolean(page.xhs_ready),
      candidates: xhsCandidates,
      candidate_access_grants: xhsCandidates.filter((item) => item.access_grant).length,
      observed_search_paths: [...xhsObservedSearchPaths].slice(0, 20),
      image_count: Number(page.image_count || 0),
      image_urls: page.image_urls || [],
      image_groups: page.image_groups || [],
      published_at: String(page.published_at || "").slice(0, 80),
      description: String(page.meta_description || "").slice(0, 1000),
      truncated: page.text.length >= MAX_TEXT_CHARS,
    };
  }

  async function readVisibleImage(state) {
    if (!localOcr) return { ...state, ocr_status: "unavailable" };
    try {
      await Promise.allSettled([...imageReads]);
      const files = [];
      const digest = createHash("sha256").update(canonicalXiaohongshuUrl(state.url));
      fs.mkdirSync(ocrDirectory, { recursive: true });
      const unique = new Set();
      for (const group of state.image_groups || []) {
        const url = group.find(value => loadedImages.has(value));
        if (!url) continue;
        const bytes = loadedImages.get(url);
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (unique.has(hash)) continue;
        unique.add(hash);
        const file = path.join(ocrDirectory, `${hash}.img`);
        fs.writeFileSync(file, bytes);
        files.push(file); digest.update(hash);
        if (files.length >= 12) break;
      }
      let method = "loaded_response";
      if (!files.length) {
        // Fallback uses already rendered pixels; it does not advance the carousel.
        const rect = await browserWindow.webContents.executeJavaScript(`(async () => {
          const images = Array.from(document.querySelectorAll('.note-detail-mask img, .note-detail img, .swiper img'));
          await Promise.race([Promise.allSettled(images.map(img => img.decode())), new Promise(resolve => setTimeout(resolve, 1000))]);
          return images.filter(img => img.complete && img.naturalWidth >= 300)
            .map(img => { const r = img.getBoundingClientRect(); return { x: Math.max(0, Math.ceil(r.x)), y: Math.max(0, Math.ceil(r.y)),
              width: Math.floor(Math.min(r.right, innerWidth) - Math.max(0, r.left)), height: Math.floor(Math.min(r.bottom, innerHeight) - Math.max(0, r.top)) }; })
            .filter(r => r.width >= 200 && r.height >= 200).sort((a,b) => b.width*b.height-a.width*a.height)[0] || null;
        })()`, true);
        if (!rect) return { ...state, ocr_status: "no_loaded_images" };
        // Offscreen frames are already rendered. Reading their bitmap avoids
        // Chromium capturePage's hidden-window compositor (UnknownVizError).
        {
          await new Promise(resolve => {
            const contents = browserWindow.webContents;
            const finish = () => { clearTimeout(timer); contents.removeListener("paint", onPaint); resolve(); };
            const onPaint = (_event, _dirty, image) => { if (!image.isEmpty()) finish(); };
            const timer = setTimeout(finish, 2000);
            contents.on("paint", onPaint);
            contents.startPainting();
            contents.invalidate();
          });
        }
        const frame = getPaintedFrame();
        if (!frame || frame.isEmpty()) return { ...state, ocr_status: "frame_not_ready" };
        const bytes = frame.crop(rect).toPNG();
        const hash = createHash("sha256").update(bytes).digest("hex");
        const file = path.join(ocrDirectory, `${hash}.png`);
        fs.writeFileSync(file, bytes); files.push(file); digest.update(hash);
        method = "visible_screenshot";
      }
      const job = localOcr.enqueue(digest.digest("hex"), files);
      return { ...state, ocr_status: job.status, ocr_job_id: job.id, ocr_images_saved: files.length,
        ocr_capture_method: method, ocr_images_processed: job.completed };
    } catch (error) {
      console.error("Local image preparation failed:", error.name, error.message);
      return { ...state, ocr_status: "failed", ocr_error_type: error.name };
    }
  }

  async function runCommand(payload) {
    if (payload?.command === "ocr_result") return localOcr ? localOcr.result(String(payload.job_id || "")) : { status: "unavailable", pages: [] };
    if (loginWindow && !loginWindow.isDestroyed()) {
      const error = new Error("请先完成或关闭小红书登录窗口，再恢复调研");
      error.code = "browser_busy";
      throw error;
    }
    const action = String(payload?.command || "");
    if (action === "status") return snapshot();
    if (action === "close") {
      if (browserWindow && !browserWindow.isDestroyed()) browserWindow.destroy();
      return { open: false };
    }
    if (action === "open") {
      const requestedUrl = await validateUrl(payload?.url);
      const isXhs = isXiaohongshuUrl(requestedUrl);
      const cacheKey = isXhs ? canonicalXiaohongshuUrl(requestedUrl) : "";
      if (isXhs) {
        if (new URL(requestedUrl).pathname.includes("/search_result")) {
          xhsNetworkCandidates.clear();
          xhsSearchRequests.clear();
          xhsObservedSearchPaths.clear();
        }
        xhsAccessCache.remember(requestedUrl);
        const cached = xhsPageCache.get(cacheKey);
        for (const entry of cached?.accessEntries || []) xhsAccessCache.remember(entry.url);
        const lostSearchGrant = cached?.state?.page_kind === "search" && (cached.state.candidates || []).some(item => item.access_grant && !hasXiaohongshuAccessGrant(xhsAccessCache.resolve(item.url)));
        if (!lostSearchGrant && cached?.expiresAt > Date.now() && (cached.state.page_kind !== 'note' || cached.extractionVersion === 4)) {
          const budget = xhsPublicGuard.status();
          return { ...cached.state, cooldown_until: budget.cooldown_until, retry_after_ms: budget.retry_after_ms,
            remaining_requests: budget.remaining_requests, request_limit: budget.request_limit, cache_hit: true };
        }
        if (cached) xhsPageCache.delete(cacheKey);
      }
      const access = isXhs ? xhsPublicGuard.beforeOpen(cacheKey) : null;
      if (isXhs) { imageRequests.clear(); loadedImages.clear(); }
      if (access?.waitMs) await new Promise((resolve) => setTimeout(resolve, access.waitMs));
      if (isXhs) xhsPublicGuard.assertAllowed();
      const url = await validateUrl(isXhs ? xhsAccessCache.resolve(cacheKey) : requestedUrl);
      const window = ensureWindow();
      paintedFrame = null;
      // Web reads stay inside the agent. A visible window is reserved for an
      // explicit future user-login flow, so background tool calls never steal focus.
      // This window is created hidden. Calling hide() again suspends the
      // offscreen compositor on Windows, leaving DOM ready but no paint frame.
      window.webContents.startPainting();
      // A newly-created BrowserWindow can still be completing its implicit
      // about:blank navigation. Wait for that document before navigating so
      // Electron does not surface its cancellation as the requested page's
      // load error.
      await waitForLoad(window.webContents, 3000);
      try {
        await window.loadURL(url);
      } catch (error) {
        if (!String(error?.message || error).includes("about:blank")) {
          if (isXhs) xhsPublicGuard.afterOpen({ user_action: "network_error" });
          throw error;
        }
        await waitForLoad(window.webContents, 3000);
        await window.loadURL(url);
      }
      await waitForLoad(window.webContents);
      // SPA recruitment pages often finish network loading before rendering
      // the job body. Poll the hidden page briefly instead of returning the
      // navigation shell as if it were a valid posting.
      let state = await snapshot();
      for (let index = 0; index < 15 && !state.job_ready && !state.xhs_ready; index += 1) {
        if (state.login_required) break;
        if (isXhs) xhsPublicGuard.assertAllowed();
        await new Promise((resolve) => setTimeout(resolve, 600));
        state = await snapshot();
      }
      if (isXhs && state.page_kind === "search" && !state.login_required) {
        // One deliberately paced incremental scroll at most. More scrolling
        // creates real search requests even though it looks like local UI work.
        const discoveryStartedAt = Date.now();
        let stopReason = "page_budget";
        try {
          const access = xhsPublicGuard.beforeOpen(requestedUrl);
          if (access.waitMs) await new Promise((resolve) => setTimeout(resolve, access.waitMs));
          xhsPublicGuard.assertAllowed();
          await window.webContents.executeJavaScript(`(() => {
            const root = document.scrollingElement || document.documentElement;
            root.scrollBy({ top: Math.round(root.clientHeight * 0.8), behavior: 'instant' });
          })()`, true);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          state = await snapshot();
          if (state.login_required) stopReason = state.user_action || "access_protection";
        } catch (error) {
          stopReason = String(error.code || error.message || "read_failed");
        }
        state = { ...state, discovery_exhausted: false, discovery_stop_reason: stopReason,
          discovery_duration_ms: Date.now() - discoveryStartedAt };
      }
      if (isXhs) {
        if (state.page_kind === "note" && state.image_count > 0 && !state.login_required) {
          state = await readVisibleImage(state);
        }
        const accountSession = (await browserSession.cookies.get({ url: "https://www.xiaohongshu.com/" }))
          .some((cookie) => cookie.name === "web_session" && Boolean(cookie.value));
        const publicStatus = xhsPublicGuard.afterOpen(state);
        state = {
          ...state,
          ...publicStatus,
          anonymous: !accountSession,
          account_session: accountSession,
          cache_hit: false,
        };
        if (state.xhs_ready && !state.login_required && !publicStatus.cooldown_until) {
          const ttlMs = state.page_kind === "search" ? XHS_SEARCH_CACHE_MS : XHS_NOTE_CACHE_MS;
          const candidateKeys = new Set((state.candidates || []).map(item => item.url));
          const accessEntries = state.page_kind === "search" ? xhsAccessCache.entries().filter(entry => candidateKeys.has(entry.canonical)) : [];
          xhsPageCache.set(cacheKey, { state, expiresAt: Date.now() + ttlMs, extractionVersion: 4, accessEntries });
          while (xhsPageCache.size > 80) xhsPageCache.delete(xhsPageCache.keys().next().value);
          scheduleAccessCacheWrite(xhsAccessCache.entries());
        }
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

  const command = createBrowserCommandGate(runCommand);
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/command") { jsonResponse(response, 404, { error: "not_found" }); return; }
    if (request.headers.authorization !== `Bearer ${token}`) { jsonResponse(response, 403, { error: "forbidden" }); return; }
    try {
      jsonResponse(response, 200, { ok: true, result: await command(await readBody(request)) });
    } catch (error) {
      console.error(
        "Controlled browser command failed:",
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      );
      jsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "browser_command_failed", code: error.code || "", details: error.details || {} });
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
    accessStatus() { return xhsPublicGuard.status(); },
    async beginLogin() {
      if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.show(); loginWindow.focus(); return { opened: true }; }
      // Reject while an automated navigation is active; the gate also protects
      // creation from racing with a subsequent command.
      await command({ command: "status" });
      loginWindow = new BrowserWindow({ width: 1080, height: 800, show: true, title: "小红书登录 · FetchCV",
        webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true } });
      loginWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      loginWindow.on("closed", () => { loginWindow = null; });
      await loginWindow.loadURL("https://www.xiaohongshu.com/explore");
      return { opened: true };
    },
    async finishLogin() {
      if (!loginWindow || loginWindow.isDestroyed()) return { connected: false, message: "请重新打开登录窗口并完成登录。" };
      const authenticated = await loginWindow.webContents.executeJavaScript(`(() => {
        const raw = window.__INITIAL_STATE__?.user?.userInfo;
        const info = raw?.value !== undefined ? raw.value : raw;
        if (info?.guest === true) return false;
        const channel = document.querySelector('.main-container .user .link-wrapper .channel');
        return Boolean(info && (info.userId || info.user_id) && !info.guest && channel && channel.getClientRects().length);
      })()`, true).catch(() => false);
      const cookies = await browserSession.cookies.get({ url: "https://www.xiaohongshu.com/" });
      const hasSession = authenticated && cookies.some(cookie => cookie.name === "web_session" && Boolean(cookie.value));
      if (!hasSession) return { connected: false, message: "尚未检测到登录会话，请在小红书窗口完成扫码登录。" };
      await browserSession.cookies.flushStore();
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
      const access = xhsPublicGuard.resumeAfterLogin();
      return { connected: true, ...access, message: access.cooldown_until ? "登录会话已保存，访问保护冷却仍在生效。" : "登录会话已保存，可以继续调研；实际可用性以读取结果为准。" };
    },
    async resolveExternal(value, context = {}) {
      lastBlockedRequest = null;
      const canonical = canonicalXiaohongshuUrl(value);
      let resolved = xhsAccessCache.resolve(canonical);
      const targetNoteId = xiaohongshuNoteId(canonical);
      const details = typeof context === "string" ? { title: context } : (context || {});
      const queries = xiaohongshuRecoveryQueries(details);
      const attempts = [];
      if (hasXiaohongshuAccessGrant(resolved)) {
        lastExternalResolution = { targetNoteId, queries: [], attempts, accessRestored: true, cacheHit: true };
        return resolved;
      }
      for (const query of queries.slice(0, 1)) {
        const search = new URL("https://www.xiaohongshu.com/search_result");
        search.searchParams.set("keyword", query);
        search.searchParams.set("source", "web_search_result_notes");
        try {
          const state = await command({ command: "open", url: search.toString() });
          attempts.push({
            query,
            candidateCount: state?.candidates?.length || 0,
            accessGrantCount: state?.candidate_access_grants || 0,
            accountSession: Boolean(state?.account_session),
            loginRequired: Boolean(state?.login_required),
            candidateNoteIds: (state?.candidates || []).map((item) => xiaohongshuNoteId(item?.url)).filter(Boolean).slice(0, 20),
          });
          if (state?.login_required || state?.cooldown_until) break;
          resolved = xhsAccessCache.resolve(canonical);
          if (hasXiaohongshuAccessGrant(resolved)) {
            lastExternalResolution = { targetNoteId, queries, attempts, accessRestored: true, cacheHit: false };
            return resolved;
          }
          const exactCandidate = (state?.candidates || []).find((item) => (
            targetNoteId && xiaohongshuNoteId(item?.url) === targetNoteId
          ));
          if (exactCandidate) {
            resolved = xhsAccessCache.resolve(exactCandidate.url);
            if (hasXiaohongshuAccessGrant(resolved)) {
              lastExternalResolution = { targetNoteId, queries, attempts, accessRestored: true, cacheHit: false };
              return resolved;
            }
          }
        } catch (error) {
          attempts.push({
            query,
            error: String(error?.code || error?.message || error).slice(0, 160),
            blockedRequest: lastBlockedRequest,
          });
          // Fall back to the canonical source if public search cannot refresh
          // the note's temporary access grant.
        }
      }
      lastExternalResolution = { targetNoteId, queries, attempts, accessRestored: false, cacheHit: false };
      return resolved;
    },
    externalResolutionStatus() {
      return lastExternalResolution;
    },
    stop() {
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy();
      if (accessCacheWriteTimer) {
        clearTimeout(accessCacheWriteTimer);
        accessCacheWriteTimer = null;
      }
      pendingAccessEntries = xhsAccessCache.entries();
      try { persistAccessEntries(); } catch { /* Best-effort local cache flush. */ }
      xhsAccessCache.clear({ notifyChange: false });
      if (browserWindow && !browserWindow.isDestroyed()) browserWindow.destroy();
      server.close();
    },
  };
}
