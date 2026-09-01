import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort, isFetchCVHealthy } from "../electron/sidecar.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const port = await findFreePort();
const providerPort = await findFreePort();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-chat-e2e-"));
const screenshot = path.join(os.tmpdir(), "fetchcv-chat-redesign.png");
let providerCalls = 0;
const provider = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/chat/completions") {
    response.writeHead(404).end(); return;
  }
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    providerCalls += 1;
    const callNumber = providerCalls;
    const payload = JSON.parse(body);
    assert.equal(payload.model, "deepseek-v4-flash");
    const systemPrompt = payload.messages?.find((item) => item.role === "system")?.content || "";
    if (providerCalls === 1) {
      assert.match(systemPrompt, /不是回答范围限制/);
      assert.match(systemPrompt, /充分分析当前问题/);
      assert.match(systemPrompt, /不得把通用问题强行转回简历/);
    }
    const prompt = payload.messages?.find((item) => item.role === "user")?.content || "";
    if (providerCalls === 2) {
      assert.match(prompt, /今天北京天气如何/);
      assert.match(prompt, /第1次 API 回答/);
    }
    const message = callNumber === 1 ? "**第1次 API 回答**\n\n- 已读取岗位上下文\n- 已保留最近对话" : `第${callNumber}次 API 回答`;
    const content = payload.tools?.length ? message : JSON.stringify({ message, intent: "discuss", suggested_actions: [] });
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 4 } }));
    }, callNumber === 1 ? 650 : callNumber === 3 ? 2000 : 120);
  });
});
await new Promise((resolve) => provider.listen(providerPort, "127.0.0.1", resolve));
const application = await electron.launch({
  args: [projectRoot],
  cwd: projectRoot,
  env: {
    ...process.env,
    FETCHCV_API_PORT: String(port),
    FETCHCV_E2E_USER_DATA: userData,
    FETCHCV_AGENT_RUNTIME: "compatible",
    FETCHCV_PROVIDER_NAME: "DeepSeek",
    FETCHCV_PROVIDER_PROTOCOL: "openai",
    FETCHCV_PROVIDER_BASE_URL: `http://127.0.0.1:${providerPort}`,
    FETCHCV_PROVIDER_API_KEY: "e2e-secret-never-render",
    FETCHCV_PROVIDER_MODEL: "deepseek-v4-flash",
  },
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
  const candidate = await post("/api/candidates", { name: "高子强" });
  await post("/api/jobs", { candidate_id: candidate.id, company: "示例科技", role: "数据分析实习生", jd_raw: "负责数据分析与指标体系建设。" });
  await window.reload();
  await window.getByRole("button", { name: "示例科技 数据分析实习生" }).click();

  assert.equal(await window.getByRole("button", { name: "添加文件" }).count(), 1);
  await window.getByRole("button", { name: "查看关键操作确认规则" }).click();
  const approvalDialog = window.getByRole("dialog", { name: "关键操作确认规则" });
  await approvalDialog.getByText("关键操作由你确认", { exact: true }).waitFor({ state: "visible" });
  await approvalDialog.getByText("写入、移动或重命名", { exact: true }).waitFor({ state: "visible" });
  await window.getByRole("button", { name: "查看关键操作确认规则" }).click();

  const modelButton = window.getByRole("button", { name: "选择模型和推理强度" });
  await modelButton.click();
  const settingsDialog = window.getByRole("dialog", { name: "模型与推理设置" });
  await settingsDialog.getByRole("button", { name: "打开模型选择" }).click();
  await settingsDialog.getByText("还没有已保存的模型连接", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await settingsDialog.getByRole("button", { name: "管理模型连接" }).count(), 1);
  await settingsDialog.getByRole("button", { name: "收起模型选择" }).click();
  const effortSlider = settingsDialog.getByRole("slider", { name: "推理强度" });
  assert.equal(await effortSlider.getAttribute("max"), "4");
  assert.match(await effortSlider.getAttribute("aria-valuetext"), /High/);
  await effortSlider.press("End");
  assert.match(await effortSlider.getAttribute("aria-valuetext"), /Ultracode/);
  assert.match(await modelButton.textContent(), /Ultracode/);
  await modelButton.click();
  const composer = window.locator(".agent-composer-v2 textarea");
  await composer.fill("这段文字应该可以被全选并替换");
  await composer.press("ControlOrMeta+A");
  await composer.type("已验证全选");
  assert.equal(await composer.inputValue(), "已验证全选");
  await composer.fill("你调用的真实 API 和模型是什么？");
  await composer.press("ControlOrMeta+Enter");
  const liveActivity = window.locator(".agent-activity");
  await liveActivity.waitFor({ state: "visible" });
  await liveActivity.locator(".processing-summary").waitFor({ state: "visible" });
  await liveActivity.getByText("思考中", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await liveActivity.getByText("正在读取岗位上下文", { exact: true }).count(), 0);
  await liveActivity.locator(".processing-summary").click();
  await liveActivity.locator(".processing-detail strong", { hasText: "判断是否需要工具" }).waitFor({ state: "visible" });
  assert.equal(await window.locator(".thinking-steps").count(), 0);
  const assistantTurns = window.locator(".agent-message.assistant");
  await assistantTurns.getByText("第1次 API 回答", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await liveActivity.waitFor({ state: "detached" });
  await assistantTurns.first().getByText("已处理", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await assistantTurns.first().locator("li").count(), 2);
  assert.equal(providerCalls, 1);
  await composer.fill("今天北京天气如何？这类通用问题也必须调用 API");
  await composer.press("ControlOrMeta+Enter");
  await liveActivity.waitFor({ state: "visible" });
  await liveActivity.locator(".processing-summary").waitFor({ state: "visible" });
  assert.equal(await liveActivity.getByText("正在读取岗位上下文", { exact: true }).count(), 0);
  await assistantTurns.getByText("第2次 API 回答", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(providerCalls, 2);
  await composer.fill("这条回答用于验证停止生成");
  await composer.press("ControlOrMeta+Enter");
  await liveActivity.waitFor({ state: "visible" });
  for (let index = 0; index < 100 && providerCalls < 3; index += 1) {
    await window.waitForTimeout(20);
  }
  assert.equal(providerCalls, 3, "the cancellation case must stop an in-flight provider request");
  await window.getByRole("button", { name: "停止生成" }).click();
  await liveActivity.waitFor({ state: "detached", timeout: 10000 });
  const stoppedNotice = window.getByRole("status");
  await stoppedNotice.waitFor({ state: "visible" });
  const stoppedNoticeBox = await stoppedNotice.boundingBox();
  const stoppedComposerBox = await window.locator(".agent-composer-v2").boundingBox();
  const noticeOverlapsComposer = !(
    stoppedNoticeBox.x + stoppedNoticeBox.width <= stoppedComposerBox.x
    || stoppedNoticeBox.x >= stoppedComposerBox.x + stoppedComposerBox.width
    || stoppedNoticeBox.y + stoppedNoticeBox.height <= stoppedComposerBox.y
    || stoppedNoticeBox.y >= stoppedComposerBox.y + stoppedComposerBox.height
  );
  assert.equal(noticeOverlapsComposer, false, `status notice must not cover the composer: ${JSON.stringify({ stoppedNoticeBox, stoppedComposerBox })}`);
  assert.equal(await assistantTurns.count(), 2);
  assert.equal(await window.locator(".agent-message.user").count(), 3);
  assert.equal(await window.locator('.agent-composer-v2 select').count(), 0);
  assert.match(await modelButton.textContent(), /deepseek-v4-flash/);
  assert.equal(await window.getByText("e2e-secret-never-render", { exact: false }).count(), 0);
  assert.equal(await window.locator(".agent-message.user").count(), 3);
  assert.equal(await window.locator(".agent-message.assistant").count(), 2);
  assert.equal(await window.getByText("我会先理解岗位，再说明判断依据。", { exact: false }).count(), 0);
  assert.equal(await window.locator(".conversation-stream .conversation-action, .conversation-stream .job-understanding, .conversation-stream .conversation-task-card").count(), 0);
  const turns = window.locator(".conversation-stream .agent-message");
  const turnCount = await turns.count();
  assert.match(await turns.nth(turnCount - 2).getAttribute("class"), /assistant/);
  assert.match(await turns.nth(turnCount - 1).getAttribute("class"), /user/);
  await modelButton.click();
  const finalSettings = window.getByRole("dialog", { name: "模型与推理设置" });
  await finalSettings.getByRole("slider", { name: "推理强度" }).waitFor({ state: "visible" });
  const composerBox = await window.locator(".agent-composer-v2").boundingBox();
  const modelButtonBox = await modelButton.boundingBox();
  const thinkingPopoverBox = await window.locator(".model-effort-popover").boundingBox();
  assert.ok(thinkingPopoverBox.width <= 360, `thinking menu must remain compact: ${JSON.stringify(thinkingPopoverBox)}`);
  assert.ok(thinkingPopoverBox.y + thinkingPopoverBox.height < modelButtonBox.y, `thinking menu must open upward from the model button: ${JSON.stringify({ modelButtonBox, thinkingPopoverBox })}`);
  assert.ok(thinkingPopoverBox.y + thinkingPopoverBox.height > composerBox.y, `thinking menu should overlap the composer instead of floating above it: ${JSON.stringify({ composerBox, thinkingPopoverBox })}`);
  assert.ok(thinkingPopoverBox.x >= composerBox.x && thinkingPopoverBox.x + thinkingPopoverBox.width <= composerBox.x + composerBox.width, "thinking menu must stay within the composer width");
  await window.waitForTimeout(250);
  await window.screenshot({ path: screenshot });
  assert.equal(fs.existsSync(screenshot), true);
} finally {
  await application.close();
  await new Promise((resolve) => provider.close(resolve));
}

for (let index = 0; index < 20 && await isFetchCVHealthy(apiBase, 250); index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(await isFetchCVHealthy(apiBase, 250), false);
