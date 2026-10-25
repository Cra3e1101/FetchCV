export function formatProcessingDuration(durationMs = 0) {
  const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function mergeProcessingEvent(events = [], nextEvent) {
  return mergeAgentEvent(events, nextEvent);
}

// Keep each operation at its first execution position. Results update that
// row; repeated tool names must never regroup earlier and later calls.
export function chronologicalProcessingEvents(events = [], receipts = []) {
  const receiptById = new Map(receipts.map(item => [`tool-${item.tool_call_id}`, item]));
  const ordered = events.reduce((items, event) => mergeAgentEvent(items, event), []);
  const used = new Set();
  const timeline = ordered.map(event => {
    const receipt = receiptById.get(event.id);
    if (receipt) used.add(event.id);
    return { ...event, detail: "", ...(receipt ? { receipt } : {}) };
  });
  for (const [id, receipt] of receiptById) {
    if (!used.has(id)) timeline.push({ id, kind: "tool", status: receipt.status, receipt });
  }
  return timeline;
}

const INTERNAL_MODEL_LABEL = /正在分析请求|模型正在推理|正在核对工具结果|正在生成回答|整理最终回答|完成回答/;

function publicDetail(label, count, completed, failed) {
  const operations = `已记录 ${count} 次操作，其中 ${completed} 次完成${failed ? `、${failed} 次失败` : ""}`;
  if (/读取面经原文/.test(label)) return `${operations}；成功保存篇数以来源回执为准。`;
  if (/发现面经来源/.test(label)) return `${operations}；候选结果与停止原因见面试证据状态。`;
  if (/提取面试问题/.test(label)) return `${operations}；问题提取篇数以当前来源状态为准。`;
  if (/生成面试简报/.test(label)) return "正在把共性问题、岗位建议和原始链接整理为面试简报。";
  if (/检索面试知识库/.test(label)) return "已优先复用本机保存的面试知识。";
  if (count > 1) return `已合并 ${count} 次同类操作${failed ? `，其中 ${failed} 次未完成` : ""}。`;
  return "已完成受控操作；详细输入与原始内容保留在本地审计记录中。";
}

/**
 * Convert low-level runtime events into a short user-facing activity history.
 * Repeated calls are grouped and scraped text/URLs never enter this view.
 */
export function compactProcessingEvents(events = [], contextKind = "conversation") {
  const groups = new Map();
  let activeModel = null;
  for (const [index, rawEvent] of events.entries()) {
    const event = normalizeAgentEvent(rawEvent, index + 1);
    if (!event?.label) continue;
    if (INTERNAL_MODEL_LABEL.test(event.label)) {
      if (event.status === "active") activeModel = event;
      continue;
    }
    const key = String(event.label).trim();
    const current = groups.get(key) || { id: `group:${key}`, label: key, count: 0, completed: 0, failed: 0, active: 0, paused: 0, cancelled: 0, pending: 0 };
    current.count += 1;
    if (event.status === "active") current.active += 1;
    else if (event.status === "failed") current.failed += 1;
    else if (event.status === "completed") current.completed += 1;
    else current[event.status] += 1;
    groups.set(key, current);
  }
  const compacted = [...groups.values()].map((group) => ({
    id: group.id,
    label: group.count > 1 ? `${group.label} · ${group.count}` : group.label,
    detail: publicDetail(group.label, group.count, group.completed, group.failed),
    status: group.active ? "active" : group.failed ? "failed" : group.paused ? "paused" : group.cancelled ? "cancelled" : group.pending ? "pending" : "completed",
  }));
  if (activeModel || latestActiveAgentEvent(events)?.kind === "model") compacted.push({
    id: "active-model-summary",
    label: contextKind === "interview_research" ? "归纳面试问题与准备建议" : "组织最终回答",
    detail: contextKind === "interview_research" ? "正在聚合共性问题、岗位针对性建议和原始来源。" : "正在依据已取得的结果形成回答。",
    status: "active",
  });
  // A model-only turn has no public operation to expand. The message renders
  // its measured duration separately, without inventing a completion step.
  return compacted;
}
import {
  latestActiveAgentEvent,
  mergeAgentEvent,
  normalizeAgentEvent,
} from "../../shared/agent-events.mjs";
