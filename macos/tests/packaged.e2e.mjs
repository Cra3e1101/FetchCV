import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort, isFetchCVHealthy } from "../electron/sidecar.mjs";
import { packagedExecutablePath } from "../scripts/platform-paths.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const isMac = process.platform === "darwin";
const executablePath = process.env.FETCHCV_PACKAGED_EXECUTABLE
  ? path.resolve(process.env.FETCHCV_PACKAGED_EXECUTABLE)
  : packagedExecutablePath(projectRoot);
const macAppPath = isMac ? path.dirname(path.dirname(path.dirname(executablePath))) : "";
const sidecarPath = isMac
  ? path.join(macAppPath, "Contents", "Resources", "sidecar", "fetchcv-api")
  : path.join(path.dirname(executablePath), "resources", "sidecar", "fetchcv-api.exe");
assert.equal(fs.existsSync(executablePath), true, `Packaged Electron executable is missing: ${executablePath}`);
assert.equal(fs.existsSync(sidecarPath), true, `Packaged sidecar is missing: ${sidecarPath}`);

const port = await findFreePort();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-packaged-e2e-"));
const launchStartedAt = Date.now();
const healthReadyPromise = (async () => {
  while (Date.now() - launchStartedAt < 30000) {
    if (await isFetchCVHealthy(`http://127.0.0.1:${port}`, 120)) return Date.now() - launchStartedAt;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Packaged sidecar did not become healthy during startup benchmark");
})();
const application = await electron.launch({
  executablePath,
  env: { ...process.env, FETCHCV_API_PORT: String(port), FETCHCV_E2E_USER_DATA: userData },
  timeout: 60000,
});
const applicationProcess = application.process();
let closedFromWindow = false;

try {
  const window = await application.firstWindow({ timeout: 50000 });
  await window.locator(".startup-workspace, .center-empty, .main-pane").first().waitFor({ state: "visible", timeout: 8000 });
  const shellVisibleMs = Date.now() - launchStartedAt;
  console.log(`FetchCV shell visible in ${shellVisibleMs}ms`);
  assert.ok(shellVisibleMs < 8000, `Desktop shell took ${shellVisibleMs}ms to appear`);
  await window.getByText("FetchCV", { exact: true }).first().waitFor({ state: "visible", timeout: 30000 });
  await window.getByRole("heading", { name: "先建立你的求职资料库" }).waitFor({ state: "visible", timeout: 30000 });
  console.log(`FetchCV sidecar healthy in ${await healthReadyPromise}ms`);
  console.log(`FetchCV Agent ready in ${Date.now() - launchStartedAt}ms`);
  assert.equal(await isFetchCVHealthy(`http://127.0.0.1:${port}`), true);
  const runtime = await window.evaluate(() => window.appRuntime);
  const browserStatus = await fetch(`${runtime.apiBase}/api/browser/status`, { headers: { "X-FetchCV-Control-Token": runtime.apiToken } }).then((response) => response.json());
  assert.deepEqual({ open: browserStatus.open, loading: browserStatus.loading }, { open: false, loading: false });
  if (isMac) {
    assert.equal(await window.locator(".window-actions").count(), 0);
    await application.close();
    closedFromWindow = true;
  } else {
    try {
      await window.getByRole("button", { name: "关闭", exact: true }).click({ noWaitAfter: true });
    } catch (error) {
      if (!window.isClosed()) throw error;
    }
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
