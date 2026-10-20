import path from "node:path";
import { pathToFileURL } from "node:url";

// Packaged apps always use their bundled UI. Development IPC trusts exactly
// one loopback document, not arbitrary localhost origins or child frames.
export function rendererEntry({ projectRoot, isPackaged, env = process.env }) {
  const production = { url: pathToFileURL(path.join(projectRoot, "dist", "index.html")).href, development: false };
  if (isPackaged || !env.FETCHCV_DEV_SERVER_URL) return production;
  const url = new URL(env.FETCHCV_DEV_SERVER_URL);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
      || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("Development UI requires an exact http://127.0.0.1:PORT/ URL");
  }
  if (!path.isAbsolute(env.FETCHCV_DEV_USER_DATA || "")) {
    throw new Error("Development UI requires an explicit absolute user-data path");
  }
  if (env.FETCHCV_DEV_SESSION_DATA && !path.isAbsolute(env.FETCHCV_DEV_SESSION_DATA)) {
    throw new Error("Development session data requires an absolute path");
  }
  return { url: url.href, development: true };
}
