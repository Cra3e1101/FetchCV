import path from "node:path";

// Sharing is explicit; a missing profile must never silently become an empty one.
export function developmentProfile({ workRoot, userData }) {
  if (userData !== undefined) {
    if (!userData || !path.isAbsolute(userData)) throw new Error("--user-data requires an absolute existing profile path");
    const data = path.normalize(userData);
    return { data, session: data, shared: true };
  }
  const data = path.join(workRoot, "user-data");
  return { data, session: path.join(data, "session"), shared: false };
}
