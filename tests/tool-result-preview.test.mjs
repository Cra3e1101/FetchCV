import test from 'node:test';
import assert from 'node:assert/strict';
import {trimToolResult} from '../electron/pi/context-policy.mjs';
import {assembleContext} from '../electron/pi/context-budget.mjs';
test('large results expose all fact IDs and a usable pagination reference within the exact budget',()=>{
 const ids=Array.from({length:120},(_,i)=>`fact_${i}`),reference={tool:'read_tool_result',arguments:{result_id:'a'.repeat(64),offset:0,limit:4000}};
 const text=trimToolResult({data:{fact_ids:ids,jd:'JD'.repeat(50000)}},50000,reference),view=JSON.parse(text);
 assert(text.length<=50000);assert.deepEqual(view.fact_ids,ids);assert.deepEqual(view.reference,reference);assert(view.preview.length>8000);
 const messages=[{role:'user',content:[{type:'text',text:'inspect'}]},{role:'assistant',content:[{type:'toolCall',id:'call',name:'inspect',arguments:{}}]},{role:'toolResult',toolCallId:'call',content:[{type:'text',text}]}];
 const packed=assembleContext(messages,{model:{contextWindow:12000,maxTokens:2000},tools:[],systemPrompt:'rules',protectedFrom:0});
 assert.deepEqual(JSON.parse(packed.messages[2].content[0].text).reference,reference);
 assert.deepEqual(JSON.parse(packed.messages[2].content[0].text).fact_ids,ids);
});

test('a second compaction preserves whole fact summaries and retrieval match diagnostics',()=>{
 const reference={tool:'read_tool_result',arguments:{result_id:'b'.repeat(64)}};
 const facts=[{id:'fact_1',text:'上线转化率提高 37%，用户已确认'}];
 const sources=[{id:'source_1',title:'岗位资料',url:'https://example.test/source',match_strategy:'relaxed_terms',search_score:0.5,text_preview:'证据文本'.repeat(2000)}];
 const first=JSON.parse(trimToolResult({status:'completed',requires_user_action:true,retryable:false,error_code:'manual_review',data:{fact_ids:['fact_1'],fact_summaries:facts,sources,jd:'长资料'.repeat(10000)}},5000,reference));
 const second=JSON.parse(trimToolResult(first,1800,reference));
 assert.deepEqual(second.fact_ids,['fact_1']);assert.deepEqual(second.fact_summaries,facts);
 assert.equal(second.sources[0].id,'source_1');assert.equal(second.sources[0].match_strategy,'relaxed_terms');
 assert.equal(second.status,'completed');assert.deepEqual(second.reference,reference);
 assert.equal(second.requires_user_action,true);assert.equal(second.retryable,false);assert.equal(second.error_code,'manual_review');
 assert(!second.preview.startsWith('{"truncated"'));
});

test('oversized fact metadata stays within budget and records whole-item omissions across compactions',()=>{
 const ids=Array.from({length:2000},(_,i)=>`事实_${i}_😀`);
 const ref={tool:'read_tool_result',arguments:{result_id:'c'.repeat(64)}};
 const text=trimToolResult({data:{fact_ids:ids,body:'x'.repeat(50000)}},1500,ref),first=JSON.parse(text);
 assert(text.length<=1500);assert(first.fact_ids.length<ids.length);
 assert.deepEqual(first.fact_ids,ids.slice(0,first.fact_ids.length));
 assert.equal(first.fact_ids.length+first.omitted.fact_ids,ids.length);
 const secondText=trimToolResult(first,900,ref),second=JSON.parse(secondText);
 assert(secondText.length<=900);assert.equal(second.fact_ids.length+second.omitted.fact_ids,ids.length);
 assert.deepEqual(second.reference,ref);
 assert.throws(()=>trimToolResult({body:'x'.repeat(5000)},50,ref),{code:'context_overflow'});
});

test('UTF-8 message measurements account for escaped CJK and preserve surrogate boundaries',()=>{
 const measure=text=>Buffer.byteLength(JSON.stringify({role:'toolResult',content:[{type:'text',text}]}));
 const text=trimToolResult({body:'😀中"\\'.repeat(5000)},1200,null,{measure});
 assert(measure(text)<=1200);
 assert(!/[\uD800-\uDBFF]$/.test(JSON.parse(text).preview));
});
