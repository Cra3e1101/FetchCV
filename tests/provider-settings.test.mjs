import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRequestOptions,providerRequestHeaders,providerConfigJson,applyProviderConfigJson,restoreSavedHeaders,providerPrivateLiterals,SAVED_HEADER} from '../shared/provider-settings.mjs';
import {probeProvider} from '../electron/pi/provider-probe.mjs';
import {compatiblePayload} from '../electron/pi/compatible-payload.mjs';
import {startProviderSettingsPeer} from './helpers/provider-settings-peer.mjs';
import {createProviderAdapter} from '../electron/pi/provider-adapter.mjs';
import * as ai from '@earendil-works/pi-ai';
import * as openai from '@earendil-works/pi-ai/api/openai-completions.lazy';
import * as anthropic from '@earendil-works/pi-ai/api/anthropic-messages.lazy';

test('CC Switch validation rejects duplicate, injected and managed headers; Agent payload cannot be overwritten',()=>{
  for(const requestHeaders of [{'X-Key':'a','x-key':'b'},{'X-Key':'a\r\nAuthorization: b'},{Authorization:'secret'},{Host:'evil.invalid'}]) assert.throws(()=>normalizeRequestOptions({requestHeaders}));
  for(const requestBody of [{messages:[]},{tools:[]},{model:'other'},{stream:false},{temperature:5},{seed:1.5},{top_p:'0.5'}])assert.throws(()=>normalizeRequestOptions({requestBody}));
  assert.throws(()=>normalizeRequestOptions({protocol:'anthropic',requestBody:{temperature:.5,top_p:.8}}));
  assert.throws(()=>normalizeRequestOptions({userAgent:'client\nInjected'}));
});
test('JSON editing preserves identity and credentials, masks headers, and rejects unknown fields atomically',()=>{
  const form={id:'saved-id',protocol:'openai',providerName:'Test',baseUrl:'https://example.invalid/v1',model:'model',apiKey:'synthetic-secret',requestHeaders:{'x-token':'synthetic-header'},modelProfiles:{model:{contextWindow:32768}},availableModels:[{id:'model',contextWindow:32768}],hasApiKey:true};
  const raw=providerConfigJson(form);assert(!raw.includes('synthetic-secret'));assert(!raw.includes('synthetic-header'));
  const parsed=JSON.parse(raw); parsed.notes='Work account';parsed.displayName='My model';
  const result=applyProviderConfigJson(JSON.stringify(parsed),form);
  assert.equal(result.id,form.id);assert.equal(result.apiKey,form.apiKey);assert.equal(result.requestHeaders['x-token'],'synthetic-header');assert.equal(result.notes,'Work account');
  assert.equal(result.availableModels,form.availableModels);
  assert.throws(()=>applyProviderConfigJson('{"apiKey":"wrong"}',form));
  assert.throws(()=>applyProviderConfigJson('{"protocol":"gemini"}',form));
  assert.throws(()=>restoreSavedHeaders({'x-token':SAVED_HEADER},{}));
  assert.equal(form.notes,undefined);
});
test('full URLs derive one endpoint and custom auth suppresses SDK default headers',()=>{
  const headers=providerRequestHeaders({protocol:'anthropic',apiKey:'synthetic',authMode:'bearer'},{sdk:true});
  assert.equal(headers['x-api-key'],null);assert.equal(headers.authorization,'Bearer synthetic');
  assert.deepEqual(restoreSavedHeaders({'x-token':SAVED_HEADER},{'x-token':'synthetic'}),{'x-token':'synthetic'});
});
test('privacy masks gateway credentials without removing ordinary header values from prompts',()=>{
  const config={apiKey:'synthetic-key',requestHeaders:{'x-secret':'synthetic-token','x-title':'FetchCV','x-version':'1'}};
  assert.deepEqual(providerPrivateLiterals(config,{sensitiveOnly:true}),['synthetic-key','synthetic-token']);
  assert(providerPrivateLiterals(config).includes('FetchCV'));
});
for(const protocol of ['openai','anthropic'])for(const authMode of ['auto','bearer','x-api-key'])test(`${protocol}/${authMode}: actual SDK probe and subsequent answer send identical auth, headers and body`,async()=>{
  const peer=await startProviderSettingsPeer();
  try {
    const suffix=protocol==='anthropic'?'/gateway/v1/messages':'/gateway/v1/chat/completions';
    const provider={protocol,authMode,baseUrl:peer.baseUrl+suffix,providerName:'Synthetic',model:'test-model',apiKey:'synthetic-key',contextWindow:32768,maxOutputTokens:4096,requestHeaders:{'X-Title':'Synthetic header'},userAgent:'FetchCV-Test/1',requestBody:{temperature:.2}};
    assert.equal((await probeProvider(provider)).tools,'verified');
    const {models,model,streamOptions}=createProviderAdapter(provider,ai,openai,anthropic);
    const answer=await models.streamSimple(model,{messages:[{role:'user',content:'Synthetic normal conversation',timestamp:1}]},{...streamOptions,onPayload:payload=>compatiblePayload(payload,provider)}).result();
    assert.equal(answer.stopReason,'stop');assert.equal(peer.requests.length,3);
    const bearer=authMode==='bearer'||authMode==='auto'&&protocol==='openai';
    for(const request of peer.requests) {
      assert.equal(new URL(request.path,peer.baseUrl).pathname,suffix);
      assert.equal(request.headers.authorization,bearer?'Bearer synthetic-key':undefined);
      assert.equal(request.headers['x-api-key'],bearer?undefined:'synthetic-key');
      assert.equal(request.headers['x-title'],'Synthetic header');assert.equal(request.headers['user-agent'],'FetchCV-Test/1');
      assert.equal(request.body.temperature,.2);assert.equal(request.body.model,'test-model');assert.equal(request.body.stream,true);
    }
  } finally {await peer.close();}
});
