import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleContext,contextBudget} from '../electron/pi/context-budget.mjs';
import {assertToolPairs,contextMemoryBlock} from '../electron/pi/context-policy.mjs';
const user=text=>({role:'user',content:[{type:'text',text}]});
const model={contextWindow:8192,maxTokens:1024};

test('English memory guidance preserves Chinese history as data',()=>{
  const summary='用户已确认：保留原文“参与项目”，不得改成“主导项目”。';
  const memory=contextMemoryBlock({compacted_summary:summary});
  assert.match(memory,/not a new user instruction/);
  assert.match(memory,/untrusted data/);
  assert(memory.includes(summary));
  assert.equal(contextMemoryBlock({compacted_summary:''}),'');
});
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
  const reference={tool:'read_tool_result',arguments:{result_id:'a'.repeat(64),offset:0,limit:4000}};
  const text=JSON.stringify({text:'中'.repeat(20000),_result_reference:reference});
  const messages=[user('继续'),{role:'assistant',content:[{type:'toolCall',id:'x',name:'read',arguments:{}}]},
    {role:'toolResult',toolCallId:'x',content:[{type:'text',text}]}];
  const selected=assembleContext(messages,{model,tools:[],systemPrompt:'',protectedFrom:0});
  assertToolPairs(selected.messages);assert.equal(messages[2].content[0].text,text);
  const marker=JSON.parse(selected.messages[2].content[0].text);
  assert.deepEqual(marker.reference,reference);assert.equal(marker.truncated,true);
  assert.equal(selected.manifest.trimmedToolResults.length,1);
  for(const window of [8192,32768])assert.ok(assembleContext(messages,{model:{...model,contextWindow:window},tools:[],systemPrompt:'',protectedFrom:0}).manifest.estimatedInputBytes<window);
});

test('a rereadable historical result is compacted before discarding user constraints',()=>{
  const reference={tool:'read_tool_result',arguments:{result_id:'b'.repeat(64)}};
  const old=[user('沿用已经确认的岗位方向；不要虚构业绩'),{role:'assistant',content:[{type:'toolCall',id:'history',name:'read',arguments:{}}]},
    {role:'toolResult',toolCallId:'history',content:[{type:'text',text:JSON.stringify({data:{text:'长材料'.repeat(4000)},_result_reference:reference})}]},
    {role:'assistant',content:[{type:'text',text:'已确认岗位方向'}]}];
  const current=user('请继续修改'),messages=[...old,current],snapshot=structuredClone(messages);
  const packed=assembleContext(messages,{model,tools:[],systemPrompt:'rules',protectedFrom:old.length});
  assert.equal(packed.manifest.droppedGroups.length,0);
  assert.deepEqual(packed.messages[0],old[0]);assert.deepEqual(packed.messages.at(-1),current);
  assert.deepEqual(JSON.parse(packed.messages[2].content[0].text).reference,reference);
  assert.deepEqual(packed.manifest.selectedToolCallIds,[]);assertToolPairs(packed.messages);
  assert.deepEqual(messages,snapshot);
  assert.deepEqual(assembleContext(messages,{model,tools:[],systemPrompt:'rules',protectedFrom:old.length}),packed);
});

test('raw text compaction preserves a preview without inventing a reread reference',()=>{
  const messages=[user('核对数字'),{role:'assistant',content:[{type:'toolCall',id:'raw',name:'read',arguments:{}}]},
    {role:'toolResult',toolCallId:'raw',content:[{type:'text',text:'业绩 37，'.repeat(5000)}]}];
  const packed=assembleContext(messages,{model,tools:[],systemPrompt:'',protectedFrom:0});
  const view=JSON.parse(packed.messages[2].content[0].text);
  assert.equal(view.reference,null);assert(view.preview.includes('37'));assert.match(view.summary,/no reread reference is available/);
  assert.deepEqual(packed.manifest.selectedToolCallIds,[]);
});

test('gateway previews cannot authorize unseen receipt evidence even when they fit',()=>{
  const messages=[user('核对'),{role:'assistant',content:[{type:'toolCall',id:'partial',name:'read',arguments:{}}]},
    {role:'toolResult',toolCallId:'partial',content:[{type:'text',text:JSON.stringify({truncated:true,preview:'部分结果'})}]}];
  const packed=assembleContext(messages,{model,tools:[],systemPrompt:'',protectedFrom:0});
  assert.deepEqual(packed.manifest.trimmedToolResults,[]);
  assert.deepEqual(packed.manifest.selectedToolCallIds,[]);
});

test('incremental budget matches the serialized input including pinned memory and CJK escaping',()=>{
  const tools=[{name:'read',description:'读取',parameters:{type:'object'}}],systemPrompt='规则😀';
  const pinnedMessages=[user('已确认记忆')],messages=[user('中"\\\n😀'.repeat(40))];
  const packed=assembleContext(messages,{model,tools,systemPrompt,pinnedMessages,protectedFrom:0});
  assert.equal(packed.manifest.estimatedInputBytes,Buffer.byteLength(JSON.stringify({systemPrompt,tools,messages:packed.messages}))+512);
});

test('multiple oversized current receipts are compacted together with complete scoped references',()=>{
  const messages=[user('继续核查真实材料')];
  for(let i=0;i<3;i++)messages.push({role:'assistant',content:[{type:'toolCall',id:`many${i}`,name:'read',arguments:{}}]},
    {role:'toolResult',toolCallId:`many${i}`,content:[{type:'text',text:JSON.stringify({text:'中'.repeat(10000),_result_reference:{tool:'read_tool_result',arguments:{result_id:String(i).repeat(64)}}})}]});
  const packed=assembleContext(messages,{model,tools:[],systemPrompt:'',protectedFrom:0});
  assert.equal(packed.manifest.trimmedToolResults.length,3);assertToolPairs(packed.messages);
  assert(packed.manifest.estimatedInputBytes<=packed.manifest.inputAllowance);
  for(let i=0;i<3;i++)assert.equal(JSON.parse(packed.messages[2+i*2].content[0].text).reference.arguments.result_id,String(i).repeat(64));
});

test('omitting extra tool content is always marked as a partial result',()=>{
  const messages=[user('读取'),{role:'assistant',content:[{type:'toolCall',id:'multipart',name:'read',arguments:{}}]},
    {role:'toolResult',toolCallId:'multipart',content:[{type:'text',text:'small first part'},{type:'text',text:'中'.repeat(10000)}]}];
  const packed=assembleContext(messages,{model,tools:[],systemPrompt:'',protectedFrom:0});
  assert.equal(JSON.parse(packed.messages[2].content[0].text).truncated,true);
  assert.deepEqual(packed.manifest.selectedToolCallIds,[]);
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
