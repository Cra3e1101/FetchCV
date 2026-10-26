// Browser checks for the real component under the workspace and settings skins.
// The fixture changes local React state only; it never touches provider settings.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `segmented-control-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import './src/styles.css';import './src/ui/workspace.css';import './src/ui/replica-alignment.css';import './src/ui/replica-components.css';import './src/ui/agent-motion.css';import './src/ui/settings.css';
import {SegmentedControl} from './src/ui/SegmentedControl';
import {MessageSquare,FileText,BookOpenCheck,Terminal,Globe} from 'lucide-react';
import {applyInterfaceTheme} from './src/ui/interface-theme';
applyInterfaceTheme('white');
const tabs=[{id:'conversation',label:'对话',icon:<MessageSquare size={14}/>},{id:'resume',label:'简历',icon:<FileText size={14}/>},{id:'interview',label:'面试',icon:<BookOpenCheck size={14}/>}];
const transports=[{id:'stdio',label:'STDIO',icon:<Terminal size={14}/>},{id:'streamable_http',label:'流式 HTTP',icon:<Globe size={14}/>}];
const state=window.segmentFixture={value:'conversation',width:300,transportWidth:230,calls:[],
 resize(width,transportWidth){this.width=width;this.transportWidth=transportWidth;render();},
 select(value){this.value=value;render();},theme:applyInterfaceTheme};
const app=createRoot(document.getElementById('root'));
function render(){app.render(<div className="app-shell fixture-shell">
 <section className="source-grid fixture-card"><h1>工作区</h1><div className="agent-workspace-v2"><header className="task-header"><div><h1>岗位</h1></div><SegmentedControl aria-label="受控工作区" className="workspace-tabs" tabs={tabs} value={state.value} onChange={(id,index)=>{state.calls.push({id,index});state.value=id;render();}} style={{width:state.width,flex:'none',maxWidth:'none'}}/></header></div></section>
 <section className="source-grid fixture-card"><h1>另一个实例</h1><div className="agent-workspace-v2"><header className="task-header"><div><h1>岗位</h1></div><SegmentedControl aria-label="独立工作区" className="workspace-tabs" tabs={tabs} defaultValue="resume" style={{width:300,flex:'none',maxWidth:'none'}}/></header></div></section>
 <section className="settings-window fixture-card"><h1>MCP 连接类型</h1><div className="mcp-transport-row"><SegmentedControl aria-label="MCP 连接类型" className="mcp-transport-switch" tabs={transports} defaultValue="stdio" style={{width:state.transportWidth,flexShrink:0}}/></div></section>
 <section className="fixture-card"><h1>键盘与禁用</h1><SegmentedControl aria-label="跳过禁用项" tabs={tabs.map((tab,index)=>({...tab,disabled:index===1}))} style={{width:300}}/><SegmentedControl aria-label="整体禁用" tabs={tabs} defaultValue="resume" disabled style={{width:300}}/></section>
 <section className="fixture-card"><h1>文字与空列表</h1><SegmentedControl aria-label="纯文字选项" tabs={transports.map(({icon,...tab})=>tab)} style={{width:170}}/><SegmentedControl aria-label="空列表" tabs={[]} style={{width:170}}/></section>
 </div>);}
render();
`;
await build({
  stdin: { contents: fixture, resolveDir: root, loader: "jsx" },
  outfile: path.join(output, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file" },
  alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") },
});
await fs.writeFile(path.join(output, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>
body{margin:0;overflow:auto;background:var(--ui-sidebar)}.fixture-shell{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:32px;min-height:100vh;height:auto;overflow:visible}.fixture-card{display:flex;flex-direction:column;gap:16px;min-width:0;padding:24px;border:1px solid var(--ui-line);border-radius:16px;background:var(--ui-surface);color:var(--ui-ink)}.fixture-card h1{font-size:15px;margin:0}.fixture-card .agent-workspace-v2{display:block;min-height:0}.fixture-card .task-header{height:auto;min-height:40px;padding:0}.fixture-card .mcp-transport-row{justify-content:flex-start}.fixture-card .workspace-tabs{margin-left:0!important}@media(max-width:759px){.fixture-shell{grid-template-columns:minmax(0,1fr);padding:20px}.fixture-card{padding:20px}}
</style></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>`);
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  const file = path.resolve(output, name);
  if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const content = await fs.readFile(file);
    const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2", ".woff": "font/woff" }[path.extname(file)];
    res.writeHead(200, { "Content-Type": mime || "application/octet-stream" }); res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: process.env.FETCHCV_BROWSER_CHANNEL || "msedge", headless: true });
const results = { fixture: "SegmentedControl with real workspace/settings CSS", checks: [], geometry: [], pageErrors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 850 } });
  page.on("pageerror", error => results.pageErrors.push(error.message));
  const check = (name, value) => { results.checks.push({ name, pass: Boolean(value) }); assert.ok(value, name); };
  const control = label => page.getByRole("group", { name: label, exact: true });
  const selected = label => control(label).locator('button[aria-pressed="true"]');
  const geometry = async (label, index, total) => {
    await control(label).locator('.segmented-control-indicator').evaluate(async (node, { index, total }) => {
      const deadline = performance.now() + 500;
      while (performance.now() < deadline) {
        const track = node.parentElement.getBoundingClientRect();
        if (Math.abs(node.getBoundingClientRect().left - track.left - (1 + index * (track.width - 2) / total)) < .15) return;
        await new Promise(requestAnimationFrame);
      }
    }, { index, total });
    const measurement = await control(label).evaluate((node, { index, total }) => {
      const track = node.querySelector('.segmented-control-track').getBoundingClientRect();
      const thumb = node.querySelector('.segmented-control-indicator').getBoundingClientRect();
      const button = node.querySelectorAll('button')[index].getBoundingClientRect();
      const aligned = Math.abs(thumb.left - track.left - (1 + index * (track.width - 2) / total)) < .15
        && Math.abs(thumb.width - (track.width - 2) / total) < .15
        && Math.abs(thumb.left - button.left) < .15 && Math.abs(thumb.width - button.width) < .15
        && Math.abs(thumb.top - track.top - 1) < .15 && Math.abs(track.bottom - thumb.bottom - 1) < .15;
      return { aligned, track: track.toJSON(), thumb: thumb.toJSON(), button: button.toJSON() };
    }, { index, total });
    results.geometry.push({ label, index, total, ...measurement });
    return measurement.aligned;
  };
  const labelsVisible = label => control(label).locator('.segmented-control-label').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).display !== 'none'));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await control('受控工作区').waitFor();
  check('each nonempty instance owns exactly one indicator', await page.locator('.segmented-control-indicator').count() === 6);
  check('three-item indicator starts on its selected button', await geometry('受控工作区', 0, 3));
  check('two-item indicator starts on its selected button', await geometry('MCP 连接类型', 0, 2));
  check('uncontrolled default selection is honored', await selected('独立工作区').getAttribute('aria-label') === '简历');
  check('workspace labels inherit each button weight despite header styles', await control('受控工作区').locator('button').evaluateAll(nodes => nodes.every(node => getComputedStyle(node.querySelector('.segmented-control-label')).fontWeight === (node.getAttribute('aria-pressed') === 'true' ? '500' : '400'))));
  const initialOther = await control('独立工作区').locator('.segmented-control-indicator').boundingBox();
  const animation = await control('受控工作区').evaluate(async node => {
    const thumb = node.querySelector('.segmented-control-indicator');
    // Establish the initial painted style before asking the browser to transition.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const start = thumb.getBoundingClientRect().left;
    const style = getComputedStyle(thumb);
    const transition = { property: style.transitionProperty, duration: style.transitionDuration };
    node.querySelectorAll('button')[2].click();
    const samples = []; const started = performance.now();
    while (performance.now() - started < 230) {
      samples.push({ t: performance.now() - started, left: thumb.getBoundingClientRect().left, cssLeft: getComputedStyle(thumb).left, animations: thumb.getAnimations().length });
      await new Promise(requestAnimationFrame);
    }
    return { start, end: thumb.getBoundingClientRect().left, samples, transition };
  });
  results.animation = animation;
  check('selection slides through intermediate positions', animation.samples.some(sample => sample.left > animation.start + 1 && sample.left < animation.end - 1));
  check('indicator has a 120ms left transition', animation.transition.property.split(',').map(item => item.trim()).includes('left') && animation.transition.duration.split(',').some(item => item.trim() === '0.12s'));
  check('three-item indicator finishes at exact requested geometry', await geometry('受控工作区', 2, 3));
  check('switching one instance leaves other selection and indicator unchanged', await selected('独立工作区').getAttribute('aria-label') === '简历' && JSON.stringify(initialOther) === JSON.stringify(await control('独立工作区').locator('.segmented-control-indicator').boundingBox()));
  check('selection callback retains id and index', await page.evaluate(() => JSON.stringify(window.segmentFixture.calls) === JSON.stringify([{ id: 'interview', index: 2 }])));
  await control('MCP 连接类型').getByRole('button', { name: '流式 HTTP', exact: true }).click();
  check('two-item change leaves three-item selection intact', await geometry('MCP 连接类型', 1, 2) && await selected('受控工作区').getAttribute('aria-label') === '面试');
  await page.evaluate(() => window.segmentFixture.select('resume'));
  check('external controlled updates move indicator and selection', await geometry('受控工作区', 1, 3) && await selected('受控工作区').getAttribute('aria-label') === '简历');
  await control('受控工作区').evaluate(node => { const buttons = node.querySelectorAll('button'); buttons[2].click(); buttons[0].click(); });
  check('rapid changes settle on the last selected item', await geometry('受控工作区', 0, 3));

  for (const [threeWidth, twoWidth, hidden] of [[255, 181, false], [254, 180, true], [200, 160, true], [300, 230, false]]) {
    await page.evaluate(({ threeWidth, twoWidth }) => window.segmentFixture.resize(threeWidth, twoWidth), { threeWidth, twoWidth });
    await page.waitForFunction(({ threeWidth, twoWidth }) => {
      const groups = [...document.querySelectorAll('[role="group"]')];
      return groups.find(node => node.getAttribute('aria-label') === '受控工作区').getBoundingClientRect().width === threeWidth
        && groups.find(node => node.getAttribute('aria-label') === 'MCP 连接类型').getBoundingClientRect().width === twoWidth;
    }, { threeWidth, twoWidth });
    check(`all three labels ${hidden ? 'hide' : 'show'} at ${threeWidth}px`, (await labelsVisible('受控工作区')).every(visible => visible === !hidden));
    check(`both labels ${hidden ? 'hide' : 'show'} at ${twoWidth}px`, (await labelsVisible('MCP 连接类型')).every(visible => visible === !hidden));
    check(`resized indicators retain alignment at ${threeWidth}px / ${twoWidth}px`, await geometry('受控工作区', 0, 3) && await geometry('MCP 连接类型', 1, 2));
  }
  check('iconless controls remain readable at narrow widths', (await labelsVisible('纯文字选项')).every(Boolean));
  await page.evaluate(() => window.segmentFixture.resize(254, 180));
  await page.setViewportSize({ width: 700, height: 1000 });
  check('compact labels keep accessible button names', await control('受控工作区').getByRole('button', { name: '面试', exact: true }).count() === 1 && await control('MCP 连接类型').getByRole('button', { name: 'STDIO', exact: true }).count() === 1);
  check('mobile workspace CSS preserves every compact icon', await control('受控工作区').locator('.segmented-control-icon svg').evaluateAll(nodes => nodes.length === 3 && nodes.every(node => getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0)));
  await page.screenshot({ path: path.join(evidence, 'compact-light.png'), fullPage: true });

  const keyboard = control('跳过禁用项');
  await keyboard.getByRole('button', { name: '对话', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  check('right arrow skips disabled option and selects within its own group', await selected('跳过禁用项').getAttribute('aria-label') === '面试' && await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === '面试');
  await page.keyboard.press('ArrowRight');
  check('arrow navigation wraps to first enabled option', await selected('跳过禁用项').getAttribute('aria-label') === '对话');
  await page.keyboard.press('End');
  check('End selects last enabled option', await selected('跳过禁用项').getAttribute('aria-label') === '面试');
  await page.keyboard.press('Home');
  check('Home selects first enabled option', await selected('跳过禁用项').getAttribute('aria-label') === '对话');
  await page.keyboard.press('ArrowLeft');
  check('left arrow wraps to last enabled option', await selected('跳过禁用项').getAttribute('aria-label') === '面试');
  check('keyboard selection maintains one tab stop', await keyboard.locator('button[tabindex="0"]').count() === 1);
  await control('整体禁用').evaluate(node => node.querySelectorAll('button')[0].click());
  check('disabled group cannot change selection', await control('整体禁用').locator('button').evaluateAll(nodes => nodes.every(node => node.disabled)) && await selected('整体禁用').getAttribute('aria-label') === '简历');
  check('empty option list has no invalid indicator', await control('空列表').count() === 0 || await control('空列表').locator('button,.segmented-control-indicator').count() === 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await control('受控工作区').getByRole('button', { name: '面试', exact: true }).click();
  check('reduced motion disables indicator animation', await control('受控工作区').locator('.segmented-control-indicator').evaluate(node => getComputedStyle(node).transitionDuration.split(',').every(value => parseFloat(value) === 0)));
  check('reduced motion retains exact selection geometry', await geometry('受控工作区', 2, 3));
  await page.evaluate(() => { window.segmentFixture.theme('dark'); window.segmentFixture.resize(300, 230); });
  await page.setViewportSize({ width: 1080, height: 850 });
  await page.screenshot({ path: path.join(evidence, 'wide-dark.png'), fullPage: true });
  check('no browser runtime errors', results.pageErrors.length === 0);
} finally {
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify(results, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
  console.log(JSON.stringify({ evidence, passed: results.checks.filter(item => item.pass).length, total: results.checks.length, pageErrors: results.pageErrors }, null, 2));
}
