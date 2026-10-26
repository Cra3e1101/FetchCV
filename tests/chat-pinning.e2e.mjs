// Component integration coverage: real browser scrolling, production React and CSS.
// The fixture supplies synthetic messages and stream packets; no backend is needed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `chat-pinning-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
await build({
  entryPoints: [path.join(root, "tests/fixtures/chat-pinning.jsx")],
  outfile: path.join(output, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file", ".html": "text" },
  alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") },
});
await fs.writeFile(path.join(output, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}.fixture-grid{height:100vh!important;grid-template-columns:minmax(0,1fr)!important;padding:0!important}.fixture-grid>main{grid-column:1!important}.fixture-grid>aside{display:none!important}</style></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>`);
const server = http.createServer(async (request, response) => {
  const name = new URL(request.url, "http://localhost").pathname.slice(1) || "index.html";
  const file = path.resolve(output, name);
  if (!file.startsWith(output + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await fs.readFile(file);
    response.writeHead(200, { "Content-Type": { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[path.extname(file)] || "application/octet-stream" });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const report = { fixture: "Synthetic messages and API stream packets, production AgentWorkspace and ConversationWorkspace", checks: [], pageErrors: [] };
const check = (name, value, detail) => {
  report.checks.push({ name, pass: Boolean(value), ...(detail === undefined ? {} : { detail }) });
  assert.ok(value, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on("pageerror", error => report.pageErrors.push(error.message));
  for (const mode of ["job", "standalone"]) {
    await page.goto(`http://127.0.0.1:${server.address().port}/${mode === "standalone" ? "?standalone=1" : ""}`);
    await page.waitForFunction(() => document.querySelectorAll(".agent-message").length === 64 && document.querySelectorAll(".agent-markdown").length === 32);
    const selector = mode === "job" ? ".conversation-scroll-v2" : ".standalone-scroll";
    const scroller = page.locator(selector);
    const jump = page.getByRole("button", { name: "回到底部", exact: true });
    const position = () => scroller.evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight, gap: node.scrollHeight - node.clientHeight - node.scrollTop }));
    const atBottom = () => page.waitForFunction(selector => {
      const node = document.querySelector(selector);
      return node && Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) <= 2;
    }, selector, { timeout: 3000 });
    const checkClearance = async label => {
      const bounds = await scroller.evaluate(node => {
        const composer = document.querySelector('.source-composer').getBoundingClientRect();
        const scroll = node.getBoundingClientRect();
        const viewport = node.closest('main').getBoundingClientRect();
        return { scrollBottom: scroll.bottom, composerTop: composer.top, composerBottom: composer.bottom, viewportBottom: viewport.bottom, overflow: getComputedStyle(node).overflowY };
      });
      check(`${mode}: ${label} clips history above the input`, bounds.scrollBottom <= bounds.composerTop - 7 && ['auto', 'scroll'].includes(bounds.overflow) && bounds.composerBottom <= bounds.viewportBottom, bounds);
    };
    const append = async (label, paragraphs = 12) => {
      const before = await position();
      await page.evaluate(({ label, paragraphs }) => window.scrollFixture.stream.emit(`\n\n${`${label}: synthetic streaming paragraph.\n\n`.repeat(paragraphs)}`), { label, paragraphs });
      await page.waitForFunction(({ selector, height }) => document.querySelector(selector).scrollHeight > height, { selector, height: before.height }, { timeout: 3000 });
    };
    const pause = async delta => {
      await scroller.hover();
      await page.mouse.wheel(0, -delta);
      await page.waitForTimeout(120);
      await jump.waitFor({ state: "visible", timeout: 3000 });
      return (await position()).top;
    };
    const staysPaused = async (label, stoppedAt) => {
      await append(label);
      await page.waitForTimeout(220);
      const current = await position();
      check(`${mode}: ${label} preserves the reading position`, Math.abs(current.top - stoppedAt) <= 2, current);
      check(`${mode}: ${label} keeps the return control available`, await jump.isVisible());
    };

    await atBottom();
    check(`${mode}: opens at latest history`, (await position()).gap <= 2);
    check(`${mode}: return control is absent at bottom`, await jump.count() === 0);
    await checkClearance('idle layout');
    const textbox = page.getByRole('textbox', { name: '消息', exact: true });
    await textbox.fill('A multiline draft\n'.repeat(12));
    await atBottom();
    await checkClearance('multiline draft');
    await textbox.fill('');
    await atBottom();
    await page.setViewportSize({ width: 390, height: 640 });
    await atBottom();
    await checkClearance('narrow layout');
    await page.setViewportSize({ width: 1100, height: 760 });
    await atBottom();
    const add = page.getByRole('button', { name: '添加内容', exact: true });
    await add.hover();
    await page.mouse.down();
    await page.waitForTimeout(100);
    const pressed = await add.evaluate(node => ({ scale: new DOMMatrix(getComputedStyle(node).transform).a, background: getComputedStyle(node, '::before').backgroundColor, border: getComputedStyle(node).borderWidth }));
    check(`${mode}: ghost button presses to 0.975 with a borderless hover fill`, Math.abs(pressed.scale - .975) < .001 && pressed.border === '0px' && pressed.background !== 'rgba(0, 0, 0, 0)', pressed);
    await page.mouse.move(2, 2);
    await page.mouse.up();
    const released = await add.evaluate(node => ({ duration: getComputedStyle(node).transitionDuration, easing: getComputedStyle(node).transitionTimingFunction }));
    check(`${mode}: releasing uses the CDS spring`, released.duration === '0.45s' && released.easing.startsWith('linear('), released);
    await page.waitForTimeout(500);
    check(`${mode}: button returns to its original size`, await add.evaluate(node => Math.abs(new DOMMatrix(getComputedStyle(node).transform).a - 1) < .001));
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("Synthetic streaming request");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.waitForFunction(() => Boolean(window.scrollFixture.stream));
    await append("Pinned output", 24);
    await atBottom();
    check(`${mode}: follows streamed growth at bottom`, (await position()).gap <= 2);

    const stoppedAt = await pause(72);
    check(`${mode}: return control includes visible text`, (await jump.innerText()).includes("回到底部"));
    await staysPaused("Streaming after upward wheel", stoppedAt);
    await checkClearance('reading earlier messages');
    const buttonBox = await jump.boundingBox();
    const paneBox = await page.locator(".main-pane").boundingBox();
    const composerBox = await page.locator(".source-composer").boundingBox();
    check(`${mode}: return control is centered above the composer`, Math.abs(buttonBox.x + buttonBox.width / 2 - paneBox.x - paneBox.width / 2) <= 2 && buttonBox.y + buttonBox.height <= composerBox.y, { buttonBox, paneBox, composerBox });
    await page.screenshot({ path: path.join(evidence, `${mode}-reading-history.png`) });
    await jump.click();
    await atBottom();
    await append("Output after clicking return");
    await atBottom();
    check(`${mode}: clicking return resumes follow`, (await position()).gap <= 2);

    const smallPause = await pause(24);
    await staysPaused("A small upward gesture inside the bottom tolerance", smallPause);
    await jump.click();
    await atBottom();

    await pause(260);
    await scroller.focus();
    await page.keyboard.press("End");
    await atBottom();
    await page.waitForTimeout(200);
    await append("Output after manual return");
    await atBottom();
    check(`${mode}: manually returning to bottom resumes follow`, (await position()).gap <= 2);

    await scroller.focus();
    await page.keyboard.press("PageUp");
    await page.waitForTimeout(250);
    await jump.waitFor({ state: "visible" });
    await staysPaused("Streaming after keyboard scroll", (await position()).top);
    await jump.click();
    await atBottom();
    await page.setViewportSize({ width: 1100, height: 600 });
    await atBottom();
    check(`${mode}: viewport height change keeps the live bottom pinned`, (await position()).gap <= 2);
    await page.setViewportSize({ width: 1100, height: 760 });
    await atBottom();

    await pause(420);
    await page.evaluate(() => window.scrollFixture.stream.done());
    await page.waitForTimeout(350);
    const saved = (await position()).top;
    await scroller.evaluate(node => { node.dataset.scrollFixtureInstance = "same-node"; });
    await page.evaluate(() => window.scrollFixture.switchConversation("second"));
    if (mode === "standalone") {
      await page.locator(".standalone-transcript").getByText("正在读取对话…", { exact: true }).waitFor();
      await page.waitForTimeout(180);
      check(`${mode}: loading another conversation clears the previous return control`, await jump.count() === 0);
    }
    await page.waitForFunction(() => document.querySelector(".task-header h1")?.textContent === "Scroll test second");
    await atBottom();
    check(`${mode}: switches conversations using the same scroll element`, await scroller.getAttribute("data-scroll-fixture-instance") === "same-node");
    check(`${mode}: the short second conversation clamps the old scroll range`, (await position()).height < saved);
    check(`${mode}: another conversation starts at its own bottom`, (await position()).gap <= 2);
    await page.evaluate(() => window.scrollFixture.switchConversation("first"));
    await page.waitForFunction(() => document.querySelector(".task-header h1")?.textContent === "Scroll test first");
    await page.waitForTimeout(300);
    check(`${mode}: long to short to long restores the saved reading position`, Math.abs((await position()).top - saved) <= 2, { saved, actual: await position() });
    await jump.waitFor({ state: "visible" });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await jump.click();
    await atBottom();
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("Reduced motion request");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.waitForTimeout(80);
    await append("Reduced motion output");
    await atBottom();
    check(`${mode}: reduced motion preserves pinned streaming`, (await position()).gap <= 2);
    await page.evaluate(() => window.scrollFixture.stream.done());
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
  check("no browser runtime errors", report.pageErrors.length === 0, report.pageErrors);
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: path.join(evidence, "report.json"), passed: report.checks.filter(check => check.pass).length, checks: report.checks.length, errors: report.pageErrors }, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
