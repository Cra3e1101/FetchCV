const XHS_NOTE_PATH = /^\/(?:explore|discovery\/item)\/([a-f0-9]{24})(?:\/|$)/i;

export function interviewSourceNoteId(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!/(^|\.)xiaohongshu\.com$/i.test(parsed.hostname)) return "";
    return XHS_NOTE_PATH.exec(parsed.pathname)?.[1]?.toLowerCase() || "";
  } catch {
    return "";
  }
}

export function derivedInterviewSourceDate(value) {
  const noteId = interviewSourceNoteId(value);
  if (!noteId) return "";
  const seconds = Number.parseInt(noteId.slice(0, 8), 16);
  if (!Number.isFinite(seconds)) return "";
  const date = new Date(seconds * 1000);
  const year = date.getUTCFullYear();
  return year >= 2013 && year <= 2100 ? date.toISOString() : "";
}

export function interviewSourcePublishedAt(source) {
  return String(source?.published_at || derivedInterviewSourceDate(source?.source_url) || "");
}

export function interviewSourceTimestamp(source) {
  const timestamp = Date.parse(interviewSourcePublishedAt(source));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortInterviewSourcesNewest(sources = []) {
  return [...sources].sort((left, right) => (
    interviewSourceTimestamp(right) - interviewSourceTimestamp(left)
    || String(right?.title || "").localeCompare(String(left?.title || ""), "zh-CN")
  ));
}

export function formatInterviewSourceDate(source, { includeYear = true } = {}) {
  const value = interviewSourcePublishedAt(source);
  if (!value) return "时间未识别";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(source?.published_at || "时间未识别");
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: includeYear ? "numeric" : undefined,
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function findInterviewSourceByUrl(value, sources = []) {
  const noteId = interviewSourceNoteId(value);
  if (noteId) {
    const matched = sources.find((source) => interviewSourceNoteId(source?.source_url) === noteId);
    if (matched) return matched;
  }
  try {
    const target = new URL(String(value || ""));
    target.search = "";
    target.hash = "";
    return sources.find((source) => {
      try {
        const candidate = new URL(String(source?.source_url || ""));
        candidate.search = "";
        candidate.hash = "";
        return candidate.toString() === target.toString();
      } catch {
        return false;
      }
    }) || null;
  } catch {
    return null;
  }
}

export function isXiaohongshuSourceUrl(value) {
  try {
    return /(^|\.)xiaohongshu\.com$/i.test(new URL(String(value || "")).hostname);
  } catch {
    return false;
  }
}
