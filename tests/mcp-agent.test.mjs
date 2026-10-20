import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {activeWorkspace} from './helpers/active-workspace.mjs';
test('Agent can propose scoped MCP calls but never receives an execution or trust capability',async()=>{
 const f=await activeWorkspace('mcp-agent');
 try{
  const s=await f.request('mcp.configure',{name:'Agent synthetic',executable:process.execPath,args:[path.resolve('tests/fixtures/mcp-stdio-fixture.mjs'),'normal']});
  await f.request('mcp.control',{serverId:s.id,expectedRevision:s.revision,state:'trusted',acknowledgeLocalExecution:true});const d=await f.request('mcp.discover',{serverId:s.id});
  await f.request('mcp.grant',{serverId:s.id,expectedRevision:d.revision,expectedSchemaHash:d.schemaHash,tools:['echo']});
  const bridge=f.store.createAgentBridge(),api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
  const start=await api(`conversations/${f.conversation.id}/turns`,{request_id:randomUUID(),content:'Propose one synthetic echo',provider:{model:'fixture'}});
  assert.equal(start.tools.some(t=>/execute|configure|grant|trust/.test(t.name)),false);
  const call=(name,args,key=name)=>api(`runs/${start.run_id}/tools/${name}`,{arguments:args,idempotency_key:`pi:${start.user.id}:${key}`,tool_revision:start.tools.find(t=>t.name===name).revision});
  const available=(await call('list_mcp_tools',{serverId:s.id})).result;assert.equal(available.tools.length,1);
  const args={serverId:s.id,toolName:'echo',expectedToolHash:available.tools[0].hash,argumentsJson:JSON.stringify({text:'Agent synthetic'})};
  const proposal=(await call('propose_mcp_call',args)).result;assert.equal(proposal.automaticExecution,false);
  assert.deepEqual((await call('propose_mcp_call',args)).result,proposal,'idempotent proposal never creates a second operation');
  const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},op=await f.request('mcp.operation',{...scope,operationId:proposal.operationId});assert.equal(op.state,'pending');
  await assert.rejects(f.request('mcp.operation',{operationId:op.id}),{code:'mcp_operation_unavailable'});
  await f.request('mcp.execute',{...scope,operationId:op.id,operationHash:op.operationHash});
  const receipt=(await call('read_mcp_receipt',{operationId:op.id})).result;assert.equal(receipt.state,'completed');assert.equal(receipt.receipt.content[0].text,'Agent synthetic');
  const uiOp=await f.request('mcp.propose',{...scope,serverId:s.id,toolName:'echo',expectedToolHash:d.tools[0].hash,arguments:{text:'UI_ONLY_ARGUMENT_CANARY'}});
  const uiView=(await call('read_mcp_receipt',{operationId:uiOp.id},'ui-receipt')).result;
  assert.deepEqual(Object.keys(uiView).sort(),['operationId','receipt','state']);
  assert.equal(JSON.stringify(uiView).includes('UI_ONLY_ARGUMENT_CANARY'),false);assert.equal(JSON.stringify(uiView).includes(uiOp.operationHash),false);
 }finally{await f.store.close();}
});
