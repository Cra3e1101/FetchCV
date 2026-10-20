import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import * as ai from '@earendil-works/pi-ai';
import * as core from '@earendil-works/pi-agent-core';
import * as node from '@earendil-works/pi-agent-core/node';
import * as openai from '@earendil-works/pi-ai/api/openai-completions.lazy';
import * as anthropic from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import {createFetchCVHarness} from '../electron/pi/fetchcv-harness.mjs';
import {PiAgentRuntime} from '../electron/pi-agent-runtime.mjs';

const provider = {providerName:'Synthetic', model:'fixture', protocol:'anthropic',
  baseUrl:'https://synthetic.invalid/v1', contextWindow:256000, maxOutputTokens:4096, apiKey:'synthetic-only'};
const usage = {input:1, output:1, cacheRead:0, cacheWrite:0, totalTokens:2,
  cost:{input:0, output:0, cacheRead:0, cacheWrite:0, total:0}};
const answer = (model, content, stopReason='stop') => ({
  role:'assistant', content, stopReason, api:model.api, provider:model.provider, model:model.id, usage, timestamp:Date.now(),
});

for (const [suffix, expected] of [
  ['', '/v1/messages'], ['/v1', '/v1/messages'], ['/v1/', '/v1/messages'],
  ['/v1/messages', '/v1/messages'], ['/anthropic/v1', '/anthropic/v1/messages'],
]) test(`real Anthropic SDK endpoint: ${suffix || '/'}`, async t => {
  const urls = [];
  const events = [
    {type:'message_start',message:{id:'fixture',type:'message',role:'assistant',model:'fixture',content:[],
      stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'OK'}},
    {type:'content_block_stop',index:0},
    {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}},
    {type:'message_stop'},
  ];
  t.mock.method(globalThis,'fetch',async(input,init)=>{
    const request = new Request(input,init);
    assert.equal(new URL(request.url).origin,'https://synthetic.invalid');
    urls.push(new URL(request.url).pathname);
    return new Response(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),
      {headers:{'content-type':'text/event-stream'}});
  });
  const created = await createFetchCVHarness({bootstrap:{session_id:`endpoint-${suffix}`,system_prompt:'Test'},
    provider:{...provider,baseUrl:`https://synthetic.invalid${suffix}`},tools:[],
    modules:[core,node,ai,openai,anthropic]});
  const result = await created.harness.prompt('hello');
  created.assertAssembly();
  assert.equal(result.stopReason,'stop',result.errorMessage);
  assert.deepEqual(urls,[expected]);
});

for (const refresh of ['inline', 'fallback', 'failure']) test(`real host task-tool refresh: ${refresh}`, async()=>{
  const contexts=[], records=[], requests=[], checkpoints=[];
  const toolA={name:'stage_a',description:'Stage A',input_schema:{type:'object',properties:{}},side_effect:true};
  const toolB={name:'stage_b',description:'Stage B',input_schema:{type:'object',properties:{evidence:{type:'string'}}}};
  const streamSimple=(model,context,options)=>{
    contexts.push({systemPrompt:context.systemPrompt, messages:structuredClone(context.messages), tools:context.tools.map(t=>({name:t.name,parameters:t.parameters}))});
    const stream=ai.createAssistantMessageEventStream();
    queueMicrotask(async()=>{
      try {
        await options.onPayload({model:model.id,messages:context.messages,
          tools:context.tools.map(t=>({name:t.name,parameters:t.parameters}))},model);
        const first=contexts.length===1;
        const message=answer(model,first?[{type:'toolCall',id:'advance-1',name:'stage_a',arguments:{}}]:
          [{type:'text',text:'done'}],first?'toolUse':'stop');
        stream.push({type:'done',reason:message.stopReason,message});
      } catch(error) { stream.push({type:'error',reason:'error',error:{...answer(model,[],'error'),errorMessage:error.message}}); }
    });
    return stream;
  };
  const api={stream:streamSimple,streamSimple};
  const runtime=new PiAgentRuntime({
    getProviderConfig:()=>({...provider,protocol:'openai'}),
    loadModules:async()=>[core,node,ai,{openAICompletionsApi:()=>api},{anthropicMessagesApi:()=>api}],
    request:async(_base,_token,url,options={})=>{
      requests.push(url);
      if(url.endsWith('/checkpoint'))checkpoints.push(JSON.parse(options.body));
      if(url.endsWith('/task-tools/stage_a'))return {result:{stage:'b',summary:'advanced'},...(refresh==='inline'?{tools:[toolB]}:{})};
      if(url.endsWith('/task-tools')){
        if(refresh==='failure')throw new Error('Synthetic backend unavailable');
        return {tools:[toolB]};
      }
      if(url.endsWith('/requests'))records.push(JSON.parse(options.body).record);
      if(url.endsWith('/control'))return {signal:null};
      if(url.endsWith('/complete'))return {task:{status:'completed'}};
      return {};
    },
  });
  const running = runtime.run({requestId:'real-host-tools',mode:'task',bootstrap:{
    run_id:'r',task_id:'t',session_id:'refresh',system_prompt:'Use available tools',
    system_prompt_sections:[{text:'A-POLICY',requires_all:['stage_a']},{text:'B-POLICY',requires_all:['stage_b']}],prompt:'Advance once',tools:[toolA]}},()=>{});
  if(refresh==='failure'){
    await assert.rejects(running,{code:'tool_refresh_failed'});
    assert(checkpoints.some(cp=>cp.tool_receipts?.some(r=>r.status==='completed_refresh_failed')));
    assert.equal(contexts.length,1,'No model request may proceed with stale tools');
    assert.equal(requests.filter(p=>p.endsWith('/task-tools/stage_a')).length,1,'No side-effect retry');
    assert.equal(requests.filter(p=>p.endsWith('/complete')).length,0);
    return;
  }
  await running;
  assert.equal(requests.filter(p=>p.endsWith('/task-tools/stage_a')).length,1);
  assert.equal(contexts.length,2);
  assert.deepEqual(contexts[1].tools.map(t=>t.name),['stage_b']);
  assert.deepEqual(records[1].payload.tools.map(t=>t.name),['stage_b']);
  assert.equal(contexts[1].systemPrompt,'B-POLICY');
  const hash=createHash('sha256').update(JSON.stringify([{name:toolB.name,parameters:toolB.input_schema}])).digest('hex');
  assert.equal(records[1].toolsHash,hash);
});


test('connection probe uses real SDK streaming, compatibility and a tool-result round trip',async t=>{
 const {probeProvider}=await import('../electron/pi/provider-probe.mjs');
 const bodies=[];
 t.mock.method(globalThis,'fetch',async(input,init)=>{
   const req=new Request(input,init);assert.equal(req.url,'https://synthetic.invalid/v1/chat/completions');
   const body=await req.json();bodies.push(body);assert.equal(body.stream,true);assert.equal(body.max_tokens,4096);assert.equal(body.max_completion_tokens,undefined);
   const delta=bodies.length===1?{role:'assistant',tool_calls:[{index:0,id:'probe-call',type:'function',function:{name:'connection_probe',arguments:'{"value":"OK"}'}}]}:{role:'assistant',content:'OK'};
   const chunk={id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:null}]};
   const end={...chunk,choices:[{index:0,delta:{},finish_reason:bodies.length===1?'tool_calls':'stop'}]};
   return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
 });
 const result=await probeProvider({...provider,protocol:'openai',modelProfiles:{fixture:{contextWindow:128000,maxOutputTokens:4096,compat:{maxTokensField:'max_tokens',supportsDeveloperRole:false}}}});
 assert.equal(result.tools,'verified');assert.equal(bodies.length,2);
 assert(bodies[1].messages.some(m=>m.role==='tool'&&m.content==='OK'));
 assert.equal(bodies[0].messages[0].role,'system');
});

test('real harness recomputes prompt sections after setTools and keeps memory outside system',async()=>{
 const captures=[];
 const streamSimple=(model,context)=>{captures.push({systemPrompt:context.systemPrompt,messages:structuredClone(context.messages)});const stream=new ai.AssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'done',reason:'stop',message:answer(model,[{type:'text',text:'OK'}])});stream.end();});return stream;};
 const api={stream:streamSimple,streamSimple};
 const a={name:'web',description:'web',parameters:{type:'object',properties:{}},execute:async()=>({content:[]})};
 const b={...a,name:'interview'};
 const created=await createFetchCVHarness({bootstrap:{session_id:'dynamic-prompt',system_prompt:'fallback',system_prompt_sections:[{text:'CORE'},{text:'WEB',requires_all:['web']},{text:'INTERVIEW',requires_all:['interview']}],compacted_summary:'untrusted remembered facts'},provider,tools:[a],modules:[core,node,ai,{openAICompletionsApi:()=>api},{anthropicMessagesApi:()=>api}]});
 await created.harness.prompt('first');await created.harness.setTools([b],['interview']);await created.harness.prompt('next');
 assert.equal(captures[0].systemPrompt,'CORE\nWEB');assert.equal(captures[1].systemPrompt,'CORE\nINTERVIEW');
 assert(!captures[1].systemPrompt.includes('remembered'));
 assert(captures[1].messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('untrusted remembered facts')));
});
