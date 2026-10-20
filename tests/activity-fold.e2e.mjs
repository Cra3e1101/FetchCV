// Real React components + explicit synthetic receipts. No provider or user data.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `activity-fold-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import './src/styles.css';import './src/ui/workspace.css';import './src/ui/replica-alignment.css';import './src/ui/replica-components.css';
import {AgentMessage} from './src/components/AgentMessage';
import {applyInterfaceTheme} from './src/ui/interface-theme';
applyInterfaceTheme();
const long=new URLSearchParams(location.search).has('long');
const receipts=[
 {tool_call_id:'test-1',tool_name:'read_workspace_file',status:'completed',summary:long?Array.from({length:120},(_,i)=>'合成输出 '+i).join('\\n'):'合成结果第一行\\n合成结果第二行\\n合成结果第三行',artifacts:[]},
 {tool_call_id:'test-2',tool_name:'web_search',status:'failed',summary:'合成失败结果',artifacts:[]},
 {tool_call_id:'test-3',tool_name:'apply_resume_changes',status:'pending',requires_user_action:true,summary:'合成审批结果',artifacts:[{id:'test-artifact'}]}
];
createRoot(document.getElementById('root')).render(<div className="source-grid" style={{display:'block',minHeight:'100vh',background:'var(--ui-surface)',padding:'32px 24px'}}><div style={{maxWidth:800,margin:'0 auto'}}><AgentMessage message={{role:'assistant',content:'用于折叠验收的合成消息',metadata_json:{tool_receipts:receipts}}}/></div></div>);
`;
await build({ stdin: { contents: fixture, resolveDir: root, loader: "jsx" }, outfile: path.join(output, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{}' }, loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file" }, alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") } });
await fs.writeFile(path.join(output, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script type="module" src="fixture.js"></script>');
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  const file = path.resolve(output, name);
  if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2", ".woff": "font/woff" }[path.extname(file)];
    const content = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": mime || "application/octet-stream" }); res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = { fixture: "synthetic receipts rendered by AgentMessage", themes: [], checks: [], pageErrors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 620 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.on("pageerror", error => results.pageErrors.push(error.message));
  const check = (name, condition) => { results.checks.push({ name, pass: condition }); assert.ok(condition, name); };
  const settled = () => page.waitForTimeout(400);
  for (const theme of ["white", "neutral-dark"]) {
    await page.goto(url);
    await page.evaluate(theme => localStorage.setItem("fetchcv.interface-theme", theme), theme);
    await page.reload();
    const group = page.locator(".agent-tool-receipt");
    const toggle = group.locator(".tool-group-toggle");
    const body = group.locator(":scope > .fold-body");
    const row = group.locator(".fold-command-row").first();
    const rowButton = row.locator(".fold-toggle");
    const childBody = row.locator(".fold-body");
    await toggle.click({ position: { x: 780, y: 12 } }); await settled();
    const groupHeight = await body.evaluate(e => e.getBoundingClientRect().height);
    const widths = await group.locator(".fold-command-row").evaluateAll(rows => rows.map(row => ({ rowWidth: row.getBoundingClientRect().width, headerWidth: row.querySelector('.group\\/activity-header').getBoundingClientRect().width })));
    results.lastMeasurement = { theme, groupHeight, widths, rows: await group.locator('.fold-command-row').evaluateAll(rows => rows.map(e => ({height:e.getBoundingClientRect().height, margin:getComputedStyle(e).margin,padding:getComputedStyle(e).padding}))) };
    check(`${theme}: all rowWidth == headerWidth`, widths.every(m => m.rowWidth === m.headerWidth));
    check(`${theme}: three-row aggregate ~100px`, Math.abs(groupHeight - 100) <= 1);
    await rowButton.click({ position: { x: 780, y: 12 } }); await settled();
    const childHeight = await childBody.evaluate(e => e.getBoundingClientRect().height);
    check(`${theme}: three-line result ~149px`, Math.abs(childHeight - 149) <= 1);
    await page.screenshot({ path: path.join(evidence, `${theme}.png`) });
    await row.getByRole("button", { name: "复制工具结果" }).click();
    check(`${theme}: copy does not toggle row`, await rowButton.getAttribute("aria-expanded") === "true");
    check(`${theme}: clipboard receives result`, (await page.evaluate(() => navigator.clipboard.readText())).startsWith("合成结果第一行"));
    await toggle.click(); await settled();
    check(`${theme}: closing parent resets child`, await rowButton.getAttribute("aria-expanded") === "false");
    check(`${theme}: parent closed to zero`, await body.evaluate(e => e.hidden && e.getBoundingClientRect().height === 0));
    await toggle.evaluate(e => { e.click(); e.click(); }); await settled();
    check(`${theme}: double click group returns zero`, await body.evaluate(e => e.hidden && e.getBoundingClientRect().height === 0));
    await toggle.click(); await settled();
    await rowButton.click(); await page.waitForTimeout(45); await rowButton.click(); await settled();
    check(`${theme}: interrupted child expansion returns zero`, await childBody.evaluate(e => e.hidden && e.getBoundingClientRect().height === 0));
    await rowButton.focus(); await page.keyboard.press("Enter"); await settled();
    check(`${theme}: keyboard expands row`, await rowButton.getAttribute("aria-expanded") === "true");
    await toggle.click(); await page.waitForTimeout(45); await toggle.click(); await settled();
    check(`${theme}: interrupted group close reopens without stale callback`, await body.evaluate(e => !e.hidden && e.style.height === "auto"));
    results.themes.push({ theme, groupHeight, childHeight, widths });
  }
  await page.goto(url + "?long=1");
  await page.locator(".tool-group-toggle").click(); await settled();
  await page.locator(".tool-detail-toggle").first().click(); await settled();
  const scroll = await page.locator("[data-testid=exec-shell-body]").first().evaluate(e => {
    e.scrollTop = 100;
    return { height: e.getBoundingClientRect().height, clientHeight: e.clientHeight, scrollHeight: e.scrollHeight, scrollTop: e.scrollTop, overflowY: getComputedStyle(e).overflowY };
  });
  check("long output scrolls internally at 260px", scroll.height === 260 && scroll.scrollHeight > scroll.clientHeight && scroll.scrollTop === 100 && scroll.overflowY === "auto");
  results.scroll = scroll;
  await page.setViewportSize({ width: 480, height: 620 });
  check("narrow viewport has no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".tool-detail-toggle").first().click();
  check("reduced motion closes immediately", await page.locator(".fold-command-row .fold-body").first().evaluate(e => e.hidden && e.style.height === "0px"));
  check("no browser errors", results.pageErrors.length === 0);
  results.pass = true;
} catch (error) { results.pass = false; results.error = error.stack; throw error;
} finally {
  await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ pass: results.pass, checks: results.checks.length, evidence }));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
