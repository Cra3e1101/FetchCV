/* Synthetic editor-only smoke: no FetchCV main process, sidecar, provider or network. */
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const output = path.resolve(process.env.FETCHCV_T1_RENDER_OUTPUT || "");
assert.ok(process.env.FETCHCV_T1_RENDER_OUTPUT, "Explicit synthetic output is required");
for (const variable of ["APPDATA", "LOCALAPPDATA", "TEMP", "TMP"]) {
  assert.ok(path.resolve(process.env[variable] || "").startsWith(output + path.sep), `${variable} must be isolated before Electron starts`);
}
for (const [name, folder] of Object.entries({ home: "home", userData: "profile", sessionData: "session", logs: "logs", crashDumps: "crashes", temp: "tmp" })) {
  const directory = path.join(output, folder);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath(name, directory);
}
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.on("window-all-closed", () => {});

async function main() {
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_request, callback) => callback({ cancel: true }));
  const root = path.resolve(__dirname, "../..");
  const snapshot = {
    profile: { name: "合成候选人" },
    sections: [{ id: "synthetic-section", title: "个人概述", kind: "self", visible: true, items: [{ id: "synthetic-item", body: "整理订单项目的数据。", fields: {}, metaLeft: "", metaRight: "" }] }],
  };
  const window = new BrowserWindow({ show: false, width: 980, height: 1320, webPreferences: { nodeIntegration: false, contextIsolation: false, sandbox: false } });
  try {
    await window.loadFile(path.join(root, "public/resume-editor/index.html"), { query: { embedded: "1", preview: "1" } });
    await window.webContents.executeJavaScript(`new Promise((resolve,reject) => {
      const deadline = Date.now()+20000;
      const timer = setInterval(() => {
        if (window.fetchCVBridge?.status().initialized) {
          clearInterval(timer);
          if (!window.fetchCVBridge.loadSnapshot(${JSON.stringify(snapshot)})) return reject(new Error('synthetic snapshot failed'));
          Promise.resolve(document.fonts?.ready).then(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        } else if (Date.now()>deadline) { clearInterval(timer); reject(new Error('editor initialization timed out')); }
      }, 80);
    })`);
    const mainSource = fs.readFileSync(path.join(root, "electron/main.mjs"), "utf8");
    const renderScript = mainSource.match(/const metrics = await renderWindow\.webContents\.executeJavaScript\(`([\s\S]*?)`\);/);
    assert.ok(renderScript, "Use the production DOM print preparation");
    const metrics = await window.webContents.executeJavaScript(renderScript[1]);
    const pdf = await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: "A4", margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    fs.writeFileSync(path.join(output, "synthetic-editor.pdf"), pdf);
    fs.writeFileSync(path.join(output, "synthetic-snapshot.json"), JSON.stringify(snapshot, null, 2));
    fs.writeFileSync(path.join(output, "synthetic-editor.png"), (await window.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, "render-report.json"), JSON.stringify({ ok: true, electron: process.versions.electron, pdfBytes: pdf.length, metrics, noRealApp: true, noSidecar: true, noNetwork: true }, null, 2));
    process.stdout.write("Synthetic Electron editor printToPDF completed.\n");
  } finally { window.destroy(); }
}
main().then(() => app.exit(0), (error) => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
