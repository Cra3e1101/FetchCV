import assert from 'node:assert/strict';
import test from 'node:test';
import {PiAgentRuntime, modelToolFailure} from '../electron/pi-agent-runtime.mjs';

const usage={input:1,output:1,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};

test('backend tool rejection is thrown to the SDK with safe structured diagnostics',async()=>{
  let received;
  const events=[];
  class Harness {
    constructor(options){this.options=options;}
    on(){} subscribe(listener){this.listener=listener;}
    async prompt(){
      const tool=this.options.tools[0];
      // Exercise the actual runtime tool wrapper. Like the SDK, an ordinary
      // return would be success; only the rejection reaches this error branch.
      let result,isError=false;
      try{result=await tool.execute('call-1',{source_id:'source-1'},undefined,()=>{});}
      catch(error){isError=true;received=JSON.parse(error.message);result={content:[{type:'text',text:error.message}],details:{}};}
      assert.equal(isError,true,'a rejected operation must never be a normal successful return');
      await this.listener({type:'tool_execution_end',toolCallId:'call-1',toolName:tool.name,result,isError});
      const message={role:'assistant',content:[{type:'text',text:'需要修正该来源，其余来源可继续。'}],stopReason:'stop',usage};
      await this.listener({type:'turn_end',message});return message;
    }
  }
  const runtime=new PiAgentRuntime({
    getProviderConfig:()=>({protocol:'openai',baseUrl:'https://synthetic.invalid',model:'test',contextWindow:128000,apiKey:'SYNTHETIC_PRIVATE_VALUE'}),
    request:async(_base,_token,url)=>{
      if(url.endsWith('/analyze_interview_source'))throw Object.assign(new Error('quote rejected'),{payload:{error:{
        code:'interview_analysis_quotes_invalid',message:'修正引用 SYNTHETIC_PRIVATE_VALUE',retryable:true,
        details:{source_id:'source-1',repair_attempts_remaining:1,rejected_questions:[{question_index:2,field:'evidence_quote',reason:'quote_not_in_current_source'}],
          headers:{authorization:'Bearer SHOULD_NOT_ESCAPE'},arguments:{raw:'SHOULD_NOT_ESCAPE'},
          fact_issues:[{code:'claim_needs_evidence',claim_index:4,fact_id:'fact-1',message:'contact hidden@example.test',ctx:{input:'SHOULD_NOT_ESCAPE'}}]},
      }}});
      return {};
    },
    loadModules:async()=>[{AgentHarness:Harness,InMemorySessionRepo:class{async create(){return {appendMessage:async()=>{}};}}},
      {NodeExecutionEnv:class{}},{Type:{Unsafe:x=>x},createModels:()=>({setProvider(){}}),createProvider:x=>x},
      {openAICompletionsApi:()=>({})},{anthropicMessagesApi:()=>({})}],
  });
  await runtime.run({requestId:'safe-error',bootstrap:{run_id:'r',user:{id:'u'},session_id:'s',prompt:'research',system_prompt:'test',
    tools:[{name:'analyze_interview_source',input_schema:{type:'object'},side_effect:true}]}},(name,payload)=>events.push({name,payload}));
  assert.equal(received.code,'interview_analysis_quotes_invalid');
  assert.equal(received.retryable,true);
  assert.equal(received.details.source_id,'source-1');
  assert.equal(received.details.rejected_questions[0].question_index,2);
  assert.equal(received.details.fact_issues[0].claim_index,4);
  assert(!JSON.stringify(received).includes('SYNTHETIC_PRIVATE_VALUE'));
  assert(!JSON.stringify(received).includes('SHOULD_NOT_ESCAPE'));
  assert(!JSON.stringify(received).includes('hidden@example.test'));
  assert(events.some(event=>event.name==='tool_receipt'&&event.payload.receipt.status==='failed'));
});

test('FastAPI schema diagnostics retain field locations and omit submitted input',()=>{
  const error=modelToolFailure(Object.assign(new Error('[object Object]'),{payload:{detail:[
    {loc:['body','questions',1,'evidence_quote'],msg:'String should have at least 2 characters',type:'string_too_short',input:'PRIVATE_INPUT',ctx:{min_length:2}},
  ]}}),'analyze_interview_source',{source_id:'source-2'});
  const value=JSON.parse(error.message);
  assert.equal(value.code,'tool_input_invalid');
  assert.equal(value.retryable,true);
  assert.deepEqual(value.details.errors[0].loc,['body','questions',1,'evidence_quote']);
  assert(!error.message.includes('PRIVATE_INPUT'));
  assert(!error.message.includes('[object Object]'));
});

for(const [code,action] of [
  ['tool_outcome_unknown','stop_and_reconcile'],
  ['tool_permission_denied','await_user_permission'],
  ['interview_source_ocr_pending','await_user_ocr_review'],
  ['interview_source_public_access_stopped','continue_other_sources_after_access_stop'],
])test(`${code} cannot be presented as an ordinary retry`,()=>{
  const value=JSON.parse(modelToolFailure(Object.assign(new Error('blocked'),{payload:{code,message:'blocked',retryable:true}}),'capture_interview_source').message);
  assert.equal(value.retryable,false);
  assert.equal(value.details.next_action,action);
});
