import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveModelProfile,normalizeModelProfiles,modelProfilesFor} from '../shared/model-profile.mjs';
import {parseModelsResponse} from '../electron/provider-utils.mjs';
import catalogue from '../shared/model-catalog.mjs';
import {publicError} from '../packages/contracts/runtime.mjs';
const custom={baseUrl:'https://custom.example/v1',protocol:'openai',model:'brand-new-model'};

test('arbitrary models work using discovered metadata without a hardcoded model name',()=>{
  const availableModels=parseModelsResponse({data:[{id:custom.model,context_length:262144,top_provider:{max_completion_tokens:16384},reasoning:false}]});
  const profile=resolveModelProfile({...custom,availableModels});
  assert.equal(profile.contextWindow,262144);assert.equal(profile.source,'provider');assert.equal(profile.reasoning,false);
});
test('unknown model asks for configuration instead of inventing an 8K limit',()=>{
  assert.equal(resolveModelProfile(custom,{strict:false}).contextWindow,null);
  assert.throws(()=>resolveModelProfile(custom),{code:'model_profile_required'});
  assert.match(publicError({code:'model_profile_required'}).message,/设置/);
});
test('per-model manual settings override metadata, survive switching, and never leak to another model',()=>{
  const modelProfiles=normalizeModelProfiles({a:{contextWindow:'128000',maxOutputTokens:'4096',reasoning:false},b:{contextWindow:'262144',maxOutputTokens:'8192',reasoning:true}});
  const saved=JSON.parse(JSON.stringify({...custom,modelProfiles,availableModels:[{id:'a',contextWindow:1000000,reasoning:true}]}));
  assert.equal(resolveModelProfile({...saved,model:'a'}).contextWindow,128000);
  assert.equal(resolveModelProfile({...saved,model:'a'}).reasoning,false);
  assert.equal(resolveModelProfile({...saved,model:'b'}).maxOutputTokens,8192);
  assert.equal(resolveModelProfile({...saved,model:'b'}).reasoning,true);
  assert.throws(()=>resolveModelProfile({...saved,model:'c'}),{code:'model_profile_required'});
});
test('clearing an override restores automatic values; refreshing discovery keeps manual values',()=>{
  const profile=resolveModelProfile({...custom,availableModels:[{id:custom.model,contextWindow:200000}],modelProfiles:{[custom.model]:{contextWindow:'',maxOutputTokens:'4096'}}});
  assert.equal(profile.source,'provider');assert.equal(profile.maxOutputTokens,4096);
});
test('legacy single-model config migrates under its model id',()=>{
  const modelProfiles=modelProfilesFor({...custom,contextWindow:32768,maxOutputTokens:2048});
  assert.deepEqual(modelProfiles[custom.model],{contextWindow:32768,maxOutputTokens:2048});
  assert.throws(()=>resolveModelProfile({...custom,model:'other',modelProfiles}),{code:'model_profile_required'});
});
test('invalid limits and third-party metadata are validated rather than coerced',()=>{
  for(const value of [0,-1,3.5,NaN,Infinity,true,'no',10000001])assert.throws(()=>normalizeModelProfiles({x:{contextWindow:value}}),{code:'invalid_model_profile'});
  assert.deepEqual(parseModelsResponse({data:[{id:'bad',context_length:'wrong',max_output_tokens:-1}]}),[{id:'bad',ownedBy:''}]);
  assert.throws(()=>resolveModelProfile({...custom,modelProfiles:{[custom.model]:{contextWindow:8192,maxOutputTokens:8192}}}),{code:'invalid_model_profile'});
});
test('offline catalog resolves multiple providers only at their matching endpoint and protocol',()=>{
  for(const host of ['https://api.openai.com/v1','https://api.anthropic.com','https://api.moonshot.ai/v1']){
    const row=catalogue.find(r=>r.baseUrl===host);assert(row,host);
    const profile=resolveModelProfile({baseUrl:host,protocol:row.protocol,model:row.id});
    assert.equal(profile.contextWindow,row.contextWindow);assert.equal(profile.source,'catalogue');
    assert.throws(()=>resolveModelProfile({baseUrl:'https://relay.example',protocol:row.protocol,model:row.id}),{code:'model_profile_required'});
  }
});


test('output budget follows capability, and explicit compatibility and modalities survive',()=>{
 const config={...custom,availableModels:[{id:custom.model,contextWindow:128000,maxOutputTokens:32000}],modelProfiles:{[custom.model]:{input:['text'],compat:{maxTokensField:'max_tokens',supportsDeveloperRole:false}}}};
 const p=resolveModelProfile(config);assert.equal(p.maxOutputTokens,16384);assert.deepEqual(p.input,['text']);assert.equal(p.compat.supportsDeveloperRole,false);
 assert.throws(()=>normalizeModelProfiles({x:{compat:{extraBody:{token:'secret'}}}}),{code:'invalid_model_profile'});
});
