import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort, isFetchCVHealthy } from "../electron/sidecar.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const port = await findFreePort();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-e2e-"));
const screenshot = path.join(os.tmpdir(), "fetchcv-desktop-smoke.png");
const narrowScreenshot = path.join(os.tmpdir(), "fetchcv-desktop-narrow.png");
const settingsScreenshot = path.join(os.tmpdir(), "fetchcv-desktop-settings.png");
const mcpSettingsScreenshot = path.join(os.tmpdir(), "fetchcv-desktop-mcp-settings.png");

const application = await electron.launch({
  args: [projectRoot],
  cwd: projectRoot,
  env: { ...process.env, FETCHCV_API_PORT: String(port), FETCHCV_E2E_USER_DATA: userData, FETCHCV_ALLOW_MOCK_RUNTIME: "1" },
  timeout: 45000,
});

let apiBase = `http://127.0.0.1:${port}`;
try {
  const window = await application.firstWindow({ timeout: 35000 });
  const rendererErrors = [];
  window.on("pageerror", (error) => rendererErrors.push(error.message));
  window.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("net::ERR_CONNECTION_REFUSED")) rendererErrors.push(text);
  });
  await window.getByText("FetchCV", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
  await window.getByRole("button", { name: "导入第一份简历" }).waitFor({ state: "visible", timeout: 20000 });
  await window.setViewportSize({ width: 1060, height: 700 });
  const narrowLayout = await window.evaluate(() => {
    const grid = document.querySelector(".app-grid");
    const columns = [...grid.children].map((node) => node.getBoundingClientRect().toJSON());
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      columns,
    };
  });
  assert.equal(narrowLayout.scrollWidth, narrowLayout.clientWidth, `narrow layout overflows: ${JSON.stringify(narrowLayout)}`);
  assert.equal(narrowLayout.columns.length, 2);
  assert.ok(narrowLayout.columns.every((column) => column.left >= 0 && column.right <= narrowLayout.clientWidth + 1), `column clipped at minimum width: ${JSON.stringify(narrowLayout)}`);
  await window.screenshot({ path: narrowScreenshot });
  assert.equal(fs.existsSync(narrowScreenshot), true);
  await window.setViewportSize({ width: 1360, height: 840 });
  const runtime = await window.evaluate(() => window.appRuntime);
  apiBase = runtime.apiBase;
  assert.equal(runtime.apiBase, `http://127.0.0.1:${port}`);
  assert.equal(await isFetchCVHealthy(runtime.apiBase), true);

  await window.locator(".sidebar-foot").click();
  const modelDialog = window.getByRole("dialog", { name: "设置" });
  await modelDialog.waitFor({ state: "visible" });
  await modelDialog.getByText("本地用户", { exact: true }).first().waitFor({ state: "visible" });
  await modelDialog.getByRole("button", { name: "模型 API" }).click();
  await modelDialog.getByRole("heading", { name: "模型 API" }).waitFor({ state: "visible" });
  await modelDialog.getByRole("button", { name: "Skills" }).click();
  await modelDialog.getByRole("heading", { name: "Skills" }).waitFor({ state: "visible" });
  await modelDialog.getByRole("button", { name: "MCP Servers" }).click();
  await modelDialog.getByRole("heading", { name: "MCP Servers" }).waitFor({ state: "visible" });
  await modelDialog.getByLabel("MCP 名称").waitFor({ state: "visible" });
  const streamableHttpButton = modelDialog.getByRole("button", { name: "流式 HTTP" });
  assert.equal(await streamableHttpButton.isDisabled(), false);
  await streamableHttpButton.click();
  assert.equal(await streamableHttpButton.getAttribute("aria-pressed"), "true");
  await modelDialog.getByRole("button", { name: "STDIO" }).click();
  await modelDialog.getByRole("button", { name: "添加参数" }).click();
  assert.equal(await modelDialog.getByLabel(/^MCP 参数 /).count(), 2);
  await modelDialog.getByRole("button", { name: "添加环境变量" }).click();
  assert.equal(await modelDialog.getByLabel(/^MCP 环境变量 /).count(), 2);
  await window.screenshot({ path: mcpSettingsScreenshot });
  assert.equal(fs.existsSync(mcpSettingsScreenshot), true);
  await modelDialog.getByRole("button", { name: "权限与浏览器" }).click();
  await modelDialog.getByText("即使允许，具体文件操作也必须逐次审批；关闭后 Agent 只能读取。", { exact: true }).waitFor({ state: "visible" });
  await modelDialog.getByRole("button", { name: "常规" }).click();
  await window.screenshot({ path: settingsScreenshot });
  assert.equal(fs.existsSync(settingsScreenshot), true);
  await modelDialog.getByRole("button", { name: "关闭" }).click();
  await modelDialog.waitFor({ state: "detached" });
  const apiHeaders = { "Content-Type": "application/json", "X-FetchCV-Control-Token": runtime.apiToken };
  const browserStatus = await fetch(`${runtime.apiBase}/api/browser/status`, { headers: apiHeaders }).then((response) => response.json());
  assert.deepEqual({ open: browserStatus.open, loading: browserStatus.loading }, { open: false, loading: false });
  const post = (url, body) => fetch(`${runtime.apiBase}${url}`, { method: "POST", headers: apiHeaders, body: JSON.stringify(body) }).then((response) => response.json());
  const candidate = await post("/api/candidates", { name: "FetchCV 测试用户", title: "数据分析" });
  await post(`/api/candidates/${candidate.id}/experiences`, { kind: "education", title: "示例大学", organization: "示例大学", role: "统计学", start_date: "2024-09", end_date: "至今", summary: "GPA 3.8/4", details_json: { bullets: ["奖学金"] } });
  await post(`/api/candidates/${candidate.id}/experiences`, { kind: "project", title: "指标分析项目", role: "负责人", start_date: "2025-01", end_date: "2025-05", summary: "使用 SQL 与 Python 建立指标体系", details_json: { bullets: ["完成数据清洗与分析"] } });
  const job = await post("/api/jobs", { candidate_id: candidate.id, company: "示例科技", role: "数据分析实习生", jd_raw: "负责业务数据分析，要求熟练使用 SQL 与 Python，能够建立指标体系并输出分析建议。" });
  await window.reload();
  const jobButton = window.getByRole("button", { name: "示例科技 数据分析实习生", exact: true });
  await jobButton.waitFor({ state: "visible" });
  await jobButton.click();
  const resumeTabBeforeGeneration = window.getByRole("button", { name: "简历", exact: true });
  assert.equal(await resumeTabBeforeGeneration.isDisabled(), false);
  await resumeTabBeforeGeneration.click();
  await window.getByRole("heading", { name: "还没有可预览的简历" }).waitFor({ state: "visible" });
  await window.getByRole("button", { name: "对话", exact: true }).click();
  await window.getByRole("button", { name: /理解岗位/ }).click();
  let startedWorkspace;
  for (let index = 0; index < 20; index += 1) {
    startedWorkspace = await fetch(`${runtime.apiBase}/api/jobs/${job.id}/workspace`, { headers: apiHeaders }).then((response) => response.json());
    if (startedWorkspace.run?.job_id === job.id) break;
    await window.waitForTimeout(100);
  }
  assert.equal(startedWorkspace.run?.job_id, job.id);
  assert.equal(startedWorkspace.run?.status, "created");
  assert.equal(startedWorkspace.resumes.length, 0);
  const interviewTab = window.getByRole("button", { name: "面试", exact: true });
  assert.equal(await interviewTab.isDisabled(), false);
  await interviewTab.click();
  await window.getByRole("heading", { name: "从真实面经，准备下一轮" }).waitFor({ state: "visible" });
  await window.screenshot({ path: screenshot });
  assert.equal(fs.existsSync(screenshot), true);
  assert.deepEqual(rendererErrors, []);
} finally {
  await application.close();
}

for (let index = 0; index < 20 && await isFetchCVHealthy(apiBase, 250); index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(await isFetchCVHealthy(apiBase, 250), false);
