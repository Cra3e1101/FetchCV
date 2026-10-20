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
});
