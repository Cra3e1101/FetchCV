import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const main = fs.readFileSync(path.join(root, "electron/main.mjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron/preload.cjs"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

test("macOS uses native traffic lights and Windows keeps custom controls", () => {
  assert.match(main, /const isMac = process\.platform === "darwin"/);
  assert.match(main, /titleBarStyle: "hiddenInset"/);
  assert.match(main, /trafficLightPosition: \{ x: 15, y: 12 \}/);
  assert.match(main, /: \{ frame: false \}/);
  assert.match(preload, /platform: process\.platform/);
  assert.match(app, /desktop && !isMac && <div className="window-actions">/);
  assert.match(css, /\.windowbar\.macos \.window-drag\s*\{\s*padding-left:\s*82px/);
});

test("desktop shell is shown before the packaged Agent sidecar becomes healthy", () => {
  const windowIndex = main.indexOf("createWindow(backendApiBase)");
  const readyIndex = main.indexOf("await Promise.all([browserPromise, sidecarStartup])");
  const startupIndex = main.indexOf("const sidecarStartup =");
  const electronReadyIndex = main.indexOf("app.whenReady().then");
  assert.ok(windowIndex >= 0 && readyIndex >= 0 && windowIndex < readyIndex);
  assert.ok(startupIndex >= 0 && electronReadyIndex >= 0 && startupIndex < electronReadyIndex);
  assert.match(preload, /getBackendStatus: \(\) => ipcRenderer\.invoke\("backend:get-status"\)/);
  assert.match(app, /const \[initializing, setInitializing\] = useState\(true\)/);
  assert.match(app, /<StartupWorkspace \/>/);
  assert.match(css, /\.startup-workspace\s*\{/);
});
