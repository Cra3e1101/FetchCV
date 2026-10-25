import test from 'node:test';
import assert from 'node:assert/strict';
import {PROVIDER_PRESETS, UNSUPPORTED_PROVIDER_PRESETS, createProviderDraft} from '../shared/provider-presets.mjs';
import {resolveProviderEndpoint} from '../shared/provider-endpoint.mjs';
import {buildModelsUrlCandidates} from '../electron/provider-utils.mjs';
import {normalizeRequestOptions} from '../shared/provider-settings.mjs';

test('official templates resolve through the two supported protocols without deployment placeholders', () => {
  const requests = {
    openai: 'https://api.openai.com/v1/chat/completions',
    anthropic: 'https://api.anthropic.com/v1/messages',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions',
    bailian: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    ark: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    hunyuan: 'https://tokenhub.tencentmaas.com/v1/chat/completions',
    qianfan: 'https://qianfan.baidubce.com/v2/chat/completions',
    kimi: 'https://api.moonshot.cn/v1/chat/completions',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    minimax: 'https://api.minimax.cn/anthropic/v1/messages',
    mimo: 'https://api.xiaomimimo.com/v1/chat/completions',
    'opencode-go': 'https://opencode.ai/inference/go/openai/v1/chat/completions',
    xai: 'https://api.x.ai/v1/chat/completions',
  };
  assert.deepEqual(new Set(PROVIDER_PRESETS.map(row => row.id)), new Set([...Object.keys(requests), 'custom']));
  for (const [id, requestUrl] of Object.entries(requests)) {
    const draft = createProviderDraft(id);
    assert.equal(resolveProviderEndpoint(draft.baseUrl, draft.protocol).requestUrl, requestUrl);
    assert.deepEqual(normalizeRequestOptions(draft).requestHeaders, {});
    assert.deepEqual(draft.modelProfiles, {});
    assert.equal(draft.health, 'unknown');
    assert.equal(draft.latencyMs, null);
    assert.equal(draft.hasApiKey, false);
  }
  assert.equal(createProviderDraft('ark').model, '');
  assert.equal(createProviderDraft('gemini').protocol, 'openai');
  assert.throws(() => createProviderDraft('responses'), /未知/);
});

test('Go has a dedicated discovery endpoint; ordinary API drafts do not inherit plan settings', () => {
  const go = createProviderDraft('opencode-go');
  assert.deepEqual(buildModelsUrlCandidates(go.baseUrl, go), ['https://opencode.ai/inference/go/v1/models']);
  for (const id of ['mimo', 'xai', 'custom']) {
    const next = createProviderDraft(id);
    assert.equal(next.modelsUrlOverride, '');
    assert.equal(next.model, '');
    assert.deepEqual(next.modelProfiles, {});
  }
});

test('Copilot is an unsupported capability notice, never an API-key connection draft', () => {
  assert.equal(UNSUPPORTED_PROVIDER_PRESETS.find(row => row.id === 'github-copilot')?.scope, '暂不支持直连');
  assert.throws(() => createProviderDraft('github-copilot'), /未知/);
  assert(UNSUPPORTED_PROVIDER_PRESETS.every(row => !row.baseUrl && !row.model && !row.protocol));
});

test('switching drafts cannot carry credentials, encrypted identity, metadata or request overrides', () => {
  const previous = createProviderDraft('openai');
  Object.assign(previous, {id: 'saved', apiKey: 'secret', hasApiKey: true, encryptedApiKey: 'cipher', userAgent: 'Private gateway', health: 'healthy'});
  previous.requestHeaders['x-secret'] = 'header-secret';
  previous.requestBody.temperature = 1;
  previous.availableModels.push({id: 'private-model', contextWindow: 32768});
  previous.modelProfiles['private-model'] = {contextWindow: 32768};
  for (const preset of PROVIDER_PRESETS) {
    const next = createProviderDraft(preset.id);
    assert.equal(next.id, '');
    assert.equal(next.apiKey, '');
    assert.equal(next.hasApiKey, false);
    assert.equal(next.encryptedApiKey, undefined);
    assert.equal(next.userAgent, '');
    assert.deepEqual(next.requestHeaders, {});
    assert.deepEqual(next.requestBody, {});
    assert.deepEqual(next.availableModels, []);
    assert.deepEqual(next.modelProfiles, {});
    assert.equal(next.health, 'unknown');
  }
  assert.equal(previous.requestHeaders['x-secret'], 'header-secret');
  const custom = createProviderDraft();
  assert.equal(custom.providerName, '');
  assert.equal(custom.website, '');
  assert.equal(custom.baseUrl, '');
  assert.equal(custom.model, '');
  custom.requestHeaders.test = 'draft-only';
  assert.deepEqual(createProviderDraft().requestHeaders, {});
});
