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
  window.on("console", (message) => { if (message.type() === "error") rendererErrors.push(message.text()); });
  await window.getByText("FetchCV", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
  await window.getByRole("heading", { name: "先建立你的求职资料库" }).waitFor({ state: "visible", timeout: 20000 });
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
  assert.equal(narrowLayout.columns.length, 3);
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
  assert.equal(await modelDialog.getByRole("button", { name: "流式 HTTP" }).isDisabled(), true);
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
  const jobButton = window.getByRole("button", { name: "示例科技 数据分析实习生" });
  await jobButton.waitFor({ state: "visible" });
  await jobButton.click();
  await window.getByRole("button", { name: /理解岗位/ }).click();
  await window.getByText("选择要重点表达的经历", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await window.getByText("固定保留", { exact: true }).waitFor({ state: "visible" });
  await window.getByRole("button", { name: /确认并生成策略/ }).click();
  await window.getByRole("button", { name: "打开改写审阅" }).click();
  await window.getByText("逐条确认，不覆盖原始资料", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
  await window.getByRole("button", { name: "采用建议" }).click();
  await window.getByRole("button", { name: /应用已确认修改/ }).click();
  await window.getByText("事实检查已通过", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
  await window.getByRole("button", { name: "进入导出检查" }).click();
  await window.getByText("简历可编辑和导出", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
  const completedWorkspace = await fetch(`${runtime.apiBase}/api/jobs/${job.id}/workspace`, { headers: apiHeaders }).then((response) => response.json());
  assert.equal(completedWorkspace.resumes[0].content_json.editor_snapshot.profile.name, "FetchCV 测试用户");
  await window.getByRole("button", { name: "简历", exact: true }).click();
  const canonicalPreview = window.locator('iframe[title="FetchCV 正式 PDF 预览"]');
  await canonicalPreview.waitFor({ state: "visible", timeout: 30000 });
  assert.match(await canonicalPreview.getAttribute("src"), /\/api\/resumes\/.+\/pdf/);
  assert.equal(await window.locator(".resume-sheet-v2").count(), 0);
  await window.getByRole("button", { name: "导出正式 PDF" }).click();
  let exportedWorkspace;
  for (let index = 0; index < 80; index += 1) {
    exportedWorkspace = await fetch(`${runtime.apiBase}/api/jobs/${job.id}/workspace`, { headers: apiHeaders }).then((response) => response.json());
    if (exportedWorkspace.resumes[0].content_json.pdf_renderer === "resume-editor-prototype") break;
    await window.waitForTimeout(500);
  }
  if (exportedWorkspace.resumes[0].content_json.pdf_renderer !== "resume-editor-prototype") {
    const uiError = await window.locator(".canonical-preview-error").textContent().catch(() => "未显示错误");
    throw new Error(`canonical PDF was not saved: ${uiError}`);
  }
  const exportedPdf = await fetch(`${runtime.apiBase}/api/resumes/${exportedWorkspace.resumes[0].id}/pdf`, { headers: apiHeaders }).then((response) => response.arrayBuffer());
  assert.equal(Buffer.from(exportedPdf).subarray(0, 4).toString(), "%PDF");
  await window.screenshot({ path: path.join(os.tmpdir(), "fetchcv-canonical-resume.png") });
  const editButtonCount = await window.getByRole("button", { name: /编辑内容与排版/ }).count();
  if (!editButtonCount) {
    const visibleText = await window.locator("body").innerText();
    throw new Error(`resume studio disappeared after export: ${visibleText.slice(0, 500)} errors=${rendererErrors.join(" | ")}`);
  }
  await window.getByRole("button", { name: /编辑内容与排版/ }).click();
  const editor = window.frameLocator('iframe[title="FetchCV 简历编辑器"]');
  await editor.locator("body").evaluate(() => new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.fetchCVBridge) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > 20000) { clearInterval(timer); reject(new Error("editor bridge timeout")); }
    }, 50);
  }));
  await editor.locator("#previewName").evaluate((element) => new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (element.textContent === "FetchCV 测试用户") { clearInterval(timer); resolve(); }
      else if (Date.now() - started > 20000) { clearInterval(timer); reject(new Error(`snapshot timeout: ${element.textContent}`)); }
    }, 50);
  }));
  assert.equal(await editor.locator("#previewName").textContent(), "FetchCV 测试用户");
  assert.equal(await editor.locator("body").evaluate((body) => body.classList.contains("fetchcv-snapshot-loading")), false);
  assert.equal(await editor.locator(".appbar").evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(250, 248, 244)");
  await window.getByRole("button", { name: "关闭编辑器" }).click();
  await canonicalPreview.waitFor({ state: "visible", timeout: 20000 });
  await window.waitForTimeout(800);
  const outerPreviewMetrics = await window.locator(".canonical-resume-preview").evaluate((node) => ({ container: node.getBoundingClientRect().toJSON(), iframe: node.querySelector("iframe")?.getBoundingClientRect().toJSON(), studio: node.closest(".resume-studio-v2")?.getBoundingClientRect().toJSON() }));
  if ((outerPreviewMetrics.iframe?.height || 0) < (outerPreviewMetrics.container?.height || 0) - 2) throw new Error(`canonical iframe does not fill preview: ${JSON.stringify(outerPreviewMetrics)}`);
  await window.screenshot({ path: screenshot });
  assert.equal(fs.existsSync(screenshot), true);
} finally {
  await application.close();
}

for (let index = 0; index < 20 && await isFetchCVHealthy(apiBase, 250); index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(await isFetchCVHealthy(apiBase, 250), false);
