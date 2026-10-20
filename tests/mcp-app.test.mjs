import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {activeWorkspace} from './helpers/active-workspace.mjs';
test('APP MCP requires pinned tool hash and persists scope-bound receipts without replay',async()=>{
 const f=await activeWorkspace('mcp-app');
 try{
  const s=await f.request('mcp.configure',{name:'APP synthetic echo',executable:process.execPath,args:[path.resolve('tests/fixtures/mcp-stdio-fixture.mjs'),'normal']});
  assert.equal(s.state,'disabled');await assert.rejects(f.request('mcp.discover',{serverId:s.id}),{code:'mcp_trust_required'});
  await f.request('mcp.control',{serverId:s.id,expectedRevision:s.revision,state:'trusted',acknowledgeLocalExecution:true});
  const d=await f.request('mcp.discover',{serverId:s.id});await f.request('mcp.grant',{serverId:s.id,expectedRevision:d.revision,expectedSchemaHash:d.schemaHash,tools:['echo']});
  const base={serverId:s.id,toolName:'echo',arguments:{text:'APP approved synthetic'}};
  await assert.rejects(f.request('mcp.propose',base),{code:'invalid_payload'});
  await assert.rejects(f.request('mcp.propose',{...base,expectedToolHash:'stale'}),{code:'mcp_revision_conflict'});
  const op=await f.request('mcp.propose',{...base,expectedToolHash:d.tools[0].hash});
  assert.equal((await f.request('mcp.operations',{})).items[0].state,'pending');
  const result=await f.request('mcp.execute',{operationId:op.id,operationHash:op.operationHash});assert.equal(result.state,'completed');
  assert.equal(result.receipt.content[0].text,base.arguments.text);
  assert.deepEqual(await f.request('mcp.execute',{operationId:op.id,operationHash:op.operationHash}),result);
  assert.equal(Object.hasOwn((await f.request('mcp.list',{})).items[0],'tools'),false);
 }finally{await f.store.close();}
});

test('APP MCP cancellation is concurrent and closing waits for interrupted receipts',async()=>{
 const f=await activeWorkspace('mcp-app-cancel');
 try{
  const s=await f.request('mcp.configure',{name:'APP synthetic hang',executable:process.execPath,args:[path.resolve('tests/fixtures/mcp-stdio-fixture.mjs'),'hang']});
  await f.request('mcp.control',{serverId:s.id,expectedRevision:s.revision,state:'trusted',acknowledgeLocalExecution:true});
  const d=await f.request('mcp.discover',{serverId:s.id});await f.request('mcp.grant',{serverId:s.id,expectedRevision:d.revision,expectedSchemaHash:d.schemaHash,tools:['echo']});
  for(const close of [false,true]){
   const op=await f.request('mcp.propose',{serverId:s.id,toolName:'echo',expectedToolHash:d.tools[0].hash,arguments:{text:'synthetic cancel'}});
   const task=assert.rejects(f.request('mcp.execute',{operationId:op.id,operationHash:op.operationHash}));
   const deadline=Date.now()+3000;while((await f.request('mcp.operation',{operationId:op.id})).state!=='running'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal((await f.request('mcp.operation',{operationId:op.id})).state,'running');
   if(close)await f.store.closeMcp();else await f.request('mcp.cancel',{operationId:op.id});await task;
   assert.equal((await f.request('mcp.operation',{operationId:op.id})).state,'unknown');
  }
 }finally{await f.store.close();}
});
