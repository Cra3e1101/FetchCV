import {randomUUID} from 'node:crypto';
import {ContractError} from '../packages/contracts/runtime.mjs';

// Main-process lifecycle adapter. No writes are automatically retried after
// timeout/death; callers retain the invocation ID and consult its receipt.
export async function startStorageUtility({utilityProcess,entry,root,env=process.env,timeoutMs=15000,onExit=()=>{},onAgentEvent=()=>{}}) {
  const cleanEnv=Object.fromEntries(Object.entries(env).filter(([key])=>!['NODE_OPTIONS','ELECTRON_RUN_AS_NODE'].includes(key.toUpperCase())&&!/^FETCHCV_PROVIDER_/i.test(key)));
  const child=utilityProcess.fork(entry,[root],{env:cleanEnv,stdio:'pipe',serviceName:'FetchCV Application'});
  const pending=new Map();let ready=false,closed=false,stopping=false,workspaceId=null;
  let readyResolve,readyReject,closedResolve;
  const startup=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const stopped=new Promise(resolve=>{closedResolve=resolve;});
  const fail=()=>{
    closed=true;readyReject(new ContractError('storage_process_exited'));
    for(const item of pending.values()) {clearTimeout(item.timer);item.reject(new ContractError('storage_outcome_unknown'));}pending.clear();
  };
  const timer=setTimeout(()=>{readyReject(new ContractError('storage_startup_timeout'));child.kill();},timeoutMs);
  child.stdout?.resume();child.stderr?.resume(); // Never forward arbitrary process output to renderer.
  child.on('exit',()=>{clearTimeout(timer);fail();closedResolve();try{onExit();}catch{/* Observer cannot revive a stopped process. */}});
  child.on('error',()=>{fail();child.kill();});
  child.on('message',message=>{
    if(message?.kind==='ready' && !closed) {
      if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(message.workspaceId||'')){readyReject(new ContractError('storage_identity_invalid'));child.kill();return;}
      workspaceId=message.workspaceId;ready=true;clearTimeout(timer);readyResolve();
    }
    else if(message?.kind==='startup-failed') {readyReject(new ContractError('storage_startup_failed'));child.kill();}
    else if(message?.kind==='agent-event'){try{onAgentEvent(message.owner,message.event);}catch{/* observer failure does not replay */}}
    else if(message?.kind==='response') {
      const item=pending.get(message.token);if(!item)return;
      pending.delete(message.token);clearTimeout(item.timer);
      if(message.ok===true) item.resolve(message.result);
      else item.reject(new ContractError(/^[a-z_]{1,80}$/.test(message.error?.code)?message.error.code:'storage_failed'));
    }
  });
  await startup;
  const send=(kind,request,extra={},waitMs=timeoutMs)=>{
    if(!ready || closed || stopping) return Promise.reject(new ContractError('storage_unavailable'));
    const control=kind==='agent-request'&&['agent.cancel','agent.ack'].includes(request?.method)||kind==='request'&&['mcp.cancel','mcp.control'].includes(request?.method);
    if(pending.size>=32&&!control) return Promise.reject(new ContractError('storage_busy'));
    const token=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(token);reject(new ContractError('storage_outcome_unknown'));},waitMs);
      pending.set(token,{resolve,reject,timer});
      try {child.postMessage({kind,token,request,...extra});}
      catch {pending.delete(token);clearTimeout(timer);reject(new ContractError('storage_outcome_unknown'));}
    });
  };
  return {
    get workspaceId(){return workspaceId;},
    get pid(){return child.pid;},
    request:request=>send('request',request,{},request.method.startsWith('mcp.')?120000:timeoutMs),
    importSelectedExtension:(request,selectedPath)=>send('extension-import',request,{selectedPath}),
    importSelectedFile:(request,selectedPath)=>send('file-import',request,{selectedPath},120000),
    agentRequest:(request,owner,provider)=>send('agent-request',request,{owner,provider},Math.max(timeoutMs,Math.min(30*60000,Number(request.deadlineMs)-Date.now()+5000))),
    disposeAgentOwner(owner){if(!closed&&!stopping)child.postMessage({kind:'agent-owner-closed',owner});},
    async close() {
      if(!closed && !stopping) {stopping=true;child.postMessage({kind:'close'});}
      const timeout=setTimeout(()=>child.kill(),timeoutMs);
      try {await stopped;} finally {clearTimeout(timeout);}
    },
    terminate(){if(!closed)child.kill();return stopped;},
  };
}
