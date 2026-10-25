import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

const project = path.resolve(import.meta.dirname, '..');
const build = path.join(project, process.argv[2] || 'dist');
const candidate = {id:'c1',name:'设置导航用户',title:'产品经理',resume_count:1,material_count:0};
const job = {id:'j1',candidate_id:'c1',company:'星云科技',role:'AI 产品经理',jd_raw:'构建知识库产品。'};
const runtime = {configured:true,provider_id:'p1',provider_name:'合成连接',model:'test-model'};

const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(build, relative);
  if (file !== build && !file.startsWith(`${build}${path.sep}`)) { response.writeHead(403).end(); return; }
  try {
    const content = await fs.readFile(file);
    const type = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff':'font/woff','.woff2':'font/woff2'}[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, {'content-type':type}); response.end(content);
  } catch { response.writeHead(404).end(); }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1360,height:840}});
  await page.route('http://127.0.0.1:8766/**', async route => {
    const request = route.request(); const pathname = new URL(request.url()).pathname; let data;
    if (pathname === '/api/conversations') data = [];
    else if (pathname === '/api/interview-knowledge') data = {sources:[],briefs:[{id:'b1',company:'面经测试公司',role:'产品经理',summary:'合成面经',source_ids:[]}]};
    else if (pathname === '/api/workspace') data = {candidates:[candidate],jobs:[job]};
    else if (pathname === '/api/runtime/status') data = runtime;
    else if (pathname === '/api/candidates/c1/library') data = {candidate,experiences:[],resumes:[],materials:[],facts:[],interview_sources:[],interview_briefs:[]};
    else if (pathname === '/api/settings/general') data = {theme:'system',accent:'coral',density:'comfortable'};
    else if (pathname === '/api/settings/permissions') data = {web_access:'allow',browser_bridge:'allow',workspace_read:'allow',workspace_write:'ask',file_delete:'ask'};
    else if (pathname === '/api/skills' || pathname === '/api/mcp/servers') data = [];
    else return route.fulfill({status:404,contentType:'application/json',body:'{}'});
    await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
  });
  await page.addInitScript(() => { window.appRuntime = {
    apiBase:'http://127.0.0.1:8766',
    getBackendStatus:async()=>({state:'ready',dataReady:true,agentReady:true}),
    listModelProviders:async()=>({activeId:'p1',profiles:[{id:'p1',providerName:'合成连接',model:'test-model',protocol:'openai',baseUrl:'https://example.invalid/v1',hasApiKey:true}]}),
  }; });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading',{name:'想聊些什么？'}).waitFor();

  const settings = page.getByRole('button',{name:'设置',exact:true});
  await settings.click(); await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();
  assert.equal(await settings.getAttribute('aria-current'),'page');
  const [railBounds,backdropBounds] = await Promise.all([page.locator('.workspace-rail').boundingBox(),page.locator('.model-settings-backdrop').boundingBox()]);
  assert.ok(backdropBounds.x >= railBounds.x + railBounds.width, '设置遮罩不得覆盖全局导航');

  await page.getByRole('button',{name:'我的资料',exact:true}).click();
  await page.getByRole('heading',{name:'个人资料库',exact:true}).waitFor();
  await page.getByRole('heading',{name:'设置导航用户',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'设置',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'我的资料',exact:true}).getAttribute('aria-current'),'page');

  await settings.click(); await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();
  await page.getByRole('button',{name:'面试知识',exact:true}).click();
  await page.getByText('面经测试公司',{exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'设置',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'面试知识',exact:true}).getAttribute('aria-current'),'page');

  await page.setViewportSize({width:390,height:840}); await settings.click();
  await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '窄屏设置页不应产生横向滚动');
  console.log('PASS: settings keeps the global rail interactive and routes to both libraries.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
