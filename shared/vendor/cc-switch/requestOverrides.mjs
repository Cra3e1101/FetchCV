// CC Switch, copyright (c) 2025 Jason Young. MIT; see ./LICENSE.
// Transpiled from upstream 85ad4969b3399500baaea9d46b1e08f87aba80e1.
function isValidHttpHeaderName(name) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}
const PROTECTED_LOCAL_PROXY_HEADER_NAMES = /* @__PURE__ */ new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "upgrade",
  "accept-encoding",
  "content-type",
  "authorization",
  "x-api-key",
  "x-goog-api-key",
  "chatgpt-account-id",
  "session_id",
  "x-client-request-id",
  "x-codex-window-id",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "forwarded",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "true-client-ip",
  "fastly-client-ip",
  "x-azure-clientip",
  "x-azure-fdid",
  "x-azure-ref",
  "akamai-origin-hop",
  "x-akamai-config-log-detail",
  "x-request-id",
  "x-correlation-id",
  "x-trace-id",
  "x-amzn-trace-id",
  "x-b3-traceid",
  "x-b3-spanid",
  "x-b3-parentspanid",
  "x-b3-sampled",
  "traceparent",
  "tracestate"
]);
function isProtectedLocalProxyHeaderName(name) {
  return PROTECTED_LOCAL_PROXY_HEADER_NAMES.has(name.toLowerCase());
}
function isValidHttpHeaderValue(value) {
  return !/[\x00-\x08\x0a-\x1f\x7f]/.test(value);
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseRequestOverrideJson(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (!isPlainObject(parsed)) {
      return { error: "JSON must be an object" };
    }
    return { value: parsed };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid JSON"
    };
  }
}
function parseBodyOverrideJson(raw) {
  const parsed = parseRequestOverrideJson(raw);
  if (parsed.error || !parsed.value) {
    return parsed;
  }
  if (Object.prototype.hasOwnProperty.call(parsed.value, "stream")) {
    return { error: 'Body override must not include protocol field "stream"' };
  }
  return parsed;
}
function parseHeaderOverrideJson(raw) {
  const parsed = parseRequestOverrideJson(raw);
  if (parsed.error || !parsed.value) {
    return parsed.error ? { error: parsed.error } : {};
  }
  const headers = {};
  for (const [name, value] of Object.entries(parsed.value)) {
    const headerName = name.trim();
    if (!headerName) {
      return { error: "Header name must not be empty" };
    }
    if (!isValidHttpHeaderName(headerName)) {
      return { error: `Header "${name}" name is not a valid HTTP token` };
    }
    if (typeof value !== "string") {
      return { error: `Header "${name}" value must be a string` };
    }
    if (!isValidHttpHeaderValue(value)) {
      return { error: `Header "${name}" value contains control characters` };
    }
    const normalizedHeaderName = headerName.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(headers, normalizedHeaderName)) {
      return {
        error: `Header "${name}" duplicates another header after case normalization`
      };
    }
    if (isProtectedLocalProxyHeaderName(normalizedHeaderName)) {
      return {
        error: `Header "${name}" is managed by the local proxy and cannot be overridden`
      };
    }
    headers[normalizedHeaderName] = value;
  }
  return { headers };
}
function formatRequestOverrideObject(value) {
  if (!value || Object.keys(value).length === 0) return "";
  return JSON.stringify(value, null, 2);
}
function buildLocalProxyRequestOverrides(headersJson, bodyJson) {
  const headerResult = parseHeaderOverrideJson(headersJson);
  if (headerResult.error) {
    return { error: headerResult.error };
  }
  const bodyResult = parseBodyOverrideJson(bodyJson);
  if (bodyResult.error) {
    return { error: bodyResult.error };
  }
  const overrides = {};
  if (headerResult.headers && Object.keys(headerResult.headers).length > 0) {
    overrides.headers = headerResult.headers;
  }
  if (bodyResult.value && Object.keys(bodyResult.value).length > 0) {
    overrides.body = bodyResult.value;
  }
  return Object.keys(overrides).length > 0 ? { overrides } : {};
}
export {
  PROTECTED_LOCAL_PROXY_HEADER_NAMES,
  buildLocalProxyRequestOverrides,
  formatRequestOverrideObject,
  isPlainObject,
  isProtectedLocalProxyHeaderName,
  isValidHttpHeaderName,
  isValidHttpHeaderValue,
  parseBodyOverrideJson,
  parseHeaderOverrideJson,
  parseRequestOverrideJson
};
