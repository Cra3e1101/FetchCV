import {assertProviderCompletion} from './provider-failure.mjs';
import {compatiblePayload} from './compatible-payload.mjs';
import {createProviderAdapter, thinkingOptions, THINKING_LEVEL} from './provider-adapter.mjs';

// No business tools or user data. This exercises the same SDK, endpoint,
// authentication and compatibility profile as the real runtime.
export async function probeProvider(provider,{modules,signal}={}) {
  const [ai,openai,anthropic]=modules??await Promise.all([import('@earendil-works/pi-ai'),import('@earendil-works/pi-ai/api/openai-completions.lazy'),import('@earendil-works/pi-ai/api/anthropic-messages.lazy')]);
  const {model:configuredModel,models,streamOptions}=createProviderAdapter(provider,ai,openai,anthropic);
  const model={...configuredModel,maxTokens:Math.min(configuredModel.maxTokens,4096)};
  const context={systemPrompt:'Connection diagnostic. Call connection_probe once with value OK. After its result, reply OK.',
    messages:[{role:'user',content:'Test the connection.',timestamp:Date.now()}],
    tools:[{name:'connection_probe',description:'A harmless local diagnostic echo. No external operation.',parameters:{type:'object',properties:{value:{type:'string',enum:['OK']}},required:['value'],additionalProperties:false}}]};
  const options={...streamOptions,...thinkingOptions(model),signal,maxRetries:0,
    reasoning:THINKING_LEVEL[provider.thinkingLevel] || 'medium',
    onPayload:payload=>compatiblePayload(payload,provider)};
  const first=await models.streamSimple(model,context,options).result();
  assertProviderCompletion(first);
  const calls=first.content.filter(p=>p.type==='toolCall');
  if(!calls.length){
    if(!first.content.some(p=>p.type==='text'&&p.text.trim()))throw new Error('模型没有返回有效文本或工具调用');
    return {conversation:true,tools:'unverified',message:'对话连接成功；模型未执行诊断工具，工具能力待确认'};
  }
  if(calls.length!==1||calls[0].name!=='connection_probe'||calls[0].arguments?.value!=='OK')throw new Error('诊断工具参数无效');
  context.messages.push(first,{role:'toolResult',toolCallId:calls[0].id,toolName:'connection_probe',content:[{type:'text',text:'OK'}],isError:false,timestamp:Date.now()});
  const second=await models.streamSimple(model,context,options).result();
  assertProviderCompletion(second);
  if(second.stopReason!=='stop'||!second.content.some(p=>p.type==='text'&&p.text.trim()))throw new Error('工具结果回传后未得到完整回答');
  return {conversation:true,tools:'verified',message:'对话连接成功；基础工具往返已验证'};
}
