import {randomUUID} from 'node:crypto';
import {ContractError} from '../contracts/runtime.mjs';
import {contentHash} from '../storage/blob-store.mjs';
import {canonicalJSON} from '../storage/legacy-archive.mjs';
import {ensureFeatureSchema} from '../storage/feature-schema.mjs';
import {resolveCitation} from './retrieval.mjs';
import {sanitizeOutboundText} from '../../electron/pi/context-policy.mjs';

const fail=code=>{throw new ContractError(code);};
const citationFields=['schemaVersion','documentId','blockId','textHash','start','end','quoteHash','offsetUnit'];
function strictCitation(citation){
  if(!citation||typeof citation!=='object'||Array.isArray(citation)||Object.keys(citation).length!==citationFields.length||Object.keys(citation).some(key=>!citationFields.includes(key)))fail('invalid_citation');
  return citation;
}
const schema=`CREATE TABLE PersonalFactReference (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,candidate_id TEXT NOT NULL,job_id TEXT,
 knowledge_id TEXT NOT NULL,knowledge_revision INTEGER NOT NULL,content_hash TEXT NOT NULL,
 citation_json TEXT NOT NULL CHECK(json_valid(citation_json)),identity_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','revoked')),confirmed_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
 UNIQUE(workspace_id,identity_hash),
 FOREIGN KEY(workspace_id,knowledge_id) REFERENCES KnowledgeItem(workspace_id,id),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES Candidate(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id,candidate_id) REFERENCES Job(workspace_id,id,candidate_id));
 CREATE TRIGGER personal_fact_reference_immutable BEFORE UPDATE OF workspace_id,candidate_id,job_id,knowledge_id,knowledge_revision,content_hash,citation_json,identity_hash,confirmed_at ON PersonalFactReference
 BEGIN SELECT RAISE(ABORT,'personal fact reference is immutable'); END;`;

// KnowledgeItem owns the only fact text. This table contains a reviewed pointer
// and an immutable source locator, never another copy of the fact text.
export class PersonalFacts {
  constructor(db,workspaceId){this.db=db;this.workspaceId=workspaceId;ensureFeatureSchema(db,'personal_fact',schema,(db)=>{
    const disable=condition=>`UPDATE KnowledgeItem SET status='disabled',revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE status='confirmed' AND id IN (SELECT r.knowledge_id FROM PersonalFactReference r JOIN Document d ON d.workspace_id=r.workspace_id AND d.id=json_extract(r.citation_json,'$.documentId') WHERE ${condition});`;
    db.exec(`CREATE TRIGGER personal_fact_source_unavailable AFTER UPDATE OF access_state,deleted_at ON Source
      WHEN NEW.access_state!='available' OR NEW.deleted_at IS NOT NULL BEGIN ${disable('d.source_id=NEW.id AND d.workspace_id=NEW.workspace_id')} END;
      CREATE TRIGGER personal_fact_document_unavailable AFTER UPDATE OF active,deleted_at,state ON Document
      WHEN NEW.active!=1 OR NEW.deleted_at IS NOT NULL OR NEW.state!='ready' BEGIN ${disable('d.id=NEW.id AND d.workspace_id=NEW.workspace_id')} END;`);
  });}
  scope({candidateId,jobId=null}){
    const row=this.db.prepare(`SELECT c.id FROM Candidate c JOIN Workspace w ON w.id=c.workspace_id
      WHERE c.workspace_id=? AND c.id=? AND c.deleted_at IS NULL AND w.deleted_at IS NULL`).get(this.workspaceId,candidateId??null);
    if(!row)fail('candidate_unavailable');
    if(jobId!==null&&!this.db.prepare('SELECT id FROM Job WHERE workspace_id=? AND candidate_id=? AND id=? AND deleted_at IS NULL').get(this.workspaceId,candidateId,jobId))fail('job_unavailable');
  }
  transaction(work){this.db.exec('SAVEPOINT personal_fact');try{const r=work();this.db.exec('RELEASE personal_fact');return r;}catch(e){this.db.exec('ROLLBACK TO personal_fact; RELEASE personal_fact');throw e;}}
  event(id,type){
    const now=new Date().toISOString(),seq=this.db.prepare('SELECT coalesce(max(sequence),0)+1 n FROM Event WHERE workspace_id=?').get(this.workspaceId).n;
    this.db.prepare('INSERT INTO Event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),this.workspaceId,null,'knowledge',id,seq,type,'{}',1,'user',now,now,now);
  }
  resolve(row,asOf=new Date().toISOString()){
    this.scope({candidateId:row.candidate_id,jobId:row.job_id});
    const k=this.db.prepare("SELECT * FROM KnowledgeItem WHERE workspace_id=? AND id=? AND kind='personal_fact' AND status='confirmed' AND deleted_at IS NULL").get(this.workspaceId,row.knowledge_id);
    if(!k||k.candidate_id!==row.candidate_id||k.job_id!==row.job_id||k.revision!==row.knowledge_revision||contentHash(k.content_json)!==row.content_hash||JSON.parse(k.confidence_json).userConfirmed!==true||k.valid_from&&k.valid_from>asOf||k.valid_to&&k.valid_to<=asOf)fail('personal_fact_unavailable');
    const citation=strictCitation(JSON.parse(row.citation_json)),source=resolveCitation(this.db,{workspaceId:this.workspaceId,candidateId:row.candidate_id,jobId:row.job_id,citation});
    if(!source.current||JSON.parse(k.content_json).text!==source.text)fail('personal_fact_unavailable');
    return {id:row.id,knowledgeId:k.id,knowledgeRevision:k.revision,contentHash:row.content_hash,revision:row.revision,
      kind:'personal_fact',value:source.text,citation,citationId:source.citationId,confirmedAt:row.confirmed_at,
      authority:'user_confirmed_knowledge_reference',candidateId:row.candidate_id,jobId:row.job_id};
  }
  confirm(p){
    this.scope(p);
    strictCitation(p.citation);
    const source=resolveCitation(this.db,{...p,workspaceId:this.workspaceId});
    if(!source.current||!source.text.trim()||[...source.text].length>1000)fail('personal_fact_source_unavailable');
    if(sanitizeOutboundText(source.text,{mode:'redacted_remote'})!==source.text||/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/.test(source.text))fail('memory_secret_forbidden');
    const identity=contentHash(canonicalJSON([p.candidateId,p.jobId??null,p.citation]));
    return this.transaction(()=>{
      const previous=this.db.prepare('SELECT * FROM PersonalFactReference WHERE workspace_id=? AND identity_hash=?').get(this.workspaceId,identity);
      if(previous){if(previous.status!=='active')fail('personal_fact_revoked');return this.resolve(previous);}
      if(this.db.prepare("SELECT count(*) n FROM PersonalFactReference WHERE workspace_id=? AND candidate_id=? AND job_id IS ? AND status='active'").get(this.workspaceId,p.candidateId,p.jobId??null).n>=100)fail('personal_fact_limit');
      const id=randomUUID(),knowledgeId=randomUUID(),now=new Date().toISOString(),body=canonicalJSON({schemaVersion:1,text:source.text});
      this.db.prepare(`INSERT INTO KnowledgeItem(id,workspace_id,candidate_id,job_id,kind,subject,predicate,content_json,status,recorded_at,extractor_revision,confidence_json,created_at,updated_at)
        VALUES(?,?,?,?,'personal_fact',?,'user_reviewed_quote',?,'confirmed',?,'exact-citation-1',?,?,?)`)
        .run(knowledgeId,this.workspaceId,p.candidateId,p.jobId??null,p.candidateId,body,now,canonicalJSON({userConfirmed:true,quoteMatch:'exact',semanticSupport:'user_reviewed',calibrationVersion:'user-review-1'}),now,now);
      this.db.prepare('INSERT INTO PersonalFactReference VALUES (?,?,?,?,?,?,?,?,?,\'active\',?,1)').run(id,this.workspaceId,p.candidateId,p.jobId??null,knowledgeId,1,contentHash(body),canonicalJSON(p.citation),identity,now);
      this.event(knowledgeId,'personal_fact.confirmed');return this.resolve(this.db.prepare('SELECT * FROM PersonalFactReference WHERE id=?').get(id));
    });
  }
  list({candidateId=null,jobId=null,asOf=new Date().toISOString(),includeInactive=false}){
    if(candidateId===null)return [];
    this.scope({candidateId,jobId});
    return this.db.prepare("SELECT * FROM PersonalFactReference WHERE workspace_id=? AND candidate_id=? AND job_id IS ? AND status='active' AND confirmed_at<=? ORDER BY id")
      .all(this.workspaceId,candidateId,jobId,asOf).flatMap(row=>{try{return [this.resolve(row,asOf)];}catch{return includeInactive?[{id:row.id,candidateId:row.candidate_id,jobId:row.job_id,revision:row.revision,evidenceUnavailable:true}]:[];}});
  }
  revoke(p){
    this.scope(p);
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM PersonalFactReference WHERE workspace_id=? AND id=? AND candidate_id=? AND job_id IS ?').get(this.workspaceId,p.factReferenceId,p.candidateId,p.jobId??null);
      if(!row)fail('personal_fact_unavailable');
      if(row.status==='revoked'&&row.revision===p.expectedRevision+1)return {revoked:true};
      if(row.revision!==p.expectedRevision)fail('personal_fact_revision_conflict');
      this.db.prepare("UPDATE PersonalFactReference SET status='revoked',revision=revision+1 WHERE id=?").run(row.id);
      this.event(row.knowledge_id,'personal_fact.memory_revoked');return {revoked:true};
    });
  }
}
