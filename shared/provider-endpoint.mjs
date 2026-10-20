/* global URL */
/** One URL contract for the SDK, connection probe and catalogue lookup. */
export function resolveProviderEndpoint(value, protocol = 'openai') {
  const url = new URL(String(value).trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('模型地址不能包含认证信息、查询参数或片段');
  }
  let basePath = url.pathname.replace(/\/+$/, '');
  if (protocol === 'anthropic') {
    basePath = basePath.replace(/\/messages$/i, '').replace(/\/v1$/i, '');
  } else if (protocol === 'openai') {
    basePath = basePath.replace(/\/chat\/completions$/i, '');
  } else {
    throw new Error('不支持的模型协议');
  }
  const sdkBaseUrl = url.origin + basePath;
  return {
    sdkBaseUrl,
    requestUrl: sdkBaseUrl + (protocol === 'anthropic' ? '/v1/messages' : '/chat/completions'),
    catalogueKey: url.origin + basePath.replace(/\/v1$/i, ''),
  };
}
