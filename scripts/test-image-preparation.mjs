import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createLocalNoteOcr } from "../electron/local-note-ocr.mjs";
const root = path.resolve(import.meta.dirname, "..");
app.setPath("userData", path.join(root, "artifacts/image-preparation-profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } });
  let paintedFrame;
  window.webContents.on("paint", (_event, _dirty, image) => { if (!image.isEmpty()) paintedFrame = image; });
  const png = fs.readFileSync(path.join(root, "artifacts/ocr-fixture.png")).toString("base64");
  await window.loadURL("data:text/html," + encodeURIComponent(`<div class="note-detail"><img src="data:image/png;base64,${png}"></div>`));
  const code = fs.readFileSync(path.join(root, "electron/browser-bridge.mjs"), "utf8");
  const start = code.indexOf("async function readVisibleImage(state)");
  const end = code.indexOf("\n  async function runCommand", start);
  const make = new Function("browserWindow", "localOcr", "imageReads", "loadedImages", "createHash", "canonicalXiaohongshuUrl", "fs", "ocrDirectory", "path", "getPaintedFrame", `return (${code.slice(start,end)})`);
  const directory = path.join(root, "artifacts/image-preparation");
  const queue = createLocalNoteOcr({ directory, binary: "C:/Program Files/Tesseract-OCR/tesseract.exe" });
  const loaded = new Map();
  const read = make(window, queue, new Set(), loaded, createHash, String, fs, directory, path, () => paintedFrame);
  const screenshot = await read({ url: "https://www.xiaohongshu.com/explore/test", image_count: 1 });
  console.log(JSON.stringify(screenshot));
  assert.equal(screenshot.ocr_images_saved, 1);
  assert.equal(screenshot.ocr_capture_method, "visible_screenshot");
  const imageUrl = "https://images.example.com/fixture.png";
  loaded.set(imageUrl, fs.readFileSync(path.join(root, "artifacts/ocr-fixture.png")));
  const response = await read({ url: "https://www.xiaohongshu.com/explore/test", image_count: 1, image_groups: [[imageUrl]] });
  assert.equal(response.ocr_capture_method, "loaded_response");
  const deadline = Date.now() + 25000;
  for (const result of [screenshot, response]) {
    while (queue.result(result.ocr_job_id).status !== "completed" && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(queue.result(result.ocr_job_id).pages[0]?.text || "", /SQL/);
  }
  console.log("PASS offscreen screenshot + loaded-image bytes -> real local OCR, without network requests");
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
