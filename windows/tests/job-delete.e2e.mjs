import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort, isFetchCVHealthy } from "../electron/sidecar.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const port = await findFreePort();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-delete-e2e-"));
const application = await electron.launch({
  args: [projectRoot],
  cwd: projectRoot,
  env: { ...process.env, FETCHCV_API_PORT: String(port), FETCHCV_E2E_USER_DATA: userData },
  timeout: 45000,
});

let apiBase = `http://127.0.0.1:${port}`;
try {
  const window = await application.firstWindow({ timeout: 35000 });
  await window.getByText("FetchCV", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
  const runtime = await window.evaluate(() => window.appRuntime);
  apiBase = runtime.apiBase;
  const apiHeaders = { "Content-Type": "application/json", "X-FetchCV-Control-Token": runtime.apiToken };
  const post = (url, body) => fetch(`${apiBase}${url}`, { method: "POST", headers: apiHeaders, body: JSON.stringify(body) }).then((response) => response.json());
  const candidate = await post("/api/candidates", { name: "删除测试用户" });
  const job = await post("/api/jobs", { candidate_id: candidate.id, company: "待删除公司", role: "测试岗位", jd_raw: "用于验证岗位删除状态同步。" });

  await window.reload();
  const jobButton = window.getByRole("button", { name: "待删除公司 测试岗位" });
  await jobButton.waitFor({ state: "visible" });
  await window.getByRole("button", { name: "管理 待删除公司 岗位" }).click();
  const dialog = window.getByRole("dialog", { name: "管理岗位项目" });
  await dialog.getByRole("button", { name: "删除项目" }).click();
  await dialog.getByRole("button", { name: "再次点击确认删除" }).click();
  await window.waitForTimeout(1200);
  if (await window.locator(".app-notice.error").count()) {
    throw new Error(`delete UI error: ${await window.locator(".app-notice.error").innerText()}`);
  }
  await dialog.waitFor({ state: "detached", timeout: 10000 });
  await jobButton.waitFor({ state: "detached", timeout: 10000 });
  assert.equal(await window.locator(".app-notice.error").count(), 0);
  assert.equal((await fetch(`${apiBase}/api/jobs/${job.id}/workspace`, { headers: apiHeaders })).status, 404);
  assert.equal((await fetch(`${apiBase}/api/candidates/${candidate.id}`, { headers: apiHeaders })).status, 200);
} finally {
  await application.close();
}

for (let index = 0; index < 20 && await isFetchCVHealthy(apiBase, 250); index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(await isFetchCVHealthy(apiBase, 250), false);
