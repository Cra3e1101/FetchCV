import {artifactVersions} from './artifact-versions.js';
import {mcpSettings} from './mcp-settings.js';
import {workspaceShell} from './workspace-shell.js';
import {documentVersions} from './document-versions.js';
'use strict';
import {sourceImportPanel} from './source-import.js';
import {showAnswerCitations,readableCitationMarkers} from './answer-citations.js';
import {factConfirmation,factReferences} from './personal-facts.js';
import {sourceReaderButton} from './source-reader.js';
import {objectTabs} from './object-tabs.js';
import {extensionSettings} from './extensions.js';
import {jobPanel,runPanel} from './object-panels.js';
import {showDraftReview} from './draft-review.js';
const el=id=>document.getElementById(id);
let workspaceId=null,kind='conversations',nextId=null,selection=null,nextSequence=null,lastSequence=0,epoch=0,ready=false,nextDocumentStart=null;
let activeAgent=null,approval=null;
const shell=workspaceShell();
import {memorySources} from './memory-sources.js';
let memoryDraft=null,memoryNextId=null,memoryItems=[];
const sources=sourceImportPanel({request,getWorkspaceId:()=>workspaceId,onChanged:async change=>{if(change?.revoked){el('knowledge-results').replaceChildren();if(selection?.source_id===change.revoked){el('detail').replaceChildren();el('document-more').hidden=true;}if(selection&&!el('memory-panel').hidden)await refreshMemory();}if(kind==='documents')await catalogue();},onOpen:async item=>{
  if(activeAgent||pendingNote)throw new Error('conversation_busy');shell.closeUtility();kind='documents';epoch++;
  for(const button of document.querySelectorAll('[data-kind]'))button.setAttribute('aria-pressed',String(button.dataset.kind===kind));
  await catalogue();await openItem(item);
}});
async function request(method,payload,id=crypto.randomUUID()) {
  const response=await window.workspaceStorage.request({v:1,id,workspaceId,method,payload});
  if(!response?.ok) throw new Error(response?.error?.code||'storage_unavailable');
  return response.result;
}
function failure(error){el('notice').textContent=`未能完成操作（${error.message}）。原有数据保持保留，请检查工作区状态。`;}
function content(value,parent=el('detail'),depth=0) {
  if(depth>20){parent.append(document.createTextNode('内容层级过深，请使用恢复包查看完整记录。'));return;}
  if(value===null || value===undefined)return;
  if(typeof value!=='object'){const p=document.createElement('pre');p.textContent=String(value);parent.append(p);return;}
  if(Array.isArray(value)){for(const item of value)content(item,parent,depth+1);return;}
  for(const [key,item] of Object.entries(value)){const d=document.createElement('details'),s=document.createElement('summary');s.textContent=key;d.open=true;d.append(s);content(item,d,depth+1);parent.append(d);}
}
extensionSettings({trigger:el('extension-settings'),request,getWorkspaceId:()=>workspaceId,onError:failure});
const scope=item=>({candidateId:item.candidate_id,jobId:item.job_id});
mcpSettings({trigger:el('mcp-settings'),request,getScope:()=>selection?scope(selection):{candidateId:null,jobId:null}});
const tabs=objectTabs({parent:el('object-tabs'),request,getEpoch:()=>epoch,
  canNavigate:()=>ready&&!activeAgent&&!pendingNote,
  onUnavailable:()=>{el('notice').textContent='这条记录已不可用，可能已撤回或删除。不会从缓存恢复正文。';},
  onOpen:async(nextKind,item,isLive)=>{kind=nextKind;const stamp=++epoch;for(const button of document.querySelectorAll('[data-kind]'))button.setAttribute('aria-pressed',String(button.dataset.kind===kind));await catalogue();if(stamp!==epoch||kind!==nextKind||!isLive())return;await openItem(item);},
});
async function history(append=false){
  const selected=selection,stamp=epoch;
  const result=await request('history.read',{...scope(selected),conversationId:selected.id,afterSequence:append?nextSequence:0,limit:50});
  if(stamp!==epoch)return;
  if(!append)el('detail').replaceChildren();
  for(const message of result.messages){const row=document.createElement('div');row.className=`message message-${message.role}`;el('detail').append(row);const h=document.createElement('h3');h.textContent=message.role==='user'?'你':message.role==='assistant'?'助手':'工具';row.append(h);for(const part of message.content.parts){if(part.type==='text')content(readableCitationMarkers(part.text,message.citationReview),row);else content('此消息还包含附件或引用内容，已保留在原记录中。',row);}
    showAnswerCitations(message.citationReview,{parent:row,scope:scope(selected),request,isCurrent:()=>stamp===epoch});
    const quote=message.content.parts.filter(p=>p.type==='text').map(p=>p.text).join('\n');
    if(message.role==='user'&&[...quote].length<=1000){const button=document.createElement('button');button.textContent='将这条消息设为记忆候选';button.addEventListener('click',()=>{if(activeAgent)return;memoryDraft={...scope(selected),messageId:message.id,start:0,end:[...quote].length};el('memory-quote').textContent=quote;el('memory-draft').hidden=false;shell.openUtility('memory');el('memory-subject').focus();});button.className='message-action';row.append(button);}
    lastSequence=message.sequence;}
  nextSequence=result.nextSequence;el('history-more').hidden=nextSequence===null;el('note-form').hidden=nextSequence!==null;el('agent-form').hidden=false;
  el('memory-panel').hidden=false;await refreshMemory();
}
async function openItem(item){
  if(pendingNote){el('notice').textContent='上次备注的保存结果待确认，请先重试保存，再切换记录。';return;}
  if(activeAgent){el('notice').textContent='请先等待本轮完成或停止生成。';return;}
  tabs.remember(kind,item);shell.select(kind,item);el('agent-status').textContent='';selection=item;const stamp=++epoch;lastSequence=0;nextDocumentStart=null;approval=null;el('approval-actions').hidden=true;el('agent-form').hidden=true;el('document-more').hidden=true;el('detail-title').textContent=item.title||'历史记录';el('detail').replaceChildren();el('note-form').hidden=true;el('history-more').hidden=true;el('notice').textContent='正在读取…';
  memoryDraft=null;el('memory-draft').hidden=true;el('memory-panel').hidden=true;el('knowledge-results').replaceChildren();el('knowledge-form').hidden=!['conversations','documents','artifacts'].includes(kind);
  sources.select(item,kind);
  try{
    if(kind==='conversations')await history();
    else if(kind==='approvals'){
      const result=await request('approval.read',{...scope(item),approvalId:item.id});if(stamp!==epoch)return;
      approval=result;showDraftReview(el('detail'),result);
      el('approval-actions').hidden=result.decision!=='pending';el('approval-accept').disabled=false;el('approval-reject').disabled=false;
    }
    else if(kind==='jobs'||kind==='runs'){
      const options={parent:el('detail'),request,scope:scope(item),runId:item.id,isCurrent:()=>stamp===epoch,onError:error=>{if(stamp===epoch)failure(error);},onNavigate:async(nextKind,nextItem)=>{
        if(stamp!==epoch||activeAgent||pendingNote)return;kind=nextKind;const nextStamp=++epoch;
        for(const b of document.querySelectorAll('[data-kind]'))b.setAttribute('aria-pressed',String(b.dataset.kind===kind));
        await catalogue();if(nextStamp===epoch)await openItem(nextItem);
      }};
      await (kind==='jobs'?jobPanel(options):runPanel(options));
    }
    else if(kind==='activities'){
      const result=await request('activity.read',{...scope(item),eventId:item.id});
      if(stamp!==epoch)return;content(result.record);
    }
    else {
      const result=kind==='artifacts'?await request('artifact.read',{...scope(item),artifactId:item.id,...(item.version_id?{versionId:item.version_id}:{})}):await request('document.read',{...scope(item),documentId:item.id,expectedHash:item.blob_hash,start:0});
      if(stamp!==epoch)return;content(kind==='artifacts'?result.content.content:result.text);
      if(kind==='documents'){nextDocumentStart=result.nextStart;el('document-more').hidden=nextDocumentStart===null;await documentVersions({parent:el('detail'),request,item,scope:scope(item),isCurrent:()=>stamp===epoch,onOpen:openItem,onError:failure});if(stamp!==epoch)return;}
      if(!el('detail').textContent.trim())content('此版本没有正文，原记录仍已保留。');
      if(kind==='artifacts'){await artifactVersions({parent:el('detail'),request,item,result,scope:scope(item),isCurrent:()=>stamp===epoch,onOpen:openItem,onError:failure});if(stamp!==epoch)return;}
      if(kind==='artifacts'&&result.status!=='draft'){
        const button=document.createElement('button');button.textContent='导出此版本与出处';
        button.addEventListener('click',async()=>{if(stamp!==epoch)return;button.disabled=true;
          try{const response=await window.workspaceStorage.exportFile({v:1,id:crypto.randomUUID(),workspaceId,method:'artifact.export',payload:{...scope(item),artifactId:item.id,versionId:result.versionId}});
            if(stamp!==epoch)return;if(!response?.ok)throw new Error(response?.error?.code||'export_failed');
            el('notice').textContent=response.result.cancelled?'已取消导出。':'已导出 JSON 归档，包含完整正文、版本和出处；未核验内容仍有标记。';
          }catch(error){if(stamp===epoch)failure(error);}finally{button.disabled=false;}
        });el('detail').append(button);
      }
      el('memory-panel').hidden=false;await refreshMemory();
    }
    if(stamp===epoch)el('notice').textContent=kind==='conversations'?'历史消息不会自动重放。':kind==='activities'?'此处仅保留历史记录，旧审批不会授权新操作，旧投递不会重新执行。':'此处展示保留的版本内容。';
  }catch(error){if(stamp===epoch)failure(error);}
}
async function catalogue(append=false){
  shell.catalogue(kind);
  const stamp=epoch,currentKind=kind;
  const result=await request('workspace.catalogue',{kind:currentKind,...(append?{afterId:nextId}:{}),limit:50});
  if(stamp!==epoch)return;
  if(!append)el('items').replaceChildren();
  for(const item of result.items){const li=document.createElement('li'),button=document.createElement('button');button.textContent=item.title||'历史记录';button.dataset.objectId=item.id;button.addEventListener('click',()=>void openItem(item));li.append(button);el('items').append(li);}
  if(!append&&!result.items.length){const li=document.createElement('li');li.textContent='还没有此类记录。';el('items').append(li);}
  nextId=result.nextId;el('more').hidden=nextId===null;
}
async function stateChanged(state){
  sources.ready(state.state==='ready');
  el('status').textContent=state.state==='ready'?'本地工作区已打开':state.state==='error'?'工作区打开失败':'正在打开…';
  if(state.state==='error'){ready=false;el('save').disabled=true;el('agent-send').disabled=true;el('agent-status').textContent='应用进程已停止；请重启后检查已保存的运行状态，不会自动重放。';return;}
  if(state.state!=='ready'||ready)return;
  ready=true;workspaceId=state.workspaceId;
  try{const name=(await request('workspace.info',{})).name;el('workspace-name').textContent=name==='Legacy workspace'?'历史工作区':name;await catalogue();await tabs.restore(workspaceId);}catch(error){failure(error);}
}
for(const button of document.querySelectorAll('[data-kind]'))button.addEventListener('click',()=>{
  if(!ready)return;if(activeAgent){el('notice').textContent='请先等待本轮完成或停止生成。';return;}if(pendingNote){el('notice').textContent='上次备注的保存结果待确认，请先重试保存。';return;}epoch++;kind=button.dataset.kind;shell.browse(kind);selection=null;approval=null;el('approval-actions').hidden=true;el('agent-form').hidden=true;el('note-form').hidden=true;el('history-more').hidden=true;el('document-more').hidden=true;el('detail').replaceChildren();el('detail-title').textContent='选择一条记录';
  for(const other of document.querySelectorAll('[data-kind]'))other.setAttribute('aria-pressed',String(other===button));void catalogue().catch(failure);
  sources.select(null,kind);memoryDraft=null;for(const id of ['memory-draft','memory-panel','knowledge-form'])el(id).hidden=true;el('knowledge-results').replaceChildren();
});
el('new-conversation').addEventListener('click',async()=>{
  if(!ready||activeAgent||pendingNote)return;
  try{const item=await request('conversation.create',{title:'普通对话'});kind='conversations';epoch++;
    for(const button of document.querySelectorAll('[data-kind]'))button.setAttribute('aria-pressed',String(button.dataset.kind===kind));
    await catalogue();await openItem(item);
  }catch(error){failure(error);}
});
async function agentRequest(method,payload,id=crypto.randomUUID()){
  const response=await window.workspaceStorage.agent({v:1,id,workspaceId,method,deadlineMs:Date.now()+10*60000,payload});
  if(!response?.ok)throw new Error(response?.error?.code||'runtime_failed');return response.result;
}
window.workspaceStorage.onAgentEvent(event=>{
  if(!activeAgent||event.streamId!==activeAgent.id)return;
  if(event.name==='status')el('agent-status').textContent=event.payload.label||'正在处理…';
  if(event.name==='delta')el('agent-status').textContent=event.payload.text;
  void agentRequest('agent.ack',{streamId:event.streamId,afterSeq:event.seq}).catch(()=>{});
});
el('agent-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!ready||activeAgent||!selection)return;
  activeAgent={id:crypto.randomUUID(),conversationId:selection.id};el('agent-send').disabled=true;el('agent-cancel').disabled=false;el('agent-status').textContent='正在开始…';
  try{await agentRequest('agent.turn',{conversationId:activeAgent.conversationId,content:el('agent-input').value},activeAgent.id);el('agent-input').value='';el('agent-status').textContent='回答已保存；如有草稿，可在待审阅草稿中确认。';}
  catch(error){el('agent-status').textContent=error.message==='cancelled'?'已停止；尚未消费的补充输入保留。':`未完成（${error.message}）。可检查历史记录；不会自动重试。`;}
  finally{activeAgent=null;el('agent-send').disabled=!ready;el('agent-cancel').disabled=true;await history().catch(failure);}
});
el('agent-cancel').addEventListener('click',()=>{if(activeAgent)void agentRequest('agent.cancel',{requestId:activeAgent.id}).catch(failure);});
for(const [id,decision]of [['approval-accept','approved'],['approval-reject','rejected']])el(id).addEventListener('click',async()=>{
  if(!ready||!approval||!selection)return;el('approval-accept').disabled=true;el('approval-reject').disabled=true;
  try{await request('approval.decide',{...scope(selection),approvalId:approval.approvalId,operationHash:approval.operationHash,decision});el('approval-actions').hidden=true;el('notice').textContent=decision==='approved'?'新版本已保存，原版本保留。':'草稿已拒绝，当前版本未改变。';await catalogue();}
  catch(error){failure(error);el('approval-accept').disabled=false;el('approval-reject').disabled=false;}
});
el('more').addEventListener('click',()=>void catalogue(true).catch(failure));
el('history-more').addEventListener('click',()=>void history(true).catch(failure));
el('document-more').addEventListener('click',async()=>{
  if(!selection || nextDocumentStart===null || el('document-more').disabled)return;
  const stamp=epoch;el('document-more').disabled=true;
  try{const result=await request('document.read',{...scope(selection),documentId:selection.id,expectedHash:selection.blob_hash,start:nextDocumentStart});
    if(stamp!==epoch)return;content(result.text);nextDocumentStart=result.nextStart;el('document-more').hidden=nextDocumentStart===null;
  }catch(error){if(stamp===epoch)failure(error);}finally{el('document-more').disabled=false;}
});
let pendingNote=null;
el('note-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!selection||el('save').disabled)return;el('save').disabled=true;
  pendingNote??={id:crypto.randomUUID(),payload:{...scope(selection),conversationId:selection.id,expectedSequence:lastSequence,text:el('note').value}};
  try{await request('conversation.append',pendingNote.payload,pendingNote.id);pendingNote=null;el('note').value='';await history();el('notice').textContent='备注已保存。';}
  catch(error){
    if(error.message==='conversation_revision_conflict'){pendingNote=null;await history().catch(failure);}
    failure(error);
  }finally{el('save').disabled=!ready;el('save').textContent=pendingNote?'重试保存':'保存备注';}
});
window.workspaceStorage.onState(state=>void stateChanged(state));
void window.workspaceStorage.status().then(stateChanged).catch(failure);

async function refreshMemory(append=false){
  if(!selection||!['conversations','documents','artifacts'].includes(kind))return;
  const stamp=epoch,selected=selection,result=await request('memory.list',{...scope(selected),includeInactive:true,...(append?{afterId:memoryNextId}:{})});
  if(stamp!==epoch)return;el('memory-items').replaceChildren();
  memoryNextId=result.nextId;memoryItems=append?[...memoryItems,...result.items]:result.items;result.items=memoryItems;
  factReferences({items:result.factReferences||[],parent:el('memory-items'),request,content,isCurrent:()=>stamp===epoch,onError:failure,onChanged:()=>refreshMemory()});
  if(!result.items.length){if(!result.factReferences?.length)el('memory-items').textContent='还没有记忆候选。';return;}
  for(const item of result.items){
    const card=document.createElement('div');card.className='memory-card';
    if(item.evidenceUnavailable){card.textContent='来源已不可用，此记忆不再提供给助手。';el('memory-items').append(card);continue;}
    const status={pending:'待确认',active:'已确认',rejected:'已拒绝',superseded:'已替代',revoked:'已撤回'}[item.status];
    content(`${item.subject} · ${item.predicate} · ${status}`,card);content(item.value,card);
    content(`适用范围：${item.jobId?'此岗位':item.candidateId?'此履历':'此工作区'}；适用起点：${item.validFrom||'未说明'}；截止：${item.validTo||'未设定'}；确认时间：${item.activatedAt||'未记录'}`,card);
    if(item.timeBasis==='legacy_start_unclassified')content('旧记录的起点含义尚未核对，已保留原值。',card);
    memorySources({item,card,request,content,isCurrent:()=>stamp===epoch,onError:failure});
    const previous=result.items.find(other=>other.id!==item.id&&other.status==='active'&&other.kind===item.kind&&other.subject===item.subject&&other.predicate===item.predicate&&other.candidateId===item.candidateId&&other.jobId===item.jobId);
    if(item.status==='pending'&&previous)content(`确认将替代：${previous.value}`,card);
    for(const decision of item.status==='pending'?['confirmed','rejected']:item.status==='active'?['revoked']:[]){
      const button=document.createElement('button');button.textContent={confirmed:previous?'确认并替代旧记忆':'确认这条记忆',rejected:'拒绝',revoked:'撤回这条记忆'}[decision];
      button.addEventListener('click',async()=>{if(!ready||activeAgent)return;button.disabled=true;try{await request('memory.decide',{candidateId:item.candidateId,jobId:item.jobId,memoryId:item.id,expectedRevision:item.revision,decision,...(decision==='confirmed'&&previous?{replaceId:previous.id}:{})});if(stamp===epoch)await refreshMemory();}catch(error){failure(error);button.disabled=false;}});card.append(button);
    }
    el('memory-items').append(card);
  }
  if(memoryNextId){const more=document.createElement('button');more.textContent='继续读取记忆';more.addEventListener('click',()=>{more.disabled=true;void refreshMemory(true).catch(error=>{failure(error);more.disabled=false;});});el('memory-items').append(more);}
}
el('memory-refresh').addEventListener('click',()=>void refreshMemory().catch(failure));
el('memory-cancel').addEventListener('click',()=>{memoryDraft=null;el('memory-draft').hidden=true;});
el('memory-draft').addEventListener('submit',async event=>{
  event.preventDefault();if(!ready||!memoryDraft||activeAgent)return;const stamp=epoch,button=event.submitter;button.disabled=true;
  try{const result=await request('memory.propose',{...memoryDraft,kind:el('memory-kind').value,subject:el('memory-subject').value,predicate:el('memory-predicate').value});if(stamp!==epoch)return;memoryDraft=null;el('memory-draft').hidden=true;await refreshMemory();el('notice').textContent=result.status==='active'?'相同内容已关联到原有记忆，原始证据均保留。':'候选已保存，请核对后确认。';}catch(error){failure(error);}finally{button.disabled=false;}
});
el('knowledge-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!ready||!selection)return;const stamp=epoch,selected=selection;el('knowledge-results').textContent='正在搜索…';
  try{const result=await request('knowledge.search',{...scope(selected),query:el('knowledge-query').value});if(stamp!==epoch)return;el('knowledge-results').replaceChildren();
    if(!result.items.length){el('knowledge-results').textContent='未找到可用原文，请尝试更具体的关键词。';return;}
    for(const item of result.items){const card=document.createElement('div');content(item.title,card);content(item.text,card);const button=document.createElement('button');button.textContent='核对原文引用';button.addEventListener('click',async()=>{try{const resolved=await request('citation.resolve',{...scope(selected),citation:item.citation});if(stamp!==epoch)return;button.textContent=resolved.current?'原文与引用一致':'这是历史版本引用';content(resolved.text,card);}catch(error){failure(error);}});card.append(button);el('knowledge-results').append(card);}
    for(const [index,card]of [...el('knowledge-results').children].entries()){
      const item=result.items[index];
      sourceReaderButton({parent:card,request,scope:scope(selected),citation:item.citation,title:item.title,page:item.page,isCurrent:()=>stamp===epoch});
      factConfirmation({card,item,scope:scope(selected),request,isCurrent:()=>stamp===epoch,onError:failure});
    }
  }catch(error){if(stamp===epoch){el('knowledge-results').replaceChildren();failure(error);}}
});
