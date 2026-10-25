// Real workspace components and production CSS; isolated, explicitly labelled test APIs.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `conversation-replica-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
await build({
  entryPoints: [path.join(root, "tests/fixtures/conversation-replica.jsx")], outfile: path.join(output, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file", ".html": "text" },
  alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") },
});
await fs.writeFile(path.join(output, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Conversation UI integration test</title><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>');
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  const file = path.resolve(output, name);
  if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2", ".woff": "font/woff" }[path.extname(file)];
    const bytes = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": mime || "application/octet-stream" }); res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const results = {
  fixture: "Real ConversationWorkspace + AgentWorkspace + Composer components; test-only api adapters. No backend/model execution.",
  reference: ".codex-ui-study/shell-body.html: captured command and output mapped to test-only Shell receipt; other messages/receipts synthetic.",
  scopeLimitations: ["Production receipts currently provide tool summaries without command/output: no production Shell capability is claimed.", "No image receipts or subagent records were supplied; no corresponding interactive panels are fabricated.", "Full application navigation, real backend, Electron IPC and export are outside this isolated component integration test."],
  evidence, themes: [], checks: [], pageErrors: [],
};
const check = (name, pass, actual) => { results.checks.push({ name, pass: Boolean(pass), ...(actual === undefined ? {} : { actual }) }); if (!pass) console.error(`FAIL: ${name}`, actual); };
const near = (actual, expected) => Math.abs(parseFloat(actual) - expected) <= 1;
try {
  const context = await browser.newContext({ viewport: { width: 1056, height: 1200 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.on("pageerror", error => results.pageErrors.push(error.message));
  const settled = () => page.waitForTimeout(420);
  const load = async (theme, query = "") => {
    await page.goto(url);
    await page.evaluate(theme => localStorage.setItem("fetchcv.interface-theme", theme), theme);
    await page.goto(url + query);
    await page.locator(".agent-markdown").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await settled();
  };
  const folds = (owner = page.locator(".agent-tool-receipt").first()) => {
    const group = owner;
    const toggle = group.locator(":scope > .outline-none button[aria-expanded]");
    const body = group.locator(":scope > .rp-actbody");
    const row = group.locator(".rp-cmdrow").first();
    const childToggle = row.locator(".tool-detail-toggle");
    const childBody = row.locator(":scope > .rp-actbody");
    return { group, toggle, body, row, childToggle, childBody };
  };
  const state = async (button, body) => ({ aria: await button.getAttribute("aria-expanded"), ...await body.evaluate(e => ({ hidden: e.hidden, height: e.getBoundingClientRect().height })) });
  const snap = async (themeResult, step, f) => {
    const value = { step, parent: await state(f.toggle, f.body), child: await state(f.childToggle, f.childBody) };
    themeResult.states.push(value); console.log(JSON.stringify({ theme: themeResult.theme, ...value })); return value;
  };
  const tailClick = async row => {
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    const position = { x: box.x + box.width - 12, y: box.y + 10 };
    await page.mouse.click(position.x, position.y);
    return position;
  };
  const measure = () => page.evaluate(() => {
    const q = selector => document.querySelector(selector);
    const m = e => {
      if (!e) return null;
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, fontFamily: s.fontFamily, color: s.color, background: s.backgroundColor, radius: s.borderRadius, borderWidth: s.borderTopWidth, borderColor: s.borderTopColor, padding: s.padding, margin: s.margin, gap: s.gap, maxWidth: s.maxWidth, minHeight: s.minHeight, boxShadow: s.boxShadow };
    };
    const row = q(".rp-cmdrow");
    return {
      column: m(q(".standalone-transcript,.conversation-stream")), bubble: m(q(".rp-bubble")), userRow: m(q(".agent-message.user")),
      paragraph: m(q(".agent-markdown > p")), strong: m(q(".agent-markdown strong")), list: m(q(".agent-markdown ul")),
      status: m(q(".replica-activity-label")), statusIcon: m(q(".replica-activity-label > svg")),
      shell: m(q(".tool-output-card")), shellHeader: m(q(".tool-output-card header")), shellStatus: m(q(".tool-output-card footer")),
      actions: m(q(".assistant .agent-message-actions")), action: m(q(".assistant .agent-message-actions button")),
      composer: m(q(".source-composer .rp-composer")), editor: m(q(".source-composer .rp-editor")), textarea: m(q(".source-composer textarea")), controls: m(q(".source-composer .rp-controls")), send: m(q(".composer-send")),
      rows: [...document.querySelectorAll(".rp-cmdrow")].map(e => ({ rowWidth: e.getBoundingClientRect().width, headerWidth: e.querySelector('.group\\/activity-header').getBoundingClientRect().width, rowHeight: e.getBoundingClientRect().height })),
      rowGap: (() => { const rows = [...document.querySelectorAll(".rp-cmdrow")]; return rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom; })(),
      groupMargin: getComputedStyle(q(".agent-tool-receipt")).margin,
      rowHover: row ? m(row) : null,
    };
  });
  for (const theme of ["white", "neutral-dark"]) {
    await load(theme);
    const t = { theme, states: [], screenshots: [] }; results.themes.push(t);
    const f = folds();
    let s = await snap(t, "收起", f);
    check(`${theme}: initial closed`, s.parent.aria === "false" && s.parent.hidden && s.parent.height === 0);
    await f.toggle.click(); await settled();
    s = await snap(t, "聚合展开", f);
    check(`${theme}: aggregate three-row height 72±1`, near(s.parent.height, 72), s.parent);
    check(`${theme}: child stays closed under expanded parent`, s.child.aria === "false" && s.child.height === 0 && s.child.hidden);
    t.widths = await f.group.locator(".rp-cmdrow").evaluateAll(rows => rows.map(e => ({ rowWidth: e.getBoundingClientRect().width, headerWidth: e.querySelector('.group\\/activity-header').getBoundingClientRect().width })));
    check(`${theme}: rowWidth == headerWidth`, t.widths.every(m => Math.abs(m.rowWidth - m.headerWidth) < 0.01), t.widths);
    t.arrowClosed = await f.row.locator(".fold-chev").evaluate(e => ({ opacity: getComputedStyle(e).opacity, transform: getComputedStyle(e.querySelector("svg")).transform }));
    check(`${theme}: child arrow is visible at .45 and not rotated by parent`, near(Number(t.arrowClosed.opacity) * 100, 45) && ["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(t.arrowClosed.transform), t.arrowClosed);
    const screenshot = async name => { const file = path.join(evidence, `${theme}-${name}.png`); await page.screenshot({ path: file }); t.screenshots.push(file); };
    await screenshot("aggregate-open");
    await f.row.hover(); await page.waitForTimeout(180);
    await snap(t, "hover 子行", f);
    t.hover = await f.row.evaluate(e => { const h = e.querySelector('.group\\/activity-header'); return { background: getComputedStyle(h).backgroundColor, radius: getComputedStyle(h).borderRadius, width: h.getBoundingClientRect().width, rowWidth: e.getBoundingClientRect().width, arrowOpacity: getComputedStyle(e.querySelector(".fold-chev")).opacity }; });
    check(`${theme}: hover arrow .75`, near(Number(t.hover.arrowOpacity) * 100, 75), t.hover);
    check(`${theme}: full-width hover background .05 and radius6`, t.hover.background === (theme === "white" ? "rgba(13, 13, 13, 0.05)" : "rgba(255, 255, 255, 0.05)") && near(t.hover.radius, 6) && near(t.hover.width, t.hover.rowWidth), t.hover);
    t.tailClick = await tailClick(f.row); await settled();
    s = await snap(t, "子行展开（鼠标行尾）", f);
    check(`${theme}: mouse coordinate tail opens child`, s.child.aria === "true" && !s.child.hidden && s.child.height > 0);
    t.shellHeightComparison = { measured: s.child.height, referenceShortOutput: 247, note: "Captured Shell output is long; actual height follows content and the 260px inner scroll cap, not a fabricated 247px measurement." };
    t.metrics = await measure(); console.log(JSON.stringify({ theme, metrics: t.metrics }, null, 2));
    const m = t.metrics;
    check(`${theme}: column width/max-width 800 and padding 16 24 190`, near(m.column.rect.width, 800) && m.column.maxWidth === "800px" && m.column.padding === "16px 24px 190px", m.column);
    check(`${theme}: user bubble 18 radius / 12 16 padding`, near(m.bubble.radius, 18) && m.bubble.padding === "12px 16px", m.bubble);
    check(`${theme}: bubble correct theme colors`, m.bubble.background === (theme === "white" ? "rgb(13, 13, 13)" : "rgb(236, 236, 236)") && m.bubble.color === (theme === "white" ? "rgb(255, 255, 255)" : "rgb(13, 13, 13)"), m.bubble);
    check(`${theme}: user bubble width <= 62% and right aligned`, m.bubble.rect.width <= (m.column.rect.width - 48) * .62 + 1 && Math.abs((m.bubble.rect.x + m.bubble.rect.width) - (m.column.rect.x + m.column.rect.width - 24)) <= 1, m.bubble);
    check(`${theme}: body 14/24.5/430`, near(m.paragraph.fontSize, 14) && near(m.paragraph.lineHeight, 24.5) && m.paragraph.fontWeight === "430", m.paragraph);
    check(`${theme}: paragraph margin 0 0 14, list 22, strong 590`, m.paragraph.margin === "0px 0px 14px" && m.list.padding.endsWith("22px") && m.strong.fontWeight === "590", { paragraph: m.paragraph.margin, list: m.list.padding, strong: m.strong.fontWeight });
    check(`${theme}: status 13/18.57 and correct color`, near(m.status.fontSize, 13) && near(m.status.lineHeight, 18.57) && m.status.color === (theme === "white" ? "rgba(26, 28, 31, 0.4)" : "rgba(255, 255, 255, 0.4)"), m.status);
    check(`${theme}: status icon 16x16`, near(m.statusIcon.rect.width, 16) && near(m.statusIcon.rect.height, 16), m.statusIcon);
    check(`${theme}: Shell radius 12.5 / border 1 / theme alpha`, near(m.shell.radius, 12.5) && m.shell.borderWidth === "1px" && m.shell.background === (theme === "white" ? "rgba(26, 28, 31, 0.055)" : "rgba(255, 255, 255, 0.055)") && m.shell.borderColor === (theme === "white" ? "rgba(26, 28, 31, 0.118)" : "rgba(255, 255, 255, 0.118)"), m.shell);
    check(`${theme}: Shell header 4 8 padding / 13 18.57`, m.shellHeader.padding === "4px 8px" && near(m.shellHeader.fontSize, 13) && near(m.shellHeader.lineHeight, 18.57), m.shellHeader);
    check(`${theme}: action 26x26 / radius6 / gap2`, near(m.action.rect.width, 26) && near(m.action.rect.height, 26) && near(m.action.radius, 6) && near(m.actions.gap, 2), { action: m.action, gap: m.actions.gap });
    check(`${theme}: composer 22 radius / editor min34 14/20 / controls52 / send32`, near(m.composer.radius, 22) && near(m.editor.minHeight, 34) && near(m.editor.fontSize, 14) && near(m.editor.lineHeight, 20) && near(m.controls.rect.height, 52) && near(m.send.rect.width, 32) && near(m.send.rect.height, 32), { composer: m.composer, editor: m.editor, controls: m.controls, send: m.send });
    check(`${theme}: command gap 4px`, near(m.rowGap, 4), m.rowGap);
    check(`${theme}: Shell shown only for capture fixture`, await f.row.locator(".tool-output-card header").innerText() === "Shell");
    t.commandStyle = await f.row.locator(".shell-command").evaluate(e => {
      const code = e.querySelector("code"), prefix = e.querySelector(".shell-command-prefix"), copy = e.querySelector("button"), status = e.parentElement.querySelector("footer span"), icon = status.querySelector("svg");
      return { font: getComputedStyle(code).fontFamily, lineClamp: getComputedStyle(code).webkitLineClamp, prefix: prefix.textContent, prefixGap: getComputedStyle(prefix).marginRight, copyOpacity: getComputedStyle(copy).opacity, statusText: status.textContent, statusMargin: getComputedStyle(status).marginLeft, iconWidth: icon.getBoundingClientRect().width, iconHeight: icon.getBoundingClientRect().height };
    });
    check(`${theme}: Shell command clamp / prompt / code font / hidden copy / success icon`, t.commandStyle.lineClamp === "2" && t.commandStyle.prefix === "$" && /mono/i.test(t.commandStyle.font) && Number(t.commandStyle.copyOpacity) === 0 && t.commandStyle.statusText === "成功" && t.commandStyle.iconWidth === 12 && t.commandStyle.iconHeight === 12, t.commandStyle);
    await screenshot("command-open");
    const scroll = f.row.locator(".fold-output-content pre");
    t.innerScroll = await scroll.evaluate(e => { e.scrollTop = 100; return { height: e.getBoundingClientRect().height, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, scrollTop: e.scrollTop, overflow: getComputedStyle(e).overflowY }; });
    check(`${theme}: captured long output scrolls internally at 260px`, near(t.innerScroll.height, 260) && t.innerScroll.scrollHeight > t.innerScroll.clientHeight && t.innerScroll.scrollTop > 0 && t.innerScroll.overflow === "auto", t.innerScroll);
    const copy = f.row.getByRole("button", { name: "复制工具结果" });
    if (await copy.count()) {
      await copy.click();
      check(`${theme}: copy preserves child state`, await f.childToggle.getAttribute("aria-expanded") === "true");
      check(`${theme}: output copy copies captured data`, (await page.evaluate(() => navigator.clipboard.readText())).includes("Settings share the workspace palette"));
    }
    await f.row.getByRole("button", { name: "复制命令", exact: true }).click();
    check(`${theme}: command copy uses captured command and preserves expansion`, (await page.evaluate(() => navigator.clipboard.readText())) === "Get-Content src/ui/settings.css; Get-Content package.json" && await f.childToggle.getAttribute("aria-expanded") === "true");
    t.closeAnimation = await f.childToggle.evaluate(async button => {
      const body = document.getElementById(button.getAttribute("aria-controls"));
      const samples = [];
      const start = performance.now();
      const sample = () => samples.push({ ms: performance.now() - start, aria: button.getAttribute("aria-expanded"), hidden: body.hidden, height: body.getBoundingClientRect().height });
      sample(); button.click();
      while (performance.now() - start < 420) { await new Promise(resolve => requestAnimationFrame(resolve)); sample(); }
      return samples;
    });
    check(`${theme}: collapse visibly animates before delayed hidden`, t.closeAnimation.some(sample => sample.aria === "false" && !sample.hidden && sample.height > 1 && sample.height < t.closeAnimation[0].height - 1) && t.closeAnimation.at(-1).hidden, t.closeAnimation);
    s = await snap(t, "子行收起", f);
    check(`${theme}: second child click returns zero`, s.child.aria === "false" && s.child.hidden && s.child.height === 0);
    await f.toggle.click(); await settled();
    s = await snap(t, "聚合收起", f);
    check(`${theme}: aggregate closes to zero`, s.parent.aria === "false" && s.parent.hidden && s.parent.height === 0);
    await screenshot("collapsed");
    await f.toggle.click(); await settled(); await f.childToggle.click(); await settled();
    await f.toggle.click(); await settled();
    s = await snap(t, "父收起复位子行", f);
    check(`${theme}: parent close resets child aria/hidden/height`, s.child.aria === "false" && s.child.hidden && s.child.height === 0);
    await f.toggle.click(); await page.waitForTimeout(35); await f.toggle.click(); await page.waitForTimeout(35); await f.toggle.click(); await settled();
    s = await snap(t, "快速切换最终展开", f);
    check(`${theme}: rapid parent toggles settle open without reopening child`, s.parent.aria === "true" && !s.parent.hidden && near(s.parent.height, 72) && s.child.height === 0);
    await f.childToggle.click(); await page.waitForTimeout(35); await f.childToggle.click(); await settled();
    check(`${theme}: interrupted child expansion settles hidden`, (await state(f.childToggle, f.childBody)).hidden);
    await f.childToggle.focus(); await page.keyboard.press("Enter"); await settled();
    check(`${theme}: keyboard Enter expands child`, await f.childToggle.getAttribute("aria-expanded") === "true");
  }

  await load("white", "?schema=1");
  let f = folds(); await f.toggle.click(); await settled(); await f.childToggle.click(); await settled();
  check("production-shaped receipt has honest tool result header", (await f.row.locator(".tool-output-card header").innerText()).includes("工具结果") && await f.row.locator(".shell-command").count() === 0);
  check("existing tool-name translation is reused", (await f.childToggle.getAttribute("aria-label")).includes("读取工作区文件"));
  check("unknown tool names remain untranslated", (await f.group.locator(".tool-detail-toggle").last().getAttribute("aria-label")).includes("run_workspace_command"));
  check("unlabelled one-line code fence remains a code card", await page.locator(".agent-code-block").count() === 2);
  await page.locator(".agent-code-block").last().getByRole("button").click();
  check("unlabelled one-line code fence copy works", (await page.evaluate(() => navigator.clipboard.readText())).trim() === "单行无语言代码围栏");

  // Exercise the real ConversationWorkspace onEvent merge and streamed text buffer.
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("开始合成流式验收");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.waitForFunction(() => window.__conversationFixture.pending);
  const streamReceipt = { tool_call_id: "stream-tool", tool_name: "read_workspace_file", status: "running", summary: "流式摘要第一版", artifacts: [] };
  await page.evaluate(receipt => {
    window.__conversationFixture.emit("delta", { text: "流式正文第一段。" });
    window.__conversationFixture.emit("tool_receipt", { receipt });
    window.__conversationFixture.emit("reasoning", { event: { id: "stream-event-1", kind: "tool", label: "合成处理事件", status: "active" } });
  }, streamReceipt);
  await settled();
  f = folds(page.locator(".agent-tool-receipt").last());
  await f.childToggle.click(); await page.waitForTimeout(35);
  const finalSummary = Array.from({ length: 24 }, (_, index) => `流式完整摘要 ${index + 1}`).join("\n");
  await page.evaluate(({ receipt, summary }) => {
    window.__conversationFixture.emit("tool_receipt", { receipt: { ...receipt, status: "completed", summary } });
    window.__conversationFixture.emit("tool_receipt", { receipt: { tool_call_id: "stream-tool-2", tool_name: "web_search", status: "completed", summary: "第二项合成摘要", artifacts: [] } });
    window.__conversationFixture.emit("delta", { text: "流式正文第二段。" });
  }, { receipt: streamReceipt, summary: finalSummary });
  await settled();
  check("receipt updates during child animation do not duplicate rows", await f.group.locator(".rp-cmdrow").count() === 2);
  check("receipt output is updated completely", (await f.row.locator("pre").innerText()) === finalSummary);
  check("stream delta buffer preserves both chunks", (await page.locator(".agent-message.assistant").last().innerText()).includes("流式正文第一段。流式正文第二段。"));
  await f.toggle.click(); await page.waitForTimeout(35);
  await page.evaluate(() => window.__conversationFixture.emit("tool_receipt", { receipt: { tool_call_id: "stream-tool-3", tool_name: "run_workspace_command", status: "completed", summary: "关闭期间到达", artifacts: [] } }));
  await settled();
  check("stream events arriving during collapse do not reopen group", (await state(f.toggle, f.body)).hidden && await f.group.locator(".rp-cmdrow").count() === 3);
  await f.toggle.click(); await settled();
  check("reopen preserves all streamed rows", await f.group.locator(".rp-cmdrow").count() === 3);
  await page.evaluate(({ receipt, summary }) => window.__conversationFixture.finish({ id: "fixture-stream-assistant", role: "assistant", content: "流式正文第一段。流式正文第二段。", metadata_json: { processing_status: "completed", tool_receipts: [{ ...receipt, status: "completed", summary }, { tool_call_id: "stream-tool-2", tool_name: "web_search", status: "completed", summary: "第二项合成摘要", artifacts: [] }, { tool_call_id: "stream-tool-3", tool_name: "run_workspace_command", status: "completed", summary: "关闭期间到达", artifacts: [] }] } }), { receipt: streamReceipt, summary: finalSummary });
  await settled();
  check("done/persistence refresh preserves streamed content and receipts", await page.locator(".agent-tool-receipt").last().locator(".rp-cmdrow").count() === 3 && (await page.locator(".agent-message.assistant").last().innerText()).includes("流式正文第一段。流式正文第二段。"));

  for (const job of [false, true]) {
    await load("white", job ? "?schema=1&job=1" : "?schema=1");
    const label = job ? "job workspace" : "standalone workspace";
    const baseline = await measure();
    (results.workspaces ||= []).push({ workspace: label, baseline });
    check(`${label}: initial column 800px, padding16/24/190, composer visible`, near(baseline.column.rect.width, 800) && baseline.column.padding === "16px 24px 190px" && baseline.composer.rect.y >= 0 && baseline.composer.rect.y + baseline.composer.rect.height <= 1200, { column: baseline.column, composer: baseline.composer });
    await page.getByRole("textbox", { name: "消息", exact: true }).fill(Array.from({ length: 8 }, (_, index) => `多行输入 ${index}`).join("\n"));
    await page.getByRole("button", { name: "上传内容", exact: true }).click();
    await settled();
    const geometry = await page.evaluate(() => {
      const scroller = document.querySelector(".standalone-scroll,.conversation-scroll-v2"); scroller.scrollTop = scroller.scrollHeight;
      const transcript = document.querySelector(".standalone-transcript,.conversation-stream");
      const composer = document.querySelector(".source-composer");
      const last = transcript.querySelector(".agent-message:last-of-type");
      const box = composer.getBoundingClientRect(), message = last.getBoundingClientRect();
      return { paddingBottom: getComputedStyle(transcript).paddingBottom, composerHeight: box.height, composerTop: box.top, composerBottom: box.bottom, lastTop: message.top, lastBottom: message.bottom, scrollHeight: scroller.getBoundingClientRect().height, mainHeight: document.querySelector("main").getBoundingClientRect().height, viewportHeight: innerHeight };
    });
    results.checks.push({ name: `${label}: multiline/attachments geometry`, pass: true, actual: geometry });
    check(`${label}: tall composer does not obscure last message`, geometry.composerTop >= 0 && geometry.composerBottom <= geometry.viewportHeight && geometry.lastTop >= 0 && geometry.lastBottom <= geometry.composerTop - 8 && geometry.scrollHeight > 0 && geometry.mainHeight > 0 && parseFloat(geometry.paddingBottom) >= geometry.composerHeight, geometry);
    await page.setViewportSize({ width: 480, height: 740 }); await settled();
    check(`${label}: narrow screen no document overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 1056, height: 1200 });
  }
  check("no browser runtime errors", results.pageErrors.length === 0, results.pageErrors);
  assert.ok(results.checks.every(item => item.pass), `${results.checks.filter(item => !item.pass).length} UI checks failed; inspect report.json`);
} catch (error) {
  results.error = error.stack; process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ evidence, passed: results.checks.filter(item => item.pass).length, failed: results.checks.filter(item => !item.pass).length, error: results.error || null }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
