import {McpManager} from '../mcp/manager.mjs';
import {ExtensionRegistry} from '../extensions/registry.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { WorkspaceManifestWriter,readWorkspaceManifest } from './workspace-manifest.mjs';
import { assertIntegrity } from './snapshot.mjs';
import { BlobStore,contentHash } from './blob-store.mjs';
import { canonicalJSON } from './legacy-archive.mjs';
import { readConversationHistory } from './history-reader.mjs';
import { readDocumentText,readDocumentVersions } from './document-reader.mjs';
import { readCatalogue,readArtifact,readArtifactVersions,readActivity } from './workspace-reader.mjs';
import {readJob,readJobObjects,readRun} from './object-reader.mjs';
import {exportArtifact} from './artifact-export.mjs';
import { validateStorageRequest } from '../contracts/storage.mjs';
import { ContractError,MAX_RPC_BYTES } from '../contracts/runtime.mjs';
import { WorkspaceAgentBridge } from '../app/workspace-agent-bridge.mjs';
import { AgentRepository } from './agent-repository.mjs';
import { readPendingApproval,decideArtifact } from './artifact-commands.mjs';
import { Ingestion } from './ingestion.mjs';
import {searchKnowledgeAsync,cancelSearchIndex,resolveCitation} from '../knowledge/retrieval.mjs';
import {MemoryStore} from '../knowledge/memory.mjs';
import {PersonalFacts} from '../knowledge/personal-facts.mjs';
import {verifyFeatureSchemas} from './feature-schema.mjs';
import {readSelectedMaterial} from './selected-material.mjs';

export class ApplicationStore {
  #db; #owner; #manifest; #blobs; #mcp; #root;
  static async open(root) {
    const owner=await WorkspaceManifestWriter.acquire(root);
    let db;
    try {
      const manifest=await readWorkspaceManifest(root);
      if(!manifest) throw new ContractError('workspace_not_activated');
      db=new DatabaseSync(manifest.databasePath,{timeout:5000});
      db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
      assertIntegrity(db);
      verifyFeatureSchemas(db);
      if(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='Memory'").get())new MemoryStore(db,manifest.workspaceId);
      const store=new ApplicationStore(db,owner,manifest,root);
      store.#recover(); return store;
    } catch(error) {db?.close();owner.close();throw error;}
  }
  constructor(db,owner,manifest,root) {this.#root=root;this.#db=db;this.#owner=owner;this.#manifest=manifest;this.#blobs=new BlobStore(manifest.blobRootPath);}
  get workspaceId(){return this.#manifest.workspaceId;}
  createIngestion(){if(!this.#db)throw new ContractError('storage_closed');return new Ingestion(this.#db,this.workspaceId,this.#blobs);}
  async importSelectedFile(raw,selectedPath){
    if(!this.#db)throw new ContractError('storage_closed');
    const request=validateStorageRequest(raw,this.workspaceId);
    if(request.method!=='source.import'||Object.hasOwn(request.payload,'contentBase64'))throw new ContractError('invalid_host_import');
    const ingestion=this.createIngestion();ingestion.scope(request.payload);
    return ingestion.capture(request,await readSelectedMaterial(selectedPath));
  }
  async importSelectedExtension(raw,selectedPath){
    if(!this.#db)throw new ContractError('storage_closed');
    const request=validateStorageRequest(raw,this.workspaceId);if(request.method!=='extension.list')throw new ContractError('invalid_host_import');
    const bytes=await readSelectedMaterial(selectedPath);if(bytes.length>262144)throw new ContractError('extension_size_limit');
    let bundle;try{bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ContractError('invalid_declarative_package');}
    return new ExtensionRegistry(this.#db,this.workspaceId).install(bundle);
  }
  mcp(){if(!this.#db)throw new ContractError('storage_closed');return this.#mcp??=new McpManager({db:this.#db,workspaceId:this.workspaceId,root:this.#root,authorize:p=>this.createIngestion().scope(p)});}
  closeMcp(){return this.#mcp?.close()??Promise.resolve();}
  createAgentBridge(){if(!this.#db)throw new ContractError('storage_closed');return new WorkspaceAgentBridge(this.#db,this.workspaceId,this.#blobs,()=>this.mcp());}
  #transaction(work) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {const result=work();this.#db.exec('COMMIT');return result;}
    catch(error) {this.#db.exec('ROLLBACK');throw error;}
  }
  #event(id,type,entityId,payload) {
    const now=new Date().toISOString(),workspace=this.#manifest.workspaceId;
    const seq=this.#db.prepare('SELECT coalesce(max(sequence),0)+1 AS n FROM Event WHERE workspace_id=?').get(workspace).n;
    this.#db.prepare('INSERT INTO Event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,workspace,null,'workspace_command',entityId,seq,type,canonicalJSON(payload),1,'app',now,now,now);
  }
  #recover() {
    this.#transaction(()=>{
      const workspace=this.#manifest.workspaceId, now=new Date().toISOString();
      const changes={};
      changes.runs=this.#db.prepare("UPDATE AgentRun SET state='interrupted',ended_at=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND state IN ('created','running','waiting_approval')").run(now,now,workspace).changes;
      changes.calls=this.#db.prepare("UPDATE ToolCall SET state='unknown',ended_at=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND state='running' AND policy_revision!='legacy-history-only'").run(now,now,workspace).changes;
      changes.approvals=this.#db.prepare("UPDATE Approval SET decision='expired',updated_at=?,revision=revision+1 WHERE workspace_id=? AND decision='pending' AND policy_revision IN ('m4-artifact-1','m4-artifact-2')").run(now,workspace).changes;
      changes.waitingCalls=this.#db.prepare("UPDATE ToolCall SET state='interrupted',ended_at=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND state='waiting_approval' AND policy_revision='m4-app-1'").run(now,now,workspace).changes;
      changes.messages=this.#db.prepare("UPDATE Message SET delivery_status='failed',updated_at=?,revision=revision+1 WHERE workspace_id=? AND delivery_status='streaming'").run(now,workspace).changes;
      changes.ingest=this.#db.prepare("UPDATE IngestJob SET state='pending',lease_owner=NULL,lease_until=NULL,updated_at=?,revision=revision+1 WHERE workspace_id=? AND state='running'").run(now,workspace).changes;
      if(Object.values(changes).some(Boolean)) this.#event(randomUUID(),'workspace.recovered',workspace,{changes,automaticReplay:false});
    });
  }
  async dispatch(raw) {
    if(!this.#db) throw new ContractError('storage_closed');
    const request=validateStorageRequest(raw,this.#manifest.workspaceId),p={...request.payload,workspaceId:request.workspaceId};
    let result;
    if(request.method==='workspace.info') {
      const row=this.#db.prepare('SELECT id,name,schema_version,revision FROM Workspace WHERE id=? AND deleted_at IS NULL').get(request.workspaceId);
      if(!row) throw new ContractError('workspace_unavailable');
      result={...row,generation:this.#manifest.generation};
    } else if(request.method.startsWith('mcp.')){
      const m=this.mcp(),op=request.method.slice(4);
      if(op==='read')result=m.describe(m.server(p.serverId));
      else if(op==='operation')result=m.read(p);
      else if(op==='list')result=m.list(p.afterId);
      else result=await m[op](p);
    } else if(request.method.startsWith('extension.')){
      const registry=new ExtensionRegistry(this.#db,this.workspaceId);
      if(request.method==='extension.list')result=registry.list(p.afterId);
      else if(request.method==='extension.read')result={...registry.describe(registry.row(p.installId)),bundle:registry.row(p.installId).bundle};
      else if(request.method==='extension.control')result=registry.control(p);
      else result=registry.select(p);
    } else if(request.method==='source.import') result=await this.createIngestion().capture(request);
    else if(request.method==='source.status') result=this.createIngestion().status(p);
    else if(['source.revoke','ingest.cancel','ingest.retry'].includes(request.method))result=this.createIngestion().control(request.method,p);
    else if(request.method==='knowledge.search')result=await searchKnowledgeAsync(this.#db,p);
    else if(request.method==='citation.resolve')result=resolveCitation(this.#db,p);
    else if(request.method==='fact.confirm')result=new PersonalFacts(this.#db,this.workspaceId).confirm(p);
    else if(request.method==='fact.revoke')result=new PersonalFacts(this.#db,this.workspaceId).revoke(p);
    else if(request.method==='memory.propose')result=new MemoryStore(this.#db,this.workspaceId).propose(p);
    else if(request.method==='memory.list')result=new MemoryStore(this.#db,this.workspaceId).list(p);
    else if(request.method==='memory.source')result=new MemoryStore(this.#db,this.workspaceId).readSource(p);
    else if(request.method==='memory.decide')result=new MemoryStore(this.#db,this.workspaceId).decide(p);
    else if(request.method==='workspace.catalogue') result=readCatalogue(this.#db,p);
    else if(request.method==='job.read')result=readJob(this.#db,p);
    else if(request.method==='job.objects')result=readJobObjects(this.#db,p);
    else if(request.method==='run.read')result=readRun(this.#db,p);
    else if(request.method==='artifact.export') result=exportArtifact(this.#db,p);
    else if(request.method==='artifact.versions')result=readArtifactVersions(this.#db,p);
    else if(request.method==='artifact.read') result=readArtifact(this.#db,p);
    else if(request.method==='activity.read') result=readActivity(this.#db,p);
    else if(request.method==='history.read') result=readConversationHistory(this.#db,p);
    else if(request.method==='document.versions')result=readDocumentVersions(this.#db,p);
    else if(request.method==='document.read') result=await readDocumentText(this.#db,this.#blobs,p);
    else if(request.method==='conversation.create')result=this.#createConversation(request,p);
    else if(request.method==='approval.read'){
      const {row,proposed,original}=readPendingApproval(this.#db,p);
      result={approvalId:row.id,operationHash:row.operation_hash,decision:row.decision,expiresAt:row.expires_at,proposed,original};
    }
    else if(request.method==='approval.decide')result=this.#transaction(()=>decideArtifact(this.#db,new AgentRepository(this.#db,p.workspaceId),p));
    else result=this.#append(request,p);
    if(Buffer.byteLength(JSON.stringify(result))>MAX_RPC_BYTES) throw new ContractError('response_too_large');
    return result;
  }
  #createConversation(request,p){
    return this.#transaction(()=>{
      const candidateId=p.candidateId??null,jobId=p.jobId??null,hash=contentHash(canonicalJSON(p));
      if(!this.#db.prepare('SELECT id FROM Workspace WHERE id=? AND deleted_at IS NULL').get(p.workspaceId))throw new ContractError('workspace_unavailable');
      if(candidateId&&!this.#db.prepare('SELECT id FROM Candidate WHERE workspace_id=? AND id=? AND deleted_at IS NULL').get(p.workspaceId,candidateId))throw new ContractError('candidate_unavailable');
      if(jobId&&(!candidateId||!this.#db.prepare('SELECT id FROM Job WHERE workspace_id=? AND id=? AND candidate_id=? AND deleted_at IS NULL').get(p.workspaceId,jobId,candidateId)))throw new ContractError('job_unavailable');
      const prior=this.#db.prepare('SELECT type,payload_json FROM Event WHERE workspace_id=? AND id=?').get(p.workspaceId,request.id);
      if(prior){const receipt=JSON.parse(prior.payload_json);if(prior.type!=='conversation.created'||receipt.requestHash!==hash)throw new ContractError('invocation_conflict');return receipt.result;}
      const now=new Date().toISOString(),id=randomUUID();
      this.#db.prepare("INSERT INTO Conversation(id,workspace_id,candidate_id,job_id,title,kind,created_at,updated_at) VALUES (?,?,?,?,?,'general',?,?)").run(id,p.workspaceId,candidateId,jobId,p.title,now,now);
      const result={id,title:p.title,candidate_id:candidateId,job_id:jobId};this.#event(request.id,'conversation.created',id,{requestHash:hash,result});return result;
    });
  }
  #append(request,p) {
    return this.#transaction(()=>{
      // Authorize even when returning a previous idempotency receipt.
      readConversationHistory(this.#db,{...p,limit:1});
      const hash=contentHash(canonicalJSON({method:request.method,payload:p}));
      const prior=this.#db.prepare('SELECT type,payload_json FROM Event WHERE workspace_id=? AND id=?').get(p.workspaceId,request.id);
      if(prior) {
        const receipt=JSON.parse(prior.payload_json);
        if(prior.type!=='conversation.append' || receipt.requestHash!==hash) throw new ContractError('invocation_conflict');
        return receipt.result;
      }
      const seq=this.#db.prepare('SELECT coalesce(max(sequence),0) AS n FROM Message WHERE workspace_id=? AND conversation_id=?').get(p.workspaceId,p.conversationId).n;
      if(seq!==p.expectedSequence) throw new ContractError('conversation_revision_conflict');
      const now=new Date().toISOString(),id=randomUUID(),body=canonicalJSON({schemaVersion:1,parts:[{type:'text',text:p.text}]});
      this.#db.prepare(`INSERT INTO Message(id,workspace_id,conversation_id,run_id,role,content_json,content_hash,sequence,delivery_status,supersedes_id,logical_message_id,created_at,updated_at)
        VALUES (?,?,?,NULL,'user',?,?,?,'completed',NULL,?,?,?)`).run(id,p.workspaceId,p.conversationId,body,contentHash(body),seq+1,id,now,now);
      this.#db.prepare('UPDATE Conversation SET revision=revision+1,updated_at=? WHERE workspace_id=? AND id=?').run(now,p.workspaceId,p.conversationId);
      const result={messageId:id,sequence:seq+1,automaticDelivery:false};
      this.#event(request.id,'conversation.append',p.conversationId,{requestHash:hash,result}); return result;
    });
  }
  cancelSearch(){if(this.#db)cancelSearchIndex(this.#db);}
  close() {this.cancelSearch();const finish=()=>{this.#db?.close();this.#db=null;this.#owner?.close();this.#owner=null;};if(this.#mcp)return this.#mcp.close().then(finish);finish();}
}
