import {randomUUID} from 'node:crypto';
import {ContractError} from '../contracts/runtime.mjs';
import {canonicalJSON} from './legacy-archive.mjs';
import {contentHash} from './blob-store.mjs';
import {readConversationHistory} from './history-reader.mjs';

const terminal=new Set(['completed','failed','cancelled','interrupted','unknown']);
const textOf=content=>content.parts.filter(p=>p.type==='text').map(p=>p.text).join('\n');
const fail=code=>{throw new ContractError(code);};

// Private to the owning APP store. These are host operations, not renderer RPCs.
// All mutations are synchronous transactions on the same authoritative handle.
export class AgentRepository {
  constructor(db,workspaceId){this.db=db;this.workspaceId=workspaceId;}
  transaction(work){
    this.db.exec('BEGIN IMMEDIATE');
    try{const result=work();this.db.exec('COMMIT');return result;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  event(type,runId,payload,id=randomUUID()){
    const now=new Date().toISOString(),seq=this.db.prepare('SELECT coalesce(max(sequence),0)+1 n FROM Event WHERE workspace_id=?').get(this.workspaceId).n;
    this.db.prepare('INSERT INTO Event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,this.workspaceId,runId,'agent_run',runId,seq,type,canonicalJSON(payload),1,'app',now,now,now);
    this.db.prepare('UPDATE AgentRun SET last_event_seq=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND id=?').run(seq,now,this.workspaceId,runId);
    return id;
  }
  scope(conversationId){
    const c=this.db.prepare('SELECT * FROM Conversation WHERE workspace_id=? AND id=? AND deleted_at IS NULL').get(this.workspaceId,conversationId);
    if(!c)fail('conversation_unavailable');
    const scope={workspaceId:this.workspaceId,conversationId,candidateId:c.candidate_id,jobId:c.job_id};
    readConversationHistory(this.db,{...scope,limit:1});return scope;
  }
  run(runId,{active=false}={}){
    const r=this.db.prepare('SELECT * FROM AgentRun WHERE workspace_id=? AND id=? AND deleted_at IS NULL').get(this.workspaceId,runId);
    if(!r || r.runtime_id!=='pi-app')fail('run_unavailable');
    this.scope(r.conversation_id);
    if(active && r.state!=='running')fail('run_inactive');return r;
  }
  message(runId,role,text,status='completed',parts=[]){
    const r=this.run(runId),scope=this.scope(r.conversation_id),now=new Date().toISOString(),id=randomUUID();
    const seq=this.db.prepare('SELECT coalesce(max(sequence),0)+1 n FROM Message WHERE workspace_id=? AND conversation_id=?').get(this.workspaceId,scope.conversationId).n;
    const body=canonicalJSON({schemaVersion:1,parts:[{type:'text',text},...parts]});
    this.db.prepare(`INSERT INTO Message(id,workspace_id,conversation_id,run_id,role,content_json,content_hash,sequence,delivery_status,logical_message_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,this.workspaceId,scope.conversationId,runId,role,body,contentHash(body),seq,status,id,now,now);
    this.db.prepare('UPDATE Conversation SET revision=revision+1,updated_at=? WHERE workspace_id=? AND id=?').run(now,this.workspaceId,scope.conversationId);
    return {id,role,content:text,sequence:seq,delivery_status:status};
  }
  start({conversationId,requestId,content,modelId,parts=[],mode='turn',prompt=content,extension=null}){
    return this.transaction(()=>{
      const scope=this.scope(conversationId);
      if(typeof requestId!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId))fail('invalid_request_id');
      // A repeated launch never replays an already dispatched model request.
      if(this.db.prepare("SELECT id FROM Event WHERE workspace_id=? AND type='agent.started' AND json_extract(payload_json,'$.requestId')=?").get(this.workspaceId,requestId))fail('duplicate_request');
      if(this.db.prepare("SELECT id FROM AgentRun WHERE workspace_id=? AND conversation_id=? AND state IN ('created','running','waiting_approval')").get(this.workspaceId,conversationId))fail('conversation_busy');
      const rows=this.db.prepare(`SELECT m.* FROM Message m WHERE m.workspace_id=? AND m.conversation_id=? AND m.deleted_at IS NULL AND m.delivery_status='completed' AND m.role IN ('user','assistant')
        AND NOT EXISTS (SELECT 1 FROM Event e WHERE e.workspace_id=m.workspace_id AND e.type='conversation.append' AND json_extract(e.payload_json,'$.result.messageId')=m.id)
        ORDER BY m.sequence DESC LIMIT 50`).all(this.workspaceId,conversationId).reverse();
      const history=rows.map(row=>{
        if(contentHash(row.content_json)!==row.content_hash)fail('history_corrupt');
        return {id:row.id,role:row.role,content:textOf(JSON.parse(row.content_json)),timestamp:Date.parse(row.created_at)};
      });
      const now=new Date().toISOString(),runId=randomUUID();
      this.db.prepare(`INSERT INTO AgentRun(id,workspace_id,conversation_id,agent_definition_id,agent_revision,runtime_id,model_id,state,started_at,context_manifest_json,budget_json,created_at,updated_at)
        VALUES (?,?,?,'fetchcv','m4-app-1','pi-app',?,'running',?,?,?, ?,?)`).run(runId,this.workspaceId,conversationId,modelId,now,canonicalJSON({schemaVersion:1,mode,scope,requestId,prompt,extension}),'{"schemaVersion":1}',now,now);
      if(extension)this.db.prepare('UPDATE AgentRun SET agent_definition_id=?,agent_revision=? WHERE id=?').run(extension.agent.id,extension.hash,runId);
      const user=this.message(runId,'user',content,'queued',parts);
      this.event('agent.started',runId,{requestId,userMessageId:user.id,mode});
      return {runId,scope,user,history};
    });
  }
  input(runId,content,parts=[],prompt=content){
    return this.transaction(()=>{
      this.run(runId,{active:true});
      const message=this.message(runId,'user',content,'queued',parts);
      this.event('agent.input.queued',runId,{messageId:message.id,prompt});return message;
    });
  }
  settleInput(messageId,state){
    if(!['consumed','unconsumed','cancelled'].includes(state))fail('invalid_input_state');
    return this.transaction(()=>{
      const m=this.db.prepare("SELECT * FROM Message WHERE workspace_id=? AND id=? AND role='user' AND deleted_at IS NULL").get(this.workspaceId,messageId);
      if(!m)fail('input_unavailable');this.run(m.run_id);
      const previous=this.db.prepare("SELECT payload_json FROM Event WHERE workspace_id=? AND run_id=? AND type='agent.input.state' AND json_extract(payload_json,'$.messageId')=? ORDER BY sequence DESC LIMIT 1").get(this.workspaceId,m.run_id,messageId);
      if(previous){const old=JSON.parse(previous.payload_json).state;if(old===state)return {state};if(old==='consumed')fail('input_already_consumed');}
      this.db.prepare('UPDATE Message SET delivery_status=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND id=?').run(state==='consumed'?'completed':state==='cancelled'?'cancelled':'queued',new Date().toISOString(),this.workspaceId,messageId);
      this.event('agent.input.state',m.run_id,{messageId,state});return {state};
    });
  }
  recordRequest(runId,{sequence,record}){
    return this.transaction(()=>{
      this.run(runId,{active:true});
      if(!Number.isSafeInteger(sequence)||sequence<1||record?.sequence!==sequence)fail('invalid_request_record');
      const hash=contentHash(canonicalJSON(record));
      const prior=this.db.prepare("SELECT payload_json FROM Event WHERE workspace_id=? AND run_id=? AND type='agent.provider.request' AND json_extract(payload_json,'$.sequence')=?").get(this.workspaceId,runId,sequence);
      if(prior){if(JSON.parse(prior.payload_json).hash!==hash)fail('request_record_conflict');return {sequence,hash};}
      const last=this.db.prepare("SELECT coalesce(max(json_extract(payload_json,'$.sequence')),0) n FROM Event WHERE workspace_id=? AND run_id=? AND type='agent.provider.request'").get(this.workspaceId,runId).n;
      if(sequence!==last+1)fail('request_record_sequence');
      this.event('agent.provider.request',runId,{sequence,hash,record});return {sequence,hash};
    });
  }
  checkpoint(runId,value){
    return this.transaction(()=>{
      this.run(runId,{active:true});
      const row=this.db.prepare("SELECT payload_json FROM Event WHERE workspace_id=? AND run_id=? AND type='agent.checkpoint' ORDER BY sequence DESC LIMIT 1").get(this.workspaceId,runId);
      const previous=row?JSON.parse(row.payload_json):null;
      if(!Number.isSafeInteger(value.sequence)||value.sequence<1)fail('invalid_checkpoint');
      if(previous && value.sequence<=previous.sequence){if(canonicalJSON(previous)===canonicalJSON(value))return previous;fail('checkpoint_conflict');}
      this.event('agent.checkpoint',runId,value);return value;
    });
  }
  beginTool(runId,{invocationId,toolId,revision,args}){
    return this.transaction(()=>{
      this.run(runId,{active:true});
      const hash=contentHash(canonicalJSON({runId,toolId,revision,args}));
      const prior=this.db.prepare('SELECT * FROM ToolCall WHERE workspace_id=? AND invocation_id=?').get(this.workspaceId,invocationId);
      if(prior){
        if(prior.operation_hash!==hash)fail('invocation_conflict');
        if(['completed','waiting_approval'].includes(prior.state)&&contentHash(prior.result_json)===prior.receipt_hash)return {id:prior.id,cached:JSON.parse(prior.result_json)};
        fail('tool_outcome_unknown');
      }
      const now=new Date().toISOString(),id=randomUUID(),scope=this.scope(this.run(runId).conversation_id);
      this.db.prepare(`INSERT INTO ToolCall(id,workspace_id,run_id,call_id,invocation_id,tool_id,tool_revision,operation_hash,args_json,target_json,state,started_at,policy_revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'running',?,'m4-app-1',?,?)`).run(id,this.workspaceId,runId,invocationId,invocationId,toolId,revision,hash,canonicalJSON(args),canonicalJSON(scope),now,now,now);
      this.event('agent.tool.started',runId,{toolCallId:id,operationHash:hash});return {id};
    });
  }
  finishTool(runId,id,result){return this.finishToolWith(runId,id,()=>result);}
  finishToolWith(runId,id,produce){
    return this.transaction(()=>{
      this.run(runId,{active:true});
      const result=produce();
      const now=new Date().toISOString(),json=canonicalJSON(result);
      const changed=this.db.prepare("UPDATE ToolCall SET state='completed',result_json=?,receipt_hash=?,ended_at=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND run_id=? AND id=? AND state='running'").run(json,contentHash(json),now,now,this.workspaceId,runId,id).changes;
      if(changed!==1)fail('tool_outcome_unknown');
      this.event('agent.tool.completed',runId,{toolCallId:id,receiptHash:contentHash(json)});return result;
    });
  }
  finish(runId,{state,content='',metadata={},citationReview}){
    if(!['completed','failed','cancelled'].includes(state))fail('invalid_run_state');
    return this.transaction(()=>{
      const r=this.run(runId),hash=contentHash(canonicalJSON({state,content,metadata,...(citationReview?{citationReview}:{})}));
      const prior=this.db.prepare("SELECT payload_json FROM Event WHERE workspace_id=? AND run_id=? AND type='agent.finished'").get(this.workspaceId,runId);
      if(prior){const p=JSON.parse(prior.payload_json);if(p.hash!==hash)fail('completion_conflict');return p.result;}
      if(terminal.has(r.state))fail('run_inactive');
      if(state==='completed' && !content.trim())fail('empty_completion');
      const assistant=state==='completed'?this.message(runId,'assistant',content):null;
      if(assistant&&citationReview)this.event('agent.citations.reviewed',runId,{messageId:assistant.id,review:citationReview});
      const now=new Date().toISOString();
      // Queued steering is deliberately not silently marked consumed.
      this.db.prepare("UPDATE Message SET delivery_status=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND run_id=? AND delivery_status='streaming'").run(state==='cancelled'?'cancelled':'failed',now,this.workspaceId,runId);
      this.db.prepare('UPDATE AgentRun SET state=?,ended_at=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND id=?').run(state,now,now,this.workspaceId,runId);
      const result={run_id:runId,assistant,state};this.event('agent.finished',runId,{hash,result,metadata});return result;
    });
  }
}
