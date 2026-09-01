const XHS_HOSTS = new Set(["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com", "www.xhslink.com"]);

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

  for (const item of initialEntries) {
    if (!item || !isXiaohongshuUrl(item.url)) continue;
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
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    if (emit && entries.size !== sizeBefore) notify();
  }

  return {
    remember(value) {
      if (!isXiaohongshuUrl(value)) return String(value || "");
      const canonical = canonicalXiaohongshuUrl(value);
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
        entries.set(canonical, { url: incoming, expiresAt: Date.now() + ttlMs });
      } else {
        existing.expiresAt = Date.now() + ttlMs;
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
  windowMs = 10 * 60 * 1000,
  maxUnique = null,
  minIntervalMs = 1800,
  cooldownMs = 30 * 60 * 1000,
  clock = () => Date.now(),
} = {}) {
  const opened = new Map();
  let lastOpenAt = 0;
  let cooldownUntil = 0;

  function prune(now) {
    for (const [key, openedAt] of opened) {
      if (openedAt <= now - windowMs) opened.delete(key);
    }
  }

  function status(now = clock()) {
    prune(now);
    return {
      anonymous: true,
      account_session: false,
      request_limit: Number.isFinite(maxUnique) ? maxUnique : null,
      remaining_requests: Number.isFinite(maxUnique) ? Math.max(0, maxUnique - opened.size) : null,
      cooldown_until: cooldownUntil > now ? new Date(cooldownUntil).toISOString() : "",
    };
  }

  return {
    beforeOpen(value) {
      const now = clock();
      prune(now);
      if (cooldownUntil > now) throw publicAccessError("xiaohongshu_public_access_cooldown");
      const key = canonicalXiaohongshuUrl(value);
      if (Number.isFinite(maxUnique) && !opened.has(key) && opened.size >= maxUnique) {
        throw publicAccessError("xiaohongshu_public_access_limit");
      }
      const waitMs = Math.max(0, minIntervalMs - (now - lastOpenAt));
      opened.set(key, now + waitMs);
      lastOpenAt = now + waitMs;
      return { key, waitMs, ...status(now) };
    },
    afterOpen(state) {
      const now = clock();
      const publicSearchCandidates = state?.page_kind === "search" && (state?.candidates?.length || 0) > 0;
      if (!publicSearchCandidates && (state?.login_required || ["captcha", "login"].includes(state?.user_action))) {
        cooldownUntil = Math.max(cooldownUntil, now + cooldownMs);
      }
      return status(now);
    },
    status,
    reset() {
      opened.clear();
      lastOpenAt = 0;
      cooldownUntil = 0;
    },
  };
}
