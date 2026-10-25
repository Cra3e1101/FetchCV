// The current Anthropic SDK adds thinking.display even when callers never opt
// into it. This is a recent Anthropic-specific presentation option, not a
// requirement for a Messages-compatible endpoint. Keep the common thinking
// fields on compatible services and preserve the native Anthropic request.
import {normalizeRequestOptions} from '../../shared/provider-settings.mjs';
export function compatiblePayload(payload, provider) {
  const overrides = normalizeRequestOptions(provider).requestBody;
  if (Object.keys(overrides).length) payload = {...payload,...overrides};
  if(provider.protocol!=='anthropic'||!payload?.thinking||!Object.hasOwn(payload.thinking,'display'))return payload;
  let native=false;
  try{const url=new URL(provider.baseUrl);native=url.origin==='https://api.anthropic.com'&&/^\/(?:v1(?:\/messages)?)?\/?$/.test(url.pathname);}catch{/* validated elsewhere */}
  if(native)return payload;
  const {display:DISPLAY,...thinking}=payload.thinking;
  return {...payload,thinking};
}
