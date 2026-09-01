import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort, isFetchCVHealthy } from "../electron/sidecar.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourceDatabase = process.env.FETCHCV_INTERVIEW_E2E_DB;
const packaged = process.env.FETCHCV_INTERVIEW_E2E_PACKAGED === "1";
assert.ok(sourceDatabase && fs.existsSync(sourceDatabase), "Set FETCHCV_INTERVIEW_E2E_DB to an existing FetchCV database");

const port = await findFreePort();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-interview-result-e2e-"));
const dataDirectory = path.join(userData, "data");
const screenshot = path.join(os.tmpdir(), "fetchcv-interview-result-recovered.png");
fs.mkdirSync(dataDirectory, { recursive: true });
fs.copyFileSync(sourceDatabase, path.join(dataDirectory, "fetchcv.db"));

const application = await electron.launch({
  ...(packaged ? { executablePath: path.join(projectRoot, "release", "win-unpacked", "FetchCV.exe") } : { args: [projectRoot] }),
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
  const runtime = await window.evaluate(() => window.appRuntime);
  apiBase = runtime.apiBase;
  const headers = { "X-FetchCV-Control-Token": runtime.apiToken };
  const workspace = await fetch(`${apiBase}/api/workspace`, { headers }).then((response) => response.json());
  const candidates = [];
  for (const job of workspace.jobs || []) {
    const detail = await fetch(`${apiBase}/api/jobs/${job.id}/workspace`, { headers }).then((response) => response.json());
    const hasLegacyReport = (detail.messages || []).some((message) => message.role === "user" && String(message.content || "").startsWith("请为当前岗位开展一次可追溯的面试情报调研"));
    if (hasLegacyReport && !(detail.interview_briefs || []).length) candidates.push(job);
  }
  assert.ok(candidates.length, "Copied database does not contain a legacy interview report without a brief");
  const job = candidates[0];
  await window.getByRole("button", { name: `${job.company} ${job.role}` }).click();
  await window.getByRole("button", { name: "面试", exact: true }).click();
  const outcome = window.locator(".interview-outcome");
  await outcome.waitFor({ state: "visible", timeout: 15000 });
  await outcome.getByText("本轮调研已完成，结果已保留", { exact: true }).waitFor({ state: "visible" });
  await outcome.getByText(/面试情报调研/).first().waitFor({ state: "visible" });
  assert.ok((await outcome.locator(".interview-outcome-markdown").innerText()).length > 200);
  await window.screenshot({ path: screenshot });
  console.log(`Recovered interview result screenshot: ${screenshot}`);
} finally {
  await application.close();
}

for (let index = 0; index < 20 && await isFetchCVHealthy(apiBase, 250); index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(await isFetchCVHealthy(apiBase, 250), false);
