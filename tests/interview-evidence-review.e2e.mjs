import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium} from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, '.m1-evidence');
fs.mkdirSync(evidence, {recursive:true});
const run = fs.mkdtempSync(path.join(evidence, 'evidence-review-ui-'));
const fixture = path.join(root, 'tests/fixtures/evidence-review-ui/server.py');
const python = process.env.FETCHCV_TEST_PYTHON || path.join(root, 'backend/.venv-m1/Scripts/python.exe');
const token = randomBytes(24).toString('hex');
const report = {run, synthetic_data:true, mocked_api:false, browser:'msedge', checks:[], screenshots:[], errors:[], responses:[], external_requests:[]};
let vite, apiProcess, context, page;
let apiBase;
const logHandles = [];

function isolatedEnv() {
  const env = {...process.env};
  for (const name of Object.keys(env)) if (/^(FETCHCV_|OPENAI_API_KEY$|ANTHROPIC_API_KEY$|DEEPSEEK_API_KEY$|FIRECRAWL_API_KEY$|NODE_OPTIONS$|APPDATA$|LOCALAPPDATA$|TEMP$|TMP$)/i.test(name)) delete env[name];
  for (const [name, folder] of [['APPDATA','roaming'],['LOCALAPPDATA','local'],['TEMP','temp'],['TMP','temp']]) {
    env[name] = path.join(run, folder); fs.mkdirSync(env[name], {recursive:true});
  }
  return env;
}
async function waitFor(fn, description, ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (apiProcess && apiProcess.exitCode !== null) throw Error(`API exited ${apiProcess.exitCode}; inspect ${run}`);
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`Timed out: ${description}`);
}
function diskReview() {
  const result = spawnSync(python, [fixture, '--run-root', run, '--inspect'], {cwd:root, env:isolatedEnv(), windowsHide:true, encoding:'utf8', timeout:10000});
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout).evidence_review;
}
async function getDetail() {
  const response = await fetch(`${apiBase}/api/interview-sources/ui-source`, {headers:{'x-fetchcv-control-token':token}});
  assert.equal(response.status, 200);
  return response.json();
}
async function saveAndVerify(kind) {
  const receipt = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${apiBase}/api/interview-sources/ui-source/review`);
  await page.getByRole('button', {name:'确认保存', exact:true}).click();
  const response = await receipt;
  const body = await response.json();
  report.responses.push({operation:kind, status:response.status(), review:body.metadata_json?.evidence_review});
  assert.equal(response.status(), 200, JSON.stringify(body));
  assert.equal(body.metadata_json.evidence_review.source_kind, kind);
  await page.getByRole('status').filter({hasText:'已保存来源核验'}).waitFor();
  assert.equal((await getDetail()).metadata_json.evidence_review.source_kind, kind);
  assert.equal(diskReview().source_kind, kind);
  report.checks.push(`${kind}: POST receipt, fresh GET and read-only SQLite agree`);
}
async function openReview() {
  await page.getByText('保存的正文', {exact:true}).waitFor();
  const section = page.locator('.interview-evidence-review');
  if (!(await section.getAttribute('open'))) {
    if (!(await section.evaluate(element => element.open))) await section.locator('summary').click();
  }
}
async function capture(theme, width, height) {
  await page.setViewportSize({width,height});
  await page.evaluate(value => window.setFixtureTheme(value), theme);
  await page.locator('.interview-evidence-review').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.evaluate(() => {
    const selectors = ['.interview-reader','.interview-reader-content','.interview-evidence-review','select','input','textarea'];
    const values = Object.fromEntries(selectors.map(selector => {
      const element = document.querySelector(selector), rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return [selector,{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,color:style.color,background:style.backgroundColor}];
    }));
    const raw = getComputedStyle(document.querySelector('.interview-reader-raw p'));
    const primary = getComputedStyle(document.querySelector('.interview-reader > footer button.primary'));
    // Canvas resolves current browser CSS color syntaxes (including oklab) to sRGB.
    const canvas = document.createElement('canvas'); canvas.width=1; canvas.height=1;
    const ctx = canvas.getContext('2d');
    function rgb(color, underneath='white') { ctx.clearRect(0,0,1,1);ctx.fillStyle=underneath;ctx.fillRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3); }
    function luminance(channels) {return channels.map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);}
    function contrast(fg,bg) {const foreground=luminance(rgb(fg,bg)),background=luminance(rgb(bg));return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);}
    return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,interfaceTheme:document.documentElement.dataset.interfaceTheme,values,
      raw_text_color:raw.color,raw_text_contrast:contrast(raw.color,values['.interview-reader'].background),primary_color:primary.color,primary_background:primary.backgroundColor,primary_contrast:contrast(primary.color,primary.backgroundColor)};
  });
  const filename = `${theme}-${width}.png`;
  await page.screenshot({path:path.join(run, filename), fullPage:true});
  report.screenshots.push({file:filename,metrics});
  assert.ok(metrics.documentWidth <= width + 1, `document overflow at ${width}`);
  for (const [selector, value] of Object.entries(metrics.values)) {
    assert.ok(value.x >= -1 && value.x + value.width <= width + 1, `${selector} exceeds viewport at ${width}`);
    assert.ok(value.scrollWidth <= value.clientWidth + 1, `${selector} internal horizontal overflow at ${width}`);
  }
  assert.ok(metrics.raw_text_contrast >= 4.5, `raw text contrast below 4.5 in ${theme}: ${metrics.raw_text_contrast}`);
  assert.ok(metrics.primary_contrast >= 4.5, `primary button contrast below 4.5 in ${theme}: ${metrics.primary_contrast}`);
  report.checks.push(`${theme} ${width}: viewport and component overflow checked`);
}
async function stopApi() {
  if (!apiProcess || apiProcess.exitCode !== null || apiProcess.signalCode !== null) return;
  if (process.platform === 'win32') {
    const result = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID',String(apiProcess.pid),'/T','/F'], {windowsHide:true, timeout:5000, encoding:'utf8'});
    report.api_cleanup = {owned_pid:apiProcess.pid, method:'taskkill_pid_tree', exit_code:result.status};
  } else apiProcess.kill('SIGTERM');
  await Promise.race([new Promise(resolve => apiProcess.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
  if (apiProcess.exitCode === null && apiProcess.signalCode === null) { apiProcess.kill('SIGKILL'); report.errors.push('API cleanup not confirmed'); }
}

try {
  assert.ok(fs.existsSync(python), 'Set FETCHCV_TEST_PYTHON to the existing test Python interpreter');
  console.log('Building the real reader component and production styles...');
  const webRoot = path.join(run,'web');
  const bundle = await build({root,logLevel:'error',build:{outDir:webRoot,emptyOutDir:false,rollupOptions:{input:path.join(root,'tests/fixtures/evidence-review-ui/entry.jsx')}}});
  const output = (Array.isArray(bundle)?bundle[0]:bundle).output;
  const entry = output.find(item => item.type==='chunk' && item.isEntry);
  const css = output.filter(item => item.type==='asset' && item.fileName.endsWith('.css'));
  fs.writeFileSync(path.join(webRoot,'index.html'),`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(item=>`<link rel="stylesheet" href="/${item.fileName}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${entry.fileName}"></script></body></html>`);
  vite = http.createServer((request,response)=>{
    const filename=path.resolve(webRoot,'.'+(new URL(request.url,'http://localhost').pathname==='/'?'/index.html':decodeURIComponent(new URL(request.url,'http://localhost').pathname)));
    if(!filename.startsWith(webRoot+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){response.writeHead(404);response.end();return;}
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.woff':'font/woff'};
    response.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');fs.createReadStream(filename).pipe(response);
  });
  await new Promise((resolve,reject)=>{vite.once('error',reject);vite.listen(0,'127.0.0.1',resolve);});
  const origin = `http://127.0.0.1:${vite.address().port}`;
  const env = {...isolatedEnv(), FETCHCV_ALLOWED_ORIGINS:origin, FETCHCV_CONTROL_TOKEN:token, FETCHCV_INSTANCE_NONCE:path.basename(run)};
  for (const name of ['api.stdout.log','api.stderr.log']) logHandles.push(fs.openSync(path.join(run,name),'wx'));
  apiProcess = spawn(python,[fixture,'--run-root',run], {cwd:root,env,windowsHide:true,stdio:['ignore',...logHandles]});
  apiProcess.on('error', error => report.errors.push(`API spawn: ${error.message}`));
  await waitFor(() => fs.existsSync(path.join(run,'api-address.json')), 'API address');
  apiBase = `http://127.0.0.1:${JSON.parse(fs.readFileSync(path.join(run,'api-address.json'),'utf8')).port}`;
  await waitFor(async () => { try { return (await (await fetch(`${apiBase}/health`,{signal:AbortSignal.timeout(1000)})).json()).instance_nonce === path.basename(run); } catch { return false; } }, 'isolated API health');
  context = await chromium.launchPersistentContext(path.join(run,'browser-profile'), {channel:'msedge',headless:true,env:isolatedEnv(),viewport:{width:1200,height:900},chromiumSandbox:true,timeout:30000});
  await context.addInitScript(runtime => { window.appRuntime = runtime; }, {apiBase,apiToken:token});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && [new URL(origin).port,new URL(apiBase).port].includes(url.port)) return route.continue();
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    report.external_requests.push(url.origin); return route.abort();
  });
  page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror',error => report.errors.push(error.message));
  await page.goto(`${origin}/`,{waitUntil:'domcontentloaded'});
  console.log('Checking save, reload and withdrawal through the real API...');
  await openReview();
  assert.equal(await page.getByLabel('来源类型').inputValue(),'unknown');
  await page.getByLabel('来源类型').selectOption('first_person');
  await page.getByLabel('原始来源链接').fill('https://example.com/original');
  await page.getByLabel('原文依据').fill('我参加了产品面试。');
  await saveAndVerify('first_person');
  await page.reload(); await openReview();
  assert.equal(await page.getByLabel('来源类型').inputValue(),'first_person');
  assert.equal(await page.getByLabel('原始来源链接').inputValue(),'https://example.com/original');
  assert.equal(await page.getByLabel('原文依据').inputValue(),'我参加了产品面试。');
  report.checks.push('reload restores saved review fields');
  for (const theme of ['light','dark']) for (const [width,height] of [[1200,900],[420,760]]) await capture(theme,width,height);
  await page.getByLabel('来源类型').selectOption('unknown');
  await saveAndVerify('unknown');
  await page.reload(); await openReview();
  assert.equal(await page.getByLabel('来源类型').inputValue(),'unknown');
  assert.match(await page.locator('.interview-evidence-review summary').innerText(),/已撤回/);
  assert.equal(diskReview().source_kind,'unknown');
  report.checks.push('withdrawal remains in API, SQLite and UI after reload');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#root').getAttribute('data-closed'),'true');
  report.checks.push('Escape reaches production dialog onClose');
  assert.deepEqual(report.errors,[]);
  assert.deepEqual(report.external_requests,[]);
  report.success = true;
} catch (error) {
  report.success = false; report.failure = error.stack;
  if (page) await page.screenshot({path:path.join(run,'failure.png'),fullPage:true}).catch(()=>{});
  process.exitCode = 1;
} finally {
  await context?.close().catch(error => report.errors.push(`browser cleanup: ${error.message}`));
  if(vite) await new Promise(resolve=>{vite.close(resolve);vite.closeAllConnections();});
  await stopApi();
  for (const handle of logHandles) fs.closeSync(handle);
  if (report.errors.length) { report.success = false; process.exitCode = 1; }
  fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({success:report.success,checks:report.checks.length,report:path.join(run,'report.json'),failure:report.failure || null,errors:report.errors},null,2));
}
