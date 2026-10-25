import assert from "node:assert/strict";
import { preview } from "vite";
import { chromium } from "playwright";

// Real renderer, isolated fixture APIs: no user profile or model calls.
// Run `npm run build` first; production chunks avoid development transforms.
const server = await preview({ preview: { host: "127.0.0.1", port: 0, open: false } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.FETCHCV_BROWSER_CHANNEL || "chrome" });
  const page = await browser.newPage();
  const errors = [], writes = [];
  let reads = 0, workspaceReads = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(apiBase => {
    window.startupFixture = {
      status: { state: "starting", dataReady: false, agentReady: false },
      listeners: new Set(), milestones: [], sends: [],
      update(status) { this.status = status; this.listeners.forEach(listener => listener(status)); },
    };
    window.appRuntime = {
      apiBase,
      getBackendStatus: async () => window.startupFixture.status,
      onBackendStatus(listener) { window.startupFixture.listeners.add(listener); return () => window.startupFixture.listeners.delete(listener); },
      reportStartupMilestone(name) { window.startupFixture.milestones.push(name); },
      listModelProviders: async () => ({ profiles: [] }),
      streamPiMessage: async input => { window.startupFixture.sends.push(input); return {}; },
    };
  }, origin);
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/workspace") workspaceReads++;
    if (request.method() !== "GET") writes.push(path); else reads++;
    const responses = {
      "/api/workspace": { candidates: [], jobs: [] },
      "/api/runtime/status": { configured: true, model: "fixture-model" },
      "/api/settings/general": { theme: "light" },
      "/api/settings/permissions": {},
      "/api/conversations": [{ id: "saved-chat", title: "已有对话", updated_at: new Date().toISOString() }],
      "/api/conversations/saved-chat": { id: "saved-chat", title: "已有对话", messages: [{ id: "previous", role: "assistant", content: "已保存的历史内容" }] },
    };
    await route.fulfill({ json: responses[path] || {} });
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.startupFixture.milestones.includes("renderer-first-paint"));
  assert.equal(reads, 0, "data requests must wait for health readiness");
  assert.equal(await page.getByLabel("正在启动 FetchCV").count(), 1);
  await page.evaluate(() => window.startupFixture.update({ state: "ready", dataReady: true, agentReady: false }));
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await page.waitForFunction(() => window.startupFixture.milestones.includes("renderer-interactive"));
  await page.getByText("已有对话", { exact: true }).click();
  await page.getByText("已保存的历史内容", { exact: true }).waitFor();
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("保留这条草稿");
  await input.press("Enter");
  assert.equal(await input.inputValue(), "保留这条草稿");
  assert.equal(await page.getByRole("button", { name: "发送消息", exact: true }).isDisabled(), true);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "删除对话 已有对话", exact: true }).click();
  await page.getByText("本地 Agent 正在准备，暂时只能浏览已有资料，请稍后重试。", { exact: true }).waitFor();
  assert.deepEqual(writes, []);
  await page.getByRole("button", { name: "关闭通知", exact: true }).click();
  await page.evaluate(() => window.startupFixture.update({ state: "ready", dataReady: true, agentReady: false, agentError: "任务恢复失败，请重试" }));
  await page.getByText("任务恢复失败，请重试", { exact: true }).waitFor();
  assert.equal(await page.getByText("已保存的历史内容", { exact: true }).count(), 1);
  await page.evaluate(() => window.startupFixture.update({ state: "ready", dataReady: true, agentReady: true }));
  await page.waitForFunction(() => !document.querySelector('.composer-send')?.disabled);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.waitForFunction(() => window.startupFixture.sends.length === 1);
  assert.ok(workspaceReads >= 2, "Agent readiness refreshes data after reconciliation");
  assert.equal(await page.evaluate(() => window.startupFixture.sends[0].content), "保留这条草稿");
  assert.deepEqual(errors, []);
  console.log("PASS readiness: first paint, data-only browsing, disabled writes, preserved draft, Agent transition and dispatch.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
