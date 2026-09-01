import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort, isFetchCVHealthy } from "../electron/sidecar.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const isMac = process.platform === "darwin";
const macAppPath = fs.existsSync(path.join(projectRoot, "release", "FetchCV.app"))
  ? path.join(projectRoot, "release", "FetchCV.app")
  : path.join(projectRoot, "release", "mac-arm64", "FetchCV.app");
const executablePath = isMac
  ? path.join(macAppPath, "Contents", "MacOS", "FetchCV")
  : path.join(projectRoot, "release", "win-unpacked", "FetchCV.exe");
const sidecarPath = isMac
  ? path.join(macAppPath, "Contents", "Resources", "sidecar", "fetchcv-api")
  : path.join(projectRoot, "release", "win-unpacked", "resources", "sidecar", "fetchcv-api.exe");
assert.equal(fs.existsSync(executablePath), true, `Packaged Electron executable is missing: ${executablePath}`);
assert.equal(fs.existsSync(sidecarPath), true, `Packaged sidecar is missing: ${sidecarPath}`);

const port = await findFreePort();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-packaged-e2e-"));
const application = await electron.launch({
  executablePath,
  env: { ...process.env, FETCHCV_API_PORT: String(port), FETCHCV_E2E_USER_DATA: userData },
  timeout: 60000,
});
const applicationProcess = application.process();
let closedFromWindow = false;

try {
  const window = await application.firstWindow({ timeout: 50000 });
  await window.getByText("FetchCV", { exact: true }).first().waitFor({ state: "visible", timeout: 30000 });
  await window.getByRole("heading", { name: "先建立你的求职资料库" }).waitFor({ state: "visible", timeout: 30000 });
  assert.equal(await isFetchCVHealthy(`http://127.0.0.1:${port}`), true);
  const runtime = await window.evaluate(() => window.appRuntime);
  const browserStatus = await fetch(`${runtime.apiBase}/api/browser/status`, { headers: { "X-FetchCV-Control-Token": runtime.apiToken } }).then((response) => response.json());
  assert.deepEqual({ open: browserStatus.open, loading: browserStatus.loading }, { open: false, loading: false });
  if (isMac) {
    assert.equal(await window.locator(".window-actions").count(), 0);
    await application.close();
    closedFromWindow = true;
  } else {
    await window.getByRole("button", { name: "关闭", exact: true }).click();
  }
  await new Promise((resolve, reject) => {
    if (isMac) return resolve();
    if (applicationProcess.exitCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error("Packaged app did not exit after window close")), 15000);
    applicationProcess.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  closedFromWindow = true;
} finally {
  if (!closedFromWindow && applicationProcess.exitCode === null) await application.close();
}

for (let index = 0; index < 30 && await isFetchCVHealthy(`http://127.0.0.1:${port}`, 250); index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(await isFetchCVHealthy(`http://127.0.0.1:${port}`, 250), false);
