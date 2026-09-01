export const AGENT_EVENT_PROTOCOL_VERSION = 1;

const EVENT_STATUSES = new Set(["pending", "active", "completed", "failed", "paused", "cancelled"]);
const EVENT_KINDS = new Set(["model", "tool", "control", "approval", "artifact", "system"]);

function compactText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

/**
 * Canonical public runtime event shared by Electron and the renderer.
 *
 * This is deliberately an action/evidence protocol, not a chain-of-thought
 * transport. `detail` may describe observable work and outcomes only.
 */
export function createAgentEvent(input = {}, scope = {}) {
  const now = Number(input.updated_at || Date.now());
  const status = EVENT_STATUSES.has(input.status) ? input.status : "active";
  const kind = EVENT_KINDS.has(input.kind) ? input.kind : "system";
  return {
    protocol_version: AGENT_EVENT_PROTOCOL_VERSION,
    id: String(input.id || `event-${scope.sequence || 0}`),
    thread_id: String(input.thread_id || scope.thread_id || ""),
    run_id: String(input.run_id || scope.run_id || ""),
    turn_id: String(input.turn_id || scope.turn_id || ""),
    sequence: Number(input.sequence ?? scope.sequence ?? 0),
    revision: Number(input.revision || 1),
    kind,
    status,
    label: compactText(input.label || "正在处理", 120),
    detail: compactText(input.detail, 1200),
    evidence_refs: Array.isArray(input.evidence_refs)
      ? input.evidence_refs.map((item) => compactText(item, 240)).filter(Boolean).slice(0, 24)
      : [],
    started_at: Number(input.started_at || now),
    updated_at: now,
  };
}

export function updateAgentEvent(current, patch = {}, scope = {}) {
  if (!current) return createAgentEvent(patch, scope);
  return createAgentEvent({
    ...current,
    ...patch,
    id: current.id,
    sequence: current.sequence,
    revision: Number(current.revision || 1) + 1,
    started_at: current.started_at,
    updated_at: Date.now(),
  }, scope);
}

export function normalizeAgentEvent(input, fallbackSequence = 0) {
  return createAgentEvent(input, {
    thread_id: input?.thread_id,
    run_id: input?.run_id,
    turn_id: input?.turn_id,
    sequence: Number(input?.sequence ?? fallbackSequence),
  });
}

export function mergeAgentEvent(events = [], input) {
  if (!input?.id) return events;
  const index = events.findIndex((item) => item.id === input.id);
  const normalized = index < 0
    ? normalizeAgentEvent(input, events.length + 1)
    : createAgentEvent({
      ...events[index],
      ...input,
      label: input.label ?? events[index].label,
      detail: input.detail ?? events[index].detail,
      sequence: events[index].sequence,
      revision: input.revision ?? (Number(events[index].revision || 1) + 1),
      started_at: events[index].started_at,
      updated_at: input.updated_at || Date.now(),
    });
  if (index < 0) return [...events, normalized].sort(compareAgentEvents);
  return events
    .map((item, itemIndex) => itemIndex === index ? { ...item, ...normalized } : item)
    .sort(compareAgentEvents);
}

export function compareAgentEvents(left, right) {
  const sequenceDelta = Number(left?.sequence || 0) - Number(right?.sequence || 0);
  if (sequenceDelta) return sequenceDelta;
  return Number(left?.started_at || 0) - Number(right?.started_at || 0);
}

export function latestActiveAgentEvent(events = []) {
  return [...events].reverse().find((item) => item?.status === "active") || null;
}
