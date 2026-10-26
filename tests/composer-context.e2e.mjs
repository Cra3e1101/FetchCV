// Exercise the production Composer with synthetic provider, usage, and file data.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `composer-context-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
await build({
  entryPoints: [path.join(root, "tests/fixtures/composer-mentions.jsx")],
  outfile: path.join(output, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file", ".html": "text" },
  alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") },
});
await fs.writeFile(path.join(output, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}.fixture-grid{height:100vh!important;grid-template-columns:minmax(0,1fr)!important;padding:0!important}.fixture-grid>main{grid-column:1!important}</style></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>');
const server = http.createServer(async (request, response) => {
  const file = path.resolve(output, new URL(request.url, "http://localhost").pathname.slice(1) || "index.html");
  if (!file.startsWith(output + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await fs.readFile(file);
    response.writeHead(200, { "Content-Type": { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[path.extname(file)] || "application/octet-stream" });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const report = { fixture: "Production Composer with synthetic provider, token metrics, file imports and sends", checks: [], pageErrors: [] };
const check = (name, passed, detail) => {
  report.checks.push({ name, pass: Boolean(passed), ...(detail === undefined ? {} : { detail }) });
  assert.ok(passed, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  page.on("pageerror", error => report.pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  const contextButton = page.getByRole("button", { name: "上下文管理", exact: true });
  const context = page.getByRole("dialog", { name: "上下文管理", exact: true });
  const modelButton = page.getByRole("button", { name: "选择模型和推理强度", exact: true });
  const model = page.getByRole("dialog", { name: "模型与推理设置", exact: true });
  const outside = page.locator("#outside");
  await input.waitFor();
  const uploadLayout = await page.getByRole("button", { name: "添加内容", exact: true }).evaluate(node => {
    const box = node.getBoundingClientRect();
    const content = [...node.children].map(child => child.getBoundingClientRect());
    return { width: box.width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, containsContent: content.every(child => child.left >= box.left && child.right <= box.right + 1) };
  });
  check("upload icon and label fit their button without overlapping the model control", uploadLayout.containsContent && uploadLayout.scrollWidth <= uploadLayout.clientWidth + 1, uploadLayout);

  await contextButton.click();
  await context.waitFor();
  check("unknown usage is explicitly unknown instead of a fabricated percent", (await context.innerText()).includes("暂无用量") && (await context.innerText()).includes("占用未知") && !(await context.innerText()).includes("%"));
  check("context opening moves focus into the dialog", await context.getByRole("button", { name: "关闭上下文管理" }).evaluate(node => document.activeElement === node));
  await page.screenshot({ path: path.join(evidence, "context-empty.png") });
  await page.keyboard.press("Escape");
  await context.waitFor({ state: "hidden" });
  check("Escape restores the context trigger focus", await contextButton.evaluate(node => document.activeElement === node));

  check("context trigger contains only the usage ring", await contextButton.innerText() === "" && await contextButton.locator("svg").count() === 1 && await contextButton.locator("span").count() === 0);
  check("model and English effort are ordered left to right", await modelButton.evaluate(node => {
    const model = node.querySelector("strong"), effort = node.querySelector("small");
    return ["Low", "Medium", "High"].includes(effort.textContent) && model.getBoundingClientRect().right <= effort.getBoundingClientRect().left && getComputedStyle(model).color !== getComputedStyle(effort).color;
  }));
  for (const used of [2500, 5000]) {
    await page.evaluate(used => window.composerFixture.update({ liveContextUsage: { version: 1, model: "Test model", source: "reported", used_tokens: used, input_tokens: used, context_window: 10000 } }), used);
    await page.waitForFunction(used => Math.abs(Number(document.querySelector(".context-gauge-fill")?.getAttribute("stroke-dashoffset")) - 2 * Math.PI * 9 * (1 - used / 10000)) < .001, used);
    check(`live usage ${used} updates the ring while the panel is closed`, await context.count() === 0 && (await contextButton.getAttribute("title")).includes(`${used / 100}%`));
  }
  await page.evaluate(() => window.composerFixture.update({ liveContextUsage: null }));

  await page.evaluate(() => {
    const fixture = window.composerFixture;
    fixture.activations = [];
    const profile = { id: "context-test", providerName: "测试服务", displayName: "Test model", model: "test-model", health: "healthy", availableModels: [{ id: "test-model" }, { id: "test-model-pro" }] };
    window.appRuntime.listModelProviders = async () => ({ profiles: [profile] });
    window.appRuntime.activateModelProvider = async (profileId, model) => {
      fixture.activations.push({ profileId, model });
      return { store: { profiles: [{ ...profile, model }] }, runtime: { configured: true, provider_id: profileId, model } };
    };
    fixture.update({ runtime: { configured: true, provider_id: profile.id, model: profile.model }, onModelActivated: runtime => fixture.update({ runtime }) });
  });
  await modelButton.click();
  await model.waitFor();
  const effort = model.getByRole("slider", { name: "分析投入" });
  check("the original analysis-effort panel remains the first model view", await effort.count() === 1 && await model.getByRole("button", { name: "打开模型选择" }).count() === 1 && await model.getByRole("button", { name: "分析投入说明" }).count() === 1);
  await effort.focus();
  await page.keyboard.press("End");
  check("the original effort setting still selects deep analysis", await effort.getAttribute("aria-valuetext") === "深入：比较方案并主动检查证据与风险");
  await model.getByRole("button", { name: "打开模型选择" }).click();
  await model.getByRole("menuitemradio", { name: "test-model-pro", exact: true }).waitFor();
  check("saved provider model choices and management action remain", await model.getByRole("menuitemradio").count() === 2 && await model.getByRole("button", { name: "管理模型连接" }).count() === 1);
  await model.getByRole("menuitemradio", { name: "test-model-pro", exact: true }).click();
  await effort.waitFor();
  check("model selection still activates the saved provider", await page.evaluate(() => window.composerFixture.activations.length === 1 && window.composerFixture.activations[0].model === "test-model-pro"));
  await contextButton.click();
  await context.waitFor();
  await model.waitFor({ state: "hidden" });
  check("context opens separately from the unchanged model dialog", await model.count() === 0);
  await page.evaluate(() => window.composerFixture.update({ contextMessages: [{ id: "standalone-answer", role: "assistant", metadata_json: { usage: { model: "previous-model", input_tokens: 1234, output_tokens: 321, total_tokens: 1555 } } }] }));
  await context.getByText("1,555 tokens", { exact: true }).waitFor();
  check("standalone conversation usage renders and identifies a different source model", (await context.innerText()).includes("1,234") && (await context.innerText()).includes("与当前模型不同") && (await context.locator(".context-token-breakdown").innerText()).includes("—"));
  await outside.click();
  await context.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "审批模式", exact: true }).click();
  const approval = page.getByRole("menu", { name: "审批模式", exact: true });
  await approval.waitFor();
  check("approval choices and their file-permission policy remain visible", await approval.getByRole("menuitemradio").count() === 2 && (await approval.innerText()).includes("请求批准") && (await approval.innerText()).includes("帮我批准") && (await approval.innerText()).includes("保留文件权限策略"));
  await page.keyboard.press("Escape");
  await approval.waitFor({ state: "hidden" });

  await page.evaluate(() => window.composerFixture.update({
    contextMessages: [{ id: "completed-answer", role: "assistant", content: "已完成分析。", metadata_json: { runtime: { model: "test-model-pro", input_tokens: 14200, output_tokens: 3800, cache_read_tokens: 42000, cache_write_tokens: 12000, total_tokens: 72000,
      context_usage: { version: 1, model: "test-model-pro", protocol: "openai", context_window: 128000, input_tokens: 72000, output_tokens: 4000, used_tokens: 72000, source: "reported", request_sequence: 2, output_reserve: 8192, safety_reserve: 6400 },
    } } }],
    quote: { id: "quoted-answer", text: "保留原有事实和指标。" },
    onClearQuote: () => window.composerFixture.update({ quote: null }),
  }));
  await page.getByRole("button", { name: "添加内容", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add files or photos", exact: false }).click();
  await page.locator(".composer-attachments").waitFor();
  await input.fill("请结合简历和引用，整理项目亮点。");
  await contextButton.click();
  await context.waitFor();
  const breakdown = context.locator(".context-token-breakdown");
  check("actual usage fields reach the independent token breakdown", (await breakdown.innerText()).includes("14,200") && (await breakdown.innerText()).includes("3,800") && (await breakdown.innerText()).includes("42,000") && (await breakdown.innerText()).includes("12,000"));
  check("latest request input including caches drives the reported context gauge", (await context.locator(".context-window-card").innerText()).includes("72,000 / 128,000 tokens") && (await contextButton.getAttribute("title")).includes("56%") && await context.getByRole("progressbar", { name: "上下文窗口占用" }).getAttribute("aria-valuenow") === "56");
  check("output and budget reserves are not added to the context numerator", (await context.locator(".context-window-card").innerText()).includes("72,000 / 128,000 tokens") && (await contextButton.getAttribute("aria-description")).includes("接口用量") && await context.getByRole("progressbar", { name: "上下文窗口占用" }).getAttribute("aria-valuenow") === "56");
  check("cumulative usage remains separately labelled", (await context.locator(".context-token-section").innerText()).includes("本轮累计") && (await context.locator(".context-token-section").innerText()).includes("72,000 tokens") && (await context.locator(".context-window-section").innerText()).includes("最近请求"));
  check("pending file and quote are both manageable", await context.getByRole("button", { name: "从上下文移除 上传附件.txt", exact: true }).count() === 1 && await context.getByRole("button", { name: "从上下文移除引用", exact: true }).count() === 1);

  const changeSnapshot = async patch => page.evaluate(patch => {
    const fixture = window.composerFixture;
    const messages = structuredClone(fixture.props.contextMessages);
    const usage = messages.at(-1).metadata_json.runtime;
    usage.context_usage = { ...usage.context_usage, ...patch };
    fixture.update({ contextMessages: messages });
  }, patch);
  await changeSnapshot({ input_tokens: 80000, used_tokens: 80000, source: "estimated", request_sequence: 3 });
  await page.waitForFunction(() => document.querySelector(".context-window-status")?.textContent === "约 63%");
  check("request-time estimates are clearly marked on both panel and trigger", (await contextButton.getAttribute("title")).includes("约 63%") && (await contextButton.getAttribute("title")).includes("估算"));
  await changeSnapshot({ input_tokens: 110000, used_tokens: 110000, source: "reported" });
  await page.waitForFunction(() => document.querySelector(".composer-context-control")?.dataset.capacityState === "warning");
  check("the ring warns once latest request input reaches 80 percent", (await contextButton.getAttribute("title")).includes("86%") && await page.locator(".composer-context-control").getAttribute("data-capacity-state") === "warning");
  await changeSnapshot({ input_tokens: 140000, used_tokens: 140000 });
  await page.waitForFunction(() => document.querySelector(".composer-context-control")?.dataset.capacityState === "full");
  check("over-capacity raw counts remain visible while percentage and ring are clamped", (await contextButton.getAttribute("title")).includes("100%") && (await context.locator(".context-window-card").innerText()).includes("140,000 / 128,000 tokens") && (await context.locator(".context-window-status").innerText()).includes("超出窗口") && await page.locator(".context-gauge-fill").getAttribute("stroke-dashoffset") === "0" && await context.getByRole("progressbar", { name: "上下文窗口占用" }).getAttribute("aria-valuenow") === "100");
  await changeSnapshot({ input_tokens: 72000, used_tokens: 72000, request_sequence: 4 });
  await page.evaluate(() => {
    const fixture = window.composerFixture;
    const messages = structuredClone(fixture.props.contextMessages);
    const usage = messages.at(-1).metadata_json.runtime;
    usage.total_tokens = 720000;
    fixture.update({ contextMessages: messages });
  });
  await context.getByText("720,000 tokens", { exact: true }).waitFor();
  check("multiple model calls only increase cumulative usage and never the context gauge", (await contextButton.getAttribute("title")).includes("56%") && (await context.locator(".context-window-card").innerText()).includes("72,000 / 128,000 tokens"));
  await page.evaluate(() => {
    const fixture = window.composerFixture;
    const messages = structuredClone(fixture.props.contextMessages);
    messages.at(-1).metadata_json.runtime.total_tokens = 72000;
    fixture.update({ contextMessages: messages });
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(evidence, "context-light.png") });

  await context.getByRole("button", { name: "从上下文移除 上传附件.txt", exact: true }).click();
  check("removing a context file updates the actual pending attachment list", await page.locator(".composer-attachments").count() === 0 && await context.getByRole("button", { name: "从上下文移除 上传附件.txt", exact: true }).count() === 0);
  await context.getByRole("button", { name: "从上下文移除引用", exact: true }).click();
  check("removing the quote updates the actual composer draft", await page.locator(".composer-quote").count() === 0 && await input.inputValue() === "请结合简历和引用，整理项目亮点。");
  await context.getByRole("button", { name: "添加上下文文件", exact: true }).click();
  await page.locator(".composer-attachments").waitFor();
  check("context file addition calls the existing import workflow", await page.evaluate(() => window.composerFixture.uploads === 2));
  if (await context.isVisible()) await context.getByRole("button", { name: "关闭上下文管理" }).click();
  await input.press("Enter");
  check("managed context reaches the unchanged send payload", await page.evaluate(() => {
    const sent = window.composerFixture.sends.at(-1);
    return sent.text === "请结合简历和引用，整理项目亮点。" && sent.options.thinkingLevel === "deep" && JSON.stringify(sent.options.attachmentPaths) === '["uploads/上传附件.txt"]' && sent.options.quote == null;
  }));

  await page.getByRole("button", { name: "添加内容", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add files or photos", exact: false }).click();
  await input.fill("请结合文件中的经历，帮我整理适合目标岗位的项目描述。");
  await contextButton.click();
  await context.waitFor();
  await page.evaluate(() => { document.documentElement.dataset.interfaceTheme = "neutral-dark"; document.documentElement.dataset.colorScheme = "dark"; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(evidence, "context-dark.png") });
  for (const [width, height] of [[390, 740], [320, 640]]) {
    await page.setViewportSize({ width, height });
    const bounds = await context.boundingBox();
    check(`context panel fits a ${width}px viewport`, bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1, bounds);
    const controls = await page.locator(".rp-controls button").evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height > 0).map(node => { const box = node.getBoundingClientRect(); return { label: node.getAttribute("aria-label"), x: box.x, right: box.right }; }));
    check(`toolbar controls remain inside a ${width}px viewport`, controls.every(box => box.x >= 0 && box.right <= width + 1), controls);
    await page.screenshot({ path: path.join(evidence, `context-dark-${width}.png`) });
  }
  await context.getByRole("button", { name: "关闭上下文管理" }).click();
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.evaluate(() => { document.documentElement.dataset.interfaceTheme = "white"; document.documentElement.dataset.colorScheme = "light"; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(evidence, "composer-light.png") });
  check("no browser runtime errors", report.pageErrors.length === 0, report.pageErrors);
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: path.join(evidence, "report.json"), passed: report.checks.filter(item => item.pass).length, checks: report.checks.length, errors: report.pageErrors }, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
