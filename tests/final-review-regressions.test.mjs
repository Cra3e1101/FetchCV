import test from "node:test";
import assert from "node:assert/strict";
import * as ai from "@earendil-works/pi-ai";
import * as core from "@earendil-works/pi-agent-core";
import * as node from "@earendil-works/pi-agent-core/node";
import * as openai from "@earendil-works/pi-ai/api/openai-completions.lazy";
import * as anthropic from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import {createFetchCVHarness} from "../electron/pi/fetchcv-harness.mjs";
import {probeProvider} from "../electron/pi/provider-probe.mjs";
import {trimToolResult} from "../electron/pi/context-policy.mjs";

test("result references preserve primitive and array results, and all compact fact summaries",()=>{
  const ref={tool:"read_tool_result",arguments:{result_id:"a".repeat(64)}};
  for(const value of ["hello", [1,2], null, 42]) {
    const parsed=JSON.parse(trimToolResult(value,50000,ref));
    assert.deepEqual(parsed.value,value);
    assert.deepEqual(parsed._result_reference,ref);
  }
  const fact_summaries=Array.from({length:120},(_,i)=>({id:`f${i}`,text:"事实摘要".repeat(30)}));
  const parsed=JSON.parse(trimToolResult({data:{fact_ids:fact_summaries.map(x=>x.id),fact_summaries,jd:"x".repeat(200000)}},50000,ref));
  assert.deepEqual(parsed.fact_summaries,fact_summaries);
  assert(JSON.stringify(parsed).length<=50000);
});

for(const mode of ["task","probe"]) test(`real Anthropic ${mode} keeps visible output within its actual cap`,async t=>{
  const bodies=[];
  const events=[
    {type:"message_start",message:{id:"fixture",type:"message",role:"assistant",model:"fixture",content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}},
    {type:"content_block_start",index:0,content_block:{type:"text",text:""}},
    {type:"content_block_delta",index:0,delta:{type:"text_delta",text:"OK"}},
    {type:"content_block_stop",index:0},
    {type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:1}},
    {type:"message_stop"},
  ];
  t.mock.method(globalThis,"fetch",async(input,init)=>{
    const req=new Request(input,init);
    assert.equal(new URL(req.url).origin,"https://synthetic.invalid");
    bodies.push(await req.json());
    return new Response(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""),
      {headers:{"content-type":"text/event-stream"}});
  });
  const provider={protocol:"anthropic",baseUrl:"https://synthetic.invalid/v1",apiKey:"synthetic",model:"fixture",
    modelProfiles:{fixture:{contextWindow:128000,maxOutputTokens:16384,reasoning:true}}};
  if(mode==="task"){
    const {harness}=await createFetchCVHarness({provider,bootstrap:{session_id:"budget",system_prompt:"test"},
      tools:[],thinkingLevel:"deep",taskMode:true,modules:[core,node,ai,openai,anthropic]});
    assert.equal((await harness.prompt("test")).stopReason,"stop");
    assert(bodies[0].max_tokens-bodies[0].thinking.budget_tokens>=8192);
    assert(bodies[0].max_tokens<=16384);
  }else{
    const result=await probeProvider(provider);
    assert.equal(result.conversation,true);
    assert.equal(result.tools,"unverified");
    assert(bodies[0].max_tokens<=4096);
    assert(bodies[0].max_tokens-bodies[0].thinking.budget_tokens>=2048);
  }
});
