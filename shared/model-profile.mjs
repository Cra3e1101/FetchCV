import catalogue from './model-catalog.mjs';
import {resolveProviderEndpoint} from './provider-endpoint.mjs';

const LIMIT = 10000000;
const fail = message => { throw Object.assign(new Error(message), {code:'invalid_model_profile'}); };
const blank = value => value === undefined || value === null || value === '';
function integer(value, field) {
  if(blank(value))return undefined;
  const n=typeof value==='string'&&/^\d+$/.test(value.trim())?Number(value):value;
  if(!Number.isSafeInteger(n)||n<1||n>LIMIT)fail(`${field}须为 1–10,000,000 的整数`);
  return n;
}
function endpoint(value, protocol) {
  try {
    return resolveProviderEndpoint(value, protocol).catalogueKey;
  } catch {return null;}
}
const COMPAT_BOOL=new Set(['supportsStore','supportsDeveloperRole','supportsReasoningEffort','supportsUsageInStreaming','requiresToolResultName','requiresAssistantAfterToolResult','requiresThinkingAsText','requiresReasoningContentOnAssistantMessages','supportsStrictMode']);
const COMPAT_ENUM={maxTokensField:['max_completion_tokens','max_tokens'],thinkingFormat:['openai','openrouter','deepseek','together','zai','qwen','chat-template','qwen-chat-template','string-thinking','ant-ling']};
export function normalizeCompat(value) {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))fail('兼容参数须为对象');
  for(const [key,item] of Object.entries(value)) {
    if(COMPAT_BOOL.has(key)){if(typeof item!=='boolean')fail(`兼容参数 ${key} 须为布尔值`);}
    else if(!COMPAT_ENUM[key]?.includes(item))fail(`不支持的兼容参数 ${key}`);
  }
  return {...value};
}
export function normalizeModelProfiles(profiles={}) {
  if(!profiles||typeof profiles!=='object'||Array.isArray(profiles)||Object.keys(profiles).length>500)fail('模型参数列表无效');
  return Object.fromEntries(Object.entries(profiles).map(([id,row])=>{
    if(!id.trim()||id.length>256||!row||typeof row!=='object'||Array.isArray(row))fail('模型参数无效');
    const contextWindow=integer(row.contextWindow,'上下文窗口'),maxOutputTokens=integer(row.maxOutputTokens,'最大输出');
    if(row.reasoning!==undefined&&typeof row.reasoning!=='boolean')fail('推理支持设置无效');
    const compat=normalizeCompat(row.compat);
    if(row.input!==undefined&&(!Array.isArray(row.input)||!row.input.includes('text')||row.input.some(x=>!['text','image'].includes(x))))fail('输入类型须包含 text，可选 image');
    return [id,{...(compat===undefined?{}:{compat}),...(row.input===undefined?{}:{input:[...new Set(row.input)]}),...(contextWindow===undefined?{}:{contextWindow}),...(maxOutputTokens===undefined?{}:{maxOutputTokens}),...(row.reasoning===undefined?{}:{reasoning:row.reasoning})}];
  }));
}
export function modelProfilesFor(provider) {
  const profiles=normalizeModelProfiles(provider.modelProfiles??{});
  // Migrate the old single-model fields into the model they were saved with.
  if(provider.model&&!Object.hasOwn(profiles,provider.model)&&(!blank(provider.contextWindow)||!blank(provider.maxOutputTokens)))
    return {...profiles,...normalizeModelProfiles({[provider.model]:{contextWindow:provider.contextWindow,maxOutputTokens:provider.maxOutputTokens}})};
  return profiles;
}
export function parseModelMetadata(row) {
  const result={};
  for(const [key,raw] of Object.entries({
    contextWindow:row?.contextWindow??row?.context_length??row?.context_window??row?.limit?.context,
    maxOutputTokens:row?.maxOutputTokens??row?.max_output_tokens??row?.top_provider?.max_completion_tokens??row?.limit?.output,
  })) {try {const value=integer(raw,key);if(value!==undefined)result[key]=value;}catch{/* Invalid third-party metadata is never a runtime limit. */}}
  if(typeof row?.reasoning==='boolean')result.reasoning=row.reasoning;
  return result;
}
export function resolveModelProfile(provider,{strict=true}={}) {
  const manual=modelProfilesFor(provider)[provider.model]??{};
  const address=endpoint(provider.baseUrl,provider.protocol);
  const builtin=address?catalogue.find(m=>m.id===provider.model&&m.protocol===(provider.protocol||'openai')&&endpoint(m.baseUrl,m.protocol)===address):undefined;
  const listed=(provider.availableModels??[]).find(m=>m?.id===provider.model);
  const metadata=parseModelMetadata(listed);
  const contextWindow=manual.contextWindow??metadata.contextWindow??builtin?.contextWindow;
  const source=manual.contextWindow!==undefined?'manual':metadata.contextWindow!==undefined?'provider':builtin?'catalogue':'unknown';
  const ceiling=metadata.maxOutputTokens??builtin?.maxOutputTokens;
  const maxOutputTokens=manual.maxOutputTokens??Math.min(16384,ceiling??8192,contextWindow?Math.floor(contextWindow/4):8192);
  if(contextWindow!==undefined&&(contextWindow<4096||maxOutputTokens<1||maxOutputTokens>=contextWindow-1024))fail('上下文至少 4096 tokens，输出须小于上下文减去 1024 tokens');
  if(strict&&contextWindow===undefined)throw Object.assign(new Error('未识别此模型的上下文窗口，请在设置 → 模型 API 中填写模型参数'),{code:'model_profile_required'});
  return {contextWindow:contextWindow??null,maxOutputTokens,input:manual.input??["text"],compat:manual.compat??{},reasoning:manual.reasoning??metadata.reasoning??builtin?.reasoning??false,source,
    profileRevision:`model-profile-v2:${source}`,outputSource:manual.maxOutputTokens!==undefined?'manual':'automatic'};
}
