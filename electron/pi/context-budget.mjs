import {createHash} from 'node:crypto';
import {assertToolPairs,trimToolResult} from './context-policy.mjs';

const overflow=()=>{throw Object.assign(new Error('当前输入和工具定义超出模型预算，请缩短本轮输入或选用已确认的大窗口模型'),{code:'context_overflow'});};
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function toolValue(message){
  const text=(message.content??[]).find(part=>part.type==='text')?.text;
  try{return JSON.parse(text);}catch{return text??'';}
}
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
// Recover space from historical, rereadable tool output before evicting a turn.
export function assembleContext(messages,{model,tools,systemPrompt,protectedFrom=messages.length,trustedInputs=[],pinnedMessages=[]}){
  assertToolPairs(messages);
  const budget=contextBudget(model),groups=[];
  for(let index=0;index<messages.length;index++){
    if(!groups.length||messages[index].role==='user')groups.push({start:index,messages:[]});
    groups.at(-1).messages.push(messages[index]);
  }
  let selected=groups.map(group=>({...group,originalHash:hash(group.messages),messages:structuredClone(group.messages)}));
  const droppedGroups=[],trimmedToolResults=[];
  // Count each serialized message once. Updates below account for array commas;
  // this is exactly the same conservative UTF-8 bound as serializing the payload.
  const baseBytes=bytes({systemPrompt,tools:tools.map(t=>({name:t.name,description:t.description,parameters:t.parameters})),messages:[]})+512;
  let messageCount=pinnedMessages.length+messages.length;
  let messageBytes=[...pinnedMessages,...messages].reduce((total,message)=>total+bytes(message)+1,0);
  const cost=()=>baseBytes+messageBytes-(messageCount?1:0);
  const trimmed=new Set();
  const compact=(message)=>{
    if(message.role!=='toolResult'||trimmed.has(message)||bytes(message)<2048)return;
    const stored=toolValue(message),reference=stored?._result_reference??stored?.reference??null;
    const originalHash=hash(message.content),before=bytes(message);
    // Bound the complete serialized message, including the escaping of text.
    // A reference can exceed this target when several tools need compaction;
    // retain its complete scope and allow the following tool to free more space.
    const maxSize=Math.min(4096,Math.max(384,before-(cost()-budget.inputAllowance)));
    const options={originalHash,force:true,measure:text=>bytes({...message,content:[{type:'text',text}]})};
    let text;
    try{text=trimToolResult(stored,maxSize,reference,options);}
    catch(error){
      if(error.code!=='context_overflow')throw error;
      if(!Number.isSafeInteger(error.requiredSize)||error.requiredSize>=before)return;
      text=trimToolResult(stored,error.requiredSize,reference,options);
    }
    const content=[{type:'text',text}],after=bytes({...message,content});
    if(after>=before)return;
    message.content=content;messageBytes+=after-before;trimmed.add(message);
    trimmedToolResults.push({toolCallId:message.toolCallId,originalHash,savedBytes:before-after});
  };
  historical: for(const group of selected){
    if(cost()<=budget.inputAllowance)break;
    if(group.start+group.messages.length>protectedFrom)break;
    for(const message of group.messages){
      if(message.role!=='toolResult')continue;
      const value=toolValue(message);
      if(value?._result_reference??value?.reference)compact(message);
      if(cost()<=budget.inputAllowance)break historical;
    }
  }
  while(cost()>budget.inputAllowance&&selected.length>1&&selected[0].start+selected[0].messages.length<=protectedFrom){
    const old=selected.shift();messageBytes-=old.messages.reduce((total,message)=>total+bytes(message)+1,0);messageCount-=old.messages.length;
    droppedGroups.push({start:old.start,count:old.messages.length,hash:old.originalHash});
  }
  if(cost()>budget.inputAllowance){
    trim: for(const group of selected)for(const message of group.messages){
      compact(message);
      if(cost()<=budget.inputAllowance)break trim;
    }
  }
  if(cost()>budget.inputAllowance)overflow();
  const output=[...pinnedMessages,...selected.flatMap(g=>g.messages)];assertToolPairs(output);
  // Gateway previews are already partial even when this assembly did not trim
  // them. They cannot authorize citations against an unseen complete receipt.
  const selectedToolCallIds=output.filter(m=>m.role==='toolResult'&&!m.isError&&!trimmed.has(m)&&toolValue(m)?.truncated!==true).map(m=>m.toolCallId);
  const userTexts=new Set(output.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:(m.content??[]).filter(p=>p.type==='text').map(p=>p.text).join('\n')));
  const selectedInputIds=[...new Set(trustedInputs.filter(input=>userTexts.has(input.text)).map(input=>input.id))];
  return {messages:output,manifest:{revision:'whole-turn-context-2',policy:'reference-first-whole-turn-v1',...budget,estimatedInputBytes:cost(),selectedToolCallIds,selectedInputIds,
    protectedFrom,selectedGroups:selected.map(g=>({start:g.start,count:g.messages.length,hash:hash(g.messages)})),droppedGroups,trimmedToolResults,references:references(output),
    reconstruction:'selection_over_durable_messages_not_a_lossless_summary'}};
}
