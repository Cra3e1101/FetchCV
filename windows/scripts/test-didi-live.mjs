import { app } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startBrowserBridge } from "../electron/browser-bridge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
app.setPath("userData", path.join(root, "artifacts", "didi-live", "browser-profile"));
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
const bridge = await startBrowserBridge({ accessCacheFile: path.join(root, "artifacts", "didi-live", "public-cache.bin") });
if (process.argv.includes("--budget")) { console.log(JSON.stringify(bridge.accessStatus())); app.exit(0); return; }
if (process.argv.includes("--login") || process.argv.includes("--resume")) {
  await bridge.beginLogin();
  console.log("Waiting for manual login in the visible Xiaohongshu window");
  let connected = false;
  const deadline = Date.now() + (process.argv.includes("--resume") ? 15000 : 10 * 60 * 1000);
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const result = await bridge.finishLogin();
    if (result.connected) {
      connected = true; console.log(result.message);
      if (result.cooldown_until) { console.log("COOLDOWN_UNTIL", result.cooldown_until); app.exit(3); return; }
      break;
    }
  }
  if (!connected) { console.log("Manual login was not completed; no research started"); app.exit(2); return; }
}
const child = spawn(path.join(root, "backend/.venv/Scripts/python.exe"), [path.join(root, "scripts/test-didi-live.py")], {
  cwd: root, windowsHide: true, stdio: "inherit",
  env: { ...process.env, PYTHONIOENCODING: "utf-8", FETCHCV_BROWSER_BRIDGE_URL: bridge.url, FETCHCV_BROWSER_BRIDGE_TOKEN: bridge.token },
});
child.on("error", error => { console.error(error.message); app.exit(1); });
child.on("exit", code => app.exit(code || 0));
}).catch(error => { console.error(error); app.exit(1); });
