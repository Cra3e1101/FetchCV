import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {activeWorkspace} from './helpers/active-workspace.mjs';import {McpManager} from '../packages/mcp/manager.mjs';
test('MCP calls require server trust, tool grant and exact one-shot operation approval',async()=>{
 const f=await activeWorkspace('mcp-manager'),m=new McpManager({db:f.store.createIngestion().db,workspaceId:f.workspaceId,root:f.root,authorize:p=>f.store.createIngestion().scope(p)});
 try{
  assert.throws(()=>m.configure({name:'Inline secret forbidden',executable:process.execPath,args:['--token','SYNTHETIC-SECRET']}),{code:'mcp_secret_reference_required'});
  const server=m.configure({name:'Synthetic echo',executable:process.execPath,args:[path.resolve('tests/fixtures/mcp-stdio-fixture.mjs'),'normal']});
  await assert.rejects(m.discover({serverId:server.id}),{code:'mcp_trust_required'});
  await m.control({serverId:server.id,expectedRevision:server.revision,state:'trusted',acknowledgeLocalExecution:true});
  const discovered=await m.discover({serverId:server.id}),scope={candidateId:null,jobId:null};
  assert.throws(()=>m.propose({...scope,serverId:server.id,toolName:'echo',arguments:{text:'synthetic'}}),{code:'mcp_capability_denied'});
  const granted=m.grant({serverId:server.id,expectedRevision:discovered.revision,expectedSchemaHash:discovered.schemaHash,tools:['echo']});
  const op=m.propose({...scope,serverId:server.id,toolName:'echo',arguments:{text:'synthetic'}}),duplicate=m.propose({...scope,serverId:server.id,toolName:'echo',arguments:{text:'synthetic'}});assert.notEqual(op.operationHash,duplicate.operationHash);
  await assert.rejects(m.execute({...scope,operationId:op.id,operationHash:'wrong'}),{code:'mcp_operation_mismatch'});
  assert.throws(()=>m.read({...scope,candidateId:f.conversation.candidate_id,operationId:op.id}),{code:'mcp_operation_unavailable'});
  const result=await m.execute({...scope,operationId:op.id,operationHash:op.operationHash});assert.equal(result.state,'completed');assert.equal(result.receipt.content[0].text,'synthetic');
  assert.deepEqual(await m.execute({...scope,operationId:op.id,operationHash:op.operationHash}),result,'repeat approve returns receipt, not another call');
  await m.control({serverId:server.id,expectedRevision:granted.revision,state:'disabled'});
  await assert.rejects(m.execute({...scope,operationId:duplicate.id,operationHash:duplicate.operationHash}),{code:'mcp_capability_denied'});
 }finally{await m.close();f.store.close();}
});
test('schema change notification revokes grants and leaves dispatched outcome unknown',async()=>{
 const f=await activeWorkspace('mcp-manager-change'),m=new McpManager({db:f.store.createIngestion().db,workspaceId:f.workspaceId,root:f.root,authorize:p=>f.store.createIngestion().scope(p)});
 try{const server=m.configure({name:'Synthetic changing schema',executable:process.execPath,args:[path.resolve('tests/fixtures/mcp-stdio-fixture.mjs'),'changed']});await m.control({serverId:server.id,expectedRevision:1,state:'trusted',acknowledgeLocalExecution:true});const d=await m.discover({serverId:server.id});m.grant({serverId:server.id,expectedRevision:d.revision,expectedSchemaHash:d.schemaHash,tools:['echo']});const op=m.propose({serverId:server.id,toolName:'echo',arguments:{text:'synthetic'}});await assert.rejects(m.execute({operationId:op.id,operationHash:op.operationHash}));assert.equal(m.read({operationId:op.id}).state,'unknown');assert.equal(m.server(server.id).state,'requires_review');}
 finally{await m.close();f.store.close();}
});
