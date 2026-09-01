import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export function defaultUserDataPath() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "fetchcv-desktop");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "fetchcv-desktop");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "fetchcv-desktop");
}
export function packagedExecutablePath(projectRoot) {
  if (process.platform === "darwin") {
    const appOverride = String(process.env.FETCHCV_MAC_APP || "").trim();
    const appCandidates = [
      appOverride,
      path.join(projectRoot, "release", `mac-${process.arch}`, "FetchCV.app"),
      path.join(projectRoot, "release", "mac-arm64", "FetchCV.app"),
      path.join(projectRoot, "release", "mac", "FetchCV.app"),
      path.join(projectRoot, "release", "mac-universal", "FetchCV.app"),
    ].filter(Boolean);
    const appPath = appCandidates.find((candidate) => fs.existsSync(candidate)) || appCandidates[0];
    return path.join(appPath, "Contents", "MacOS", "FetchCV");
  }
  if (process.platform === "win32") {
    return path.join(projectRoot, "release", "win-unpacked", "FetchCV.exe");
  }
  throw new Error(`Packaged FetchCV is not configured for ${process.platform}`);
}
