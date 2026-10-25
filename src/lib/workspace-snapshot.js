// Workspace responses are complete JSON snapshots. Reuse equal branches so a
// background read does not invalidate memoized messages, Markdown or sources.
// Every new field/value still wins; this never skips a read or mutates either
// snapshot, including when the selected job is receiving streamed updates.
export function shareWorkspaceSnapshot(previous, next) {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== "object" || typeof next !== "object") return next;
  const array = Array.isArray(next);
  if (array !== Array.isArray(previous)) return next;
  if (!array && (Object.getPrototypeOf(previous) !== Object.prototype || Object.getPrototypeOf(next) !== Object.prototype)) return next;

  const keys = Object.keys(next);
  let equal = keys.length === Object.keys(previous).length;
  let result = next;
  for (const key of keys) {
    const existed = Object.hasOwn(previous, key);
    const value = existed ? shareWorkspaceSnapshot(previous[key], next[key]) : next[key];
    if (!existed || !Object.is(value, previous[key])) equal = false;
    if (!Object.is(value, next[key])) {
      if (result === next) result = array ? next.slice() : { ...next };
      result[key] = value;
    }
  }
  return equal ? previous : result;
}
