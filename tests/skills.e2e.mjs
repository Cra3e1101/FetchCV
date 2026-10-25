import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright';

const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1296, height: 950 } });
  const errors = [], writes = [];
  let scanFails = false, approvalFails = false;
  const skills = ['interview-research', 'web-research'].map((name, index) => ({
    id: `skill-${index}`, name, description: '读取资料并核对来源，按工作说明处理任务。',
    enabled: false, content_hash: `hash-${index}`, path: `D:\\FetchCV\\backend\\applyos_agent\\builtin_skills\\${name}\\SKILL.md`,
    metadata_json: { available: true, source: 'builtin', shadowed_paths: [] },
  }));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://127.0.0.1:8766/**', async route => {
    const req = route.request(), url = new URL(req.url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let data = {}, status = 200;
    if (url === '/api/workspace') data = { candidates: [], jobs: [] };
    else if (url === '/api/runtime/status') data = { configured: false };
    else if (url === '/api/conversations' || url === '/api/mcp/servers') data = [];
    else if (url === '/api/settings/general') data = { theme: 'system', density: 'comfortable', accent: 'coral' };
    else if (url === '/api/settings/permissions') data = { web_access: 'allow' };
    else if (url === '/api/skills') data = skills;
    else if (url === '/api/skills/reload') {
      if (scanFails) { status = 500; data = { detail: '扫描暂时失败' }; }
      else data = skills;
    } else if (url.startsWith('/api/skills/')) {
      if (approvalFails) { status = 409; data = { detail: 'skill_content_changed' }; }
      else {
        const body = req.postDataJSON(); writes.push(body);
        data = skills.find(skill => url.endsWith(skill.id)); data.enabled = body.enabled;
      }
    }
    await route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.addInitScript(() => {
    window.appRuntime = { apiBase: 'http://127.0.0.1:8766', getBackendStatus: async () => ({ state: 'ready' }), listModelProviders: async () => ({ profiles: [] }) };
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  const switches = page.getByRole('switch');
  await switches.first().waitFor();
  assert.equal(await switches.count(), 2);
  assert.doesNotMatch(await switches.first().innerText(), /内置|SKILL.md/);
  assert.match(await switches.first().locator('strong').getAttribute('title'), /SKILL.md/);
  await switches.first().click();
  await page.getByText('1 个已启用', { exact: true }).waitFor();
  assert.deepEqual(writes[0], { enabled: true, content_hash: 'hash-0' });
  approvalFails = true;
  await switches.nth(1).click();
  await page.getByRole('alert').filter({ hasText: 'Skill 内容已变化' }).waitFor();
  assert.equal(await switches.nth(1).getAttribute('aria-checked'), 'false');
  scanFails = true;
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '扫描暂时失败' }).waitFor();
  assert.equal(await switches.count(), 2);
  scanFails = false;
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  await page.getByRole('button', { name: '重新扫描', exact: true }).waitFor();
  const output = path.resolve('artifacts/skills-settings');
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'skills.png') });
  assert.deepEqual(errors, []);
  console.log('Skills UI: compact rows, path tooltips, hash-bound toggle, conflict and scan error recovery passed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
