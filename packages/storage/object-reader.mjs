import {ContractError} from '../contracts/runtime.mjs';
import {readCatalogue} from './workspace-reader.mjs';

// APP-only summaries: no raw provider records, prompts, tool arguments or results.
function authorize(db,p,kind,id){
 const item=readCatalogue(db,{workspaceId:p.workspaceId,kind,objectId:id,limit:1}).items[0];
 if(!item||item.candidate_id!==(p.candidateId??null)||item.job_id!==(p.jobId??null))throw new ContractError('object_unavailable');
 return item;
}
export function readJob(db,p){
 authorize(db,p,'jobs',p.jobId);
 const job=db.prepare('SELECT id,company,role,location,status,applied_at FROM Job WHERE workspace_id=? AND id=?').get(p.workspaceId,p.jobId);
 return {job,scope:{candidateId:p.candidateId,jobId:p.jobId}};
}
export function readJobObjects(db,p){
 readJob(db,p);
 if(!['conversations','artifacts','documents','runs','approvals'].includes(p.kind))throw new ContractError('invalid_payload');
 return readCatalogue(db,{...p,authorizedScope:{candidateId:p.candidateId,jobId:p.jobId}});
}
export function readRun(db,p){
 const item=authorize(db,p,'runs',p.runId);
 const run=db.prepare('SELECT id,conversation_id,state,started_at,ended_at FROM AgentRun WHERE workspace_id=? AND id=?').get(p.workspaceId,p.runId);
 const rows=db.prepare('SELECT id,tool_id,state,started_at,ended_at,receipt_hash FROM ToolCall WHERE workspace_id=? AND run_id=? AND deleted_at IS NULL AND id>? ORDER BY id LIMIT 51').all(p.workspaceId,p.runId,p.afterId??'');
 const known=new Set(['read_memory','propose_memory','search_knowledge','read_evidence','inspect_application_workspace','read_artifact','read_document','read_conversation','propose_artifact']);
 return {run,scope:{candidateId:item.candidate_id,jobId:item.job_id},tools:rows.slice(0,50).map(r=>({id:r.id,name:known.has(r.tool_id)?r.tool_id:'其他工具',state:r.state,startedAt:r.started_at,endedAt:r.ended_at,receiptRecorded:!!r.receipt_hash})),nextId:rows.length>50?rows[49].id:null,automaticReplay:false};
}
