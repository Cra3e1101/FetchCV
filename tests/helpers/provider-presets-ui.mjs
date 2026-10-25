import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PROVIDER_PRESETS, UNSUPPORTED_PROVIDER_PRESETS} from '../../shared/provider-presets.mjs';
import {resolveProviderEndpoint} from '../../shared/provider-endpoint.mjs';

export async function verifyProviderPresets({app, page, dialog, run, savedPath, peer, report}) {
  const savedBefore = fs.readFileSync(savedPath, 'utf8');
  const requestsBefore = peer.requests.length;
  // Fail closed if a preset ever attempts an official HTTP request in the main process.
  await app.evaluate(() => {
    globalThis.__presetFetch = globalThis.fetch;
    globalThis.__presetRequests = [];
    globalThis.fetch = (...args) => {
      globalThis.__presetRequests.push(String(args[0]?.url || args[0]));
      throw new Error('Preset selection must not send HTTP requests');
    };
  });
  const pick = id => dialog.locator(`[data-preset-id="${id}"]`).click();
  try {
    await dialog.getByRole('button', {name: '新连接', exact: true}).click();
    assert.equal(await dialog.locator('[data-preset-id]').count(), PROVIDER_PRESETS.length);
    assert.equal(await dialog.locator('[data-unavailable-preset-id]').count(), UNSUPPORTED_PROVIDER_PRESETS.length);
    const copilot = dialog.locator('[data-unavailable-preset-id="github-copilot"]');
    assert(await copilot.isDisabled());
    await copilot.evaluate(button => button.click());
    assert.equal(await dialog.locator('[data-preset-id="custom"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await dialog.getByLabel('Base URL', {exact: true}).inputValue(), '');
    assert((await dialog.locator('#github-copilot-notice').innerText()).includes('尚未接入'));
    for (const preset of PROVIDER_PRESETS) {
      await pick(preset.id);
      assert.equal(await dialog.locator(`[data-preset-id="${preset.id}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await dialog.locator('[data-preset-id][aria-pressed="true"]').count(), 1);
      for (const [label, value] of [['连接名称', preset.providerName], ['官网链接', preset.website], ['Base URL', preset.baseUrl], ['模型名称', preset.model], ['API Key', '']]) {
        assert.equal(await dialog.getByLabel(label, {exact: true}).inputValue(), value, `${preset.id}: ${label}`);
      }
      await dialog.getByRole('button', {name: /^高级选项/}).click();
      if (preset.baseUrl) assert((await dialog.locator('.provider-endpoint').innerText()).includes(resolveProviderEndpoint(preset.baseUrl, preset.protocol).requestUrl));
      assert.equal(await dialog.getByLabel('上游格式', {exact: true}).inputValue(), preset.protocol);
      assert.equal(await dialog.getByLabel('认证方式', {exact: true}).inputValue(), 'auto');
      assert.equal(await dialog.getByLabel('Models URL', {exact: true}).inputValue(), preset.modelsUrlOverride || '');
      assert(await dialog.getByRole('button', {name: '保存并启用', exact: true}).isDisabled());
    }
    report.checks.push(`all ${PROVIDER_PRESETS.length - 1} supported presets and custom autofill verified fields; Copilot is clearly unavailable and cannot create a draft`);

    await pick('openai');
    await dialog.getByLabel('API Key', {exact: true}).fill('discarded-synthetic-key');
    await dialog.getByRole('button', {name: '显示 API Key', exact: true}).click();
    await dialog.getByLabel('模型名称', {exact: true}).fill('private-model');
    await dialog.getByRole('button', {name: /^高级选项/}).click();
    await dialog.getByLabel('认证方式', {exact: true}).selectOption('x-api-key');
    await dialog.getByLabel('User-Agent', {exact: true}).fill('Private/1');
    await dialog.getByLabel('Models URL', {exact: true}).fill('https://private.invalid/models');
    await dialog.getByLabel('上下文窗口（tokens）', {exact: true}).fill('32768');
    await dialog.getByLabel('Header 覆盖', {exact: true}).fill('{"X-Secret":"discarded-header"}');
    await dialog.getByLabel('Body 覆盖', {exact: true}).fill('{"temperature":0.2}');
    // Include invalid local-only JSON, which cannot be cleared by replacing form values alone.
    await dialog.getByLabel('Header 覆盖', {exact: true}).fill('{"X-Secret":"invalid-secret');
    await dialog.getByRole('button', {name: /配置 JSON/}).click();
    await dialog.getByRole('button', {name: '编辑 JSON', exact: true}).click();
    await dialog.getByLabel('配置 JSON', {exact: true}).fill('{"notes":"unapplied-secret');
    await pick('gemini');
    assert.equal(await dialog.getByLabel('API Key', {exact: true}).inputValue(), '');
    assert.equal(await dialog.getByLabel('API Key', {exact: true}).getAttribute('type'), 'password');
    await dialog.getByRole('button', {name: /^高级选项/}).click();
    for (const label of ['Header 覆盖', 'Body 覆盖', 'User-Agent', 'Models URL']) assert.equal(await dialog.getByLabel(label, {exact: true}).inputValue(), '');
    assert.equal(await dialog.getByLabel('认证方式', {exact: true}).inputValue(), 'auto');
    await dialog.getByRole('button', {name: /配置 JSON/}).click();
    const config = JSON.parse(await dialog.getByLabel('配置 JSON', {exact: true}).inputValue());
    assert.deepEqual(config.modelProfiles, {});
    assert.equal(await dialog.getByLabel('配置 JSON', {exact: true}).getAttribute('readonly'), '');
    assert.equal(await dialog.locator('[role="alert"]').count(), 0);
    report.checks.push('preset switch clears key visibility, headers, body, auth, model limits, endpoint overrides and invalid/unapplied JSON');

    await pick('custom');
    const edits = [['连接名称', '自定义测试'], ['官网链接', 'https://example.com'], ['Base URL', peer.baseUrl + '/v1'], ['模型名称', 'manual-model'], ['API Key', 'synthetic-custom']];
    for (const [label, value] of edits) await dialog.getByLabel(label, {exact: true}).fill(value);
    await dialog.getByRole('button', {name: /^高级选项/}).click();
    await dialog.getByLabel('上游格式', {exact: true}).selectOption('anthropic');
    for (const [label, value] of edits) assert.equal(await dialog.getByLabel(label, {exact: true}).inputValue(), value);
    assert.equal(await dialog.getByLabel('上游格式', {exact: true}).inputValue(), 'anthropic');
    assert(await dialog.getByRole('button', {name: '测试连接', exact: true}).isEnabled());
    await pick('bailian');
    await dialog.getByLabel('连接名称', {exact: true}).fill('我的百炼连接');
    await dialog.getByLabel('官网链接', {exact: true}).fill('https://example.com');
    await dialog.getByLabel('Base URL', {exact: true}).fill(peer.baseUrl + '/v1');
    assert.equal(await dialog.locator('[data-preset-id="bailian"]').getAttribute('aria-pressed'), 'true');
    report.checks.push('custom and official drafts remain editable; selection is tracked independently of editable name');

    await pick('opencode-go');
    for (const theme of ['white', 'neutral-dark']) {
      await page.evaluate(theme => {document.documentElement.dataset.interfaceTheme = theme; document.documentElement.dataset.colorScheme = theme === 'white' ? 'light' : 'dark'; document.querySelector('.settings-content').scrollTop = 0;}, theme);
      await page.mouse.move(50, 43);
      const screenshot = path.join(run, `presets-${theme}.png`);
      await page.screenshot({path: screenshot, animations: 'disabled'});
      report.screenshots.push(screenshot);
      const colors = await dialog.locator('[data-preset-id="opencode-go"]').evaluate(el => ({border: getComputedStyle(el).borderColor, color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor}));
      assert.notEqual(colors.color, colors.background);
      report[`presets-${theme}`] = colors;
    }
    const originalSize = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].getContentSize());
    await app.evaluate(({BrowserWindow}) => {const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(480, 500); window.setContentSize(600, 800);});
    await page.waitForFunction(() => innerWidth <= 600);
    for (const theme of ['white', 'neutral-dark']) {
      await page.evaluate(theme => {document.documentElement.dataset.interfaceTheme = theme; document.documentElement.dataset.colorScheme = theme === 'white' ? 'light' : 'dark'; document.querySelector('.settings-content').scrollTop = 0;}, theme);
      await dialog.locator('.provider-preset-picker').evaluate(el => {
        const content = el.closest('.settings-content');
        content.scrollTop += el.getBoundingClientRect().top - content.getBoundingClientRect().top - 48;
      });
      const overflow = await dialog.locator('.settings-content,.provider-preset-picker,.provider-presets,.provider-editor').evaluateAll(els => els.map(el => ({name: el.className, overflow: el.scrollWidth - el.clientWidth})));
      assert(overflow.every(row => row.overflow <= 1), JSON.stringify(overflow));
      const visibleGrid = await dialog.locator('.provider-presets').evaluate(el => {
        const footer = document.querySelector('.settings-actions').getBoundingClientRect();
        const content = el.closest('.settings-content').getBoundingClientRect();
        return [...el.children].every(button => {const box = button.getBoundingClientRect(); return box.top >= content.top && box.bottom <= footer.top;});
      });
      assert(visibleGrid, 'all preset buttons must be reachable above the fixed action bar');
      const screenshot = path.join(run, `presets-narrow-${theme}.png`);
      await page.screenshot({path: screenshot, animations: 'disabled'});
      report.screenshots.push(screenshot);
    }
    await dialog.locator('[data-preset-id="custom"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await dialog.locator('[data-preset-id="custom"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await dialog.getByLabel('Base URL', {exact: true}).inputValue(), '');
    await app.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), originalSize);
    await page.evaluate(() => {document.documentElement.dataset.interfaceTheme = 'white'; document.documentElement.dataset.colorScheme = 'light';});
    report.checks.push('light/dark preset grids at desktop and 600px have visible selection and no horizontal overflow');

    assert.equal(fs.readFileSync(savedPath, 'utf8'), savedBefore);
    assert.equal(peer.requests.length, requestsBefore);
    assert.deepEqual(await app.evaluate(() => globalThis.__presetRequests), []);
    await dialog.getByRole('button', {name: '编辑 本地验收供应商', exact: true}).click();
    assert.equal(await dialog.locator('.provider-preset-picker').count(), 0);
    assert.equal(await dialog.getByLabel('连接名称', {exact: true}).inputValue(), '本地验收供应商');
    assert.equal(await dialog.getByLabel('API Key', {exact: true}).getAttribute('placeholder'), '已安全保存；留空继续使用');
    report.checks.push('preset editing makes zero HTTP requests or saved-file changes; existing connections and active ID remain intact');
  } finally {
    await app.evaluate(() => {globalThis.fetch = globalThis.__presetFetch; delete globalThis.__presetFetch; delete globalThis.__presetRequests;});
  }
}
