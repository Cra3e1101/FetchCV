import { app } from "electron";
import path from "node:path";
import { startBrowserBridge } from "../electron/browser-bridge.mjs";
const root = path.resolve(import.meta.dirname, "..");
app.setPath("userData", path.join(root, "artifacts/didi-live/browser-profile"));
app.on("window-all-closed", () => app.quit());
app.whenReady().then(async () => {
  const bridge = await startBrowserBridge({ accessCacheFile: path.join(root, "artifacts/didi-live/public-cache.bin") });
  await bridge.beginLogin();
}).catch(error => { console.error(error.message); app.exit(1); });
