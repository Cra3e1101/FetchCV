// Real appearance controls and CSS with a synthetic, button-heavy workspace.
// Frame timings are evidence only; assertions cover behavior, not machine speed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `theme-switching-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import './src/styles.css'; import './src/ui/workspace.css'; import './src/ui/replica-alignment.css'; import './src/ui/replica-components.css'; import './src/ui/agent-motion.css';
import {ModelSettingsDialog} from './src/components/ModelSettingsDialog';
import {api} from './src/lib/api';
import {applyInterfaceTheme,saveInterfaceTheme} from './src/ui/interface-theme';
applyInterfaceTheme();
window.themeFixture={save:saveInterfaceTheme,apply:applyInterfaceTheme};
Object.assign(api,{skills:async()=>[],mcpServers:async()=>[],permissionSettings:async()=>({}),generalSettings:async()=>({accent:'coral',density:'comfortable',theme:'light'})});
window.appRuntime={listModelProviders:async()=>({profiles:[]})};
createRoot(document.getElementById('root')).render(<div className="app-shell source-grid"><section className="agent-workspace-v2 theme-probe-workspace" aria-hidden="true">{Array.from({length:100},(_,i)=><button key={i} className="theme-color-probe">合成历史会话 {i}</button>)}</section><ModelSettingsDialog open user={{name:'合成用户'}} runtime={{configured:true}} onClose={()=>{}} onSaved={()=>{}}/></div>);
`;
await build({ stdin: { contents: fixture, resolveDir: root, loader: "jsx" }, outfile: path.join(output, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file" }, alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") } });
await fs.writeFile(path.join(output, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>.theme-probe-workspace{position:absolute;inset:0;display:grid;grid-template-columns:repeat(5,1fr);overflow:hidden}.theme-color-probe{color:var(--ui-ink);background:var(--ui-sidebar);border:1px solid var(--ui-line)}.theme-color-probe:hover{background:var(--ui-selection)}</style><div id="root"></div><script type="module" src="fixture.js"></script>');
const server = http.createServer(async (req, res) => {
  const file = path.resolve(output, new URL(req.url, "http://localhost").pathname.slice(1) || "index.html");
  if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try { const content = await fs.readFile(file); res.writeHead(200, { "content-type": { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[path.extname(file)] || "application/octet-stream" }).end(content); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: process.env.FETCHCV_BROWSER_CHANNEL || "msedge", headless: true });
const report = { checks: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 960 } });
  page.on("pageerror", error => report.errors.push(error.message));
  const check = (name, pass) => { report.checks.push({ name, pass: Boolean(pass) }); assert.ok(pass, name); };
  const picker = () => page.getByRole("group", { name: "主题", exact: true });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await picker().waitFor();
  await page.waitForTimeout(350);

  const burst = await page.evaluate(async () => {
    const changes = [];
    const observer = new MutationObserver(records => changes.push(...records.filter(r => r.attributeName === 'data-interface-theme').map(() => document.documentElement.dataset.interfaceTheme)));
    observer.observe(document.documentElement, { attributes: true });
    window.themeFixture.save('neutral-dark'); window.themeFixture.save('light'); window.themeFixture.save('dark');
    const saved = localStorage.getItem('fetchcv.interface-theme');
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    observer.disconnect();
    return { saved, changes, theme: document.documentElement.dataset.interfaceTheme };
  });
  report.burst = burst;
  check('a same-frame burst persists the last requested theme', burst.saved === 'dark' && burst.theme === 'dark');
  check('same-frame requests commit at most one global theme change', burst.changes.length <= 1);
  await page.reload(); await picker().waitFor();
  check('saved final theme restores after reload', await page.locator('html').getAttribute('data-interface-theme') === 'dark' && await picker().locator('button[aria-pressed="true"]').getAttribute('aria-label') === '暖色深色');
  await page.waitForTimeout(350);

  const roundTrip = await picker().evaluate(async node => {
    const buttons = [...node.querySelectorAll('button')];
    for (const index of [0, 1, 2, 3]) { buttons[index].click(); await Promise.resolve(); }
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    return { theme: document.documentElement.dataset.interfaceTheme, saved: localStorage.getItem('fetchcv.interface-theme'), selected: node.querySelector('button[aria-pressed="true"]').getAttribute('aria-label') };
  });
  check('same-frame clicks can return to the original theme without stale work', roundTrip.theme === 'dark' && roundTrip.saved === 'dark' && roundTrip.selected === '暖色深色');

  const result = await page.evaluate(async () => {
    const buttons = [...document.querySelector('[role="group"][aria-label="主题"]').querySelectorAll('button')];
    const frames = []; let previous = performance.now();
    const sample = () => {
      const now = performance.now();
      const animations = document.getAnimations().filter(animation => animation.playState === 'running');
      frames.push({ delta: now - previous, theme: document.documentElement.dataset.interfaceTheme,
        globalColorTransitions: animations.filter(a => a.effect?.target?.matches?.('.theme-color-probe') && /color|background|shadow|fill|stroke/.test(a.transitionProperty || '')).length,
        sliderTransitions: animations.filter(a => a.effect?.target?.classList?.contains('segmented-control-indicator') && a.transitionProperty === 'left').length });
      previous = now;
    };
    for (let i = 0; i < 24; i++) {
      buttons[[0, 1, 2, 3][i % 4]].click();
      await new Promise(requestAnimationFrame); sample();
      await new Promise(requestAnimationFrame); sample();
    }
    for (let i = 0; i < 8; i++) { await new Promise(requestAnimationFrame); sample(); }
    const probe = document.querySelector('.theme-color-probe');
    const indicator = document.querySelector('[aria-label="主题"] .segmented-control-indicator');
    return { frames, finalTheme: document.documentElement.dataset.interfaceTheme, selected: document.querySelector('[aria-label="主题"] button[aria-pressed="true"]').getAttribute('aria-label'), saved: localStorage.getItem('fetchcv.interface-theme'), restoredProperties: getComputedStyle(probe).transitionProperty, sliderDuration: getComputedStyle(indicator).transitionDuration };
  });
  report.rapid = result;
  check('rapid switching avoids global color animation tails', result.frames.every(frame => frame.globalColorTransitions === 0));
  check('theme indicator retains its 120ms slide', result.sliderDuration === '0.12s' && result.frames.some(frame => frame.sliderTransitions > 0));
  check('last click, rendered theme, and saved preference agree', result.finalTheme === 'dark' && result.saved === 'dark' && result.selected === '暖色深色');
  check('ordinary color transitions restore after theme updates', /color/.test(result.restoredProperties));

  const preserved = await page.evaluate(async () => {
    const node = document.createElement('div');
    node.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;opacity:1;transform:translateX(0);transition:opacity 500ms linear,transform 500ms linear';
    document.body.appendChild(node); node.getBoundingClientRect();
    node.style.opacity = '.5'; node.style.transform = 'translateX(20px)';
    window.themeFixture.save('white');
    for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    const properties = node.getAnimations().filter(animation => animation.playState === 'running').map(animation => animation.transitionProperty);
    node.remove(); window.themeFixture.save('dark');
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    return properties;
  });
  check('theme updates preserve unrelated opacity and movement transitions', preserved.includes('opacity') && preserved.includes('transform'));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await picker().getByRole('button', { name: '简约白', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.interfaceTheme === 'white');
  check('reduced motion still applies and saves theme', await page.evaluate(() => localStorage.getItem('fetchcv.interface-theme') === 'white'));
  check('reduced motion keeps theme indicator static', await picker().locator('.segmented-control-indicator').evaluate(node => getComputedStyle(node).transitionDuration.split(',').every(value => parseFloat(value) === 0)));
  check('no browser runtime errors', report.errors.length === 0);
} finally {
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
  console.log(JSON.stringify({ evidence, passed: report.checks.filter(item => item.pass).length, total: report.checks.length, errors: report.errors }));
}
