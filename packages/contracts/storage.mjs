import { ContractError,MAX_RPC_BYTES } from './runtime.mjs';

const fields={
  'mcp.list':['afterId'],
  'mcp.read':['serverId'],
  'mcp.configure':['name','executable','args'],
  'mcp.control':['serverId','expectedRevision','state','acknowledgeLocalExecution'],
  'mcp.discover':['serverId'],
  'mcp.grant':['serverId','expectedRevision','expectedSchemaHash','tools'],
  'mcp.propose':['candidateId','jobId','serverId','toolName','expectedToolHash','arguments'],
  'mcp.operations':['candidateId','jobId','afterId'],
  'mcp.operation':['candidateId','jobId','operationId'],
  'mcp.execute':['candidateId','jobId','operationId','operationHash'],
  'mcp.cancel':['candidateId','jobId','operationId'],
  'extension.list':['afterId'],
  'extension.read':['installId'],
  'extension.control':['installId','expectedRevision','expectedHash','state','grants'],
  'extension.select':['installId','agentId','expectedRevision','expectedHash'],
  'job.read':['candidateId','jobId'],
  'job.objects':['candidateId','jobId','kind','afterId','limit'],
  'run.read':['candidateId','jobId','runId','afterId'],
  'fact.confirm':['candidateId','jobId','citation'],
  'fact.revoke':['candidateId','jobId','factReferenceId','expectedRevision'],
  'source.import':['candidateId','jobId','sourceId','expectedRevision','title','format','contentBase64'],
  'source.status':['candidateId','jobId','sourceId'],
  'source.revoke':['candidateId','jobId','sourceId','expectedRevision'],
  'ingest.cancel':['candidateId','jobId','sourceId','ingestId'],
  'ingest.retry':['candidateId','jobId','sourceId','ingestId'],
  'knowledge.search':['candidateId','jobId','query','limit','sourceId','asOf','sourceTypes','pinnedIds','maxTokens'],
  'citation.resolve':['candidateId','jobId','citation'],
  'memory.propose':['candidateId','jobId','messageId','start','end','kind','subject','predicate','validFrom','validTo'],
  'memory.list':['candidateId','jobId','includeInactive','asOf','afterId','limit'],
  'memory.source':['candidateId','jobId','memoryId','evidenceId'],
  'memory.decide':['candidateId','jobId','memoryId','expectedRevision','decision','replaceId'],
  'workspace.info':[],
  'history.read':['installId','agentId','runId','objectId','candidateId','jobId','conversationId','afterSequence','limit'],
  'document.versions':['candidateId','jobId','documentId','afterVersion'],
  'document.read':['candidateId','jobId','documentId','expectedHash','start','end'],
  'conversation.append':['installId','agentId','runId','objectId','candidateId','jobId','conversationId','expectedSequence','text'],
  'workspace.catalogue':['kind','afterId','limit','objectId'],
  'artifact.versions':['candidateId','jobId','artifactId','beforeVersion'],
  'artifact.read':['candidateId','jobId','artifactId','versionId'],
  'artifact.export':['candidateId','jobId','artifactId','versionId'],
  'activity.read':['candidateId','jobId','eventId'],
  'conversation.create':['candidateId','jobId','title'],
  'approval.read':['candidateId','jobId','approvalId'],
  'approval.decide':['candidateId','jobId','approvalId','operationHash','decision'],
};
export function validateStorageRequest(raw,workspaceId) {
  let bytes;
  try {bytes=JSON.stringify(raw);} catch {throw new ContractError('invalid_payload');}
  if(!bytes || Buffer.byteLength(bytes)>MAX_RPC_BYTES) throw new ContractError('payload_too_large');
  if(!raw || Object.keys(raw).some(key=>!['v','id','method','workspaceId','payload'].includes(key)) || raw.v!==1)
    throw new ContractError('protocol_version');
  if(typeof raw.id!=='string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(raw.id)) throw new ContractError('invalid_request_id');
  if(raw.workspaceId!==workspaceId) throw new ContractError('workspace_mismatch');
  if(typeof raw.method!=='string' || !Object.hasOwn(fields,raw.method)) throw new ContractError('method_not_allowed');
  const p=raw.payload;
  if(!p || typeof p!=='object' || Array.isArray(p) || Object.keys(p).some(key=>!fields[raw.method].includes(key))) throw new ContractError('invalid_payload');
  if(['mcp.read','mcp.control','mcp.discover','mcp.grant','mcp.propose'].includes(raw.method)&&!p.serverId)throw new ContractError('invalid_payload');
  if(['mcp.operation','mcp.execute','mcp.cancel'].includes(raw.method)&&!p.operationId)throw new ContractError('invalid_payload');
  if(raw.method==='mcp.execute'&&!p.operationHash)throw new ContractError('invalid_payload');
  if(raw.method==='mcp.propose'&&(!p.expectedToolHash||typeof p.toolName!=='string'||!Object.hasOwn(p,'arguments')))throw new ContractError('invalid_payload');
  if(raw.method==='fact.revoke'&&(typeof p.factReferenceId!=='string'||!p.factReferenceId||p.factReferenceId.length>100||!Number.isSafeInteger(p.expectedRevision)))throw new ContractError('invalid_payload');
  for(const key of ['serverId','operationId','expectedSchemaHash','expectedToolHash','installId','agentId','runId','objectId','candidateId','jobId','conversationId','documentId','expectedHash','artifactId','versionId','afterId','eventId','approvalId','operationHash','sourceId','ingestId','messageId','memoryId','replaceId','evidenceId']) {
    if(p[key]!=null && (typeof p[key]!=='string' || !p[key] || p[key].length>100)) throw new ContractError('invalid_payload');
  }
  for(const key of ['beforeVersion','afterVersion','afterSequence','limit','start','end','expectedSequence','expectedRevision'])
    if(p[key]!==undefined && (!Number.isSafeInteger(p[key]) || p[key]<0)) throw new ContractError('invalid_payload');
  if(raw.method.startsWith('history.') || raw.method==='conversation.append') {
    if(typeof p.conversationId!=='string' || !p.conversationId) throw new ContractError('invalid_payload');
  }
  if(['document.read','document.versions'].includes(raw.method) && !p.documentId) throw new ContractError('invalid_payload');
  if(['source.status','source.revoke','ingest.cancel','ingest.retry'].includes(raw.method)&&!p.sourceId)throw new ContractError('invalid_payload');
  if(raw.method.startsWith('ingest.')&&!p.ingestId)throw new ContractError('invalid_payload');
  if(raw.method==='memory.propose'&&(!p.messageId||!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)))throw new ContractError('invalid_payload');
  if(raw.method==='memory.decide'&&(!p.memoryId||!Number.isSafeInteger(p.expectedRevision)))throw new ContractError('invalid_payload');
  if(raw.method==='memory.source'&&!p.memoryId)throw new ContractError('invalid_payload');
  if(['artifact.read','artifact.export','artifact.versions'].includes(raw.method) && !p.artifactId) throw new ContractError('invalid_payload');
  if(['extension.read','extension.control'].includes(raw.method)&&!p.installId)throw new ContractError('invalid_payload');
  if(raw.method==='extension.control'&&(!Number.isSafeInteger(p.expectedRevision)||!Array.isArray(p.grants)||p.grants.length>16))throw new ContractError('invalid_payload');
  if(raw.method.startsWith('job.')&&(!p.jobId||!p.candidateId))throw new ContractError('invalid_payload');
  if(raw.method==='run.read'&&!p.runId)throw new ContractError('invalid_payload');
  if(raw.method==='activity.read' && !p.eventId) throw new ContractError('invalid_payload');
  if(raw.method.startsWith('approval.') && !p.approvalId)throw new ContractError('invalid_payload');
  if(raw.method==='approval.decide' && (!p.operationHash||!['approved','rejected'].includes(p.decision)))throw new ContractError('invalid_payload');
  if(raw.method==='conversation.create' && (typeof p.title!=='string'||!p.title.trim()||p.title.length>200))throw new ContractError('invalid_payload');
  if(raw.method==='workspace.catalogue' && !['conversations','artifacts','documents','activities','approvals','jobs','runs'].includes(p.kind)) throw new ContractError('invalid_payload');
  if(raw.method==='conversation.append' && (!Number.isSafeInteger(p.expectedSequence) || typeof p.text!=='string' || !p.text.trim() || p.text.length>12000)) throw new ContractError('invalid_payload');
  return structuredClone(raw);
}
