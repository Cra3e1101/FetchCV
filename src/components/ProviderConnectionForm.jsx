import {useEffect, useState} from 'react';
import {Check, ChevronDown, Clipboard, Code2, Eye, EyeOff, Link, LoaderCircle, RefreshCw, Search} from 'lucide-react';
import {ModelParameters} from './ModelParameters';
import {AnimatedCollapse} from '../ui/AnimatedCollapse';
import {resolveProviderEndpoint} from '../../shared/provider-endpoint.mjs';
import {resolveModelProfile} from '../../shared/model-profile.mjs';
import {applyProviderConfigJson, normalizeRequestOptions, providerConfigJson} from '../../shared/provider-settings.mjs';
import './ProviderConnectionForm.css';

function JsonField({label, value, onChange, onError, placeholder}) {
  const encoded = Object.keys(value || {}).length ? JSON.stringify(value,null,2) : '';
  const [text,setText] = useState(encoded);
  const [error,setError] = useState('');
  useEffect(() => {setText(encoded); setError(''); onError('');},[encoded]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = raw => {
    setText(raw);
    try { const parsed = raw.trim() ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('请输入 JSON 对象');
      onChange(parsed); setError(''); onError('');
    } catch {setError('请输入有效的 JSON 对象'); onError('JSON 格式错误');}
  };
  return <label className="provider-json-field"><span>{label}</span><textarea aria-label={label} spellCheck={false} value={text} onChange={event=>change(event.target.value)} placeholder={placeholder} aria-invalid={!!error}/>{error && <small role="alert">{error}</small>}</label>;
}

export function ProviderConnectionForm({form, setForm, update, busy, showKey, setShowKey, pasteApiKey, handleKeyPaste, handlePaste, canDiscover, fetchingModels, discoverModels, modelQuery, setModelQuery, modelOptions, onValidityChange, modelHint}) {
  const [advanced,setAdvanced] = useState(false);
  const [jsonOpen,setJsonOpen] = useState(false);
  const [jsonDraft,setJsonDraft] = useState(null);
  const [jsonError,setJsonError] = useState('');
  const [fieldErrors,setFieldErrors] = useState({});
  let endpoint='', endpointError='', optionError='', needsProfile=false;
  if (form.baseUrl) { try {endpoint=resolveProviderEndpoint(form.baseUrl,form.protocol).requestUrl;} catch {endpointError='请输入有效地址，不含账号密码、查询参数或片段';} }
  try {normalizeRequestOptions(form);} catch(error) {optionError=error.message;}
  if(form.model) {try {needsProfile=!resolveModelProfile(form,{strict:false}).contextWindow;}catch {needsProfile=true;}}
  const valid = !endpointError && !optionError && !Object.values(fieldErrors).some(Boolean) && jsonDraft === null;
  useEffect(()=>onValidityChange(valid),[valid,onValidityChange]);
  const markError = field => error => setFieldErrors(current=>current[field] === error ? current : {...current,[field]:error});
  const applyJson = () => {
    try {setForm(applyProviderConfigJson(jsonDraft,form)); setJsonDraft(null);setJsonError('');}
    catch(error) {setJsonError(error.message);}
  };
  const changeProtocol = protocol => setForm(current=>({...current,protocol,availableModels:[],modelsEndpoint:''}));
  return <fieldset className="provider-editor" disabled={busy}>
    <div className="provider-basics">
      <label><span>连接名称</span><input aria-label="连接名称" value={form.providerName} onChange={event=>update('providerName',event.target.value)} placeholder="例如 DeepSeek" /></label>
      <label><span>备注</span><input aria-label="备注" value={form.notes || ''} onChange={event=>update('notes',event.target.value)} placeholder="可选" /></label>
      <label className="full"><span>官网链接</span><input aria-label="官网链接" type="url" value={form.website || ''} onChange={event=>update('website',event.target.value)} placeholder="https://example.com（可选）" /></label>
      <label className="full"><span>API Key</span><div className="provider-key"><input aria-label="API Key" type={showKey?'text':'password'} autoComplete="off" spellCheck={false} value={form.apiKey} onKeyDown={handleKeyPaste} onPaste={handlePaste} onChange={event=>update('apiKey',event.target.value)} placeholder={form.hasApiKey?'已安全保存；留空继续使用':'粘贴 API Key'} /><button type="button" onClick={pasteApiKey} aria-label="粘贴 API Key"><Clipboard size={16}/></button><button type="button" onClick={()=>setShowKey(!showKey)} aria-label={showKey?'隐藏 API Key':'显示 API Key'}>{showKey?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></label>
      <label className="full"><span>请求地址 <small>{form.protocol==='anthropic'?'Anthropic Messages':'OpenAI Chat Completions'}</small></span><input aria-label="Base URL" title="支持 Base URL 或标准协议的完整请求地址" value={form.baseUrl} onChange={event=>update('baseUrl',event.target.value)} placeholder={form.protocol==='anthropic'?'https://api.example.com':'https://api.example.com/v1'} /></label>
      {endpointError && <p className="provider-field-error full" role="alert">{endpointError}</p>}
      <div className="provider-model-heading full"><strong>模型</strong><button type="button" onClick={discoverModels} disabled={!canDiscover || fetchingModels}>{fetchingModels?<LoaderCircle className="spin" size={14}/>:<RefreshCw size={14}/>}读取模型</button></div>
      <label><span>模型 ID</span><input aria-label="模型名称" value={form.model} onChange={event=>update('model',event.target.value)} placeholder="支持工具调用的模型 ID" /></label>
      <label><span>显示名称</span><input aria-label="显示名称" value={form.displayName || ''} onChange={event=>update('displayName',event.target.value)} placeholder="默认显示模型 ID" /></label>
      {!form.id && modelHint && <small className="provider-model-help full">{modelHint}</small>}
      {needsProfile && <button type="button" className="provider-profile-needed full" onClick={()=>setAdvanced(true)}>未识别上下文窗口，展开高级选项填写模型参数</button>}
    </div>

    {!!form.availableModels?.length && <section className="model-catalog"><header><div><strong>服务提供的模型</strong><small>{form.availableModels.length} 个</small></div><label><Search size={13}/><input aria-label="搜索模型" value={modelQuery} onChange={event=>setModelQuery(event.target.value)} placeholder="搜索模型"/></label></header><div>{modelOptions.map(item=><button type="button" key={item.id} className={form.model===item.id?'active':''} onClick={()=>update('model',item.id)}><span>{item.id}</span>{item.ownedBy && <small>{item.ownedBy}</small>}{form.model===item.id && <Check size={13}/>}</button>)}</div>{modelQuery && !modelOptions.length && <p>没有匹配的模型</p>}</section>}

    <section className="provider-advanced-panel">
      <button type="button" className="provider-disclosure" aria-expanded={advanced} aria-controls="provider-advanced-body" onClick={()=>setAdvanced(!advanced)}><ChevronDown size={16} className={advanced?'is-open':''}/><span><strong>高级选项</strong></span></button>
      <AnimatedCollapse open={advanced} id="provider-advanced-body"><div className="provider-advanced-content">
        <label><span>上游格式</span><select aria-label="上游格式" value={form.protocol} onChange={event=>changeProtocol(event.target.value)}><option value="openai">OpenAI Chat Completions</option><option value="anthropic">Anthropic Messages</option></select></label>
        {endpoint && <div className="provider-endpoint"><Link size={14}/><span>实际请求：<code>{endpoint}</code></span></div>}
        <label><span>认证方式</span><select aria-label="认证方式" value={form.authMode || 'auto'} onChange={event=>update('authMode',event.target.value)}><option value="auto">协议默认（{form.protocol==='anthropic'?'x-api-key':'Bearer Token'}）</option><option value="bearer">Authorization: Bearer</option><option value="x-api-key">x-api-key</option></select></label>
        {form.model && <ModelParameters provider={form} onChange={profiles=>update('modelProfiles',profiles)}/>}
        <label><span>模型列表地址</span><input aria-label="Models URL" value={form.modelsUrlOverride} onChange={event=>update('modelsUrlOverride',event.target.value)} placeholder="自动从请求地址推导" /></label>
        <label><span>User-Agent</span><input aria-label="User-Agent" value={form.userAgent || ''} onChange={event=>update('userAgent',event.target.value)} placeholder="使用 SDK 默认值" /></label>
        <div className="provider-overrides-heading"><strong>请求覆盖</strong></div>
        <div className="provider-overrides">
          <JsonField label="Header 覆盖" value={form.requestHeaders} onChange={value=>update('requestHeaders',value)} onError={markError('headers')} placeholder={'{\n  "X-Title": "FetchCV"\n}'}/>
          <JsonField label="Body 覆盖" value={form.requestBody} onChange={value=>update('requestBody',value)} onError={markError('body')} placeholder={'{\n  "temperature": 0.2\n}'}/>
        </div>
        <details className="settings-help"><summary>支持的参数<ChevronDown size={12}/></summary><p>temperature、top_p、seed、frequency_penalty、presence_penalty；可用范围依协议而定。模型、消息、工具与输出上限由 Agent 管理。</p></details>
        {optionError && <p className="provider-field-error" role="alert">{optionError}</p>}
      </div></AnimatedCollapse>
    </section>

    <section className="provider-config-section">
      <button type="button" className="provider-disclosure" aria-expanded={jsonOpen} onClick={()=>setJsonOpen(!jsonOpen)}><Code2 size={16}/><span><strong>配置 JSON</strong></span><ChevronDown size={16} className={jsonOpen?'is-open':''}/></button>
      <AnimatedCollapse open={jsonOpen}><div className="provider-config-content">
        <p className="provider-field-help">API Key 不导出，请求头值已隐藏。</p>
        <textarea aria-label="配置 JSON" spellCheck={false} readOnly={jsonDraft===null} value={jsonDraft===null?providerConfigJson(form):jsonDraft} onChange={event=>{setJsonDraft(event.target.value);setJsonError('');}} />
        <div className="provider-json-actions">{jsonDraft===null?<button type="button" onClick={()=>setJsonDraft(providerConfigJson(form))}>编辑 JSON</button>:<><button type="button" onClick={()=>{setJsonDraft(null);setJsonError('');}}>取消编辑</button><button type="button" onClick={applyJson}>应用到表单</button></>}</div>
        {jsonError && <p role="alert">{jsonError}</p>}
      </div></AnimatedCollapse>
    </section>
  </fieldset>;
}
