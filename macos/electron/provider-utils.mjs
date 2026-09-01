const COMPATIBLE_PATH_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude",
];

function appendUnique(items, value) {
  if (value && !items.includes(value)) items.push(value);
}

function endsWithVersionSegment(pathname) {
  return /^v\d+$/i.test(pathname.split("/").filter(Boolean).at(-1) || "");
}

function stripCompatibleSuffix(pathname) {
  const suffix = COMPATIBLE_PATH_SUFFIXES.find((item) => pathname.endsWith(item));
  return suffix ? pathname.slice(0, -suffix.length) : null;
}

export function buildModelsUrlCandidates(baseUrl, { modelsUrlOverride = "", isFullUrl = false } = {}) {
  const override = String(modelsUrlOverride || "").trim();
  if (override) {
    const parsed = new URL(override);
    const localHttp = parsed.protocol === "http:" && new Set(["127.0.0.1", "localhost"]).has(parsed.hostname);
    if ((parsed.protocol !== "https:" && !localHttp) || parsed.username || parsed.password) {
      throw new Error("Models URL must use HTTPS or loopback HTTP without embedded credentials");
    }
    return [parsed.toString().replace(/\/$/, "")];
  }

  const parsed = new URL(String(baseUrl || "").trim());
  parsed.search = "";
  parsed.hash = "";
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const candidates = [];
  const withPath = (nextPath) => {
    const value = new URL(parsed.toString());
    value.pathname = nextPath.replace(/\/{2,}/g, "/");
    appendUnique(candidates, value.toString().replace(/\/$/, ""));
  };

  if (isFullUrl || /\/(chat\/completions|messages)$/i.test(pathname)) {
    const versionIndex = pathname.search(/\/v1\//i);
    if (versionIndex >= 0) withPath(`${pathname.slice(0, versionIndex)}/v1/models`);
    else withPath(`${pathname.slice(0, pathname.lastIndexOf("/"))}/models`);
    return candidates;
  }

  if (endsWithVersionSegment(pathname)) {
    withPath(`${pathname}/models`);
    if (!/\/v1$/i.test(pathname)) withPath(`${pathname}/v1/models`);
  } else {
    withPath(`${pathname}/v1/models`);
  }

  const strippedPath = stripCompatibleSuffix(pathname);
  if (strippedPath !== null) {
    withPath(`${strippedPath}/v1/models`);
    withPath(`${strippedPath}/models`);
  }
  return candidates;
}

export function parseModelsResponse(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];
  const seen = new Set();
  return rows
    .map((item) => typeof item === "string"
      ? { id: item, ownedBy: "" }
      : { id: String(item?.id || item?.name || "").trim(), ownedBy: String(item?.owned_by || item?.ownedBy || item?.provider || "").trim() })
    .filter((item) => item.id && !seen.has(item.id) && seen.add(item.id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 500);
}

export function redactProviderError(raw, apiKey) {
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  const detail = payload?.error?.message || payload?.message || payload?.detail || payload?.error?.type || raw || "";
  const secret = String(apiKey || "");
  return (secret ? String(detail).replaceAll(secret, "[已隐藏]") : String(detail))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}
