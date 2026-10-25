// Real desktop, IPC, SDK and isolated database; localhost synthetic provider only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {_electron as electron} from 'playwright';
import {resolveElectronRuntime} from '../scripts/electron-runtime.mjs';
import {findFreePort} from '../electron/sidecar.mjs';
import {startProviderSettingsPeer} from './helpers/provider-settings-peer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const evidence = path.join(root, '.m1-evidence', 'agent-continuity');
fs.mkdirSync(evidence, {recursive: true});
const run = fs.mkdtempSync(path.join(evidence, 'desktop-'));
const probe = await startProviderSettingsPeer();
const pending = [];
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const part of req) raw += part;
  const body = raw ? JSON.parse(raw) : {};
  if (body.tools?.some(tool => tool.function?.name === 'connection_probe')) {
    const response = await fetch(probe.baseUrl + req.url, {method: 'POST', headers: {'content-type': 'application/json'}, body: raw});
    res.writeHead(response.status, {'content-type': 'text/event-stream'}); res.end(await response.text()); return;
  }
  res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'}); res.flushHeaders();
  const emit = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({id: 'synthetic-delayed', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{index: 0, delta, finish_reason}]})}\n\n`);
  emit({role: 'assistant'});
  const item = {closed: false, body, release(text) {emit({content: text}); emit({}, 'stop'); res.end('data: [DONE]\n\n');}};
  pending.push(item); res.on('close', () => {if (!res.writableEnded) item.closed = true;});
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FETCHCV_|^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY)$/.test(key)));
Object.assign(env, {FETCHCV_E2E_USER_DATA: path.join(run, 'user-data'), FETCHCV_API_PORT: String(await findFreePort()), PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8'});
const report = {run, isolated: true, provider: 'localhost synthetic SSE only', checks: [], errors: []};
let app, page;
try {
  app = await electron.launch({executablePath: (await resolveElectronRuntime({projectRoot: root})).executable, args: [root], cwd: root, env, timeout: 45000});
  assert.equal(await app.evaluate(({app}) => app.getPath('userData')), env.FETCHCV_E2E_USER_DATA);
  page = await app.firstWindow(); page.setDefaultTimeout(25000); page.on('pageerror', error => report.errors.push(error.message));
  const ready = async () => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const status = await page.evaluate(() => window.appRuntime?.getBackendStatus?.());
      if (status?.agentReady) return;
      await page.waitForTimeout(250);
    }
    throw new Error('isolated backend did not become ready');
  };
  await ready();
  await page.evaluate(baseUrl => window.appRuntime.saveModelProvider({providerName: '合成延迟接口', protocol: 'openai', baseUrl, apiKey: 'synthetic-key', model: 'test-model', contextWindow: 131072, maxOutputTokens: 4096, modelProfiles: {'test-model': {contextWindow: 131072, maxOutputTokens: 4096}}, activate: true}), baseUrl);
  await page.reload(); await ready();
  const question = '桌面对话切换合成验收';
  await page.getByRole('textbox', {name: '消息', exact: true}).fill(question);
  await page.getByRole('textbox', {name: '消息', exact: true}).press('Enter');
  await page.locator('.processing-disclosure.running').waitFor();
  await page.getByRole('button', {name: question, exact: true}).waitFor();
  await page.getByRole('button', {name: '新对话', exact: true}).click();
  await page.getByRole('heading', {name: '想聊些什么？', exact: true}).waitFor();
  await page.waitForTimeout(1600);
  assert.equal(pending.length, 1); assert.equal(pending[0].closed, false);
  await page.getByRole('button', {name: question, exact: true}).click();
  await page.locator('.processing-disclosure.running').waitFor();
  await page.getByRole('button', {name: '停止生成', exact: true}).waitFor();
  assert.equal(pending.length, 1);
  report.checks.push('real IPC/SDK request remains open after switching and returning; no duplicate request');
  await page.screenshot({path: path.join(run, 'returned-running.png')});
  await page.getByRole('button', {name: '新对话', exact: true}).click();
  pending[0].release('后台任务已完成。来源：[合成官网](https://example.org/source)。');
  await page.waitForTimeout(1200);
  await page.getByRole('button', {name: question, exact: true}).click();
  await page.locator('.agent-markdown').getByRole('link', {name: '合成官网', exact: true}).waitFor();
  await page.waitForFunction(() => !document.querySelector('.source-composer.working'));
  assert.equal(await page.locator('.agent-message.user').count(), 1);
  assert.equal(await page.locator('.agent-message.assistant').count(), 1);
  report.checks.push('completion while detached restores one persisted user/assistant pair and source link');
  await page.reload(); await ready();
  await page.getByRole('button', {name: question, exact: true}).click();
  await page.locator('.agent-markdown').getByRole('link', {name: '合成官网', exact: true}).waitFor();
  report.checks.push('completed reply and clickable source survive renderer reload through the isolated database');
  await page.screenshot({path: path.join(run, 'persisted-answer.png')});
  const input = page.getByRole('textbox', {name: '消息', exact: true});
  await input.fill('主动停止合成验收'); await input.press('Enter');
  await page.locator('.processing-disclosure.running').waitFor();
  await page.waitForTimeout(800);
  assert.equal(pending.length, 2);
  await page.getByRole('button', {name: '新对话', exact: true}).click();
  await page.getByRole('button', {name: question, exact: true}).click();
  await page.getByRole('button', {name: '停止生成', exact: true}).click();
  await page.waitForFunction(() => !document.querySelector('.source-composer.working'));
  assert.equal(pending[1].closed, true);
  report.checks.push('explicit stop after returning cancels only the selected native request');
  assert.deepEqual(report.errors, []); report.success = true;
} catch (error) {
  report.error = error.stack;
  if (page && !page.isClosed()) {await page.screenshot({path: path.join(run, 'failure.png')}); fs.writeFileSync(path.join(run, 'failure.txt'), await page.locator('body').innerText());}
  throw error;
} finally {
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await probe.close();
  console.log(JSON.stringify(report));
}
