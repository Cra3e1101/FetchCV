import test from 'node:test';import assert from 'node:assert/strict';import {fork} from 'node:child_process';import {once} from 'node:events';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {activeWorkspace} from './helpers/active-workspace.mjs';
test('MCP cancel and revoke pass a held worker import without waiting for the ordinary queue',{timeout:25000},async()=>{
 const f=await activeWorkspace('mcp-worker-control');await f.store.close();
 const child=fork(path.resolve('tests/fixtures/mcp-queued-worker.mjs'),[f.root],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 const pending=new Map();child.on('exit',()=>{for(const p of pending.values())p.reject(new Error('worker exited'));pending.clear();});let heldResolve;const ready=new Promise((resolve,reject)=>{child.on('error',reject);child.on('message',m=>{if(m.kind==='ready')resolve();if(m.kind==='test-import-held')heldResolve?.();if(m.kind==='response'){const p=pending.get(m.token);if(p){pending.delete(m.token);m.ok?p.resolve(m.result):p.reject(Object.assign(new Error(m.error.code),m.error));}}});});
 const deadline=setTimeout(()=>child.kill(),20000);const call=(method,payload={},kind='request')=>new Promise((resolve,reject)=>{const token=randomUUID();pending.set(token,{resolve,reject});child.send({kind,token,request:{v:1,id:randomUUID(),workspaceId:f.workspaceId,method,payload}});});
 try{await ready;
  for(const action of ['mcp.cancel','mcp.control']){
   const s=await call('mcp.configure',{name:action,executable:process.execPath,args:[path.resolve('tests/fixtures/mcp-stdio-fixture.mjs'),'hang']});
   await call('mcp.control',{serverId:s.id,expectedRevision:1,state:'trusted',acknowledgeLocalExecution:true});const d=await call('mcp.discover',{serverId:s.id});const granted=await call('mcp.grant',{serverId:s.id,expectedRevision:d.revision,expectedSchemaHash:d.schemaHash,tools:['echo']});
   const op=await call('mcp.propose',{serverId:s.id,toolName:'echo',expectedToolHash:d.tools[0].hash,arguments:{text:'synthetic'}});
   const execution=assert.rejects(call('mcp.execute',{operationId:op.id,operationHash:op.operationHash}));
   let state;for(let i=0;i<100;i++){state=(await call('mcp.operation',{operationId:op.id})).state;if(state==='running')break;await new Promise(r=>setTimeout(r,10));}assert.equal(state,'running');
   const held=new Promise(resolve=>{heldResolve=resolve;});const importing=call('source.import',{},'file-import');await held;
   let timeout;try{await Promise.race([call(action,action==='mcp.cancel'?{operationId:op.id}:{serverId:s.id,expectedRevision:granted.revision,state:'disabled'}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('safety control waited behind import')),3000);})]);}finally{clearTimeout(timeout);}
   await execution;child.send({kind:'test-release-import'});await importing;
   assert.equal((await call('mcp.operation',{operationId:op.id})).state,'unknown');
  }
  const stopped=once(child,'exit');child.send({kind:'close'});assert.equal((await stopped)[0],0);
 }finally{clearTimeout(deadline);if(child.exitCode===null)child.kill();}
});
