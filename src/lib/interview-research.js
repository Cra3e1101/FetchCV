import { matchingQuestionEvidence } from "./interview-evidence.js";

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
  const currentSources = new Map(sources.filter(source => source.status === "analyzed"
    && String(source.text_preview ?? source.raw_text ?? "").trim() && source.extracted_questions?.length).map(source => [source.id, source]));
  const supported = (briefs[0]?.common_questions || []).some(item =>
    (item.question_evidence?.supporting_source_ids || []).some(id => currentSources.has(id)
      && Boolean(matchingQuestionEvidence(currentSources.get(id), item)?.evidence_quote?.trim())));
  // A legacy brief or persisted source_count cannot establish current evidence.
  if (supported) return "brief_limited";
  if (sources.some(source => ["captured", "analyzed"].includes(source.status) && String(source.text_preview ?? source.raw_text ?? "").trim())) return "sources_saved";
  return result ? "completed_without_brief" : "idle";
}
