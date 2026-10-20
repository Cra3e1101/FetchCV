import {randomUUID} from 'node:crypto';
import {mkdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {ContractError} from '../contracts/runtime.mjs';
import {canonicalJSON} from '../storage/legacy-archive.mjs';
import {contentHash} from '../storage/blob-store.mjs';
import {ensureFeatureSchema} from '../storage/feature-schema.mjs';
import {sanitizeOutboundValue} from '../../electron/pi/context-policy.mjs';
import {StdioSession} from './stdio-session.mjs';
import {toolDescriptor,validateArguments,validateResult} from './tool-schema.mjs';
const fail=code=>{throw new ContractError(code);};
const ddl=`CREATE TABLE McpOperation(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES Workspace(id),server_id TEXT NOT NULL,scope_json TEXT NOT NULL,snapshot_json TEXT NOT NULL,args_json TEXT NOT NULL,operation_hash TEXT NOT NULL,state TEXT NOT NULL,receipt_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;`;
export class McpManager{
 constructor({db,workspaceId,root,authorize}){this.db=db;this.workspaceId=workspaceId;this.root=root;this.authorize=authorize;this.sessions=new Map();this.active=new Map();this.tasks=new Set();this.closing=false;ensureFeatureSchema(db,'mcp',ddl);
  db.prepare("UPDATE McpOperation SET state='unknown',updated_at=? WHERE workspace_id=? AND state='running'").run(new Date().toISOString(),workspaceId);
 }
 server(id){const row=this.db.prepare('SELECT * FROM McpServer WHERE workspace_id=? AND id=? AND deleted_at IS NULL').get(this.workspaceId,id);if(!row)fail('mcp_server_unavailable');return row;}
 list(afterId=''){const rows=this.db.prepare('SELECT id FROM McpServer WHERE workspace_id=? AND deleted_at IS NULL AND id>? ORDER BY id LIMIT 21').all(this.workspaceId,afterId);return {items:rows.slice(0,20).map(x=>{const {launch,tools,...summary}=this.describe(this.server(x.id));return {...summary,toolCount:tools.length};}),nextId:rows.length>20?rows[19].id:null};}
 describe(row){const launch=JSON.parse(row.launch_json);return {id:row.id,name:row.server_id,state:row.state,revision:row.revision,schemaHash:row.schema_hash,launch:launch.schemaVersion===2?launch:null,tools:launch.schemaVersion===2?Object.values(JSON.parse(row.tool_policies_json)):[],legacyRequiresReconfiguration:launch.schemaVersion!==2};}
 configure(p){
  if(typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.executable!=='string'||!path.isAbsolute(p.executable)||process.platform==='win32'&&path.extname(p.executable).toLowerCase()!=='.exe'||!Array.isArray(p.args)||p.args.length>32||p.args.some(x=>typeof x!=='string'||x.length>4096||x.includes('\0')))fail('invalid_mcp_launch');
  if(/(?:<|%3C)(?:CREDENTIAL|TOKEN|COOKIE|PRIVATE_KEY|PASSWORD|USER)(?:>|%3E)/i.test(canonicalJSON(sanitizeOutboundValue(p,{mode:'redacted_remote'})))||p.args.some(x=>/^--?(?:password|passwd|secret|token|api[-_]?key|authorization|cookie)(?:=|$)/i.test(x)))fail('mcp_secret_reference_required');
  const id=randomUUID(),now=new Date().toISOString();this.db.prepare("INSERT INTO McpServer(id,workspace_id,server_id,transport,launch_json,secret_refs_json,state,tool_policies_json,created_at,updated_at) VALUES (?,?,?,'stdio',?,'[]','disabled','{}',?,?)").run(id,this.workspaceId,p.name,canonicalJSON({schemaVersion:2,executable:p.executable,args:p.args}),now,now);return this.describe(this.server(id));
 }
 async control(p){const row=this.server(p.serverId);if(row.revision!==p.expectedRevision)fail('mcp_revision_conflict');
  if(!['trusted','disabled'].includes(p.state)||p.state==='trusted'&&(p.acknowledgeLocalExecution!==true||JSON.parse(row.launch_json).schemaVersion!==2))fail('mcp_trust_required');
  this.db.prepare("UPDATE McpServer SET state=?,schema_hash=NULL,tool_policies_json='{}',revision=revision+1,updated_at=? WHERE id=? AND workspace_id=?").run(p.state,new Date().toISOString(),row.id,this.workspaceId);await this.disconnect(row.id);return this.describe(this.server(row.id));
 }
 async disconnect(id){const promise=this.sessions.get(id);this.sessions.delete(id);if(promise)await promise.then(s=>s.close(),()=>{});}
 invalidate(id){const row=this.server(id);this.db.prepare("UPDATE McpServer SET state='requires_review',tool_policies_json='{}',schema_hash=NULL,revision=revision+1 WHERE id=? AND workspace_id=?").run(id,this.workspaceId);void this.disconnect(row.id);}
 async session(id){if(this.closing)fail('mcp_closed');const row=this.server(id);if(row.state!=='trusted')fail('mcp_trust_required');
  if(this.sessions.has(id)){const s=await this.sessions.get(id);if(!s.closed)return s;this.sessions.delete(id);}
  if(this.sessions.size>=2)fail('mcp_connection_limit');const launch=JSON.parse(row.launch_json);if(launch.schemaVersion!==2)fail('mcp_trust_required');
  const promise=(async()=>{let cwd=this.root;for(const name of ['derived','mcp',id]){cwd=path.join(cwd,name);try{await mkdir(cwd);}catch(e){if(e.code!=='EEXIST')throw e;}const info=await lstat(cwd);if(!info.isDirectory()||info.isSymbolicLink())fail('invalid_mcp_launch');}const s=await StdioSession.open({...launch,cwd,onToolsChanged:()=>this.invalidate(id)});
   const now=this.server(id);if(now.state!=='trusted'||now.revision!==row.revision){await s.close();fail('mcp_revision_conflict');}return s;})();
  void promise.then(s=>s.exited.then(()=>{if(this.sessions.get(id)===promise)this.sessions.delete(id);}),()=>{});
  this.sessions.set(id,promise);try{return await promise;}catch(e){if(this.sessions.get(id)===promise)this.sessions.delete(id);throw e;}
 }
 async discover(p){const initial=this.server(p.serverId),s=await this.session(p.serverId),raw=await s.tools();
  const row=this.server(p.serverId);if(row.state!=='trusted'||row.revision!==initial.revision)fail('mcp_revision_conflict');
  const descriptors=raw.map(t=>toolDescriptor(row.id,t));if(new Set(descriptors.map(t=>t.name)).size!==descriptors.length)fail('mcp_duplicate_tool');
  descriptors.sort((a,b)=>a.name.localeCompare(b.name));const hash=contentHash(canonicalJSON(descriptors)),policies=Object.fromEntries(descriptors.map(t=>[t.name,t]));
  if(row.schema_hash!==hash)this.db.prepare('UPDATE McpServer SET schema_hash=?,tool_policies_json=?,revision=revision+1,updated_at=? WHERE workspace_id=? AND id=?').run(hash,canonicalJSON(policies),new Date().toISOString(),this.workspaceId,row.id);
  return this.describe(this.server(row.id));
 }
 grant(p){const row=this.server(p.serverId);if(row.state!=='trusted'||row.revision!==p.expectedRevision||row.schema_hash!==p.expectedSchemaHash||!Array.isArray(p.tools)||p.tools.length>100||new Set(p.tools).size!==p.tools.length)fail('mcp_revision_conflict');
  const policies=JSON.parse(row.tool_policies_json);if(p.tools.some(name=>!Object.hasOwn(policies,name)))fail('mcp_tool_unavailable');
  for(const tool of Object.values(policies))tool.approved=p.tools.includes(tool.name);
  this.db.prepare('UPDATE McpServer SET tool_policies_json=?,revision=revision+1,updated_at=? WHERE workspace_id=? AND id=?').run(canonicalJSON(policies),new Date().toISOString(),this.workspaceId,row.id);void this.disconnect(row.id);return this.describe(this.server(row.id));
 }
 tool(serverId,name){const row=this.server(serverId),tool=JSON.parse(row.tool_policies_json)[name];if(row.state!=='trusted'||!tool?.approved)fail('mcp_capability_denied');return {row,tool};}
 propose(p){this.authorize(p);const {row,tool}=this.tool(p.serverId,p.toolName);if(p.expectedToolHash!==undefined&&p.expectedToolHash!==tool.hash)fail('mcp_revision_conflict');validateArguments(tool.inputSchema,p.arguments);
  if(canonicalJSON(sanitizeOutboundValue(p.arguments,{mode:'redacted_remote'}))!==canonicalJSON(p.arguments))fail('mcp_secret_reference_required');
  const id=randomUUID(),scope={candidateId:p.candidateId??null,jobId:p.jobId??null},snapshot={serverId:row.id,serverRevision:row.revision,launchHash:contentHash(row.launch_json),toolName:tool.name,toolHash:tool.hash,identity:tool.identity},args=canonicalJSON(p.arguments),hash=contentHash(canonicalJSON({id,workspaceId:this.workspaceId,scope,snapshot,args})),now=new Date().toISOString();
  this.db.prepare("INSERT INTO McpOperation VALUES (?,?,?,?,?,?,?,'pending',NULL,?,?)").run(id,this.workspaceId,row.id,canonicalJSON(scope),canonicalJSON(snapshot),args,hash,now,now);return this.read({...scope,operationId:id});
 }
 operation(p){this.authorize(p);const row=this.db.prepare('SELECT * FROM McpOperation WHERE workspace_id=? AND id=?').get(this.workspaceId,p.operationId);if(!row||row.scope_json!==canonicalJSON({candidateId:p.candidateId??null,jobId:p.jobId??null}))fail('mcp_operation_unavailable');return row;}
 operations(p){this.authorize(p);const scope=canonicalJSON({candidateId:p.candidateId??null,jobId:p.jobId??null});const rows=this.db.prepare('SELECT id,state,snapshot_json,created_at FROM McpOperation WHERE workspace_id=? AND scope_json=? AND id>? ORDER BY id LIMIT 21').all(this.workspaceId,scope,p.afterId??'');return {items:rows.slice(0,20).map(r=>({id:r.id,state:r.state,snapshot:JSON.parse(r.snapshot_json),createdAt:r.created_at})),nextId:rows.length>20?rows[19].id:null};}
 read(p){const r=this.operation(p);return {id:r.id,scope:JSON.parse(r.scope_json),snapshot:JSON.parse(r.snapshot_json),arguments:JSON.parse(r.args_json),operationHash:r.operation_hash,state:r.state,receipt:r.receipt_json?JSON.parse(r.receipt_json):null};}
 checkOperation(r){const snapshot=JSON.parse(r.snapshot_json),scope=JSON.parse(r.scope_json);const hash=contentHash(canonicalJSON({id:r.id,workspaceId:this.workspaceId,scope,snapshot,args:r.args_json}));if(hash!==r.operation_hash)fail('mcp_operation_corrupt');const {row,tool}=this.tool(r.server_id,snapshot.toolName);if(row.revision!==snapshot.serverRevision||contentHash(row.launch_json)!==snapshot.launchHash||tool.hash!==snapshot.toolHash)fail('mcp_revision_conflict');return {snapshot,tool};}
 execute(p){if(this.closing)return Promise.reject(new ContractError('mcp_closed'));const task=this.executeOperation(p);this.tasks.add(task);void task.finally(()=>this.tasks.delete(task)).catch(()=>{});return task;}
 async executeOperation(p){const r=this.operation(p);if(r.operation_hash!==p.operationHash)fail('mcp_operation_mismatch');if(['completed','failed'].includes(r.state))return this.read(p);if(Date.parse(r.created_at)+86400000<Date.now())fail('mcp_operation_expired');if(r.state!=='pending')fail('mcp_outcome_requires_review');
  this.checkOperation(r);await this.discover({serverId:r.server_id});this.operation(p);const {snapshot,tool}=this.checkOperation(r);
  const updated=this.db.prepare("UPDATE McpOperation SET state='running',updated_at=? WHERE workspace_id=? AND id=? AND state='pending'").run(new Date().toISOString(),this.workspaceId,r.id).changes;if(updated!==1)fail('mcp_outcome_requires_review');
  const cancel=new AbortController();this.active.set(r.id,cancel);
  try{const s=await this.session(r.server_id);this.operation(p);this.checkOperation(r);cancel.signal.throwIfAborted();const raw=await s.request('tools/call',{name:snapshot.toolName,arguments:JSON.parse(r.args_json)},{signal:cancel.signal});
   this.operation(p);this.checkOperation(r);validateResult(tool,raw);const receipt=sanitizeOutboundValue(raw,{mode:'redacted_remote'});if(Buffer.byteLength(canonicalJSON(receipt))>65536)fail('mcp_receipt_limit');
   this.db.prepare("UPDATE McpOperation SET state=?,receipt_json=?,updated_at=? WHERE workspace_id=? AND id=? AND state='running'").run(raw?.isError===true?'failed':'completed',canonicalJSON(receipt),new Date().toISOString(),this.workspaceId,r.id);return this.read(p);
  }catch(e){this.db.prepare("UPDATE McpOperation SET state='unknown',updated_at=? WHERE workspace_id=? AND id=? AND state='running'").run(new Date().toISOString(),this.workspaceId,r.id);throw e;}
  finally{this.active.delete(r.id);}
 }
 cancel(p){const r=this.operation(p);if(r.state==='pending')this.db.prepare("UPDATE McpOperation SET state='rejected',updated_at=? WHERE workspace_id=? AND id=?").run(new Date().toISOString(),this.workspaceId,r.id);else this.active.get(r.id)?.abort();return this.read(p);}
 async close(){this.closing=true;for(const controller of this.active.values())controller.abort();await Promise.allSettled([...this.sessions.keys()].map(id=>this.disconnect(id)));await Promise.allSettled([...this.tasks]);}
}
