import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveProviderEndpoint} from '../shared/provider-endpoint.mjs';
import {createProviderAdapter} from '../electron/pi/provider-adapter.mjs';
import * as ai from '@earendil-works/pi-ai';
const streams={openAICompletionsApi:()=>({}),anthropicMessagesApi:()=>({})};
for(const protocol of ['openai','anthropic']) {
  const cases=protocol==='openai'
    ? [['','/chat/completions'],['/v1','/v1/chat/completions'],['/v1/','/v1/chat/completions'],
       ['/v1/chat/completions','/v1/chat/completions'],['/gateway/chat/completions','/gateway/chat/completions']]
    : [['','/v1/messages'],['/v1','/v1/messages'],['/v1/','/v1/messages'],
       ['/v1/messages','/v1/messages'],['/gateway/v1/messages','/gateway/v1/messages']];
  for(const [suffix,expected] of cases)test(`${protocol} shared probe and SDK endpoint ${suffix || '/'}`,()=>{
    const provider={protocol,baseUrl:`https://example.invalid${suffix}`,model:'synthetic',contextWindow:32768,apiKey:'synthetic'};
    const resolved=resolveProviderEndpoint(provider.baseUrl,protocol);
    const {model}=createProviderAdapter(provider,ai,streams,streams);
    assert.equal(resolved.requestUrl,`https://example.invalid${expected}`);
    assert.equal(model.baseUrl+(protocol==='anthropic'?'/v1/messages':'/chat/completions'),resolved.requestUrl);
  });
}
test('endpoint rejects credential/query URLs instead of silently discarding authentication',()=>{
  for(const url of ['https://user:secret@example.invalid','https://example.invalid?key=secret','https://example.invalid#secret','file:///tmp/example'])
    assert.throws(()=>resolveProviderEndpoint(url));
});
