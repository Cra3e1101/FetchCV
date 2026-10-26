// Real selector components; deferred synthetic APIs exercise failure and focus.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `selectors-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
await build({ stdin: { resolveDir: root, loader: "jsx", contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import './src/styles.css';import './src/ui/workspace.css';import './src/ui/replica-alignment.css';import './src/ui/replica-components.css';import './src/ui/agent-motion.css';
import {Composer} from './src/components/AgentWorkspace';import {api} from './src/lib/api';import {applyInterfaceTheme} from './src/ui/interface-theme';
applyInterfaceTheme();
const models=Array.from({length:36},(_,i)=>({id:'test-model-'+String(i).padStart(2,'0'),ownedBy:'Example models'}));
const profile={id:'p1',providerName:'Example provider',model:models[0].id,availableModels:models};
let runtime={configured:true,provider_id:'p1',model:profile.model};
const state=window.selectorFixture={calls:[],writes:[],failPermissions:false,settle(fail){const call=this.calls.at(-1);fail?call.reject(new Error('合成切换失败')):call.resolve({store:{profiles:[{...profile,model:call.model}]},runtime:{...runtime,model:call.model}})}};
window.appRuntime={listModelProviders:async()=>({profiles:[profile]}),activateModelProvider:(id,model)=>new Promise((resolve,reject)=>state.calls.push({id,model,resolve,reject}))};
let permissions={web_access:'ask',browser_bridge:'ask',workspace_write:'ask',file_delete:'ask',workspace_read:'deny'};
api.permissionSettings=async()=>permissions;
api.updatePermissionSettings=async patch=>{if(state.failPermissions)throw new Error('合成权限保存失败');state.writes.push(patch);return permissions={...permissions,...patch}};
const app=createRoot(document.getElementById('root'));
function render(){app.render(<div className="app-shell source-grid"><main className="selector-fixture"><button id="outside">外部操作</button><div id="composer-host"><Composer runtime={runtime} busy={false} onSend={()=>{}} onAddMaterial={async()=>[]} onManageModels={()=>{}} onModelActivated={next=>{runtime=next;render()}}/></div><button id="after">下一个操作</button></main></div>)}render();
` }, outfile: path.join(output, "fixture.js"), bundle: true, platform: "browser", format: "esm", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  loader: { ".woff2": "file", ".woff": "file", ".svg": "file", ".png": "file" },
  alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") } });
await fs.writeFile(path.join(output, "index.html"), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}#composer-host{position:fixed;left:20px;right:20px;bottom:20px}#composer-host>.source-composer{width:100%;margin:0}.selector-fixture{height:100%}#outside,#after{position:fixed;top:20px;left:20px}#after{left:150px}</style><div id="root"></div><script type="module" src="fixture.js"></script>`);
const server = http.createServer(async (req, res) => {
  const file = path.resolve(output, new URL(req.url, "http://localhost").pathname.slice(1) || "index.html");
  if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try { const bytes = await fs.readFile(file); res.writeHead(200, { "content-type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "application/octet-stream" }).end(bytes); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = { checks: [], errors: [] };
const check = (name, value) => { report.checks.push({ name, pass: Boolean(value) }); assert.ok(value, name); };
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  page.on("pageerror", error => report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const model = page.getByRole("button", { name: "选择模型和推理强度", exact: true });
  const dialog = page.getByRole("dialog", { name: "模型与推理设置" });
  const search = page.getByRole("searchbox", { name: "搜索模型或服务商" });
  const openModels = async () => { await model.click(); await page.getByRole("button", { name: "打开模型选择" }).click(); await search.waitFor(); };
  await model.focus(); await page.keyboard.press("ArrowDown");
  check("arrow key opens effort control and focuses the slider", await page.getByRole("slider").evaluate(node => node === document.activeElement));
  await page.keyboard.press("End");
  check("slider arrows remain native and explanation follows value", await page.getByRole("slider").inputValue() === "2" && await page.locator('.effort-description').innerText() === '深入 · 比较方案并主动检查证据与风险');
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
  check("Escape restores model trigger focus", await model.evaluate(node => node === document.activeElement));
  await openModels();
  check("model search receives focus", await search.evaluate(node => node === document.activeElement));
  check("current model has a selected indicator", await page.getByRole("menuitemradio", { checked: true }).count() === 1);
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("End");
  check("End reaches and scrolls to last model", await page.evaluate(() => document.activeElement.textContent.includes('test-model-35') && document.querySelector('.model-choice-list').scrollTop > 0));
  await search.fill("no-such-model");
  check("empty search keeps a clear recovery message", await page.getByText("没有匹配的模型，试试其他关键词").isVisible());
  await search.fill("test-model-03"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  check("selection sends exactly one activation and disables pending choices", await page.evaluate(() => window.selectorFixture.calls.length) === 1 && await page.getByRole('menuitemradio').isDisabled());
  await page.evaluate(() => window.selectorFixture.settle(true));
  await page.getByRole("alert").filter({ hasText: "合成切换失败" }).waitFor();
  check("failed selection keeps dialog open and permits retry", await dialog.isVisible() && await page.getByRole("menuitemradio").isEnabled());
  check("failed selection preserves a keyboard path for retry", await dialog.evaluate(node => node.contains(document.activeElement)));
  await page.getByRole("menuitemradio").click(); await page.evaluate(() => window.selectorFixture.settle(false));
  await dialog.waitFor({ state: "detached" });
  report.selection = await model.evaluate(node => ({ text: node.innerText, focused: node === document.activeElement, active: document.activeElement.outerHTML.slice(0, 300) }));
  check("successful choice updates trigger and restores focus", (await model.innerText()).includes("test-model-03") && await model.evaluate(node => node === document.activeElement));
  await openModels(); await search.fill('test-model-04'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'});
  await openModels(); await page.evaluate(() => window.selectorFixture.settle(false));
  await page.waitForFunction(() => document.querySelector('.model-effort-trigger').textContent.includes('test-model-04'));
  check("late completion does not close a newly opened menu or steal its focus", await dialog.isVisible() && await search.evaluate(node => node === document.activeElement));
  await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'});

  const approval = page.getByRole("button", { name: "审批模式", exact: true });
  await approval.click();
  await page.getByRole('menuitemradio', { name: /帮我批准/ }).waitFor();
  await page.evaluate(() => { window.selectorFixture.failPermissions = true; });
  await page.getByRole('menuitemradio', { name: /帮我批准/ }).click();
  await page.getByRole('alert').filter({ hasText: '合成权限保存失败' }).waitFor();
  check("permission errors stay inside the open menu", await page.getByRole('menu', { name: '审批模式' }).getByRole('alert').isVisible());
  await page.evaluate(() => { window.selectorFixture.failPermissions = false; });
  await page.getByRole('menuitemradio', { name: /帮我批准/ }).click();
  await page.locator('.approval-menu').waitFor({ state: 'detached' });
  check("permission selection only writes the original network fields", await page.evaluate(() => JSON.stringify(window.selectorFixture.writes) === JSON.stringify([{web_access:'allow',browser_bridge:'allow'}])));

  await openModels(); await page.locator('#outside').click();
  await dialog.waitFor({ state: "detached" });
  check("outside click closes without stealing destination focus", await page.locator('#outside').evaluate(node => node === document.activeElement));
  const add = page.getByRole("button", { name: "添加内容", exact: true });
  await add.click(); await page.keyboard.press("Tab");
  check("Tab leaves the menu and proceeds to the next composer control", await page.getByRole('menu', { name: '添加内容', exact: true }).count() === 0 && await approval.evaluate(node => node === document.activeElement));

  for (const [width, height, top] of [[1000,720,false],[420,620,false],[420,620,true]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(top => { const host=document.getElementById('composer-host');host.style.top=top?'50px':'auto';host.style.bottom=top?'auto':'20px';host.style.overflow='hidden';host.style.transform='translateZ(0)'; }, top);
    for (const theme of ['white','neutral-dark','light','dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.interfaceTheme=theme; }, theme);
      await openModels(); await page.waitForTimeout(220);
      const geometry = await dialog.evaluate(node => { const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,side:node.dataset.side,topLayer:node.matches(':popover-open'),scroll:node.querySelector('.model-choice-list').scrollHeight>node.querySelector('.model-choice-list').clientHeight}; });
      check(`${width}x${height} ${top?'top':'bottom'} ${theme}: viewport bounds and unclipped top layer`, geometry.x >= 11 && geometry.y >= 11 && geometry.right <= width-11 && geometry.bottom <= height-11 && geometry.topLayer && geometry.scroll);
      check(`${width} ${theme}: placement follows available space`, geometry.side === (top?'bottom':'top'));
      if (width===420) await page.screenshot({path:path.join(evidence,`${theme}-${top?'top':'bottom'}.png`),animations:'disabled'});
      await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'});
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openModels(); await page.waitForTimeout(160);
  check("reduced motion keeps the menu at full scale", await dialog.evaluate(node => getComputedStyle(node).transform === 'none' || getComputedStyle(node).transform === 'matrix(1, 0, 0, 1, 0, 0)'));
  check("no browser runtime errors", report.errors.length === 0);
} finally {
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify(report,null,2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
  console.log(JSON.stringify({evidence,passed:report.checks.filter(c=>c.pass).length,total:report.checks.length,errors:report.errors}));
}
