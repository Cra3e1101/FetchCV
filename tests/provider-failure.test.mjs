import assert from 'node:assert/strict';
import test from 'node:test';
import {providerFailure,assertProviderCompletion} from '../electron/pi/provider-failure.mjs';
import {publicError} from '../packages/contracts/runtime.mjs';
import {compatiblePayload} from '../electron/pi/compatible-payload.mjs';

test('SDK diagnostic classification never exposes credentials, echoed prompts or arbitrary response fields',()=>{
  for(const [raw,code] of [
    ['401 SYNTHETIC_SECRET','provider_http_401'],
    ['400 invalid thinking.display SYNTHETIC_SECRET','provider_http_400'],
    ['429 SYNTHETIC_SECRET','provider_http_429'],
    ['Connection error. SYNTHETIC_SECRET','provider_network'],
    ['Request timed out SYNTHETIC_SECRET','provider_timeout'],
    ['arbitrary response SYNTHETIC_SECRET','provider_stream_failed'],
  ]){
    const error=providerFailure(new Error(raw)),visible=publicError(error);
    assert.equal(visible.code,code);assert(!JSON.stringify(visible).includes('SYNTHETIC_SECRET'));
  }
  assert.equal(providerFailure({status:503,message:'private'}).code,'provider_http_503');
  assert.throws(()=>assertProviderCompletion({stopReason:'aborted'}),{name:'AbortError'});
  assert.throws(()=>assertProviderCompletion({stopReason:'length',content:[{type:'text',text:'partial'}]}),{code:'provider_output_limit'});
});

test('Anthropic-compatible requests omit only vendor presentation option, keeping native semantics and source object',()=>{
  const payload={thinking:{type:'enabled',budget_tokens:1024,display:'summarized'},max_tokens:4096,tools:[{name:'read'}]};
  for(const baseUrl of ['https://custom.invalid/anthropic','https://api.deepseek.com/anthropic','https://api.anthropic.com.evil.invalid']){
    const result=compatiblePayload(payload,{protocol:'anthropic',baseUrl});
    assert.deepEqual(result.thinking,{type:'enabled',budget_tokens:1024});
    assert.equal(result.max_tokens,4096);assert.equal(result.tools,payload.tools);
  }
  assert.equal(compatiblePayload(payload,{protocol:'anthropic',baseUrl:'https://api.anthropic.com'}),payload);
  assert.equal(compatiblePayload(payload,{protocol:'openai',baseUrl:'https://custom.invalid'}),payload);
  assert.equal(payload.thinking.display,'summarized');
});
