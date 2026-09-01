import assert from "node:assert/strict";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const root = path.resolve(import.meta.dirname, "..");
const errors = [];

await app.whenReady();
const window = new BrowserWindow({
  width: 1360,
  height: 840,
  show: false,
  webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false },
});
window.webContents.on("console-message", (_event, level, message) => {
  if (level >= 2) errors.push(message);
});
window.webContents.on("render-process-gone", (_event, details) => errors.push(`renderer gone: ${details.reason}`));

try {
  await window.loadFile(path.join(root, "dist", "resume-editor", "index.html"), {
    query: { embedded: "1", resumeId: "resume_test_snapshot" },
  });
  const snapshot = {
    schema: 6,
    profile: { name: "高子强", phone: "13950545605", email: "test@example.com", showPhoto: false, custom: [] },
    sections: [{
      id: "education",
      tab: "教育背景",
      title: "教育背景",
      visible: true,
      builtin: true,
      items: [{ id: "education-1", metaLeft: "2024-09 ~ 至今", metaRight: "中南财经政法大学", body: "数量经济学" }],
    }],
    settings: { customAccent: "#1f3b5c", customAccent2: "#3f5f84", customStage: "#eef1f5" },
  };
  const result = await window.webContents.executeJavaScript(`(() => {
    const snapshot = ${JSON.stringify(snapshot)};
    window.fetchCVBridge.loadSnapshot(snapshot);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      bodyClass: document.body.className,
      previewName: document.querySelector('#previewName')?.textContent,
      inputName: document.querySelector('#nameInput')?.value,
      appbarBackground: getComputedStyle(document.querySelector('.appbar')).backgroundColor,
      previewDisplay: getComputedStyle(document.querySelector('.workspace')).display,
      editorDisplay: getComputedStyle(document.querySelector('.editor-drawer')).display,
    }))));
  })()`);
  assert.equal(result.previewName, "高子强", JSON.stringify({ result, errors }));
  assert.equal(result.inputName, "高子强", JSON.stringify({ result, errors }));
  assert.equal(result.bodyClass.includes("fetchcv-snapshot-loading"), false, JSON.stringify({ result, errors }));
  assert.equal(result.appbarBackground, "rgb(250, 248, 244)", JSON.stringify({ result, errors }));
  assert.notEqual(result.previewDisplay, "none", JSON.stringify({ result, errors }));
  assert.notEqual(result.editorDisplay, "none", JSON.stringify({ result, errors }));

} finally {
  window.destroy();
  app.quit();
}
