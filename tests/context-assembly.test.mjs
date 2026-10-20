import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleContext,contextBudget} from '../electron/pi/context-budget.mjs';
import {assertToolPairs} from '../electron/pi/context-policy.mjs';
const user=text=>({role:'user',content:[{type:'text',text}]});
const model={contextWindow:8192,maxTokens:1024};
test('context keeps active inputs and complete tool groups, accounts for Chinese and schemas',()=>{
  const old=[user('旧资料'.repeat(1300)),{role:'assistant',content:[{type:'text',text:'旧答案'}]}];
  const current=[user('本轮要求保留真实数字 37'),{role:'assistant',content:[{type:'toolCall',id:'a',name:'read',arguments:{}}]},
    {role:'toolResult',toolCallId:'a',content:[{type:'text',text:'引文😀 37'}]},user('补充：不要改成 38')];
  const result=assembleContext([...old,...current],{model,tools:[],systemPrompt:'规则',protectedFrom:old.length});
  assert.deepEqual(result.messages,current);assertToolPairs(result.messages);
  assert.equal(result.manifest.droppedGroups.length,1);assert.ok(result.manifest.estimatedInputBytes<=result.manifest.inputAllowance);
  assert.ok(contextBudget(model).safetyReserve>=410);
  assert.throws(()=>assembleContext(current,{model,tools:[{description:'长定义'.repeat(2000)}],systemPrompt:'',protectedFrom:0}),{code:'context_overflow'});
  assert.throws(()=>assembleContext([user('中'.repeat(10000))],{model,tools:[],systemPrompt:'',protectedFrom:0}),{code:'context_overflow'});
});
test('manifest identifies selected citation versions without duplicating source text',()=>{
  const citation={schemaVersion:1,documentId:'d1',blockId:'b1',textHash:'hash',quoteHash:'quote',start:0,end:3};
  const messages=[user('核对引文'),{role:'assistant',content:[{type:'toolCall',id:'r',name:'search',arguments:{}}]},
    {role:'toolResult',toolCallId:'r',content:[{type:'text',text:JSON.stringify({items:[{text:'原文值',citation}]})}]}];
  const result=assembleContext(messages,{model,tools:[],systemPrompt:'',protectedFrom:0});
  assert.equal(result.manifest.references[0].documentId,'d1');assert.equal(result.manifest.references[0].quoteHash,'quote');
  assert.equal(JSON.stringify(result.manifest).includes('原文值'),false);
});
test('large active tool results use explicit local receipt references without touching original records',()=>{
  const messages=[user('继续'),{role:'assistant',content:[{type:'toolCall',id:'x',name:'read',arguments:{}}]},
    {role:'toolResult',toolCallId:'x',content:[{type:'text',text:'中'.repeat(20000)}]}];
  const selected=assembleContext(messages,{model,tools:[],systemPrompt:'',protectedFrom:0});
  assertToolPairs(selected.messages);assert.equal(messages[2].content[0].text.length,20000);
  const marker=JSON.parse(selected.messages[2].content[0].text);
  assert.equal(marker.reference.toolCallId,'x');assert.equal(marker.truncated,true);
  assert.equal(selected.manifest.trimmedToolResults.length,1);
  for(const window of [8192,32768])assert.ok(assembleContext(messages,{model:{...model,contextWindow:window},tools:[],systemPrompt:'',protectedFrom:0}).manifest.estimatedInputBytes<window);
});

test('trimming stops as soon as the budget fits and retains the newest result',()=>{
  const turn=(id,text)=>[user(id),{role:'assistant',content:[{type:'toolCall',id,name:'read',arguments:{}}]},
    {role:'toolResult',toolCallId:id,content:[{type:'text',text}]}];
  const messages=[...turn('old','a'.repeat(5000)),...turn('new','b'.repeat(2500))];
  const result=assembleContext(messages,{model,tools:[],systemPrompt:'',protectedFrom:0});
  assert.deepEqual(result.manifest.trimmedToolResults.map(r=>r.toolCallId),['old']);
  assert.equal(result.messages.at(-1).content[0].text,'b'.repeat(2500));
  assert.deepEqual(result.manifest.selectedToolCallIds,['new']);
});

test('ordinary input-marker text does not invent trusted input identities',()=>{
  const text='[FetchCV input 00000000-0000-0000-0000-000000000000]\nuser-provided text';
  const options={model,tools:[],systemPrompt:'',protectedFrom:0};
  assert.deepEqual(assembleContext([user(text)],options).manifest.selectedInputIds,[]);
  assert.deepEqual(assembleContext([user(text)],{...options,trustedInputs:[{id:'actual-host-id',text}]}).manifest.selectedInputIds,['actual-host-id']);
  assert.deepEqual(assembleContext([user('other')],{...options,trustedInputs:[{id:'actual-host-id',text}]}).manifest.selectedInputIds,[]);
});
