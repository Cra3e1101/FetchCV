const XHS_HOSTS = new Set(["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com", "www.xhslink.com"]);

// Read only the requested note. Recommendations and comments in page state
// must never become evidence for the current URL.
export function extractXiaohongshuNote(state, noteId) {
  const visited = new WeakSet();
  let count = 0;
  function walk(value, key = "", depth = 0) {
    if (!value || typeof value !== "object" || visited.has(value) || depth > 9 || ++count > 7000) return null;
    visited.add(value);
    const note = value.note || value;
    const id = note.noteId || note.note_id || note.id || key;
    if (id === noteId && typeof note.desc === "string") {
      return { title: typeof note.title === "string" ? note.title : "", description: note.desc,
        publishedAt: note.time || note.publishTime || note.publish_time || "",
        imageCount: Array.isArray(note.imageList) ? note.imageList.length : 0,
        imageGroups: (note.imageList || []).map(image => [image.urlDefault, image.urlPre, image.url, ...(image.infoList || []).map(info => info.url)].filter(url => typeof url === "string" && url.startsWith("https://"))),
        imageUrls: (note.imageList || []).flatMap(image => [image.urlDefault, image.urlPre, image.url, ...(image.infoList || []).map(info => info.url)]).filter(url => typeof url === "string" && url.startsWith("https://")) };
    }
    for (const [childKey, child] of Object.entries(value)) {
      if (/comment|recommend/i.test(childKey)) continue;
      const found = walk(child, childKey, depth + 1);
      if (found) return found;
    }
    return null;
  }
  return noteId ? walk(state) : null;
}

export function isXiaohongshuUrl(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return XHS_HOSTS.has(host) || host.endsWith(".xiaohongshu.com") || host.endsWith(".xhslink.com");
  } catch {
    return false;
  }
}

export function canonicalXiaohongshuUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!isXiaohongshuUrl(parsed.toString())) return parsed.toString();
    if (/^\/(?:discovery\/item|explore)\/[^/]+/.test(parsed.pathname)) {
      parsed.search = "";
      parsed.hash = "";
    }
    return parsed.toString();
  } catch {
    return String(value || "");
  }
}

function compactRecoveryText(value) {
  return String(value || "")
    .replace(/\s*-\s*小红书\s*$/i, "")
    .replace(/[｜|·—–_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function xiaohongshuRecoveryQueries(input = {}) {
  const title = compactRecoveryText(input.title).slice(0, 120);
  const company = compactRecoveryText(input.company).replace(/(?:出行|科技|集团|有限公司)$/u, "").trim();
  const businessUnit = compactRecoveryText(input.businessUnit || input.business_unit)
    .replace(/事业部$/u, "")
    .trim();
  const role = compactRecoveryText(input.role)
    .replace(/(?:实习生|实习)$/u, "")
    .trim();
  const titleCore = title
    .replace(/[（(][^）)]{0,20}[）)]/gu, " ")
    .replace(/(?:一面|二面|三面|终面|面试|面经|复盘|已offer|offer|凉经版|凉经)/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...new Set([
    title,
    [company, businessUnit, role, "面经"].filter(Boolean).join(" "),
    [company, role, "面经"].filter(Boolean).join(" "),
    [company, titleCore].filter(Boolean).join(" "),
  ].map((item) => item.trim()).filter((item) => item.length >= 2))].slice(0, 4);
}

export function createXiaohongshuAccessCache({
  ttlMs = 30 * 24 * 60 * 60 * 1000,
  maxEntries = 240,
  initialEntries = [],
  onChange = null,
} = {}) {
  const entries = new Map();
  const usable = (value) => {
    try { const url = new URL(value); return isXiaohongshuUrl(value) && (/^\/(explore|discovery\/item)\/[^/]+/.test(url.pathname) || url.hostname.endsWith("xhslink.com")); }
    catch { return false; }
  };
  const priority = (value) => { try { return new URL(value).searchParams.get("xsec_source") === "pc_search" ? 1 : 0; } catch { return 0; } };

  for (const item of initialEntries) {
    if (!item || !usable(item.url)) continue;
    const canonical = canonicalXiaohongshuUrl(item.canonical || item.url);
    const expiresAt = Number(item.expiresAt || 0);
    if (expiresAt > Date.now()) entries.set(canonical, { url: String(item.url), expiresAt });
  }

  function snapshot() {
    return [...entries].map(([canonical, item]) => ({ canonical, ...item }));
  }

  function notify() {
    onChange?.(snapshot());
  }

  function prune({ emit = false } = {}) {
    const now = Date.now();
    const sizeBefore = entries.size;
    for (const [key, item] of entries) {
      if (item.expiresAt <= now) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      const lowPriority = [...entries].find(([, item]) => !priority(item.url));
      entries.delete(lowPriority ? lowPriority[0] : entries.keys().next().value);
    }
    if (emit && entries.size !== sizeBefore) notify();
  }

  return {
    remember(value) {
      if (!isXiaohongshuUrl(value)) return String(value || "");
      const canonical = canonicalXiaohongshuUrl(value);
      if (!usable(value)) return canonical;
      const incoming = String(value);
      const existing = entries.get(canonical);
      let incomingHasAccessGrant = false;
      let existingHasAccessGrant = false;
      try {
        incomingHasAccessGrant = Boolean(new URL(incoming).searchParams.get("xsec_token"));
        existingHasAccessGrant = Boolean(existing?.url && new URL(existing.url).searchParams.get("xsec_token"));
      } catch {
        // Invalid values are rejected by isXiaohongshuUrl above.
      }
      if (!existingHasAccessGrant || incomingHasAccessGrant) {
        entries.delete(canonical);
        entries.set(canonical, { url: incoming, expiresAt: Date.now() + ttlMs });
      } else {
        existing.expiresAt = Date.now() + ttlMs;
        entries.delete(canonical);
        entries.set(canonical, existing);
      }
      prune();
      notify();
      return canonical;
    },
    resolve(value) {
      prune();
      const canonical = canonicalXiaohongshuUrl(value);
      return entries.get(canonical)?.url || String(value || "");
    },
    entries() {
      prune();
      return snapshot();
    },
    clear({ notifyChange = true } = {}) {
      entries.clear();
      if (notifyChange) notify();
    },
  };
}

function publicAccessError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function createXiaohongshuPublicAccessGuard({
  windowMs = 30 * 60 * 1000,
  maxUnique = null,
  maxRequests = 12,
  minIntervalMs = 12000,
  cooldownMs = 30 * 60 * 1000,
  clock = () => Date.now(),
  initialState = {},
  onChange = null,
} = {}) {
  const opened = new Map(initialState.opened || []);
  let requests = Array.isArray(initialState.requests) ? initialState.requests.filter(Number.isFinite) : [];
  let lastOpenAt = Number(initialState.lastOpenAt) || 0;
  let cooldownUntil = Number(initialState.cooldownUntil) || 0;
  let failures = Number(initialState.failures) || 0;
  let restriction = String(initialState.restriction || "");
  const persist = () => onChange?.({ opened: [...opened], requests, lastOpenAt, cooldownUntil, failures, restriction });
  function prune(now) {
    for (const [key, openedAt] of opened) if (openedAt <= now - windowMs) opened.delete(key);
    requests = requests.filter((at) => at > now - windowMs);
  }
  function status(now = clock()) {
    prune(now);
    const nextAllowedAt = Math.max(cooldownUntil, lastOpenAt + minIntervalMs,
      requests.length >= maxRequests ? requests[0] + windowMs : 0);
    return {
      anonymous: true, account_session: false,
      request_limit: Number.isFinite(maxUnique) ? Math.min(maxUnique, maxRequests) : maxRequests,
      remaining_requests: Math.max(0, Math.min(maxRequests - requests.length, Number.isFinite(maxUnique) ? maxUnique - opened.size : Infinity)),
      cooldown_until: cooldownUntil > now ? new Date(cooldownUntil).toISOString() : "",
      retry_after_ms: Math.max(0, nextAllowedAt - now),
    };
  }
  function fail(code) {
    const error = publicAccessError(code);
    error.details = status();
    throw error;
  }
  return {
    beforeOpen(value) {
      const now = clock();
      prune(now);
      if (cooldownUntil > now) fail("xiaohongshu_public_access_cooldown");
      const key = canonicalXiaohongshuUrl(value);
      if (requests.length >= maxRequests || (Number.isFinite(maxUnique) && !opened.has(key) && opened.size >= maxUnique)) fail("xiaohongshu_public_access_limit");
      const waitMs = lastOpenAt ? Math.max(0, minIntervalMs - (now - lastOpenAt)) : 0;
      opened.set(key, now + waitMs);
      requests.push(now + waitMs);
      lastOpenAt = now + waitMs;
      persist();
      return { key, waitMs, ...status(now) };
    },
    assertAllowed() {
      if (cooldownUntil > clock()) fail("xiaohongshu_public_access_cooldown");
    },
    afterOpen(state) {
      const now = clock();
      if (state?.login_required || ["captcha", "login", "rate_limited", "network_error"].includes(state?.user_action)) {
        const reason = state?.user_action || "login";
        if (cooldownUntil <= now || !restriction || reason !== "login") restriction = reason;
        // Every restriction counts, even if some search cards were visible.
        // Repeated failures back off exponentially, surviving app restarts.
        if (cooldownUntil <= now) failures = Math.min(failures + 1, 6);
        cooldownUntil = Math.max(cooldownUntil, now + Math.min(24 * 60 * 60 * 1000, cooldownMs * (2 ** Math.max(0, failures - 1))));
        persist();
      }
      return status(now);
    },
    status,
    resumeAfterLogin() {
      // A completed login resolves only a login stop, never a rate/captcha stop.
      if (restriction === "login") { cooldownUntil = 0; restriction = ""; persist(); }
      return status();
    },
    reset() { opened.clear(); requests = []; lastOpenAt = 0; cooldownUntil = 0; failures = 0; persist(); },
  };
}

// A shared BrowserWindow cannot safely navigate two jobs at once. Coalesce
// identical requests and reject competing navigation instead of growing a queue.
export function createBrowserCommandGate(handler) {
  let active = null;
  return (payload) => {
    const key = JSON.stringify([payload?.command, canonicalXiaohongshuUrl(payload?.url || "")]);
    if (active) {
      if (active.key === key) return active.promise;
      return Promise.reject(publicAccessError("browser_busy"));
    }
    const promise = Promise.resolve().then(() => handler(payload));
    active = { key, promise };
    const clear = () => { if (active?.promise === promise) active = null; };
    promise.then(clear, clear);
    return promise;
  };
}
