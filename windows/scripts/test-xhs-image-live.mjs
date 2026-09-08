import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { startBrowserBridge } from "../electron/browser-bridge.mjs";
const root = path.resolve(import.meta.dirname, "..", "artifacts", "didi-live");
app.setPath("userData", path.join(root, "browser-profile"));
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const bridge = await startBrowserBridge({ accessCacheFile: path.join(root, "public-cache.bin") });
  console.log("Budget", JSON.stringify(bridge.accessStatus()));
  const command = async payload => {
    const response = await fetch(`${bridge.url}/command`, { method: "POST", headers: { authorization: `Bearer ${bridge.token}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!data.ok) throw new Error(JSON.stringify({ error: data.error, code: data.code }));
    return data.result;
  };
  const started = Date.now();
  const state = await command({ command: "open", url: "https://www.xiaohongshu.com/explore/6a8586ed00000000050231de" });
  const report = { url: state.url, title: state.title, chars: state.text?.length, images: state.image_count,
    saved: state.ocr_images_saved, method: state.ocr_capture_method, status: state.ocr_status, capture_ms: Date.now() - started };
  console.log(JSON.stringify(report));
  if (state.ocr_job_id) {
    for (let i = 0; i < 30; i++) {
      const result = await command({ command: "ocr_result", job_id: state.ocr_job_id });
      if (["completed", "failed", "partial"].includes(result.status)) { report.ocr = result; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  fs.writeFileSync(path.join(root, "image-live-result.json"), JSON.stringify(report, null, 2));
  console.log("OCR", report.ocr?.status, "chars", report.ocr?.pages?.reduce((n, page) => n + (page.text?.length || 0), 0));
  app.exit(report.saved > 0 && report.ocr?.status === "completed" ? 0 : 2);
}).catch(error => { console.error(error.message); app.exit(1); });
