import {randomUUID} from 'node:crypto';
import {ContractError} from '../contracts/runtime.mjs';
import {contentHash} from '../storage/blob-store.mjs';
import {canonicalJSON} from '../storage/legacy-archive.mjs';
import {sanitizeOutboundText} from '../../electron/pi/context-policy.mjs';
import {ensureFeatureSchema} from '../storage/feature-schema.mjs';
import {memoryEquivalence,normalizeMemoryValue,MEMORY_EVIDENCE_LIMIT} from './memory-evidence.mjs';
import {upgradeMemoryTime,effectiveMemoryStart,MEMORY_VALID_SQL} from './memory-time.mjs';
import {PersonalFacts} from './personal-facts.mjs';

const fail=code=>{throw new ContractError(code);};
function rejectSecret(text){
  if(sanitizeOutboundText(text,{mode:'redacted_remote'})!==text||/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/.test(text))fail('memory_secret_forbidden');
}
const VISIBLE=`((candidate_id IS ? AND (job_id IS ? OR (job_id IS NULL AND kind='preference'))) OR (kind='preference' AND candidate_id IS NULL AND job_id IS NULL))`;
const VALID=MEMORY_VALID_SQL;
const priority=row=>row.job_id!==null?2:row.candidate_id!==null?1:0;
// Evidence-only additions increment the UI revision but do not change what
// the user authorized. Every cache use still validates ALL current sources.
const reviewStateHash=row=>contentHash(canonicalJSON([row.id,row.normalized_hash,row.status,row.valid_from,row.valid_to,row.activated_at,row.time_basis,row.confirmed_by,row.disabled_at,row.disabled_reason]));
const SCHEMA=`CREATE TABLE IF NOT EXISTS Memory (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES Workspace(id),candidate_id TEXT,job_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('preference','constraint','decision')),subject TEXT NOT NULL,predicate TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),normalized_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','active','rejected','superseded','revoked')),
 valid_from TEXT,valid_to TEXT,recorded_at TEXT NOT NULL,supersedes_id TEXT REFERENCES Memory(id),
 source_message_id TEXT NOT NULL,source_hash TEXT NOT NULL,char_start INTEGER NOT NULL,char_end INTEGER NOT NULL,
 confirmed_by TEXT,extractor_revision TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,normalized_hash),CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to>valid_from),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES Candidate(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id,candidate_id) REFERENCES Job(workspace_id,id,candidate_id),
 FOREIGN KEY(workspace_id,source_message_id) REFERENCES Message(workspace_id,id));
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_memory ON Memory(workspace_id,coalesce(candidate_id,''),coalesce(job_id,''),kind,subject,predicate) WHERE status='active';
 CREATE TRIGGER IF NOT EXISTS memory_evidence_immutable BEFORE UPDATE OF workspace_id,candidate_id,job_id,kind,subject,predicate,value_json,normalized_hash,source_message_id,source_hash,char_start,char_end,extractor_revision ON Memory
 BEGIN SELECT RAISE(ABORT,'memory evidence is immutable'); END;`;

export class MemoryStore {
  constructor(db,workspaceId){this.db=db;this.workspaceId=workspaceId;ensureFeatureSchema(db,'memory',SCHEMA,upgradeMemoryTime);}
  transaction(work){this.db.exec('SAVEPOINT memory_command');try{const r=work();this.db.exec('RELEASE memory_command');return r;}catch(error){this.db.exec('ROLLBACK TO memory_command; RELEASE memory_command');throw error;}}
  scope({candidateId=null,jobId=null}){
    if(!this.db.prepare('SELECT id FROM Workspace WHERE id=? AND deleted_at IS NULL').get(this.workspaceId))fail('workspace_unavailable');
    if(candidateId!==null&&!this.db.prepare('SELECT id FROM Candidate WHERE workspace_id=? AND id=? AND deleted_at IS NULL').get(this.workspaceId,candidateId))fail('candidate_unavailable');
    if(jobId!==null&&!this.db.prepare('SELECT id FROM Job WHERE workspace_id=? AND candidate_id IS ? AND id=? AND deleted_at IS NULL').get(this.workspaceId,candidateId,jobId))fail('job_unavailable');
  }
  shadowed(row,scope,now){
    if(row.kind!=='preference')return false;
    // Search all eligible scopes, independent of the list page/cursor.
    return this.db.prepare(`SELECT * FROM Memory WHERE workspace_id=? AND ${VISIBLE} AND ${VALID} AND kind='preference' AND subject=? AND predicate=?`)
      .all(this.workspaceId,scope.candidateId??null,scope.jobId??null,now,now,row.subject,row.predicate)
      .some(other=>{
        if(priority(other)<=priority(row))return false;
        try{this.validateSources(other);return true;}catch{return false;}
      });
  }
  snapshotHash(scope,now){
    const rows=this.db.prepare(`SELECT * FROM Memory WHERE workspace_id=? AND ${VISIBLE} AND ${VALID} ORDER BY id`)
      .all(this.workspaceId,scope.candidateId??null,scope.jobId??null,now,now);
    return contentHash(canonicalJSON({memories:rows.map(row=>({id:row.id,reviewStateHash:reviewStateHash(row)})),facts:new PersonalFacts(this.db,this.workspaceId).list({...scope,asOf:now})}));
  }
  evidence(p){
    const row=this.db.prepare(`SELECT m.*,c.candidate_id,c.job_id FROM Message m JOIN Conversation c ON c.id=m.conversation_id AND c.workspace_id=m.workspace_id
      JOIN Workspace w ON w.id=m.workspace_id LEFT JOIN Candidate person ON person.id=c.candidate_id LEFT JOIN Job j ON j.id=c.job_id
      WHERE m.workspace_id=? AND m.id=? AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND w.deleted_at IS NULL
        AND (c.candidate_id IS NULL OR person.id IS NOT NULL AND person.deleted_at IS NULL)
        AND (c.job_id IS NULL OR j.id IS NOT NULL AND j.deleted_at IS NULL)`).get(this.workspaceId,p.messageId);
    if(!row||row.role!=='user'||row.candidate_id!==(p.candidateId??null)||row.job_id!==(p.jobId??null)||contentHash(row.content_json)!==row.content_hash)fail('memory_evidence_unavailable');
    const chars=[...JSON.parse(row.content_json).parts.filter(p=>p.type==='text').map(p=>p.text).join('\n')];
    if(!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)||p.start<0||p.end>chars.length||p.end<=p.start||p.end-p.start>1000)fail('invalid_memory_range');
    const quote=chars.slice(p.start,p.end).join('');
    rejectSecret(quote);
    return {quote,hash:row.content_hash};
  }
  sources(row){return this.db.prepare('SELECT * FROM MemoryEvidence WHERE workspace_id=? AND memory_id=? ORDER BY recorded_at,id').all(this.workspaceId,row.id);}
  validateSources(row){
    rejectSecret(row.subject);rejectSecret(row.predicate);
    const sources=this.sources(row),value=normalizeMemoryValue(JSON.parse(row.value_json).text);
    if(!sources.length||sources.length>MEMORY_EVIDENCE_LIMIT)fail('memory_evidence_unavailable');
    for(const source of sources){
      const checked=this.evidence({candidateId:row.candidate_id,jobId:row.job_id,messageId:source.message_id,start:source.char_start,end:source.char_end});
      if(checked.hash!==source.source_hash||normalizeMemoryValue(checked.quote)!==value)fail('memory_evidence_unavailable');
    }
    return sources;
  }
  propose(p){
    if(!['preference','constraint','decision'].includes(p.kind)||!['subject','predicate'].every(k=>typeof p[k]==='string'&&/^[\p{L}\p{N}_. -]{1,80}$/u.test(p[k])))fail('invalid_memory');
    rejectSecret(p.subject);rejectSecret(p.predicate);
    const evidence=this.evidence(p);
    for(const key of ['validFrom','validTo'])if(p[key]!=null&&!Number.isFinite(Date.parse(p[key])))fail('invalid_memory_time');
    const validFrom=p.validFrom==null?null:new Date(p.validFrom).toISOString(),validTo=p.validTo==null?null:new Date(p.validTo).toISOString();
    if(validFrom&&validTo&&validTo<=validFrom)fail('invalid_memory_time');
    const identity=contentHash(canonicalJSON([p.candidateId??null,p.jobId??null,p.kind,p.subject,p.predicate,p.messageId,evidence.hash,p.start,p.end,validFrom,validTo]));
    const equivalence=memoryEquivalence(p,p.kind,p.subject,p.predicate,evidence.quote);
    return this.transaction(()=>{
      const previous=this.db.prepare('SELECT m.* FROM Memory m JOIN MemoryEvidence e ON e.memory_id=m.id AND e.workspace_id=m.workspace_id WHERE e.workspace_id=? AND e.proposal_hash=?').get(this.workspaceId,identity);
      if(previous){if(previous.disabled_reason)fail('memory_evidence_unavailable');this.validateSources(previous);return this.view(previous);}
      const id=randomUUID(),now=new Date().toISOString();
      const equal=this.db.prepare("SELECT * FROM Memory WHERE workspace_id=? AND equivalence_hash=? AND status IN ('pending','active') ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,recorded_at,id").all(this.workspaceId,equivalence).find(row=>
        row.valid_to===validTo&&(!row.valid_to||row.valid_to>now)&&row.proposal_valid_from===validFrom);
      if(equal){
        const sources=this.validateSources(equal);if(sources.length>=MEMORY_EVIDENCE_LIMIT)fail('memory_evidence_limit');
        this.linkSource(equal.id,p,evidence,identity,now);
        this.db.prepare('UPDATE Memory SET revision=revision+1 WHERE id=?').run(equal.id);
        this.event(equal.id,'memory.evidence_linked',{sourceMessageId:p.messageId});
        return this.view(this.db.prepare('SELECT * FROM Memory WHERE id=?').get(equal.id));
      }
      this.db.prepare(`INSERT INTO Memory(id,workspace_id,candidate_id,job_id,kind,subject,predicate,value_json,normalized_hash,status,valid_from,valid_to,recorded_at,source_message_id,source_hash,char_start,char_end,extractor_revision,equivalence_hash,proposal_valid_from)
        VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,'quoted-user-1',?,?)`).run(id,this.workspaceId,p.candidateId??null,p.jobId??null,p.kind,p.subject,p.predicate,canonicalJSON({schemaVersion:1,text:evidence.quote}),identity,validFrom,validTo,now,p.messageId,evidence.hash,p.start,p.end,equivalence,validFrom);
      this.linkSource(id,p,evidence,identity,now);
      this.event(id,'memory.proposed',{sourceMessageId:p.messageId});return this.view(this.db.prepare('SELECT * FROM Memory WHERE id=?').get(id));
    });
  }
  linkSource(id,p,evidence,identity,now){this.db.prepare('INSERT INTO MemoryEvidence VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),this.workspaceId,id,p.messageId,evidence.hash,p.start,p.end,identity,now);}
  event(id,type,payload){
    const now=new Date().toISOString(),sequence=this.db.prepare('SELECT coalesce(max(sequence),0)+1 n FROM Event WHERE workspace_id=?').get(this.workspaceId).n;
    this.db.prepare('INSERT INTO Event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),this.workspaceId,null,'memory',id,sequence,type,canonicalJSON(payload),1,'user',now,now,now);
  }
  readSource(p){
    const row=this.db.prepare('SELECT * FROM Memory WHERE workspace_id=? AND id=?').get(this.workspaceId,p.memoryId);
    if(!row||row.candidate_id!==(p.candidateId??null)||row.job_id!==(p.jobId??null))fail('memory_unavailable');
    const sources=this.validateSources(row),source=p.evidenceId?sources.find(item=>item.id===p.evidenceId):sources.find(item=>item.proposal_hash===row.normalized_hash);
    if(!source)fail('memory_evidence_unavailable');
    const message=this.db.prepare('SELECT id,conversation_id,content_json,created_at FROM Message WHERE workspace_id=? AND id=?').get(this.workspaceId,source.message_id);
    return {messageId:message.id,conversationId:message.conversation_id,createdAt:message.created_at,text:JSON.parse(message.content_json).parts.filter(part=>part.type==='text').map(part=>part.text).join('\n'),start:source.char_start,end:source.char_end,offsetUnit:'unicode_codepoint',
      sources:sources.map(item=>({id:item.id,messageId:item.message_id,start:item.char_start,end:item.char_end}))};
  }
  validateSnapshot(scope,{items,snapshotHash,factReferences=[]}){
    this.scope(scope);
    const now=new Date().toISOString();
    if(snapshotHash!==this.snapshotHash(scope,now))fail('context_memory_stale');
    if(canonicalJSON(factReferences)!==canonicalJSON(new PersonalFacts(this.db,this.workspaceId).list({...scope,asOf:now})))fail('context_memory_stale');
    for(const item of items){
      const row=this.db.prepare('SELECT * FROM Memory WHERE workspace_id=? AND id=?').get(this.workspaceId,item.id);
      const visible=row&&(row.kind==='preference'&&row.candidate_id===null&&row.job_id===null||row.candidate_id===(scope.candidateId??null)&&(row.job_id===(scope.jobId??null)||row.kind==='preference'&&row.job_id===null));
      if(!visible||row.revision<item.revision||reviewStateHash(row)!==item.reviewStateHash||
        !['active','superseded'].includes(row.status)||row.status==='superseded'&&!row.valid_to||!effectiveMemoryStart(row)||effectiveMemoryStart(row)>now||row.valid_to&&row.valid_to<=now)fail('context_memory_stale');
      if(this.shadowed(row,scope,now))fail('context_memory_stale');
      this.validateSources(row);
    }
  }
  validateProposal(scope,item){
    const row=this.db.prepare('SELECT * FROM Memory WHERE workspace_id=? AND id=?').get(this.workspaceId,item.id);
    if(!row||row.candidate_id!==(scope.candidateId??null)||row.job_id!==(scope.jobId??null))fail('context_memory_stale');
    if(row.disabled_reason)fail('memory_evidence_unavailable');
    if(row.revision<item.revision||reviewStateHash(row)!==item.reviewStateHash||!['pending','active'].includes(row.status))fail('context_memory_stale');
    this.validateSources(row);
  }
  view(row){return {id:row.id,kind:row.kind,subject:row.subject,predicate:row.predicate,value:JSON.parse(row.value_json).text,status:row.status,revision:row.revision,
    disabledAt:row.disabled_at,disabledReason:row.disabled_reason,sourceCount:this.sources(row).length,reviewStateHash:reviewStateHash(row),
    candidateId:row.candidate_id,jobId:row.job_id,validFrom:row.valid_from,validTo:row.valid_to,activatedAt:row.activated_at,timeBasis:row.time_basis,recordedAt:row.recorded_at,
    source:{messageId:row.source_message_id,hash:row.source_hash,start:row.char_start,end:row.char_end},confirmedBy:row.confirmed_by};}
  list({candidateId=null,jobId=null,includeInactive=false,asOf=new Date().toISOString(),afterId='',limit=100}){
    if(typeof includeInactive!=='boolean'||!Number.isFinite(Date.parse(asOf))||typeof afterId!=='string'||afterId.length>100||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('invalid_memory_query');
    this.scope({candidateId,jobId});
    const now=new Date(asOf).toISOString();
    const rows=this.db.prepare(`SELECT * FROM Memory WHERE workspace_id=? AND ${VISIBLE} AND id>? ${includeInactive?'':`AND ${VALID}`} ORDER BY id LIMIT ?`)
      .all(this.workspaceId,candidateId,jobId,afterId,...(includeInactive?[]:[now,now]),limit+1);
    const page=rows.slice(0,limit);
    return {nextId:rows.length>limit?page.at(-1).id:null,items:page.flatMap(row=>{
      try{
        if(!includeInactive&&this.shadowed(row,{candidateId,jobId},now))return [];
        this.validateSources(row);
        return [this.view(row)];
      }catch{
        // An audit entry may remain, but no cached quote survives withdrawal.
        return includeInactive?[{id:row.id,status:row.status,revision:row.revision,disabledAt:row.disabled_at,disabledReason:row.disabled_reason,evidenceUnavailable:true}]:[];
      }
    }),factReferences:new PersonalFacts(this.db,this.workspaceId).list({candidateId,jobId,asOf:now,includeInactive}),snapshotHash:this.snapshotHash({candidateId,jobId},now),authority:'user_confirmed_data_not_system_policy'};
  }
  decide(p){
    if(!['confirmed','rejected','revoked'].includes(p.decision))fail('invalid_memory_decision');
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM Memory WHERE workspace_id=? AND id=?').get(this.workspaceId,p.memoryId);
      if(!row||row.candidate_id!==(p.candidateId??null)||row.job_id!==(p.jobId??null))fail('memory_unavailable');
      const state={confirmed:'active',rejected:'rejected',revoked:'revoked'}[p.decision];
      if(row.status===state&&row.revision===p.expectedRevision+1)return this.view(row);
      if(row.revision!==p.expectedRevision)fail('memory_revision_conflict');
      if(p.decision==='confirmed'){
        if(row.status!=='pending')fail('memory_not_pending');
        this.validateSources(row);
        const previous=this.db.prepare("SELECT * FROM Memory WHERE workspace_id=? AND candidate_id IS ? AND job_id IS ? AND kind=? AND subject=? AND predicate=? AND status='active'").get(this.workspaceId,row.candidate_id,row.job_id,row.kind,row.subject,row.predicate);
        if(previous&&p.replaceId!==previous.id||!previous&&p.replaceId)fail('memory_conflict_requires_review');
        const activatedAt=new Date().toISOString(),starts=row.valid_from??activatedAt;
        if(row.valid_to&&row.valid_to<=starts||previous&&effectiveMemoryStart(previous)&&starts<=effectiveMemoryStart(previous))fail('invalid_memory_time');
        if(previous)this.db.prepare("UPDATE Memory SET status='superseded',valid_to=?,revision=revision+1 WHERE id=?").run(previous.valid_to&&previous.valid_to<starts?previous.valid_to:starts,previous.id);
        this.db.prepare("UPDATE Memory SET status='active',activated_at=?,confirmed_by='user',supersedes_id=?,revision=revision+1 WHERE id=?").run(activatedAt,previous?.id??null,row.id);
      }else this.db.prepare('UPDATE Memory SET status=?,revision=revision+1 WHERE id=?').run(state,row.id);
      this.event(row.id,'memory.'+p.decision,{replaces:p.replaceId??null});return this.view(this.db.prepare('SELECT * FROM Memory WHERE id=?').get(row.id));
    });
  }
}
