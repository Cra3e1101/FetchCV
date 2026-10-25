/* global URL */
import {parseHeaderOverrideJson, parseBodyOverrideJson} from './vendor/cc-switch/requestOverrides.mjs';
import {isValidUserAgentHeader} from './vendor/cc-switch/userAgent.mjs';
import {modelProfilesFor} from './model-profile.mjs';
import {resolveProviderEndpoint} from './provider-endpoint.mjs';

export const SAVED_HEADER = '[已保存]';
export const PROVIDER_FIELDS = ['providerName', 'notes', 'website', 'protocol', 'baseUrl', 'model', 'displayName', 'authMode', 'userAgent', 'requestHeaders', 'requestBody', 'modelsUrlOverride', 'modelProfiles'];
const ranges = {temperature:[0,2], top_p:[0,1], frequency_penalty:[-2,2], presence_penalty:[-2,2], seed:[-2147483648,2147483647]};
const fail = message => { throw new Error(message); };

export function normalizeRequestOptions(config = {}) {
  const authMode = config.authMode || 'auto';
  if (!['auto','bearer','x-api-key'].includes(authMode)) fail('认证方式无效');
  const userAgent = String(config.userAgent || '').trim();
  if (!isValidUserAgentHeader(userAgent) || /[^\x20-\x7e\t]/.test(userAgent)) fail('User-Agent 只能包含可见 ASCII 字符');
  const headers = parseHeaderOverrideJson(JSON.stringify(config.requestHeaders ?? {}));
  if (headers.error) fail(`请求头无效：${headers.error}`);
  if (Object.keys(headers.headers || {}).length > 32) fail('最多设置 32 个请求头');
  for (const [name, value] of Object.entries(headers.headers || {})) {
    if (name === 'user-agent') fail('User-Agent 请使用专用输入框设置');
    if (value !== SAVED_HEADER && (value.length > 4096 || /[^\x20-\x7e\t]/.test(value))) fail(`请求头 ${name} 须为不超过 4096 字符的 ASCII 文本`);
  }
  const body = parseBodyOverrideJson(JSON.stringify(config.requestBody ?? {}));
  if (body.error) fail(`请求参数无效：${body.error}`);
  for (const [key, value] of Object.entries(body.value || {})) {
    const range = Object.hasOwn(ranges,key) ? ranges[key] : null;
    if (!range) fail(`不支持覆盖 ${key}；可设置 temperature、top_p、seed、frequency_penalty、presence_penalty`);
    if (!Number.isFinite(value) || value < range[0] || value > range[1] || (key === 'seed' && !Number.isInteger(value))) fail(`${key} 须在 ${range[0]}–${range[1]} 之间${key === 'seed' ? '，且为整数' : ''}`);
    if (config.protocol === 'anthropic' && (!['temperature','top_p'].includes(key) || (key === 'temperature' && value > 1))) fail(`Anthropic 不支持当前 ${key} 设置`);
  }
  if (config.protocol === 'anthropic' && body.value?.temperature !== undefined && body.value?.top_p !== undefined) fail('Anthropic 的 temperature 和 top_p 请只设置一项');
  return {authMode, userAgent, requestHeaders:headers.headers || {}, requestBody:body.value || {}};
}

export function normalizeProviderDetails(config) {
  const website = String(config.website || '').trim();
  if (website) { let url; try { url = new URL(website); } catch { fail('官网链接无效'); }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) fail('官网链接须为 HTTP(S) 地址'); }
  return {notes:String(config.notes || '').trim().slice(0,1000), website, displayName:String(config.displayName || '').trim().slice(0,128), ...normalizeRequestOptions(config)};
}

// The same headers reach the catalogue, probe, Pi and Python extraction calls.
// null suppresses a default SDK authentication header instead of sending both.
export function providerRequestHeaders(config, {sdk = false} = {}) {
  const options = normalizeRequestOptions(config);
  if (Object.values(options.requestHeaders).includes(SAVED_HEADER)) fail('请求头需要重新填写');
  const mode = options.authMode === 'auto' ? (config.protocol === 'anthropic' ? 'x-api-key' : 'bearer') : options.authMode;
  return {
    ...(sdk ? {authorization:null, 'x-api-key':null} : {}),
    ...options.requestHeaders,
    ...(options.userAgent ? {'user-agent':options.userAgent} : {}),
    ...(config.protocol === 'anthropic' ? {'anthropic-version':'2023-06-01'} : {}),
    ...(mode === 'bearer' ? {authorization:`Bearer ${config.apiKey}`} : {'x-api-key':config.apiKey}),
  };
}

export function restoreSavedHeaders(headers, saved = {}) {
  return Object.fromEntries(Object.entries(headers).map(([name,value]) => {
    if (value !== SAVED_HEADER) return [name,value];
    if (!Object.hasOwn(saved,name)) fail(`请求头 ${name} 需要重新填写`);
    return [name,saved[name]];
  }));
}

export function providerPrivateLiterals(config, {sensitiveOnly = false} = {}) {
  const headers = Object.entries(config.requestHeaders || {}).filter(([name])=>!sensitiveOnly || /token|secret|key|authorization|cookie|credential|password/i.test(name)).map(([,value])=>value);
  return [config.apiKey,...headers].filter(value=>typeof value === 'string' && value && value !== SAVED_HEADER);
}

export function providerConfigJson(config) {
  const visible = Object.fromEntries(PROVIDER_FIELDS.map(key => [key, config[key]]).filter(([,value]) => value !== undefined));
  // Never duplicate credentials into the JSON preview or exports.
  visible.requestHeaders = Object.fromEntries(Object.keys(config.requestHeaders || {}).map(key => [key,SAVED_HEADER]));
  return JSON.stringify(visible,null,2);
}

export function applyProviderConfigJson(raw, current) {
  let parsed; try { parsed = JSON.parse(raw); } catch { fail('配置 JSON 格式错误'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('配置 JSON 须为对象');
  for (const key of Object.keys(parsed)) if (!PROVIDER_FIELDS.includes(key)) fail(`配置不支持 ${key}；密钥请在 API Key 输入框填写`);
  const next = {...current,...parsed};
  if (!['openai','anthropic'].includes(next.protocol)) fail('请选择受支持的协议');
  if (typeof next.providerName !== 'string' || !next.providerName.trim() || typeof next.model !== 'string' || !next.model.trim()) fail('连接名称和模型名称不能为空');
  resolveProviderEndpoint(next.baseUrl,next.protocol);
  const details = normalizeProviderDetails(next);
  details.requestHeaders = restoreSavedHeaders(details.requestHeaders,current.requestHeaders);
  const targetChanged = ['baseUrl','protocol','modelsUrlOverride'].some(key=>next[key] !== current[key]);
  return {...next,...details,modelProfiles:modelProfilesFor(next),...(targetChanged?{availableModels:[],modelsEndpoint:''}:{})};
}
