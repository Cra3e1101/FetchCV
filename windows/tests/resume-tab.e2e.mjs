import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort, isFetchCVHealthy } from "../electron/sidecar.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const port = await findFreePort();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-resume-tab-"));
const application = await electron.launch({
  args: [projectRoot],
  cwd: projectRoot,
  env: {
    ...process.env,
    FETCHCV_API_PORT: String(port),
    FETCHCV_E2E_USER_DATA: userData,
    FETCHCV_ALLOW_MOCK_RUNTIME: "1",
  },
  timeout: 45000,
});

let apiBase = `http://127.0.0.1:${port}`;
try {
  const window = await application.firstWindow({ timeout: 35000 });
  await window.getByText("FetchCV", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
  await window.getByRole("heading", { name: "先建立你的求职资料库" }).waitFor({ state: "visible", timeout: 20000 });
  const runtime = await window.evaluate(() => window.appRuntime);
  apiBase = runtime.apiBase;
  const headers = {
    "Content-Type": "application/json",
    "X-FetchCV-Control-Token": runtime.apiToken,
  };
  const post = (url, body) => fetch(`${runtime.apiBase}${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }).then((response) => response.json());

  const candidate = await post("/api/candidates", { name: "页签回归用户" });
  const job = await post("/api/jobs", {
    candidate_id: candidate.id,
    company: "页签回归公司",
    role: "策略运营",
    jd_raw: "负责策略运营与数据分析。",
  });

  await window.reload();
  await window.getByRole("button", { name: `${job.company} ${job.role}` }).click();
  const resumeTab = window.getByRole("button", { name: "简历", exact: true });
  assert.equal(await resumeTab.isDisabled(), false);
  await resumeTab.click();
  await window.getByRole("heading", { name: "还没有可预览的简历" }).waitFor({ state: "visible" });
  assert.equal(await resumeTab.getAttribute("class"), "active");
} finally {
  await application.close();
}

for (let index = 0; index < 20 && await isFetchCVHealthy(apiBase, 250); index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(await isFetchCVHealthy(apiBase, 250), false);
