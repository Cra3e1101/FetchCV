// Real React components + explicit synthetic activity. No provider or user data.
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
import React, {useState} from 'react';import {createRoot} from 'react-dom/client';
import './src/styles.css';import './src/ui/workspace.css';import './src/ui/replica-alignment.css';import './src/ui/replica-components.css';import './src/ui/agent-motion.css';
import {AgentActivity, ProcessingDisclosure, ToolReceipt} from './src/components/AgentActivity';
import {ActivityIndicator} from './src/ui/ActivityIndicator';
import {applyInterfaceTheme} from './src/ui/interface-theme';
applyInterfaceTheme();
const long=new URLSearchParams(location.search).has('long');
const receipts=[
 {tool_call_id:'test-1',tool_name:'read_workspace_file',status:'completed',summary:long?Array.from({length:120},(_,i)=>'合成输出 '+i).join('\\n'):'合成结果第一行\\n合成结果第二行\\n合成结果第三行',artifacts:[]},
 {tool_call_id:'test-2',tool_name:'web_search',status:'failed',summary:'合成失败结果',artifacts:[]},
 {tool_call_id:'test-3',tool_name:'apply_resume_changes',status:'pending',requires_user_action:true,summary:'合成审批结果',artifacts:[{id:'test-artifact'}]}
];
const startedAt=Date.now();
function IndicatorFixture(){
 const [primary,setPrimary]=useState(true);
 return <><div data-indicator-group style={{display:'flex',gap:24}}><ActivityIndicator active={primary} priority={30} label="工具运行"/><ActivityIndicator priority={20} label="思考中"/><button data-release-owner onClick={()=>setPrimary(false)}>释放运行指示</button></div><div style={{height:'180vh'}}/><div data-offscreen-target>页面底部</div></>;
}
function FinishedFixture(){
 const [finished,setFinished]=useState(false);
 return <><button data-finish-activity onClick={()=>setFinished(true)}>收到结束回执</button><AgentActivity activity={{kind:'chat',finished,startedAt,events:[{id:'finish-check',label:'读取合成资料',status:'active'}]}}/></>;
}
function ProcessingFixture(){
 const [count,setCount]=useState(1);
 const [status,setStatus]=useState('running');
 const [stale,setStale]=useState(false);
 const events=Array.from({length:count},(_,index)=>({id:'synthetic-'+index,kind:'tool',label:'合成工具阶段 '+(index+1),status:index>=count-2&&(status!=='completed'||stale)?'active':'completed'}));
 return <>
  <div aria-label="合成事件控制" style={{display:'flex',gap:12,marginBottom:24}}>
   {[1,4,5,7].map(value=><button key={value} data-event-count={value} onClick={()=>setCount(value)}>{value} 个合成阶段</button>)}
   <button data-complete onClick={()=>{setStale(false);setStatus('completed')}}>完成合成任务</button>
   <button data-stale-completed onClick={()=>{setStale(true);setStatus('completed')}}>完成但保留活动检查点</button>
   {['running','stopping','awaiting_approval','paused','cancelled','failed'].map(value=><button key={value} data-task-status={value} onClick={()=>setStatus(value)}>{value}</button>)}
  </div>
  <ProcessingDisclosure status={status} startedAt={startedAt} durationMs={status==='completed'?3200:undefined} events={events} defaultExpanded/>
  <div data-after-processing>处理记录之后的合成消息</div>
 </>;
}
const query=new URLSearchParams(location.search);
createRoot(document.getElementById('root')).render(<div className="source-grid" style={{display:'block',minHeight:'100vh',background:'var(--ui-surface)',padding:'32px 24px'}}><div style={{maxWidth:800,margin:'0 auto'}}>{query.has('indicators')?<IndicatorFixture/>:query.has('finished')?<FinishedFixture/>:query.has('processing')?<ProcessingFixture/>:<ToolReceipt receipts={receipts}/>}</div></div>);
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
const results = { fixture: "synthetic receipts and processing events rendered by real components", themes: [], checks: [], pageErrors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 620 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.on("pageerror", error => results.pageErrors.push(error.message));
  const check = (name, condition) => { results.checks.push({ name, pass: condition }); assert.ok(condition, name); };
  const settled = () => page.waitForTimeout(400);
  const arrowAngle = async locator => {
    const value = await locator.evaluate(e => {
    const matrix = new DOMMatrix(getComputedStyle(e).transform);
    return { angle: Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI), transform: getComputedStyle(e).transform, parent: e.parentElement.outerHTML };
    });
    (results.arrowMeasurements ||= []).push(value);
    return value.angle;
  };
  for (const theme of ["white", "neutral-dark"]) {
    await page.goto(url);
    await page.evaluate(theme => localStorage.setItem("fetchcv.interface-theme", theme), theme);
    await page.reload();
    const group = page.locator(".agent-tool-receipt");
    await group.waitFor();
    check(`${theme}: historical tool receipt mounts at full opacity`, await group.evaluate(e => getComputedStyle(e).opacity === "1" && getComputedStyle(e).transform === "none"));
    const toggle = group.locator(".tool-group-toggle");
    const body = group.locator(":scope > .fold-body");
    const row = group.locator(".fold-command-row").first();
    const rowButton = row.locator(".fold-toggle");
    const childBody = row.locator(":scope > .rp-actbody");
    const groupArrow = group.locator(":scope > .outline-none .fold-chev > svg");
    const rowArrow = row.locator(".fold-chev > svg");
    check(`${theme}: collapsed group arrow points right`, await arrowAngle(groupArrow) === -90);
    const groupBounds = await toggle.boundingBox();
    await page.mouse.click(groupBounds.x + groupBounds.width - 12, groupBounds.y + groupBounds.height / 2); await settled();
    const groupHeight = await body.evaluate(e => e.getBoundingClientRect().height);
    const widths = await group.locator(".fold-command-row").evaluateAll(rows => rows.map(row => ({ rowWidth: row.getBoundingClientRect().width, headerWidth: row.querySelector('.group\\/activity-header').getBoundingClientRect().width })));
    results.lastMeasurement = { theme, groupHeight, widths, rows: await group.locator('.fold-command-row').evaluateAll(rows => rows.map(e => ({height:e.getBoundingClientRect().height, margin:getComputedStyle(e).margin,padding:getComputedStyle(e).padding}))) };
    check(`${theme}: all rowWidth == headerWidth`, widths.every(m => m.rowWidth === m.headerWidth));
    check(`${theme}: three-row aggregate ~72px`, Math.abs(groupHeight - 72) <= 1);
    check(`${theme}: open group arrow rotates 90 degrees while child stays closed`, await arrowAngle(groupArrow) === 0 && await arrowAngle(rowArrow) === -90);
    const receiptColors = await group.locator(".fold-command-row .replica-activity-label").evaluateAll(labels => labels.map(e => getComputedStyle(e).color));
    check(`${theme}: failed receipt has a distinct static warning color`, receiptColors[1] !== receiptColors[0] && await group.locator(".fold-command-row.failed").evaluate(e => !e.getAnimations({ subtree: true }).some(animation => animation.effect.getTiming().iterations === Infinity)));
    const rowBounds = await row.boundingBox();
    await page.mouse.click(rowBounds.x + rowBounds.width - 12, rowBounds.y + rowBounds.height / 2); await settled();
    const childHeight = await childBody.evaluate(e => e.getBoundingClientRect().height);
    // 12px outside spacing + 2px border + 26.57px header + 8px content
    // padding + 3 × 18.57px output lines + 24.57px footer.
    check(`${theme}: three-line result follows content (~129px)`, Math.abs(childHeight - 128.85) <= 1);
    check(`${theme}: expanded child arrow points down`, await arrowAngle(rowArrow) === 0);
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
    check(`${theme}: interrupted group close reopens without stale callback`, await body.evaluate(e => !e.hidden && e.getBoundingClientRect().height > 0));
    results.themes.push({ theme, groupHeight, childHeight, widths });
  }
  await page.goto(url + "?long=1");
  await page.locator(".tool-group-toggle").click(); await settled();
  await page.locator(".tool-detail-toggle").first().click(); await settled();
  const scroll = await page.locator(".shell-output").first().evaluate(e => {
    e.scrollTop = 100;
    return { height: e.getBoundingClientRect().height, clientHeight: e.clientHeight, scrollHeight: e.scrollHeight, scrollTop: e.scrollTop, overflowY: getComputedStyle(e).overflowY };
  });
  check("long output scrolls internally at 260px", scroll.height === 260 && scroll.scrollHeight > scroll.clientHeight && scroll.scrollTop === 100 && scroll.overflowY === "auto");
  results.scroll = scroll;
  await page.setViewportSize({ width: 480, height: 620 });
  check("narrow viewport has no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".tool-detail-toggle").first().click();
  check("reduced motion closes immediately", await page.locator(".fold-command-row .fold-body").first().evaluate(e => e.hidden && e.getBoundingClientRect().height === 0));

  await page.setViewportSize({ width: 960, height: 620 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(url + "?processing=1");
  const processing = page.locator(".processing-disclosure");
  const processingBody = processing.locator(":scope > .fold-body");
  const processingToggle = processing.locator(".processing-summary");
  const processingRows = processing.locator(".activity-line");
  await settled();
  const processingBaseColor = await processingToggle.evaluate(e => getComputedStyle(e).color);
  const measureProcessing = () => processingBody.evaluate(e => {
    const bounds = e.getBoundingClientRect();
    const rows = [...e.querySelectorAll('.activity-line')].map(row => row.getBoundingClientRect());
    const content = e.querySelector('.processing-detail').getBoundingClientRect();
    return {
      height: bounds.height,
      contentHeight: content.height,
      visible: !e.hidden && bounds.height > 0,
      rows: rows.length,
      noClipping: content.bottom <= bounds.bottom + 1 && rows.every(row => row.top >= bounds.top - 1 && row.bottom <= bounds.bottom + 1),
    };
  });
  const sampleEventChange = async count => page.evaluate(async count => {
    const body = document.querySelector('.processing-disclosure > .fold-body');
    const after = document.querySelector('[data-after-processing]');
    const started = performance.now();
    const samples = [];
    const sample = () => samples.push({
      ms: Math.round(performance.now() - started),
      height: body.getBoundingClientRect().height,
      afterTop: after.getBoundingClientRect().top,
      rows: body.querySelectorAll('.activity-line').length,
    });
    sample();
    document.querySelector('[data-event-count="'+count+'"]').click();
    while (performance.now() - started < 750) {
      // Measure after rendering, as the user sees it.
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      sample();
    }
    return samples;
  }, count);
  const checkResize = (name, samples, direction, animate = false) => {
    const start = samples[0].height;
    const end = samples.at(-1).height;
    check(`${name}: changes height in expected direction`, (end - start) * direction > 20);
    if (animate) check(`${name}: renders intermediate heights`, samples.some(sample => sample.height > Math.min(start, end) + 2 && sample.height < Math.max(start, end) - 2));
    check(`${name}: following message tracks panel height`, samples.every(sample => Math.abs((sample.afterTop - samples[0].afterTop) - (sample.height - start)) < 1));
    check(`${name}: settles without oscillation`, samples.slice(-5).every(sample => Math.abs(sample.height - end) < 0.5));
  };
  const growth = await sampleEventChange(4);
  checkResize("streamed processing growth", growth, 1);
  const grown = await measureProcessing();
  check("streamed processing growth leaves all four rows visible", grown.rows === 4 && grown.visible && grown.noClipping);
  check("multiple active events have only one visible processing indicator", await processing.locator('.activity-indicator').count() === 1 && await processing.locator('.activity-indicator[data-motion-active="true"]').count() === 1);
  const rolling = await sampleEventChange(5);
  const rolled = await measureProcessing();
  results.rolling = { samples: rolling, settled: rolled };
  check("processing history rolls up older operations and keeps the latest four in order", rolled.rows === 4 && await processingRows.first().innerText() === "合成工具阶段 2" && await processingRows.last().innerText() === "合成工具阶段 5");
  check("growing processing history avoids overshooting its final height", rolling.every(sample => sample.height <= Math.max(rolling[0].height, rolled.height) + 1));
  check("growing processing history settles without clipping", rolled.noClipping);
  const shrink = await sampleEventChange(1);
  checkResize("processing row removal", shrink, -1);
  const shrunk = await measureProcessing();
  check("removed processing rows leave no stale nodes or clipping", shrunk.rows === 1 && shrunk.visible && shrunk.noClipping);
  await page.locator('[data-event-count="7"]').click(); await page.waitForTimeout(750);
  check("long processing history initially shows four recent steps", await processingRows.count() === 4);
  await processing.getByRole('button', {name: '较早的 3 步', exact: true}).click(); await settled();
  const allHistory = await measureProcessing();
  check("opening earlier history restores all seven stages", allHistory.rows === 7 && allHistory.noClipping);
  await page.screenshot({ path: path.join(evidence, "processing-history.png") });

  const sampleToggle = () => processingToggle.evaluate(async button => {
    const body = document.querySelector('.processing-disclosure > .fold-body');
    const after = document.querySelector('[data-after-processing]');
    const started = performance.now();
    const samples = [];
    const sample = () => samples.push({ height: body.getBoundingClientRect().height, afterTop: after.getBoundingClientRect().top });
    sample(); button.click();
    while (performance.now() - started < 450) {
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      sample();
    }
    return samples;
  });
  checkResize("explicit processing close", await sampleToggle(), -1, true);
  check("collapsed elapsed line stays compact and hides the detail indicator", await processing.locator('.processing-summary .activity-indicator').count() === 0 && await processingBody.evaluate(e => e.hidden && e.getBoundingClientRect().height === 0));
  check("collapsed content is inert and hidden from assistive technology", await processingBody.evaluate(e => e.inert && e.getAttribute('aria-hidden') === 'true'));
  checkResize("explicit processing open", await sampleToggle(), 1, true);

  await processingToggle.evaluate(async button => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    button.click(); await pause();
    document.querySelector('[data-event-count="4"]').click();
    button.click(); await pause();
    button.click(); await pause();
    button.click();
  });
  await page.waitForTimeout(750);
  const interrupted = await measureProcessing();
  check("rapid processing toggles and streamed changes settle open", await processingToggle.getAttribute("aria-expanded") === "true" && interrupted.rows === 4 && interrupted.visible && interrupted.noClipping);
  await processingToggle.click(); await page.waitForTimeout(40);
  await page.locator('[data-event-count="7"]').click(); await page.waitForTimeout(750);
  check("events arriving during close do not reopen processing", await processingToggle.getAttribute("aria-expanded") === "false" && await processingBody.evaluate(e => e.hidden && e.getBoundingClientRect().height === 0));
  await processingToggle.click(); await settled();
  check("reopening after hidden events reveals current complete content", (await measureProcessing()).rows === 7 && (await measureProcessing()).noClipping);

  await processingToggle.click(); await settled();
  await processingToggle.click(); await page.waitForTimeout(40);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(50);
  const reducedDuringOpen = await measureProcessing();
  check("enabling reduced motion during expansion settles to full content", reducedDuringOpen.visible && reducedDuringOpen.noClipping);
  await processingToggle.click();
  check("reduced-motion processing close is immediate", await processingBody.evaluate(e => e.hidden && e.getBoundingClientRect().height === 0));
  await processingToggle.click();
  const reducedOpen = await measureProcessing();
  check("reduced-motion processing open is immediate", reducedOpen.visible && reducedOpen.noClipping);
  await page.locator('[data-event-count="1"]').click(); await page.waitForTimeout(80);
  const reducedShrink = await measureProcessing();
  check("reduced-motion row removal settles without a delayed exit", reducedShrink.rows === 1 && reducedShrink.noClipping);
  check("reduced motion keeps one static processing indicator", await processing.locator('.activity-indicator').evaluateAll(indicators => indicators.length === 1 && indicators.every(indicator => indicator.dataset.motionActive === "false")));

  // Mount under the preference as well as switching it during a running task.
  await page.goto(url + "?processing=1"); await page.waitForTimeout(80);
  await page.locator('[data-event-count="4"]').click(); await page.waitForTimeout(80);
  const reducedGrowth = await measureProcessing();
  check("processing mounted with reduced motion grows without clipping", reducedGrowth.rows === 4 && reducedGrowth.noClipping);
  await page.locator('[data-complete]').click(); await page.waitForTimeout(600);
  check("completed processing still collapses after its acknowledgement delay", await processingToggle.getAttribute("aria-expanded") === "false" && await processingBody.evaluate(e => e.hidden && e.getBoundingClientRect().height === 0));
  await processingToggle.click();
  const completed = await measureProcessing();
  check("completed processing history remains accessible", completed.rows === 4 && completed.visible && completed.noClipping);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('[data-task-status="running"]').click(); await settled();
  check("resuming processing restores one indicator", await processing.locator('.activity-indicator[data-motion-active="true"]').count() === 1);
  for (const state of ['stopping', 'awaiting_approval']) {
    await page.locator(`[data-task-status="${state}"]`).click(); await page.waitForTimeout(180);
    const frozenElapsed = await processing.locator('time').innerText();
    await page.waitForTimeout(1100);
    check(`${state}: elapsed time freezes until the backend settles`, await processing.locator('time').innerText() === frozenElapsed);
    check(`${state}: keeps history open without a processing loop`, await processingToggle.getAttribute('aria-expanded') === 'true' && await processing.locator('.activity-indicator').count() === 0);
    check(`${state}: does not claim final cancellation`, !(await processing.innerText()).includes('已停止') && !(await processing.innerText()).includes('已中断'));
  }
  for (const state of ['paused', 'cancelled', 'failed', 'completed']) {
    await page.locator('[data-task-status="running"]').click(); await settled();
    await page.locator(state === 'completed' ? '[data-stale-completed]' : `[data-task-status="${state}"]`).click();
    await page.waitForTimeout(750);
    if (await processingToggle.getAttribute('aria-expanded') !== 'true') await processingToggle.click();
    await settled();
    check(`${state}: stale checkpoint activity never restarts a loop`, await processing.locator('.activity-indicator').count() === 0);
    check(`${state}: preserves recorded active outcomes instead of inventing success`, await processing.locator('.activity-line[data-recorded-status="active"]').count() === 2 && await processing.locator('.activity-line.completed').count() === 2);
    if (state === 'failed') check('failed processing has a distinct static warning color', await processingToggle.evaluate(e => getComputedStyle(e).color) !== processingBaseColor && await processing.evaluate(e => !e.getAnimations({ subtree: true }).some(animation => animation.effect.getTiming().iterations === Infinity)));
    if (state === 'completed' || state === 'failed') check(`${state}: stale activity is ended without claiming cancellation`, await processing.locator('.activity-line[data-recorded-status="active"] .activity-line-state').evaluateAll(states => states.every(e => e.textContent === '已结束')));
  }
  results.processing = { growth, shrink, rolling, grown, shrunk, rolled, allHistory, interrupted, reducedDuringOpen, reducedShrink, reducedGrowth };

  await page.goto(url + '?finished=1'); await settled();
  check('unfinished live activity owns an indicator', await page.locator('.activity-indicator[data-motion-active="true"]').count() === 1);
  await page.locator('[data-finish-activity]').click(); await page.waitForTimeout(100);
  check('finished callback stops the loop before activity is cleared', await page.locator('.activity-indicator').count() === 0 && await page.locator('.processing-disclosure.completed').count() === 1 && (await page.locator('.processing-summary').innerText()).startsWith('用时 '));

  await page.goto(url + '?indicators=1'); await settled();
  const indicators = page.locator('.activity-indicator');
  check('two visible indicators elect one highest-priority loop owner', await indicators.count() === 2 && await indicators.nth(0).getAttribute('data-motion-active') === 'true' && await indicators.nth(1).getAttribute('data-motion-active') === 'false');
  await page.locator('[data-release-owner]').click(); await page.waitForTimeout(100);
  check('releasing an owner transfers playback to the remaining active indicator', await indicators.nth(0).getAttribute('data-motion-active') === 'false' && await indicators.nth(1).getAttribute('data-motion-active') === 'true');
  await page.locator('[data-indicator-group]').evaluate(e => { e.style.transform = 'translateY(-1000px)'; }); await page.waitForTimeout(150);
  check('offscreen indicators stop continuous motion', await page.locator('.activity-indicator[data-motion-active="true"]').count() === 0);
  await page.locator('[data-indicator-group]').evaluate(e => { e.style.transform = ''; }); await page.waitForTimeout(150);
  check('returning onscreen restores only one loop owner', await page.locator('.activity-indicator[data-motion-active="true"]').count() === 1);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(100);
  check('changing reduced motion stops all live indicator playback', await page.locator('.activity-indicator[data-motion-active="true"]').count() === 0 && await indicators.locator('i').evaluateAll(dots => dots.every(dot => getComputedStyle(dot).animationName === 'none')));
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForTimeout(100);
  check('restoring motion preference resumes one owner only', await page.locator('.activity-indicator[data-motion-active="true"]').count() === 1);
  check("no browser errors", results.pageErrors.length === 0);
  results.pass = true;
} catch (error) { results.pass = false; results.error = error.stack; throw error;
} finally {
  await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ pass: results.pass, checks: results.checks.length, evidence }));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
