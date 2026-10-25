import {resolveModelProfile} from '../../shared/model-profile.mjs';

export function ModelParameters({provider,onChange}) {
  const manual=provider.modelProfiles?.[provider.model]??{};
  let resolved,error;
  try {resolved=resolveModelProfile(provider,{strict:false});}catch(e){error=e.message;}
  const update=(key,value)=>onChange({...provider.modelProfiles,[provider.model]:{...manual,[key]:value}});
  const source={manual:'手动设置',provider:'服务商返回',catalogue:'离线目录 · 请核对',unknown:'待填写'};
  return <fieldset className="full model-parameters">
    <legend>模型参数</legend>
    <p className="model-parameter-source" role="status">{resolved?.contextWindow?source[resolved.source]:'未识别窗口，请填写服务商提供的数值'}</p>
    <div className="model-form">
      <label><span>上下文窗口（tokens）</span><input aria-label="上下文窗口（tokens）" type="number" min="4096" max="10000000" step="1" value={manual.contextWindow??''} placeholder={String(resolved?.contextWindow??'例如 128000')} onChange={e=>update('contextWindow',e.target.value)}/></label>
      <label><span>最大输出（tokens）</span><input aria-label="最大输出（tokens）" type="number" min="1" max="10000000" step="1" value={manual.maxOutputTokens??''} placeholder={String(resolved?.maxOutputTokens??8192)} onChange={e=>update('maxOutputTokens',e.target.value)}/></label>
      <label><span>推理模式</span><select aria-label="推理模式支持" value={manual.reasoning===undefined?'auto':String(manual.reasoning)} onChange={e=>update('reasoning',e.target.value==='auto'?undefined:e.target.value==='true')}><option value="auto">自动识别</option><option value="true">支持</option><option value="false">不支持</option></select></label>
      <label><span>图片输入</span><select value={manual.input?.includes('image')?'image':'text'} onChange={e=>update('input',e.target.value==='image'?['text','image']:['text'])}><option value="text">仅文本</option><option value="image">文本与图片（服务商已支持）</option></select></label>
      {provider.protocol!=='anthropic'&&<>
        <label><span>输出上限字段</span><select value={manual.compat?.maxTokensField??''} onChange={e=>{const compat={...manual.compat};if(e.target.value)compat.maxTokensField=e.target.value;else delete compat.maxTokensField;update('compat',compat);}}><option value="">自动</option><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></select></label>
        <label><span>推理协议格式</span><select value={manual.compat?.thinkingFormat??''} onChange={e=>{const compat={...manual.compat};if(e.target.value)compat.thinkingFormat=e.target.value;else delete compat.thinkingFormat;update('compat',compat);}}><option value="">自动</option>{['openai','openrouter','deepseek','together','zai','qwen','qwen-chat-template','string-thinking','ant-ling'].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
        {['supportsDeveloperRole','supportsReasoningEffort','supportsUsageInStreaming','supportsStrictMode'].map((key,index)=><label key={key}><span>{['developer 角色','reasoning_effort 参数','流式用量','严格工具 Schema'][index]}</span><select value={manual.compat?.[key]===undefined?'auto':String(manual.compat[key])} onChange={e=>{const compat={...manual.compat};if(e.target.value==='auto')delete compat[key];else compat[key]=e.target.value==='true';update('compat',compat);}}><option value="auto">自动</option><option value="true">支持</option><option value="false">不支持</option></select></label>)}
      </>}
    </div>
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}
