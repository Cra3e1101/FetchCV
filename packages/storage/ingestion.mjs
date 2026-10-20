import {randomUUID} from 'node:crypto';
import {ContractError} from '../contracts/runtime.mjs';
import {canonicalJSON} from './legacy-archive.mjs';
import {contentHash} from './blob-store.mjs';
import {claimIngest,completeIngest} from './ingest-lease.mjs';
import {isParserInfrastructureError} from '../knowledge/parser-errors.mjs';

const fail=code=>{throw new ContractError(code);};
const parserRevision='local-structured-1';
// Protocol 1 stays compatible with pending jobs; retain the actual parser patch
// revision on each document so old and corrected text can be distinguished.
const supportedParserRevisions=new Set([parserRevision,'local-structured-1.1','local-structured-1.2']);
const formats=new Set(['txt','md','html','docx','pdf','chat']);
function insert(db,table,values){const keys=Object.keys(values);db.prepare(`INSERT INTO ${table}(${keys}) VALUES (${keys.map(()=>'?')})`).run(...Object.values(values));}

export class Ingestion {
  constructor(db,workspaceId,blobs){this.db=db;this.workspaceId=workspaceId;this.blobs=blobs;}
  nextPending(){return this.db.prepare(`SELECT j.id FROM IngestJob j JOIN Source s ON s.id=j.source_id AND s.workspace_id=j.workspace_id
    JOIN Document d ON d.id=j.document_id AND d.workspace_id=j.workspace_id AND d.source_id=j.source_id AND d.blob_hash=j.input_hash AND d.deleted_at IS NULL AND d.active=1
    WHERE j.workspace_id=? AND j.deleted_at IS NULL AND (j.state='pending' OR (j.state='running' AND j.lease_until<=?)) AND j.stage='parse'
    AND j.config_revision IN (${[...formats].map(f=>`'local-structured-1:${f}:'||j.expected_source_revision`).join(',')})
    AND s.deleted_at IS NULL AND s.access_state='available' AND s.revision=j.expected_source_revision ORDER BY j.created_at,j.id LIMIT 1`).get(this.workspaceId,new Date().toISOString());}
  isCurrent(id){return Boolean(this.db.prepare(`SELECT j.id FROM IngestJob j JOIN Source s ON s.id=j.source_id AND s.workspace_id=j.workspace_id
    WHERE j.id=? AND j.workspace_id=? AND j.deleted_at IS NULL AND j.state='running' AND s.deleted_at IS NULL AND s.access_state='available' AND s.revision=j.expected_source_revision`).get(id,this.workspaceId));}
  defer(id,code){this.db.prepare("UPDATE IngestJob SET error_json=? WHERE id=? AND workspace_id=? AND state='pending'").run(canonicalJSON({code}),id,this.workspaceId);}
  transaction(work){this.db.exec('BEGIN IMMEDIATE');try{const r=work();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  scope(p){
    if(!this.db.prepare('SELECT id FROM Workspace WHERE id=? AND deleted_at IS NULL').get(this.workspaceId))fail('workspace_unavailable');
    const candidateId=p.candidateId??null,jobId=p.jobId??null;
    if(candidateId&&!this.db.prepare('SELECT id FROM Candidate WHERE workspace_id=? AND id=? AND deleted_at IS NULL').get(this.workspaceId,candidateId))fail('candidate_unavailable');
    if(jobId&&!this.db.prepare('SELECT id FROM Job WHERE workspace_id=? AND id=? AND candidate_id=? AND deleted_at IS NULL').get(this.workspaceId,jobId,candidateId))fail('job_unavailable');
    return {candidate_id:candidateId,job_id:jobId};
  }
  source(p){
    const row=this.db.prepare('SELECT * FROM Source WHERE workspace_id=? AND id=?').get(this.workspaceId,p.sourceId);
    if(!row||row.deleted_at||row.candidate_id!==(p.candidateId??null)||row.job_id!==(p.jobId??null))fail('source_unavailable');
    this.scope(p);
    return row;
  }
  event(id,type,entityId,payload){
    const now=new Date().toISOString(),seq=this.db.prepare('SELECT coalesce(max(sequence),0)+1 n FROM Event WHERE workspace_id=?').get(this.workspaceId).n;
    this.db.prepare('INSERT INTO Event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,this.workspaceId,null,'source',entityId,seq,type,canonicalJSON(payload),1,'app',now,now,now);
  }
  async capture(request,trustedBytes=null){
    const p=request.payload,scope=this.scope(p);
    if(!formats.has(p.format)||typeof p.title!=='string'||!p.title.trim()||p.title.length>200||(!trustedBytes&&(typeof p.contentBase64!=='string'||!p.contentBase64||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.contentBase64))))fail('invalid_material');
    if(trustedBytes&&!Buffer.isBuffer(trustedBytes))fail('invalid_material');
    const input=trustedBytes??Buffer.from(p.contentBase64,'base64');
    if(input.length>50*1024*1024)fail('file_size_limit');
    const requestHash=contentHash(canonicalJSON(trustedBytes?{kind:'host-selected-file-1',metadata:p,inputHash:contentHash(input)}:p));
    const prior=this.db.prepare('SELECT type,payload_json FROM Event WHERE workspace_id=? AND id=?').get(this.workspaceId,request.id);
    if(prior){
      const receipt=JSON.parse(prior.payload_json);
      if(prior.type!=='source.captured'||receipt.requestHash!==requestHash)fail('invocation_conflict');
      const source=this.source({...p,sourceId:receipt.result.sourceId});if(source.access_state==='revoked')fail('source_unavailable');
      return receipt.result;
    }
    if(p.sourceId){const source=this.source(p);if(source.access_state==='revoked')fail('source_unavailable');if(source.revision!==p.expectedRevision)fail('source_revision_conflict');}
    const hash=await this.blobs.put(input); // Blob is durable before any row refers to it.
    return this.transaction(()=>{
      this.scope(p);
      const replay=this.db.prepare('SELECT type,payload_json FROM Event WHERE workspace_id=? AND id=?').get(this.workspaceId,request.id);
      if(replay){const receipt=JSON.parse(replay.payload_json);if(replay.type!=='source.captured'||receipt.requestHash!==requestHash)fail('invocation_conflict');return receipt.result;}
      const now=new Date().toISOString(),base=()=>({id:randomUUID(),workspace_id:this.workspaceId,created_at:now,updated_at:now});
      const identity=contentHash(canonicalJSON([scope,p.title,p.format]));
      let source=p.sourceId?this.source(p):this.db.prepare('SELECT * FROM Source WHERE workspace_id=? AND identity_key=?').get(this.workspaceId,identity);
      if(source&&(source.deleted_at||source.access_state==='revoked'))fail('source_unavailable');
      if(p.sourceId&&source.revision!==p.expectedRevision)fail('source_revision_conflict');
      if(!source){
        source={...base(),...scope,revision:1,kind:`document:${p.format}`,identity_key:identity,title:p.title,access_state:'available',retention_json:'{"original":"keep"}',metadata_json:canonicalJSON({format:p.format})};
        insert(this.db,'Source',source);
      }
      const current=this.db.prepare('SELECT * FROM Document WHERE workspace_id=? AND source_id=? AND active=1 AND deleted_at IS NULL').get(this.workspaceId,source.id);
      if(current?.blob_hash===hash){
        const job=this.db.prepare('SELECT * FROM IngestJob WHERE source_id=? AND input_hash=? ORDER BY created_at DESC,id DESC LIMIT 1').get(source.id,hash);
        const result={sourceId:source.id,documentId:current.id,jobId:job?.id??null,revision:source.revision,state:job?.state??current.state};
        this.event(request.id,'source.captured',source.id,{requestHash,result});return result;
      }
      if(current){
        if(!p.sourceId)fail('source_revision_required');
        this.db.prepare('UPDATE Source SET revision=revision+1,updated_at=? WHERE id=?').run(now,source.id);source.revision++;
        this.db.prepare("UPDATE IngestJob SET state='cancelled',lease_owner=NULL,lease_until=NULL WHERE source_id=? AND state IN ('pending','running')").run(source.id);
      }
      const version=this.db.prepare('SELECT coalesce(max(version),0)+1 n FROM Document WHERE source_id=?').get(source.id).n;
      this.db.prepare('UPDATE Document SET active=0 WHERE source_id=?').run(source.id);
      const document={...base(),source_id:source.id,version,blob_hash:hash,state:'captured',captured_at:now,quality_json:'{"status":"pending"}',active:1};
      insert(this.db,'Document',document);
      const job={...base(),source_id:source.id,document_id:document.id,stage:'parse',state:'pending',expected_source_revision:source.revision,input_hash:hash,config_revision:`${parserRevision}:${p.format}:${source.revision}`};
      insert(this.db,'IngestJob',job);
      const result={sourceId:source.id,documentId:document.id,jobId:job.id,revision:source.revision,state:'pending'};
      this.event(request.id,'source.captured',source.id,{requestHash,result});return result;
    });
  }
  status(p){const source=this.source(p);return {sourceId:source.id,revision:source.revision,accessState:source.access_state,
    jobs:this.db.prepare('SELECT j.id,j.document_id,j.stage,j.state,j.attempt,j.error_json,d.quality_json FROM IngestJob j LEFT JOIN Document d ON d.id=j.document_id AND d.workspace_id=j.workspace_id WHERE j.workspace_id=? AND j.source_id=? ORDER BY j.created_at,j.id').all(this.workspaceId,source.id)};}
  control(method,p){
    return this.transaction(()=>{
      const source=this.source(p),now=new Date().toISOString();
      if(method==='source.revoke'){
        if(source.revision!==p.expectedRevision)fail('source_revision_conflict');
        this.db.prepare("UPDATE Source SET access_state='revoked',revision=revision+1,updated_at=? WHERE id=?").run(now,source.id);
        this.db.prepare("UPDATE IngestJob SET state='cancelled',lease_owner=NULL,lease_until=NULL WHERE source_id=? AND state IN ('pending','running')").run(source.id);
        this.db.prepare("UPDATE KnowledgeItem SET status='disabled',updated_at=?,revision=revision+1 WHERE workspace_id=? AND id IN (SELECT knowledge_id FROM EvidenceLink e JOIN Document d ON d.id=e.document_id WHERE d.source_id=?)").run(now,this.workspaceId,source.id);
        this.event(randomUUID(),'source.revoked',source.id,{originalRetained:true});return {sourceId:source.id,state:'revoked',originalRetained:true};
      }
      const job=this.db.prepare('SELECT * FROM IngestJob WHERE workspace_id=? AND id=? AND source_id=?').get(this.workspaceId,p.ingestId,source.id);
      if(!job)fail('ingest_unavailable');
      if(method==='ingest.retry'){
        if(source.access_state==='revoked'||source.revision!==job.expected_source_revision||!['pending','failed','cancelled'].includes(job.state))fail('ingest_not_retryable');
        this.db.prepare("UPDATE IngestJob SET state='pending',error_json=NULL,updated_at=? WHERE id=?").run(now,job.id);
      }else this.db.prepare("UPDATE IngestJob SET state='cancelled',lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state IN ('pending','running')").run(now,job.id);
      return this.status(p);
    });
  }
  async process(jobId,parse,signal){
    const job=this.db.prepare('SELECT * FROM IngestJob WHERE workspace_id=? AND id=? AND deleted_at IS NULL').get(this.workspaceId,jobId);
    if(!job)fail('ingest_unavailable');
    const configuration=/^local-structured-1:(txt|md|html|docx|pdf|chat):([1-9][0-9]*)$/.exec(job.config_revision??'');
    if(job.stage!=='parse'||!configuration||Number(configuration[2])!==job.expected_source_revision||!/^[a-f0-9]{64}$/.test(job.input_hash))fail('ingest_protocol_unsupported');
    if(job.state==='completed')return {state:'completed',documentId:job.document_id};
    const owner=randomUUID(),now=new Date().toISOString(),sourceRevision=job.expected_source_revision;
    const lease=claimIngest(this.db,{workspaceId:this.workspaceId,jobId,owner,sourceRevision,now,leaseUntil:new Date(Date.now()+180000).toISOString(),protocol:{configRevision:job.config_revision,inputHash:job.input_hash,documentId:job.document_id}});
    if(!lease)fail('ingest_not_pending');
    try{
      signal?.throwIfAborted();
      const source=this.db.prepare('SELECT candidate_id,job_id FROM Source WHERE id=? AND workspace_id=?').get(job.source_id,this.workspaceId);
      this.scope({candidateId:source.candidate_id,jobId:source.job_id});
      const bytes=await this.blobs.read(job.input_hash),format=configuration[1];
      const ir=await parse(bytes,format,{signal});signal?.throwIfAborted();
      if(ir?.schemaVersion!==1||ir.parserId!=='fetchcv-local'||ir.format!==format||!supportedParserRevisions.has(ir.parserRevision)||!['ready','needs_review'].includes(ir.quality?.status)||ir.offsetUnit!=='unicode_codepoint'||typeof ir.source_text!=='string'||ir.source_text.includes('\0')||[...ir.source_text].length>2000000||!Array.isArray(ir.blocks)||ir.blocks.length>20000)fail('invalid_parser_result');
      const chars=[...ir.source_text];let lastEnd=0;
      for(const block of ir.blocks){
        if(!Number.isSafeInteger(block.charStart)||!Number.isSafeInteger(block.charEnd)||block.charStart<lastEnd||block.charEnd>chars.length||block.charEnd<=block.charStart||chars.slice(block.charStart,block.charEnd).join('')!==block.text||!['text','heading','table','list','image'].includes(block.type)||!Array.isArray(block.headingPath))fail('invalid_parser_locator');
        lastEnd=block.charEnd;
        if(block.headingPath.length>12||block.headingPath.some(h=>typeof h!=='string'||h.length>2000)||block.page!=null&&(!Number.isSafeInteger(block.page)||block.page<1||block.page>500)||block.bbox!=null&&(!Array.isArray(block.bbox)||block.bbox.length!==4||block.bbox.some(n=>!Number.isFinite(n))))fail('invalid_parser_locator');
      }
      const textHash=await this.blobs.put(Buffer.from(ir.source_text)),irHash=await this.blobs.put(Buffer.from(canonicalJSON(ir)));
      signal?.throwIfAborted();
      return this.transaction(()=>{
        const time=new Date().toISOString();
        if(!completeIngest(this.db,{workspaceId:this.workspaceId,jobId,owner,attempt:lease.attempt,sourceRevision,now:time}))fail('ingest_lease_lost');
        const source=this.db.prepare('SELECT * FROM Source WHERE id=?').get(job.source_id);
        this.scope({candidateId:source.candidate_id,jobId:source.job_id});
        const version=this.db.prepare('SELECT max(version)+1 n FROM Document WHERE source_id=?').get(job.source_id).n;
        this.db.prepare('UPDATE Document SET active=0 WHERE source_id=?').run(job.source_id);
        const documentId=randomUUID();
        insert(this.db,'Document',{id:documentId,workspace_id:this.workspaceId,source_id:job.source_id,version,blob_hash:job.input_hash,text_hash:textHash,text_blob_hash:textHash,ir_blob_hash:irHash,
          parser_id:ir.parserId,parser_revision:ir.parserRevision,state:'ready',captured_at:time,quality_json:canonicalJSON({...ir.quality,textLength:chars.length,offsetUnit:'unicode_codepoint'}),active:1,created_at:time,updated_at:time});
        ir.blocks.forEach((block,ordinal)=>insert(this.db,'Block',{id:randomUUID(),workspace_id:this.workspaceId,document_id:documentId,ordinal,type:block.type,text:block.text,char_start:block.charStart,char_end:block.charEnd,page:block.page??null,bbox_json:block.bbox?canonicalJSON(block.bbox):null,heading_path_json:canonicalJSON(block.headingPath),origin_json:canonicalJSON(block.originRef??{}),quality_json:canonicalJSON({...block.quality,status:ir.quality?.status??'needs_review'}),created_at:time,updated_at:time}));
        this.db.prepare('UPDATE IngestJob SET document_id=? WHERE id=?').run(documentId,jobId);
        this.event(randomUUID(),'source.parsed',job.source_id,{documentId,jobId,textHash,irHash});return {state:'completed',documentId};
      });
    }catch(error){
      const stopped=signal?.aborted&&signal.reason?.code==='application_closing',deferred=stopped||isParserInfrastructureError(error);
      this.db.prepare("UPDATE IngestJob SET state=?,lease_owner=NULL,lease_until=NULL,error_json=? WHERE id=? AND state='running' AND lease_owner=? AND attempt=?").run(deferred?'pending':'failed',stopped?null:canonicalJSON({code:error.code??'parse_failed'}),jobId,owner,lease.attempt);
      throw error;
    }
  }
}
