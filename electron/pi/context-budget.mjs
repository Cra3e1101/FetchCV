import {createHash} from 'node:crypto';
import {assertToolPairs} from './context-policy.mjs';

const overflow=()=>{throw Object.assign(new Error('当前输入和工具定义超出模型预算，请缩短本轮输入或选用已确认的大窗口模型'),{code:'context_overflow'});};
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function references(messages){
  const refs=new Map();
  for(const message of messages){
    if(message.role!=='toolResult')continue;
    for(const part of message.content??[]){
      if(part.type!=='text')continue;
      let result;try{result=JSON.parse(part.text);}catch{continue;}
      for(const item of Array.isArray(result?.items)?result.items:[result]){
        if(item?.citation?.schemaVersion===1){const c=item.citation;const ref={kind:'citation',documentId:c.documentId,blockId:c.blockId,textHash:c.textHash,start:c.start,end:c.end,quoteHash:c.quoteHash};refs.set(hash(ref),ref);}
        else if(item?.documentId&&item?.textHash){const ref={kind:'document',documentId:item.documentId,textHash:item.textHash,start:item.start,end:item.end};refs.set(hash(ref),ref);}
        else if(item?.id&&item?.source?.messageId&&item?.revision){const ref={kind:'memory',memoryId:item.id,revision:item.revision,messageId:item.source.messageId,sourceHash:item.source.hash};refs.set(hash(ref),ref);}
        if(refs.size>1000)overflow();
      }
    }
  }
  return [...refs.values()];
}
export function contextBudget(model){
  const window=Number(model.contextWindow),output=Number(model.maxTokens);
  if(!Number.isSafeInteger(window)||!Number.isSafeInteger(output)||window<1024||output<1)overflow();
  const safetyReserve=Math.max(1024,Math.ceil(window*.05)),inputAllowance=window-output-safetyReserve;
  if(inputAllowance<=0)overflow();
  return {window,outputAllowance:output,safetyReserve,inputAllowance,estimator:'utf8-bytes-conservative-text-bound-v1'};
}

// A context view only: the durable messages and Pi session are never rewritten.
// Each user turn is indivisible; all inputs in the running turn remain pinned.
export function assembleContext(messages,{model,tools,systemPrompt,protectedFrom=messages.length,trustedInputs=[],pinnedMessages=[]}){
  assertToolPairs(messages);
  const budget=contextBudget(model),groups=[];
  for(let index=0;index<messages.length;index++){
    if(!groups.length||messages[index].role==='user')groups.push({start:index,messages:[]});
    groups.at(-1).messages.push(messages[index]);
  }
  let selected=groups.map(group=>({...group,messages:structuredClone(group.messages)}));
  const droppedGroups=[],trimmedToolResults=[];
  const cost=()=>bytes({systemPrompt,tools:tools.map(t=>({name:t.name,description:t.description,parameters:t.parameters})),messages:[...pinnedMessages,...selected.flatMap(g=>g.messages)]})+512;
  while(cost()>budget.inputAllowance&&selected.length>1&&selected[0].start+selected[0].messages.length<=protectedFrom){
    const old=selected.shift();droppedGroups.push({start:old.start,count:old.messages.length,hash:hash(old.messages)});
  }
  if(cost()>budget.inputAllowance){
    trim: for(const group of selected)for(const message of group.messages){
      if(message.role!=='toolResult'||bytes(message)<2048)continue;
      const originalHash=hash(message.content);
      let stored;try{stored=JSON.parse(message.content?.find(p=>p.type==='text')?.text??'null');}catch{/* A text tool result need not be JSON. */}
      const reference=stored?._result_reference??stored?.reference??null;
      message.content=[{type:'text',text:JSON.stringify({truncated:true,summary:reference?'使用 reference 分页回读，勿重新执行原工具。':'预算不足，工具内容未完整展示；不可据此推断事实。',reference,preview:JSON.stringify(stored??'').slice(0,512),originalHash})}];
      trimmedToolResults.push({toolCallId:message.toolCallId,originalHash});
      if(cost()<=budget.inputAllowance)break trim;
    }
  }
  if(cost()>budget.inputAllowance)overflow();
  const output=[...pinnedMessages,...selected.flatMap(g=>g.messages)];assertToolPairs(output);
  const trimmed=new Set(trimmedToolResults.map(item=>item.toolCallId));
  const selectedToolCallIds=output.filter(m=>m.role==='toolResult'&&!m.isError&&!trimmed.has(m.toolCallId)).map(m=>m.toolCallId);
  const userTexts=new Set(output.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:(m.content??[]).filter(p=>p.type==='text').map(p=>p.text).join('\n')));
  const selectedInputIds=[...new Set(trustedInputs.filter(input=>userTexts.has(input.text)).map(input=>input.id))];
  return {messages:output,manifest:{revision:'whole-turn-context-2',...budget,estimatedInputBytes:cost(),selectedToolCallIds,selectedInputIds,
    protectedFrom,selectedGroups:selected.map(g=>({start:g.start,count:g.messages.length,hash:hash(g.messages)})),droppedGroups,trimmedToolResults,references:references(output),
    reconstruction:'selection_over_durable_messages_not_a_lossless_summary'}};
}
