// Real workspace controls with synthetic tasks and deferred cancellation requests.
// No backend, persisted profile, or permission changes are used by this fixture.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `agent-controls-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import './src/styles.css';import './src/ui/workspace.css';import './src/ui/replica-alignment.css';import './src/ui/replica-components.css';import './src/ui/agent-motion.css';
import {AgentWorkspace} from './src/components/AgentWorkspace';
import {api} from './src/lib/api';import {applyInterfaceTheme} from './src/ui/interface-theme';
applyInterfaceTheme();localStorage.setItem('fetchcv.context-rail-collapsed','0');
window.appRuntime={listModelProviders:async()=>({profiles:[]})};
const permissions={web_access:'ask',browser_bridge:'ask',workspace_write:'ask',file_delete:'ask',file_read:'deny'};
api.permissionSettings=async()=>({...permissions});
api.updatePermissionSettings=async patch=>{state.permissionWrites.push(patch);Object.assign(permissions,patch);return {...permissions};};
const makeTask=id=>({id,status:'running',started_at:new Date(Date.now()-7000).toISOString()});
const state=window.controlsFixture={task:makeTask('task-a'),busy:false,error:'',calls:[],permissionWrites:[],
 detail:{job:{id:'job-a',company:'合成公司',role:'合成岗位',jd_raw:'合成岗位描述'},run:{id:'run-a',current_stage:'draft_generating',status:'running'},steps:[{id:'step-a',event_type:'stage',stage:'draft_generating',message:'正在整理已确认的经历'}],messages:[],approvals:[],facts:[],materials:[],proposals:[],resumes:[],base_resumes:[]},
 switchTask(id,jobId){this.task=makeTask(id);this.busy=false;this.error='';if(jobId)this.detail={...this.detail,job:{...this.detail.job,id:jobId}};render();},
 settle(index,fail=false){const call=this.calls[index];if(fail){if(this.task.id===call.taskId){this.busy=false;this.error='合成取消请求失败';}call.reject(new Error('合成取消请求失败'));}
 else{if(this.task.id===call.taskId){this.task={...this.task,status:'cancelled',completed_at:new Date().toISOString()};this.detail={...this.detail,run:{...this.detail.run,status:'cancelled',current_stage:'cancelled'}};this.busy=false;}call.resolve({status:'cancelled'});}render();},
};
function cancel(){state.busy=true;render();return new Promise((resolve,reject)=>state.calls.push({taskId:state.task.id,resolve,reject}));}
const app=createRoot(document.getElementById('root'));
function render(){app.render(<div className="app-shell"><div className="app-grid source-grid" style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) var(--context-rail-width,306px)',height:'100vh',width:'100vw'}}><AgentWorkspace detail={state.detail} task={state.task} busy={state.busy} error={state.error} runtime={{configured:true,model:'synthetic-model'}} onCancelTask={cancel}/></div></div>);}
render();
`;
await build({ stdin: { contents: fixture, resolveDir: root, loader: "jsx" }, outfile: path.join(output, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{}' }, loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file" }, alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") } });
await fs.writeFile(path.join(output, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>.app-grid.source-grid>.main-pane{grid-column:1}.app-grid.source-grid>.context-rail{grid-column:2}</style><div id="root"></div><script type="module" src="fixture.js"></script>');
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
const results = { fixture: "real AgentWorkspace and ApprovalModeMenu; synthetic cancellation and permission APIs", checks: [], pageErrors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", error => results.pageErrors.push(error.message));
  const check = (name, value) => { results.checks.push({ name, pass: Boolean(value) }); assert.ok(value, name); };
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const cancel = () => page.getByRole("button", { name: "取消当前 Agent 任务", exact: true });
  const pending = () => page.getByRole("button", { name: "正在请求取消", exact: true });
  const switchTask = (id, jobId) => page.evaluate(({ id, jobId }) => window.controlsFixture.switchTask(id, jobId), { id, jobId });
  const settle = (index, fail) => page.evaluate(({ index, fail }) => window.controlsFixture.settle(index, fail), { index, fail });
  await cancel().waitFor();
  await page.locator('.activity-indicator[data-motion-active="true"]').waitFor();
  check("running durable task owns one visible indicator", await page.locator('.activity-indicator[data-motion-active="true"]').count() === 1);
  await cancel().click();
  await pending().waitFor();
  check("cancel and pause disable immediately during request", await pending().isDisabled() && await page.getByRole("button", { name: "暂停当前 Agent 任务" }).isDisabled());
  check("pending request preserves actual task and busy lock", await page.evaluate(() => window.controlsFixture.task.status === 'running' && window.controlsFixture.busy));
  check("pending request uses accurate header and rail labels", (await page.locator('.task-meta').innerText()).includes('正在请求取消') && (await page.locator('.rail-state strong').innerText()) === '正在请求取消');
  check("pending request does not claim cancellation complete", !(await page.locator('.agent-workspace-v2').innerText()).includes('已取消') && !(await page.locator('.agent-rail-v2').innerText()).includes('任务已取消'));
  await page.locator('.processing-disclosure.stopping').waitFor();
  const time = await page.locator('.processing-summary time').innerText();
  await page.waitForTimeout(1100);
  check("pending request freezes elapsed timer and every indicator", time === await page.locator('.processing-summary time').innerText() && await page.locator('.activity-indicator[data-motion-active="true"]').count() === 0);
  await pending().evaluate(node => { node.click(); node.click(); });
  check("duplicate clicks do not send another cancellation", await page.evaluate(() => window.controlsFixture.calls.length) === 1);
  await page.screenshot({ path: path.join(evidence, "cancel-pending.png") });
  await settle(0, true);
  await cancel().waitFor();
  await page.locator('.processing-disclosure.running').waitFor();
  await page.locator('.activity-indicator[data-motion-active="true"]').waitFor();
  check("failed request restores running activity and cancellation control", await cancel().isEnabled() && await page.evaluate(() => window.controlsFixture.task.status === 'running') && (await page.locator('.inline-error').innerText()).includes('合成取消请求失败'));
  await switchTask('task-b');
  await cancel().click();
  await pending().waitFor();
  await switchTask('task-c');
  await cancel().waitFor();
  check("task switch clears previous cancellation view", await cancel().isEnabled() && await page.locator('.processing-disclosure.stopping').count() === 0);
  await cancel().click();
  await pending().waitFor();
  await settle(1, false);
  check("old request completion cannot clear new task pending state", await pending().isDisabled() && await page.evaluate(() => window.controlsFixture.task.id === 'task-c' && window.controlsFixture.task.status === 'running'));
  await settle(2, false);
  await pending().waitFor({ state: "detached" });
  check("confirmed cancellation follows persisted terminal status", await page.evaluate(() => window.controlsFixture.task.status === 'cancelled') && await cancel().count() === 0 && await page.locator('.activity-indicator[data-motion-active="true"]').count() === 0);
  await switchTask('task-d', 'job-b');
  await cancel().waitFor();
  await cancel().click();
  await pending().waitFor();
  await switchTask('task-e', 'job-c');
  await cancel().waitFor();
  await settle(3, false);
  check("job switch does not inherit pending or old cancellation result", await cancel().isEnabled() && await page.evaluate(() => window.controlsFixture.detail.job.id === 'job-c' && window.controlsFixture.task.status === 'running'));

  const mode = page.getByRole("button", { name: "审批模式", exact: true });
  await mode.click();
  const menu = page.getByRole("menu", { name: "审批模式" });
  await menu.waitFor();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.approval-menu')).opacity) > .99);
  check("approval menu avoids duplicate CSS entry animation", await menu.evaluate(node => getComputedStyle(node).animationName === 'none'));
  await mode.press('ArrowDown');
  check("approval keyboard navigation still reaches choices", await page.evaluate(() => document.activeElement.getAttribute('role') === 'menuitemradio'));
  const exitMotion = await page.evaluate(async () => {
    const node = document.querySelector('.approval-menu');
    const started = performance.now(); const samples = [];
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    while (node.isConnected && performance.now() - started < 600) {
      samples.push({ t: performance.now() - started, opacity: Number(getComputedStyle(node).opacity), inert: node.inert, pointerEvents: getComputedStyle(node).pointerEvents });
      await new Promise(requestAnimationFrame);
    }
    return { duration: performance.now() - started, samples, removed: !node.isConnected, focused: document.activeElement.getAttribute('aria-label') };
  });
  results.menuExit = exitMotion;
  check("menu exits through a brief fade before removal", exitMotion.removed && exitMotion.duration >= 90 && exitMotion.duration < 330 && exitMotion.samples.some(sample => sample.opacity > .05 && sample.opacity < .95));
  check("exiting menu is excluded from keyboard and pointer input", exitMotion.samples.filter(sample => sample.t > 20).every(sample => sample.inert && sample.pointerEvents === 'none'));
  check("Escape restores focus to menu trigger", exitMotion.focused === '审批模式');
  await mode.click();
  await menu.waitFor();
  await page.getByRole('menuitemradio').filter({ hasText: '帮我批准' }).click();
  await page.locator('.approval-menu').waitFor({ state: 'detached' });
  check("approval choice preserves network-only permission contract", await page.evaluate(() => JSON.stringify(window.controlsFixture.permissionWrites) === JSON.stringify([{ web_access: 'allow', browser_bridge: 'allow' }])));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mode.click();
  await menu.waitFor();
  const reduced = await menu.evaluate(async node => {
    const samples = [];
    const started = performance.now();
    while (performance.now() - started < 230) {
      const style = getComputedStyle(node);
      samples.push({ transform: style.transform, opacity: Number(style.opacity), animation: style.animationName });
      await new Promise(requestAnimationFrame);
    }
    return samples;
  });
  results.reducedMenu = reduced;
  check("live reduced-motion preference removes menu displacement", reduced.every(sample => sample.transform === 'none' || sample.transform === 'matrix(1, 0, 0, 1, 0, 0)'));
  check("reduced-motion menu keeps readable final state without CSS replay", reduced.at(-1).opacity > .99 && reduced.every(sample => sample.animation === 'none'));
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  check("reduced-motion menu still closes", await menu.count() === 0);
  check("no browser runtime errors", results.pageErrors.length === 0);
} finally {
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify(results, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
  console.log(JSON.stringify({ evidence, passed: results.checks.filter(item => item.pass).length, total: results.checks.length, pageErrors: results.pageErrors }, null, 2));
}
