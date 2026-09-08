import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

// Isolated UI fixtures: no real candidate data, model calls, or writes to the sidecar.
const candidate = { id: "candidate-test", name: "林同学", resume_count: 1, fact_count: 12 };
const jobs = [
  { id: "job-a", company: "远山科技", role: "产品经理", latest_run: { current_stage: "awaiting_user_review" } },
  { id: "job-b", company: "青禾设计", role: "用户体验设计师", latest_run: { current_stage: "frozen" } },
  { id: "job-c", company: "远山科技", role: "策略运营", latest_run: null },
].map((job) => ({ ...job, candidate_id: candidate.id, jd_raw: "负责产品规划、用户研究与数据分析。" }));
const browser = await chromium.launch({ headless: true, channel: process.env.FETCHCV_BROWSER_CHANNEL || "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let failRuntime = false;
let failJob = false;
let empty = false;
const researchRequests = [];
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/messages/stream")) {
    researchRequests.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "text/event-stream", body: `event: done\ndata: ${JSON.stringify({ assistant: { id: "test-reply", role: "assistant", content: "测试完成" } })}\n\n` });
  }
  if (path === "/api/runtime/status" && failRuntime) return route.fulfill({ status: 503, json: { detail: "unavailable" } });
  if (/\/jobs\/.*\/workspace/.test(path)) {
    if (failJob) return route.fulfill({ status: 503, json: { detail: "暂时无法读取" } });
    const job = jobs.find((item) => path.includes(item.id));
    return route.fulfill({ json: { job, candidate, run: null, profile: null, messages: [], tasks: [], steps: [], approvals: [], proposals: [], resumes: [], base_resumes: [], portfolios: [], facts: [], experiences: [], materials: [], applications: [], queued_messages: [], interview_sources: [], interview_briefs: [] } });
  }
  const responses = {
    "/api/workspace": { candidates: empty ? [] : [candidate], jobs: empty ? [] : jobs },
    "/api/runtime/status": { configured: true, model: "test-model", provider_name: "Test" },
    "/api/settings/general": { theme: "light", accent: "coral", density: "comfortable" },
    [`/api/candidates/${candidate.id}/library`]: { candidate, resumes: [], experiences: [], materials: [], interview_sources: [], interview_briefs: [] },
  };
  return route.fulfill({ json: responses[path] || [] });
});
const home = () => page.getByRole("button", { name: /求职工作台 总览/ }).click();
try {
  await page.goto(process.env.FETCHCV_UI_URL || "http://127.0.0.1:5188");
  await page.locator(".career-job").first().waitFor();
  assert.equal(await page.locator(".career-job").count(), 3);
  await page.getByRole("button", { name: "待我确认", exact: true }).click();
  assert.equal(await page.locator(".career-job").count(), 1);
  await page.getByRole("button", { name: "全部岗位", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索工作台岗位" }).fill("青禾");
  assert.equal(await page.locator(".career-job").count(), 1);
  await page.getByRole("textbox", { name: "搜索工作台岗位" }).fill("");
  await fs.mkdir("artifacts/workspace-optimization", { recursive: true });
  await page.screenshot({ path: "artifacts/workspace-optimization/dashboard-light.png" });
  await page.getByRole("button", { name: "远山科技 策略运营 面经", exact: true }).click();
  await page.locator(".workspace-tabs button.active").filter({ hasText: "面试" }).waitFor();
  assert.equal(await page.locator(".workspace-recovery[role=alert]").count(), 0);
  await page.locator(".interview-primary").click();
  assert.equal(await page.getByRole("button", { name: /只查牛客|补充牛客/ }).count(), 0);
  await page.waitForFunction(() => !document.querySelector(".interview-primary")?.disabled);
  assert.equal(researchRequests.length, 1);
  assert.match(researchRequests[0].content, /默认来源包含小红书和牛客网/);
  assert.equal(researchRequests[0].task_kind, "interview_research");
  await home();
  await page.getByRole("button", { name: "远山科技 策略运营 简历", exact: true }).click();
  await page.locator(".workspace-tabs button.active").filter({ hasText: "简历" }).waitFor();
  await home();
  failJob = true;
  await page.getByRole("button", { name: "打开 青禾设计 用户体验设计师", exact: true }).click();
  await page.getByRole("heading", { name: "岗位资料暂时无法读取" }).waitFor();
  failJob = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.locator(".task-header h1").filter({ hasText: "用户体验设计师" }).waitFor();
  await home();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fetchcv:appearance", { detail: { theme: "dark", accent: "sage" } })));
  await page.screenshot({ path: "artifacts/workspace-optimization/dashboard-dark.png" });
  await page.setViewportSize({ width: 800, height: 900 });
  assert.equal(await page.locator(".career-dashboard").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
  await page.screenshot({ path: "artifacts/workspace-optimization/dashboard-narrow.png" });
  failRuntime = true;
  await page.reload();
  await page.locator(".career-job").first().waitFor();
  await page.getByText("模型状态暂时无法读取，个人资料和岗位仍可使用。", { exact: true }).waitFor();
  assert.equal(await page.getByText("本地服务未能启动", { exact: true }).count(), 0);
  empty = true;
  failRuntime = false;
  await page.reload();
  await page.getByRole("button", { name: "导入第一份简历" }).waitFor();
  assert.equal(await page.locator(".career-job").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS dashboard: filters, search, interview navigation, retry, dark/narrow layouts, degraded runtime, onboarding; no page errors.");
} finally { await browser.close(); }
