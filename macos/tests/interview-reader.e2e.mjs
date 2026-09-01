import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort } from "../electron/sidecar.mjs";
import { defaultUserDataPath } from "../scripts/platform-paths.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourceUserData = process.env.FETCHCV_PROBE_SOURCE_USER_DATA
  || defaultUserDataPath();
const liveUserData = process.env.FETCHCV_PROBE_LIVE === "1";
const userData = liveUserData
  ? sourceUserData
  : fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-interview-reader-"));
const screenshotPath = path.join(os.tmpdir(), "fetchcv-interview-reader.png");

const copy = (relativePath) => {
  const source = path.join(sourceUserData, relativePath);
  const destination = path.join(userData, relativePath);
  assert.equal(fs.existsSync(source), true, `Missing reader input: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
};

if (!liveUserData) {
  copy(path.join("data", "fetchcv.db"));
  copy(path.join("settings", "model-provider.json"));
  for (const relativePath of [
    path.join("settings", "xiaohongshu-session.bin"),
    path.join("settings", "xiaohongshu-public-links.bin"),
  ]) {
    if (fs.existsSync(path.join(sourceUserData, relativePath))) copy(relativePath);
  }
}

const port = await findFreePort();
const application = await electron.launch({
  args: [projectRoot],
  cwd: projectRoot,
  env: {
    ...process.env,
    FETCHCV_API_PORT: String(port),
    FETCHCV_E2E_USER_DATA: userData,
    FETCHCV_E2E_CAPTURE_EXTERNAL: "1",
  },
  timeout: 60000,
});

try {
  const window = await application.firstWindow({ timeout: 50000 });
  const rendererErrors = [];
  window.on("pageerror", (error) => rendererErrors.push(error.message));
  await window.locator(".main-pane, .center-empty").first().waitFor({ state: "visible", timeout: 30000 });
  const runtime = await window.evaluate(() => ({
    apiBase: window.appRuntime.apiBase,
    apiToken: window.appRuntime.apiToken,
  }));
  const headers = { "x-fetchcv-control-token": runtime.apiToken };
  const request = async (pathname) => {
    const response = await fetch(`${runtime.apiBase}${pathname}`, { headers });
    const body = await response.json();
    if (!response.ok) throw new Error(`${pathname}: ${JSON.stringify(body)}`);
    return body;
  };
  const workspace = await request("/api/workspace");
  const job = workspace.jobs.find((item) => (
    String(item.company || "").includes("滴滴")
    && /两轮车|策略运营/.test(String(item.role || ""))
  ));
  assert.ok(job, "The local workspace has no Didi two-wheel strategy-operations job");

  await window.getByRole("button", { name: `${job.company} ${job.role}`, exact: true }).click();
  await window.getByRole("button", { name: "面试", exact: true }).click();
  await window.locator(".interview-page").waitFor({ state: "visible", timeout: 20000 });

  const question = window.locator(".interview-question").first();
  await question.waitFor({ state: "visible" });
  const questionHead = question.locator(".interview-question-head");
  if (await questionHead.getAttribute("aria-expanded") === "true") await questionHead.click();
  await questionHead.click();
  assert.equal(await questionHead.getAttribute("aria-expanded"), "true");
  const questionBody = question.locator(".interview-question-body");
  await questionBody.waitFor({ state: "visible" });
  const questionBodyTextLength = (await questionBody.innerText()).length;
  assert.ok(questionBodyTextLength > 20, "Expanded question body is empty");

  const evidenceCard = question.locator(".interview-evidence-card").first();
  const localSourceButton = window.locator(".interview-rail-source .snapshot").first();
  if (await evidenceCard.count()) await evidenceCard.click();
  else await localSourceButton.click();

  const reader = window.getByRole("dialog", { name: /面经原文/ });
  await reader.waitFor({ state: "visible", timeout: 12000 });
  await reader.getByText("本地证据快照", { exact: false }).waitFor({ state: "visible" });
  await reader.locator(".interview-reader-raw").waitFor({ state: "visible", timeout: 12000 });
  await reader.locator(".interview-reader-loading").waitFor({ state: "detached", timeout: 12000 });
  const readerText = await reader.innerText();
  assert.match(readerText, /保存的正文|原文中识别的问题|Agent 摘要/);
  assert.match(readerText, /无需小红书扫码/);
  await window.screenshot({ path: screenshotPath });
  assert.equal(fs.existsSync(screenshotPath), true);

  await reader.getByRole("button", { name: "关闭原文" }).click();
  await reader.waitFor({ state: "detached" });

  await window.getByRole("button", { name: "对话", exact: true }).click();
  const conversationSources = window.locator(".message-interview-sources").last();
  await conversationSources.waitFor({ state: "visible", timeout: 12000 });
  const sourceArticles = conversationSources.locator(":scope > div > article");
  const originalButtons = sourceArticles.locator(".message-source-original");
  assert.ok(await sourceArticles.count() >= 2, "Conversation did not render saved interview sources");
  const sourceDates = await originalButtons.locator("small").allTextContents();
  const timestamps = sourceDates.map((value) => {
    const matched = value.match(/(20\d{2})\/(\d{2})\/(\d{2})/);
    assert.ok(matched, `Missing publication date in conversation source: ${value}`);
    return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  });
  assert.deepEqual(timestamps, [...timestamps].sort((left, right) => right - left));

  const firstTitle = await originalButtons.first().locator("strong").innerText();
  const jobDetail = await request(`/api/jobs/${job.id}/workspace`);
  const firstSource = jobDetail.interview_sources.find((source) => source.title === firstTitle);
  assert.ok(firstSource, "Could not resolve the first conversation source");
  const externalResult = await window.evaluate(
    (source) => window.appRuntime.openInterviewSource({
      url: source.source_url,
      title: source.title,
      company: source.company,
      businessUnit: source.business_unit,
      role: source.role,
    }),
    firstSource,
  );
  assert.match(externalResult.url, /^https:\/\/(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)\//);
  assert.ok(
    externalResult.url.includes("xsec_token=") || externalResult.url.includes("xhslink.com"),
    `Original source access grant was not restored: ${externalResult.url}\n${JSON.stringify(externalResult.diagnostics, null, 2)}`,
  );

  const windowsBefore = application.windows().length;
  await originalButtons.first().click();
  await window.waitForTimeout(250);
  assert.equal(await window.getByRole("dialog", { name: /面经原文/ }).count(), 0, "Original-post action opened the local backup");
  await sourceArticles.first().locator(".message-source-snapshot").click();
  const conversationReader = window.getByRole("dialog", { name: /面经原文/ });
  await conversationReader.waitFor({ state: "visible", timeout: 12000 });
  assert.equal(application.windows().length, windowsBefore, "Local backup opened an external Xiaohongshu window");
  await conversationReader.getByRole("button", { name: "关闭原文" }).click();
  await conversationReader.waitFor({ state: "detached" });
  assert.deepEqual(rendererErrors, []);
  console.log(JSON.stringify({
    screenshot: screenshotPath,
    expanded_question_text_length: questionBodyTextLength,
    local_reader_text_length: readerText.length,
    conversation_source_dates: sourceDates,
    original_source_access_restored: true,
  }, null, 2));
} finally {
  await application.close().catch(() => {});
}
