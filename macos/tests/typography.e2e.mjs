import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort, isFetchCVHealthy } from "../electron/sidecar.mjs";
import { defaultUserDataPath } from "../scripts/platform-paths.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourceUserData = process.env.FETCHCV_PROBE_SOURCE_USER_DATA || defaultUserDataPath();
const sourceDatabase = path.join(sourceUserData, "data", "fetchcv.db");
assert.equal(fs.existsSync(sourceDatabase), true, `Missing FetchCV database: ${sourceDatabase}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-typography-"));
const dataDirectory = path.join(userData, "data");
fs.mkdirSync(dataDirectory, { recursive: true });
fs.copyFileSync(sourceDatabase, path.join(dataDirectory, "fetchcv.db"));

const port = await findFreePort();
const screenshotPath = path.join(os.tmpdir(), "fetchcv-readable-typography.png");
const conversationScreenshotPath = path.join(os.tmpdir(), "fetchcv-readable-conversation.png");
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
  await window.setViewportSize({ width: 1600, height: 900 });
  await window.locator(".main-pane, .center-empty").first().waitFor({ state: "visible", timeout: 30000 });
  const runtime = await window.evaluate(() => window.appRuntime);
  apiBase = runtime.apiBase;
  const headers = { "X-FetchCV-Control-Token": runtime.apiToken };
  const request = (pathname) => fetch(`${runtime.apiBase}${pathname}`, { headers }).then((response) => response.json());
  const workspace = await request("/api/workspace");

  let selected = null;
  for (const job of workspace.jobs || []) {
    const detail = await request(`/api/jobs/${job.id}/workspace`);
    if ((detail.interview_briefs || []).length) {
      selected = { job, detail };
      break;
    }
  }
  assert.ok(selected, "No job with an interview brief is available for typography validation");

  await window.getByRole("button", {
    name: `${selected.job.company} ${selected.job.role}`,
    exact: true,
  }).click();
  await window.getByRole("button", { name: "面试", exact: true }).click();
  await window.locator(".interview-page").waitFor({ state: "visible", timeout: 15000 });

  const computedSize = (selector) => window.locator(selector).first().evaluate(
    (node) => Number.parseFloat(getComputedStyle(node).fontSize),
  );
  assert.ok(await computedSize(".interview-summary > p") >= 15.5);
  assert.ok(await computedSize(".interview-question-title strong") >= 13.5);
  if (await window.locator(".interview-rail-source strong").count()) {
    assert.ok(await computedSize(".interview-rail-source strong") >= 11.5);
  }

  await window.screenshot({ path: screenshotPath });
  assert.equal(fs.existsSync(screenshotPath), true);
  console.log(`Typography screenshot: ${screenshotPath}`);

  await window.getByRole("button", { name: "对话", exact: true }).click();
  await window.locator(".agent-message.assistant").first().waitFor({ state: "visible", timeout: 15000 });
  assert.ok(await computedSize(".agent-message.assistant") >= 15);
  assert.ok(await computedSize(".job-copy small") >= 12);
  if (await window.locator(".message-source-original strong").count()) {
    assert.ok(await computedSize(".message-source-original strong") >= 11.5);
  }
  await window.screenshot({ path: conversationScreenshotPath });
  assert.equal(fs.existsSync(conversationScreenshotPath), true);
  console.log(`Conversation typography screenshot: ${conversationScreenshotPath}`);
} finally {
  await application.close();
}

for (let index = 0; index < 20 && await isFetchCVHealthy(apiBase, 250); index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(await isFetchCVHealthy(apiBase, 250), false);
