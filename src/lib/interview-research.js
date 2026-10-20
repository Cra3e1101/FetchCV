export const INTERVIEW_RESEARCH_TASK = "interview_research";
export const LEGACY_INTERVIEW_RESEARCH_MARKER = "请为当前岗位开展一次可追溯的面试情报调研";

export function isInterviewResearchRequest(message) {
  if (message?.role !== "user") return false;
  if (message.metadata_json?.task_kind === INTERVIEW_RESEARCH_TASK) return true;
  // Compatibility for reports created before task_kind was persisted.
  return String(message.content || "").startsWith(LEGACY_INTERVIEW_RESEARCH_MARKER);
}

export function findLatestInterviewResearchResult(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !String(message.content || "").trim()) continue;
    if (message.metadata_json?.task_kind === INTERVIEW_RESEARCH_TASK) return message;
    for (let requestIndex = index - 1; requestIndex >= 0; requestIndex -= 1) {
      const request = messages[requestIndex];
      if (request?.role === "assistant") break;
      if (isInterviewResearchRequest(request)) return message;
    }
  }
  return null;
}

export function hasUnansweredInterviewResearchRequest(messages = []) {
  let latestResultIndex = -1;
  let latestRequestIndex = -1;
  messages.forEach((message, index) => {
    if (isInterviewResearchRequest(message)) latestRequestIndex = index;
    if (message?.role === "assistant" && message.metadata_json?.task_kind === INTERVIEW_RESEARCH_TASK) latestResultIndex = index;
  });
  if (latestRequestIndex < 0) return false;
  if (latestResultIndex >= latestRequestIndex) return false;
  return !messages.slice(latestRequestIndex + 1).some((message) => message?.role === "assistant" && String(message.content || "").trim());
}

export function resolveInterviewResearchState({ briefs = [], sources = [], result = null } = {}) {
  if (briefs.length) return briefs[0]?.metadata_json?.evidence_status === "limited" ? "brief_limited" : "brief_ready";
  const persisted = result?.metadata_json?.research_result?.status;
  if (persisted) return persisted;
  if (sources.length) return "sources_saved";
  return result ? "completed_without_brief" : "idle";
}
