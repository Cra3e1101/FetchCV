import {ContractError} from '../../packages/contracts/runtime.mjs';

// SDK exceptions can echo prompts, keys and full response bodies. Classify them
// here; neither the raw exception nor arbitrary provider text is public output.
export function providerFailure(error) {
  if(error?.name==='AbortError')return error;
  const text=String(error?.errorMessage??error?.message??'');
  const status=Number(error?.status??/^\s*(?:Error:\s*)?([45]\d{2})\b/.exec(text)?.[1]);
  if(Number.isInteger(status)&&status>=400&&status<=599){
    let hint=status===401||status===403?'请检查密钥与模型权限':status===429?'请求限流或额度不足':status===404?'请检查模型名和接口地址':status>=500?'服务暂时异常，请稍后重试':'请检查接口协议与模型参数';
    // Only field names from this fixed allowlist may be added to the message.
    if(status===400){
      const field=['thinking.display','budget_tokens','reasoning_content','max_tokens','tool_choice','input_schema'].find(name=>text.includes(name));
      if(field)hint+=`；相关字段：${field}`;
    }
    return new ContractError(`provider_http_${status}`,`模型服务返回 HTTP ${status}，${hint}`);
  }
  if(/timeout|timed out/i.test(text))return new ContractError('provider_timeout','模型请求超时，请重试或检查网络');
  if(/connection error|fetch failed|ECONN|ENOTFOUND|network/i.test(text))return new ContractError('provider_network','模型连接中断，请检查网络与接口地址');
  return new ContractError('provider_stream_failed','模型流式响应失败；连接测试成功不代表正式对话已通过（provider_stream_failed）');
}

export function assertProviderCompletion(message) {
  if(message?.stopReason==='aborted')throw Object.assign(new Error('已停止生成'),{name:'AbortError'});
  if(message?.stopReason==='error')throw providerFailure(message);
  if(message?.stopReason==='length')throw new ContractError('provider_output_limit','模型达到输出上限，回答未完成；请在模型设置中增大最大输出');
}

export function emptyProviderResponse() {
  return new ContractError('provider_empty_response','模型未返回正文；请检查最大输出设置与推理模式（provider_empty_response）');
}
