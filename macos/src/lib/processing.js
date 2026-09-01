export function formatProcessingDuration(durationMs = 0) {
  const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function mergeProcessingEvent(events = [], nextEvent) {
  if (!nextEvent?.id) return events;
  const index = events.findIndex((item) => item.id === nextEvent.id);
  if (index < 0) return [...events, nextEvent];
  return events.map((item, itemIndex) => itemIndex === index ? { ...item, ...nextEvent } : item);
}
