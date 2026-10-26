// Real React event integration and browser geometry. No backend/model required.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `composer-mentions-${Date.now()}`;
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
const report = { fixture: "Production Composer, synthetic file and send APIs; IME composition events are simulated", checks: [], pageErrors: [] };
const check = (name, value, detail) => {
  report.checks.push({ name, pass: Boolean(value), ...(detail === undefined ? {} : { detail }) });
  assert.ok(value, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  await page.addInitScript(() => {
    if (new URLSearchParams(location.search).has("webkit")) Object.defineProperty(navigator, "vendor", { configurable: true, value: "Apple Computer, Inc." });
  });
  page.on("pageerror", error => report.pageErrors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  const slash = page.getByRole("listbox", { name: "快捷指令", exact: true });
  const files = page.getByRole("listbox", { name: "引用文件", exact: true });
  const count = () => page.evaluate(() => window.composerFixture.sends.length);
  const reload = async () => { await page.goto(url); await input.waitFor(); };
  await reload();

  const add = page.getByRole("button", { name: "添加内容", exact: true });
  const addMenu = page.getByRole("menu", { name: "添加内容", exact: true });
  await add.click();
  check("plus is icon only and opens four real actions", await add.innerText() === "" && await addMenu.getByRole("menuitem").count() === 4 && await page.evaluate(() => window.composerFixture.uploads) === 0);
  await page.keyboard.press("End");
  check("add menu keyboard navigation reaches the final action", await page.getByRole("menuitem", { name: "Add MCP server" }).evaluate(node => node === document.activeElement));
  await page.keyboard.press("Escape");
  check("Escape closes add menu and restores plus focus", await addMenu.count() === 0 && await add.evaluate(node => node === document.activeElement));
  for (const [label, section] of [["Skills", "skills"], ["Manage connectors", "mcp"], ["Add MCP server", "mcp-add"]]) {
    await add.click();
    await addMenu.getByRole("menuitem", { name: label, exact: true }).click();
    check(`${label} opens its settings destination`, await page.evaluate(section => window.composerFixture.settings.at(-1) === section, section) && await addMenu.count() === 0);
  }
  await input.focus();
  await input.press("Control+u");
  await page.getByRole("button", { name: "移除 上传附件.txt", exact: true }).waitFor();
  check("Ctrl+U imports files directly", await page.evaluate(() => window.composerFixture.uploads === 1));
  await reload();

  await input.fill("普通消息");
  await input.press("Enter");
  check("ordinary Enter sends once and clears text", await count() === 1 && await input.inputValue() === "");
  await input.fill("第一行");
  await input.press("Shift+Enter");
  await input.press("End");
  await input.press("x");
  check("Shift+Enter preserves multiline editing", await count() === 1 && (await input.inputValue()).includes("\n"));

  await input.fill("中文候选词");
  await input.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  check("composition ref protects Enter even when native isComposing is false", await count() === 1 && await input.inputValue() === "中文候选词");
  await input.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionend", { data: "词", bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    node.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  });
  check("compositionend followed by an unmarked Enter cannot send", await count() === 1);
  await input.press("Enter");
  check("after keyup the next intentional Enter immediately sends committed Chinese text", await count() === 2 && (await page.evaluate(() => window.composerFixture.sends.at(-1).text)) === "中文候选词");
  await input.fill("legacy IME");
  await input.evaluate(node => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true })));
  check("legacy keyCode 229 cannot submit", await count() === 2);
  await input.evaluate(node => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
  check("native isComposing protects submit", await count() === 2);

  // Exercise the longer WebKit timing branch without claiming a native Safari test.
  await page.goto(`${url}/?webkit=1`);
  await input.waitFor();
  await input.fill("WebKit候选词");
  await input.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    node.dispatchEvent(new CompositionEvent("compositionend", { data: "词", bubbles: true }));
  });
  await page.waitForTimeout(120);
  await input.press("Enter");
  check("WebKit timing guard blocks a delayed post-composition Enter", await count() === 0);
  await input.press("Enter");
  check("WebKit guard is consumed once and does not swallow the next Enter", await count() === 1);

  await reload();
  await input.fill("/");
  await slash.waitFor();
  check("slash lists executable task and control commands", await slash.getByRole("option").count() >= 5);
  const first = await slash.getByRole("option", { selected: true }).innerText();
  await input.press("ArrowDown");
  check("ArrowDown changes the active option without moving focus", await slash.getByRole("option", { selected: true }).innerText() !== first && await input.evaluate(node => document.activeElement === node));
  await input.press("ArrowUp");
  check("ArrowUp returns to the first option", await slash.getByRole("option", { selected: true }).innerText() === first);
  await input.press("ArrowUp");
  check("ArrowUp wraps to the final option", await slash.getByRole("option", { selected: true }).innerText() === await slash.getByRole("option").last().innerText());
  await input.fill("/res");
  check("slash search filters by command", await slash.getByRole("option").count() === 1 && (await slash.innerText()).includes("/resume"));
  await input.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  check("IME candidate confirmation does not select a slash command", await input.inputValue() === "/res" && await count() === 0);
  await input.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionend", { data: "", bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    node.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  });
  await input.press("Enter");
  await slash.waitFor({ state: "hidden" });
  check("Enter selects a command without sending", await count() === 0 && (await page.locator(".source-composer").innerText()).includes("/resume"));
  await input.fill("请突出项目成果");
  await input.press("Enter");
  const commandSend = await page.evaluate(() => window.composerFixture.sends.at(-1));
  check("selected command reaches the actual send with user detail", await count() === 1 && commandSend.text.includes("请突出项目成果") && commandSend.text.length > "请突出项目成果".length);
  check("send clears the command chip", !(await page.locator(".source-composer").innerText()).includes("/resume"));

  await input.fill("/missing-command");
  await slash.waitFor();
  await input.press("Enter");
  check("zero-result Enter does not accidentally submit", await count() === 1);
  await input.press("Escape");
  await slash.waitFor({ state: "hidden" });
  await input.press("Enter");
  check("Escape dismisses zero-result menu and restores normal sending", await count() === 2);

  await input.fill("before /res after");
  await input.press("Home");
  for (let offset = 0; offset < 11; offset += 1) await input.press("ArrowRight");
  await slash.waitFor();
  await input.press("Tab");
  check("selection in the middle preserves both surrounding text segments", (await input.inputValue()).includes("before") && (await input.inputValue()).includes("after") && !(await input.inputValue()).includes("/res"));
  await reload();
  await input.fill("/model");
  await slash.getByRole("option").first().click();
  await page.getByRole("dialog", { name: "模型与推理设置" }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="模型与推理设置"]')?.contains(document.activeElement));
  check("model command opens the existing model control without sending", await count() === 0);
  check("model command transfers keyboard focus into its dialog", await page.evaluate(() => document.querySelector('[aria-label="模型与推理设置"]').contains(document.activeElement)));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "消息");
  check("Escape from model dialog restores composer keyboard focus", await input.evaluate(node => document.activeElement === node));
  await input.fill("/attach");
  await input.press("Tab");
  await page.waitForFunction(() => window.composerFixture.uploads === 1);
  check("attach command invokes the actual upload callback", (await page.locator(".composer-attachments").innerText()).includes("上传附件.txt") && await count() === 0);
  await page.getByRole("button", { name: "移除 上传附件.txt", exact: true }).click();

  await input.fill("@");
  await files.waitFor();
  await files.getByRole("option").first().waitFor();
  check("mention suggestions are loaded from real discovery contract", await files.getByRole("option").count() === 3 && await page.evaluate(() => window.composerFixture.fileRequests > 0));
  await page.screenshot({ path: path.join(evidence, "files-white.png") });
  await input.fill("@Project");
  await files.getByRole("option").first().waitFor();
  check("filename search supports paths with spaces", await files.getByRole("option").count() === 1 && (await files.innerText()).includes("Project Notes.md"));
  await input.press("Tab");
  check("Tab adds a file chip without sending", (await page.locator(".composer-attachments").innerText()).includes("Project Notes.md") && await count() === 0);
  await input.fill("@Project");
  await files.waitFor();
  const duplicateOption = files.getByRole("option");
  if (await duplicateOption.count()) await duplicateOption.first().click();
  else await input.press("Escape");
  check("selecting the same path cannot duplicate attachments", await page.getByRole("button", { name: "移除 Project Notes.md", exact: true }).count() === 1);
  await input.fill("请阅读引用文件");
  await input.press("Enter");
  const fileSend = await page.evaluate(() => window.composerFixture.sends.at(-1));
  check("referenced file path reaches existing agent payload", JSON.stringify(fileSend.options.attachmentPaths) === JSON.stringify(["materials/Project Notes.md"]));
  check("sending clears the attachment chip", await page.locator(".composer-attachments").count() === 0);

  await input.fill("查看 @Project 后文");
  await input.press("Home");
  for (let offset = 0; offset < 7; offset += 1) await input.press("ArrowRight");
  await files.getByRole("option").first().waitFor();
  await input.press("Tab");
  check("selection inside @Pro|ject replaces the entire token and preserves following prose", await input.inputValue() === "查看  后文" && await page.getByRole("button", { name: "移除 Project Notes.md", exact: true }).count() === 1);
  await page.getByRole("button", { name: "移除 Project Notes.md", exact: true }).click();

  await input.fill("说明 @中文 后文");
  await input.press("Home");
  for (let offset = 0; offset < 6; offset += 1) await input.press("ArrowRight");
  await files.waitFor();
  await files.getByRole("option").first().click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "消息");
  check("mention choice preserves suffix and restores text focus", (await input.inputValue()).includes("说明") && (await input.inputValue()).includes("后文") && await input.evaluate(node => document.activeElement === node));
  await page.getByRole("button", { name: "移除 中文简历.pdf", exact: true }).click();
  check("removing a reference updates the pending attachments", await page.locator(".composer-attachments").count() === 0);
  await input.fill("name@example.com");
  check("email addresses do not open file menus", await files.count() === 0);
  await input.fill("https://example.com");
  check("URLs do not open slash menus", await slash.count() === 0);

  await input.fill("@");
  await files.waitFor();
  await page.locator("#outside").click();
  check("outside click dismisses suggestions", await files.count() === 0);
  await input.fill("@not-present");
  await files.waitFor();
  const beforeEmpty = await count();
  await input.press("Enter");
  check("missing file does not send a raw unfinished mention", await count() === beforeEmpty);
  await input.press("Escape");
  await files.waitFor({ state: "hidden" });

  await reload();
  await page.evaluate(() => window.composerFixture.failFiles = true);
  await input.fill("@");
  await page.getByRole("button", { name: "重试", exact: true }).waitFor();
  await input.press("Enter");
  check("file discovery failure is recoverable and cannot submit", await count() === 0 && await files.getByRole("option").count() === 0);
  await page.evaluate(() => window.composerFixture.failFiles = false);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await files.getByRole("option").first().waitFor();
  check("retry refreshes file suggestions without losing the draft", await files.getByRole("option").count() === 3 && await input.inputValue() === "@");

  await reload();
  await page.evaluate(() => window.composerFixture.delayFiles = true);
  await input.fill("@");
  await page.waitForFunction(() => Boolean(window.composerFixture.releaseFiles));
  await input.press("Enter");
  check("Enter during async file loading preserves the draft without sending", await count() === 0 && await input.inputValue() === "@" && await files.getAttribute("aria-busy") === "true");
  await page.evaluate(() => { window.composerFixture.delayFiles = false; window.composerFixture.releaseFiles(); });
  await files.getByRole("option").first().waitFor();
  check("async discovery updates the active mention menu", await files.getByRole("option").count() === 3);

  await reload();
  await page.evaluate(() => {
    window.composerFixture.files = Array.from({ length: 12 }, (_, index) => {
      const name = `file-${String(index).padStart(2, "0")}.txt`;
      return { name, workspacePath: `materials/${name}` };
    });
  });
  for (let index = 0; index < 10; index += 1) {
    await input.fill(`@file-${String(index).padStart(2, "0")}`);
    await files.getByRole("option").first().waitFor();
    await input.press("Enter");
    await page.waitForFunction(count => document.querySelectorAll(".composer-attachments > span").length === count, index + 1);
  }
  await input.fill("@file-10");
  await files.getByRole("option").first().waitFor();
  await input.press("Enter");
  check("the eleventh distinct file is disabled and cannot exceed the API limit", await files.getByRole("option").first().getAttribute("aria-disabled") === "true" && await page.locator(".composer-attachments > span").count() === 10 && await count() === 0);
  await page.getByRole("button", { name: "移除 file-00.txt", exact: true }).click();
  await input.fill("@file-11");
  await files.getByRole("option").first().waitFor();
  await input.press("Enter");
  await page.getByRole("button", { name: "移除 file-11.txt", exact: true }).waitFor();
  check("removing a file frees capacity for a different reference", await page.locator(".composer-attachments > span").count() === 10);
  await input.press("Enter");
  check("attachments-only send passes ten paths through the existing payload", await count() === 1 && await page.evaluate(() => window.composerFixture.sends[0].options.attachmentPaths.length) === 10);

  await reload();
  await page.evaluate(() => {
    window.composerFixture.files = [
      { name: "too-large.pdf", workspacePath: "materials/too-large.pdf", sizeBytes: 50 * 1024 * 1024 + 1 },
      { name: "small.pdf", workspacePath: "materials/small.pdf", sizeBytes: 1024 },
    ];
  });
  await input.fill("@too-large");
  await files.getByRole("option").first().waitFor();
  await input.press("Enter");
  check("files over 50 MiB remain disabled and cannot be attached", await files.getByRole("option").first().getAttribute("aria-disabled") === "true" && await page.locator(".composer-attachments").count() === 0 && await count() === 0);
  await input.press("Tab");
  check("Tab on a disabled file leaves the editor without trapping keyboard focus", await files.count() === 0 && !(await input.evaluate(node => document.activeElement === node)));
  await input.fill("@small");
  await files.getByRole("option").first().waitFor();
  await input.press("Tab");
  check("a valid file remains selectable after rejecting an oversized file", await page.getByRole("button", { name: "移除 small.pdf", exact: true }).count() === 1);

  await reload();
  await page.evaluate(() => { delete window.appRuntime.listWorkspaceFiles; });
  await input.fill("@");
  await page.getByRole("status").filter({ hasText: "桌面客户端" }).waitFor();
  await input.press("Enter");
  check("missing desktop discovery capability shows a truthful state without sending", await count() === 0 && await files.getByRole("option").count() === 0);

  await input.fill("/");
  await slash.waitFor();
  await page.screenshot({ path: path.join(evidence, "commands-white.png") });
  await page.evaluate(() => document.documentElement.dataset.interfaceTheme = "neutral-dark");
  // Theme colors animate for 120ms; capture the settled palette.
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(evidence, "commands-dark.png") });
  await page.setViewportSize({ width: 390, height: 640 });
  const bounds = await slash.boundingBox();
  check("narrow-screen popup stays within the viewport", bounds.x >= 0 && bounds.x + bounds.width <= 391 && bounds.y >= 0, bounds);
  await page.screenshot({ path: path.join(evidence, "commands-narrow.png") });
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
