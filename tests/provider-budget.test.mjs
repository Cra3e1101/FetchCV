import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import * as ai from '@earendil-works/pi-ai';
import {createProviderAdapter} from '../electron/pi/provider-adapter.mjs';
import {assembleContext} from '../electron/pi/context-budget.mjs';
import {prepareRequestRecord} from '../electron/pi/request-record.mjs';
import {createFetchCVHarness} from '../electron/pi/fetchcv-harness.mjs';
import * as core from '@earendil-works/pi-agent-core';
import * as node from '@earendil-works/pi-agent-core/node';
import * as openai from '@earendil-works/pi-ai/api/openai-completions.lazy';
import * as anthropic from '@earendil-works/pi-ai/api/anthropic-messages.lazy';

const provider={protocol:'openai',baseUrl:'https://api.deepseek.com',model:'deepseek-v4-flash',apiKey:'synthetic'};
const unused={openAICompletionsApi:()=>({}),anthropicMessagesApi:()=>({})};
const model=(patch={})=>createProviderAdapter({...provider,...patch},ai,unused,unused).model;

function freshBootstrap(){
  assert(process.env.M1_ALLOWED_DELETE_ROOT,'Run under the guarded test runner');
  const result=spawnSync(path.resolve('backend/.venv-m1/Scripts/python.exe'),
    ['-B','tests/helpers/provider-budget-bootstrap.py',process.env.M1_ALLOWED_DELETE_ROOT],
    {encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout);
}

test('DeepSeek first turn fits real production bootstrap; unknown endpoint remains conservative',()=>{
  const bootstrap=freshBootstrap();
  const tools=bootstrap.tools.map(t=>({name:t.name,description:t.description,parameters:t.input_schema}));
  const messages=[{role:'user',content:bootstrap.prompt}];
  const options={tools,systemPrompt:bootstrap.system_prompt,protectedFrom:0};
  // Exact pre-fix behaviour: even a brand-new six-character question is rejected.
  assert.throws(()=>assembleContext(messages,{...options,model:model({baseUrl:'https://unverified.example/v1',contextWindow:8192})}),{code:'context_overflow'});
  const selected=assembleContext(messages,{...options,model:model()});
  assert.deepEqual(selected.messages,messages);
  const payload={model:provider.model,messages:[{role:'system',content:bootstrap.system_prompt},...messages],tools:tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}}))};
  assert.doesNotThrow(()=>prepareRequestRecord(payload,{model:model(),tools,sequence:1,contextManifest:selected.manifest}));
  console.log(JSON.stringify({tools:tools.length,promptBytes:Buffer.byteLength(bootstrap.system_prompt),estimatedInputBytes:selected.manifest.estimatedInputBytes,oldInputAllowance:5120,newInputAllowance:selected.manifest.inputAllowance}));
});

test('real Pi Anthropic request reaches transport and completes with official DeepSeek limits',async(t)=>{
  const bootstrap=freshBootstrap(),calls=[],records=[];
  const tools=bootstrap.tools.map(t=>({name:t.name,description:t.description,parameters:t.input_schema,execute:async()=>{throw Error('No tool expected')}}));
  const events=[
    {type:'message_start',message:{id:'synthetic-budget',type:'message',role:'assistant',model:provider.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'SYNTHETIC_BUDGET_OK'}},
    {type:'content_block_stop',index:0},
    {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:5}},
    {type:'message_stop'},
  ];
  // Intercept transport only: real SDK, authentication, context assembly and wire
  // payload hooks run. No paid model request or user credentials are involved.
  t.mock.method(globalThis,'fetch',async(input,init)=>{
    const request=new Request(input,init);
    assert.equal(new URL(request.url).origin,'https://api.deepseek.com');
    assert.equal(new URL(request.url).pathname,'/anthropic/v1/messages');
    calls.push(await request.json());
    assert.equal(calls.at(-1).thinking?.display,undefined,'Third-party compatibility requests must not assume Anthropic display support');
    return new Response(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),{status:200,headers:{'content-type':'text/event-stream'}});
  });
  const created=await createFetchCVHarness({bootstrap,tools,provider:{...provider,protocol:'anthropic',baseUrl:'https://api.deepseek.com/anthropic'},thinkingLevel:'balanced',modules:[core,node,ai,openai,anthropic],recordRequest:async r=>records.push(r)});
  const response=await created.harness.prompt(bootstrap.prompt);
  created.assertAssembly();
  assert.equal(response.stopReason,'stop',response.errorMessage);
  assert.equal(response.content.find(c=>c.type==='text')?.text,'SYNTHETIC_BUDGET_OK');
  assert.equal(calls.length,1);
  assert.equal(calls[0].model,'deepseek-v4-flash');
  assert.equal(calls[0].tools.length,tools.length);
  assert.equal(records.length,1);
  assert.equal(records[0].model.contextWindow,1000000);
  assert.equal(records[0].profileRevision,'model-profile-v2:catalogue');
  assert(records[0].budget.actualPayloadBytes>5120);
});

test('verified profile matches official endpoint and exact model, retaining explicit limits',()=>{
  for(const baseUrl of ['https://api.deepseek.com','https://api.deepseek.com/v1/','https://api.deepseek.com/chat/completions','https://api.deepseek.com/v1/chat/completions']){
    for(const id of ['deepseek-v4-flash','deepseek-flash','deepseek-v4-pro'])assert.equal(model({baseUrl,model:id}).contextWindow,1000000);
  }
  for(const baseUrl of ['https://api.deepseek.com.evil.example','https://proxy.example/v1','https://api.deepseek.com/proxy','http://api.deepseek.com','https://api.deepseek.com:8443','https://user@api.deepseek.com'])assert.throws(()=>model({baseUrl}),{code:'model_profile_required'});
  assert.throws(()=>model({model:'unknown-model'}),{code:'model_profile_required'});
  for(const baseUrl of ['https://api.deepseek.com/anthropic','https://api.deepseek.com/anthropic/','https://api.deepseek.com/anthropic/v1/messages'])assert.equal(model({protocol:'anthropic',baseUrl}).contextWindow,1000000);
  assert.throws(()=>model({protocol:'anthropic',baseUrl:'https://proxy.example/anthropic'}),{code:'model_profile_required'});
  assert.equal(model({contextWindow:32768,maxOutputTokens:4096}).contextWindow,32768);
  assert.equal(model({contextWindow:32768,maxOutputTokens:4096}).maxTokens,4096);
  assert.throws(()=>model({contextWindow:0}),{code:'invalid_model_profile'});
  assert.throws(()=>assembleContext([{role:'user',content:'x'.repeat(1000000)}],{model:model(),tools:[],systemPrompt:'',protectedFrom:0}),{code:'context_overflow'});
});
