function nextContentLine(lines, from) {
  for (let index = from; index < lines.length; index += 1) {
    if (lines[index].trim()) return index;
  }
  return -1;
}

export function splitJobDescriptions(source) {
  const text = String(source || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const company = lines[index].trim();
    if (!company || company.length > 40 || /[：:；;，,。.!！?？]/.test(company)) continue;
    if (index > 0 && lines[index - 1].trim()) continue;
    const roleIndex = nextContentLine(lines, index + 1);
    const markerIndex = nextContentLine(lines, roleIndex + 1);
    if (roleIndex < 0 || markerIndex < 0) continue;
    const role = lines[roleIndex].trim();
    const marker = lines[markerIndex].trim();
    if (!role || role.length > 160 || !/^(职位描述|工作职责|岗位职责|职位简介)/.test(marker)) continue;
    starts.push({ index, company, role });
  }
  return starts.map((item, position) => {
    const end = starts[position + 1]?.index ?? lines.length;
    return {
      company: item.company,
      role: item.role,
      jd: lines.slice(item.index, end).join("\n").trim(),
    };
  });
}

export const JOB_CONTEXT_FIELDS = [
  { key: "function", label: "职能", placeholder: "例如：研发、产品、运营" },
  { key: "sub_direction", label: "子方向", placeholder: "例如：后端开发、策略运营" },
  { key: "recruitment_type", label: "招聘类型" },
  { key: "business_unit", label: "部门 / 业务线", placeholder: "未注明可留空" },
  { key: "published_at", label: "JD 发布日期", placeholder: "YYYY-MM-DD，未注明可留空" },
];

export const JOB_CONTEXT_BASIS = {
  source: "原文依据", inferred: "推断", user_confirmed: "用户确认", unknown: "未知",
};

export const RECRUITMENT_TYPES = { campus: "校招正式", internship: "实习", social: "社招" };

function emptyContextField() {
  return { value: null, basis: "unknown", source_quote: "", source_span: null };
}

function locateContextQuote(body, quote) {
  if (!quote) return null;
  const start = body.indexOf(quote);
  if (start < 0) return null;
  // The persisted contract uses Unicode character positions, as the backend does.
  const offset = Array.from(body.slice(0, start)).length;
  return [offset, offset + Array.from(quote).length];
}

export function normalizeJobContext(context, body = "") {
  const text = String(body || "");
  const fields = {};
  for (const { key } of JOB_CONTEXT_FIELDS) {
    const field = context?.fields?.[key];
    const value = typeof field?.value === "string" ? field.value : "";
    const basis = field?.basis;
    if (!value.trim() || !Object.hasOwn(JOB_CONTEXT_BASIS, basis) || basis === "unknown"
      || (key === "recruitment_type" && !Object.hasOwn(RECRUITMENT_TYPES, value))) {
      fields[key] = emptyContextField();
      continue;
    }
    const quote = typeof field.source_quote === "string" ? field.source_quote : "";
    const span = locateContextQuote(text, quote);
    if (["source", "inferred"].includes(basis) && !span) {
      fields[key] = emptyContextField();
      continue;
    }
    fields[key] = { value, basis, source_quote: span ? quote : "", source_span: span };
  }
  return { schema_version: 1, fields };
}

export function updateJobContextField(context, key, value, body = "") {
  const normalized = normalizeJobContext(context, body);
  if (!JOB_CONTEXT_FIELDS.some(field => field.key === key)) return normalized;
  const nextValue = String(value || "");
  normalized.fields[key] = nextValue.trim()
    ? { ...normalized.fields[key], value: nextValue, basis: "user_confirmed" }
    : emptyContextField();
  return normalizeJobContext(normalized, body);
}

export function jobPostingPreviewState(posting) {
  const body = String(posting?.body ?? posting?.description ?? "");
  const status = posting?.status || (body.trim() ? "ok" : "insufficient_content");
  const warnings = Array.isArray(posting?.warnings) ? posting.warnings : [];
  return {
    body, status, usable: status === "ok" && Boolean(body.trim()),
    label: { ok: "已读取正文", requires_user_action: "需要登录或手动补充", timeout: "读取超时", insufficient_content: "正文不足", error: "读取失败" }[status] || "读取状态未知",
    warnings,
    warningMessages: [...new Set(warnings.map(jobPostingWarningLabel))],
  };
}

function jobPostingWarningLabel(warning) {
  const code = String(warning || "");
  if (code === "published_at:structured_metadata_not_in_body") return "网页元数据标有发布日期，但正文中未找到；请核对后手动确认。";
  if (code === "body_edited_since_fetch") return "正文已手动修改，请核对仍适用的岗位语境。";
  if (/invalid_url|insecure|denied/i.test(code)) return "链接无法安全读取，请检查地址或手动粘贴 JD。";
  if (/requires_user_action|login|captcha|access_protection|rate.?limit/i.test(code)) return "页面访问需要确认；请核对可访问的原文，或手动粘贴完整 JD。";
  if (/timeout/i.test(code)) return "部分读取超时，可以重试或手动补充 JD。";
  if (/insufficient_content|job_page_content_insufficient/i.test(code)) return "部分读取未取得完整 JD，请检查正文并补充缺失内容。";
  return "部分读取未完成，请核对正文，必要时手动补充 JD。";
}

export function staleJobResults(detail) {
  const labels = [];
  if (detail?.profile?.business_context?.analysis_status === "stale") labels.push("岗位重点");
  if (detail?.interview_briefs?.[0]?.metadata_json?.analysis_status === "stale") labels.push("面试简报");
  if (detail?.resumes?.[0]?.job_relevance?.analysis_status === "stale") labels.push("旧岗位简历");
  if (detail?.proposals?.some(item => item.job_relevance?.analysis_status === "stale")) labels.push("旧改写建议");
  return labels;
}
