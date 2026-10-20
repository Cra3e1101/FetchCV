import {randomUUID} from 'node:crypto';
import {contentHash} from '../storage/blob-store.mjs';
import {canonicalJSON} from '../storage/legacy-archive.mjs';
import {ContractError} from '../contracts/runtime.mjs';
import {ensureFeatureSchema} from '../storage/feature-schema.mjs';
import {setImmediate as yieldTurn} from 'node:timers/promises';

const REVISION='structure-fts-2';
const fail=code=>{throw new ContractError(code);};
const FTS_SCHEMA="CREATE VIRTUAL TABLE IF NOT EXISTS SearchFTS2 USING fts5(chunk_id UNINDEXED,scope,title,heading,body,tokenize='unicode61');";
const SCHEMA=`
CREATE TABLE IF NOT EXISTS SearchGeneration(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES Workspace(id),revision TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS SearchHead(workspace_id TEXT PRIMARY KEY REFERENCES Workspace(id),generation_id TEXT NOT NULL REFERENCES SearchGeneration(id));
CREATE TABLE IF NOT EXISTS SearchChunk(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,document_id TEXT NOT NULL,block_id TEXT NOT NULL,generation_id TEXT NOT NULL REFERENCES SearchGeneration(id),
 char_start INTEGER NOT NULL,char_end INTEGER NOT NULL,text TEXT NOT NULL,text_hash TEXT NOT NULL,heading_json TEXT NOT NULL,scope_key TEXT NOT NULL,
 FOREIGN KEY(workspace_id,document_id) REFERENCES Document(workspace_id,id),FOREIGN KEY(workspace_id,block_id,document_id) REFERENCES Block(workspace_id,id,document_id));
CREATE INDEX IF NOT EXISTS search_chunk_generation ON SearchChunk(workspace_id,generation_id,document_id);
${FTS_SCHEMA}
`;
const scopeKey=(workspace,candidate,job)=>contentHash(canonicalJSON([workspace,candidate??null,job??null]));
export const citationIdentity=citation=>contentHash(canonicalJSON(citation));
export function lexicalTerms(text){
  const terms=[];
  for(const match of String(text).normalize('NFKC').toLowerCase().matchAll(/\p{Script=Han}+|[\p{L}\p{N}_+-]+/gu)){
    if(/^\p{Script=Han}+$/u.test(match[0])){
      const chars=[...match[0]];
      terms.push(...chars);
      for(let i=0;i<chars.length-1;i++)terms.push(chars[i]+chars[i+1]);
    }else terms.push(match[0]);
  }
  return [...new Set(terms)];
}
// Structure first; split only oversized elements. Each range still quotes the
// original block. UTF-8 byte allowance is conservative, not tokenizer output.
function* blockChunks(block){
  const chars=[...block.text];let start=0;
  while(start<chars.length){
    let end=start,bytes=0,lastBoundary=-1;
    while(end<chars.length&&bytes+Buffer.byteLength(chars[end])<=512){
      bytes+=Buffer.byteLength(chars[end]);end++;
      if(/[\s。！？；.!?;]/u.test(chars[end-1])&&bytes>=200)lastBoundary=end;
    }
    if(end<chars.length&&lastBoundary>start)end=lastBoundary;
    const text=chars.slice(start,end).join('');
    yield {start:block.char_start+start,end:block.char_start+end,text};
    start=end;
  }
}
export const chunkBlock=block=>[...blockChunks(block)].filter(chunk=>chunk.text.trim());

function* buildIndex(db,workspaceId){
    ensureFeatureSchema(db,'search',SCHEMA,(db,from)=>{
      if(from!==0&&from!==1)fail('unsupported_feature_schema');
      // Retain the old table and generations; only the final batch publishes
      // the replacement head together with its ready state.
      db.exec(FTS_SCHEMA);
    });
    const generation=randomUUID(),revision=indexRevision(db,workspaceId);
    db.prepare("INSERT INTO SearchGeneration VALUES (?,?,?,'building',?)").run(generation,workspaceId,revision,new Date().toISOString());
    const page=db.prepare(`SELECT b.*,s.title,s.candidate_id,s.job_id FROM Block b JOIN Document d ON d.id=b.document_id AND d.workspace_id=b.workspace_id
      JOIN Source s ON s.id=d.source_id AND s.workspace_id=d.workspace_id WHERE b.workspace_id=? AND b.deleted_at IS NULL AND d.deleted_at IS NULL
      AND d.state='ready' AND s.deleted_at IS NULL AND s.access_state='available' AND coalesce(json_extract(d.quality_json,'$.status'),'ready')='ready'
      AND b.id>? ORDER BY b.id LIMIT 1`);
    let count=0,after='';
    while(true){
      if(indexRevision(db,workspaceId)!==revision)fail('index_source_changed');
      const rows=page.all(workspaceId,after);if(!rows.length)break;
      for(const block of rows){for(const chunk of blockChunks(block)){
      // Scanning whitespace still consumes a bounded batch step.
      if(!chunk.text.trim()){yield;continue;}
      if(++count>200000)fail('index_capacity_exceeded');
      const id=contentHash(canonicalJSON([generation,block.document_id,block.id,chunk.start,chunk.end,chunk.text,REVISION]));
      const scope=scopeKey(workspaceId,block.candidate_id,block.job_id);
      db.prepare('INSERT INTO SearchChunk VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,workspaceId,block.document_id,block.id,generation,chunk.start,chunk.end,chunk.text,contentHash(chunk.text),block.heading_path_json,scope);
      db.prepare('INSERT INTO SearchFTS2(chunk_id,scope,title,heading,body) VALUES (?,?,?,?,?)')
        .run(id,scope,lexicalTerms(block.title).join(' '),lexicalTerms(JSON.parse(block.heading_path_json).join(' ')).join(' '),lexicalTerms(chunk.text).join(' '));
      yield;
      }after=block.id;yield;}
    }
    if(indexRevision(db,workspaceId)!==revision)fail('index_source_changed');
    db.prepare("UPDATE SearchGeneration SET state='ready' WHERE id=?").run(generation);
    db.prepare('INSERT INTO SearchHead VALUES (?,?) ON CONFLICT(workspace_id) DO UPDATE SET generation_id=excluded.generation_id').run(workspaceId,generation);
    return {generation,revision:REVISION,chunks:count,mode:'fts'};
}

function batch(db,steps,limit){
  db.exec('SAVEPOINT search_build');
  try{
    let result;
    for(let i=0;i<limit;i++){result=steps.next();if(result.done)break;}
    db.exec('RELEASE search_build');return result;
  }catch(error){db.exec('ROLLBACK TO search_build; RELEASE search_build');throw error;}
}

export function createSearchIndex(db,workspaceId){
  return batch(db,buildIndex(db,workspaceId),Infinity).value;
}

function indexRevision(db,workspaceId){
  return `${REVISION}:${db.prepare("SELECT coalesce(max(sequence),0) n FROM Event WHERE workspace_id=? AND type='source.parsed'").get(workspaceId).n}`;
}
export function ensureSearchIndex(db,workspaceId){
  const exists=db.prepare("SELECT name FROM sqlite_schema WHERE name='SearchHead'").get();
  const head=exists&&db.prepare('SELECT g.revision FROM SearchHead h JOIN SearchGeneration g ON g.id=h.generation_id WHERE h.workspace_id=?').get(workspaceId);
  if(!head||head.revision!==indexRevision(db,workspaceId))return createSearchIndex(db,workspaceId);
  return {revision:head.revision,reused:true};
}

const builds=new WeakMap();
export function cancelSearchIndex(db){builds.get(db)?.controller.abort();}
function ensureBackgroundIndex(db,workspaceId){
  if(builds.has(db))return builds.get(db).promise;
  const exists=db.prepare("SELECT name FROM sqlite_schema WHERE name='SearchHead'").get();
  const head=exists&&db.prepare('SELECT g.revision FROM SearchHead h JOIN SearchGeneration g ON g.id=h.generation_id WHERE h.workspace_id=?').get(workspaceId);
  if(head?.revision===indexRevision(db,workspaceId))return;
  const controller=new AbortController();
  const promise=(async()=>{
    try{
      const steps=buildIndex(db,workspaceId);
      while(true){
        // Every wait is outside a transaction; closing the store aborts before
        // the next access to its SQLite handle. Partial generations stay hidden.
        await yieldTurn(undefined,{signal:controller.signal});
        controller.signal.throwIfAborted();
        if(batch(db,steps,64).done)return;
      }
    }finally{builds.delete(db);}
  })();
  builds.set(db,{controller,promise});return promise;
}

async function waitForBuild(promise,signal){
  if(!signal)return promise;
  signal.throwIfAborted();
  let onAbort;
  try{
    return await Promise.race([promise,new Promise((_,reject)=>{
      onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});
    })]);
  }finally{signal.removeEventListener('abort',onAbort);}
}

export async function searchKnowledgeAsync(db,{workspaceId,candidateId=null,jobId=null,...options}){
  const args={...options,scope:{workspaceId,candidateId,jobId}};
  // Validate authorization before any derived writes; validate again after the
  // wait so a concurrent revocation cannot leak an earlier search result.
  validateSearch(db,args);
  const pending=ensureBackgroundIndex(db,workspaceId);
  if(pending)await waitForBuild(pending,options.signal);
  const {hits,...result}=retrieve(db,args);
  return {...result,items:hits};
}

const AVAILABLE=`JOIN Document d ON d.id=c.document_id AND d.workspace_id=c.workspace_id
 JOIN Source s ON s.id=d.source_id AND s.workspace_id=d.workspace_id JOIN Workspace w ON w.id=s.workspace_id
 LEFT JOIN Candidate p ON p.id=s.candidate_id AND p.workspace_id=s.workspace_id LEFT JOIN Job j ON j.id=s.job_id AND j.workspace_id=s.workspace_id`;
const AUTHORIZED=`w.deleted_at IS NULL AND s.deleted_at IS NULL AND s.access_state='available' AND d.deleted_at IS NULL AND d.state='ready'
 AND (s.candidate_id IS NULL OR p.deleted_at IS NULL AND p.id IS NOT NULL) AND (s.job_id IS NULL OR j.deleted_at IS NULL AND j.id IS NOT NULL)
 AND coalesce(json_extract(d.quality_json,'$.status'),'ready')='ready'
 AND s.candidate_id IS ? AND (s.job_id IS NULL OR s.job_id IS ?)`;

// Compatibility shape for existing RPC callers. All selection uses the same Retriever.
export function searchKnowledge(db,{workspaceId,candidateId=null,jobId=null,...options}){
  const {hits,...result}=retrieve(db,{...options,scope:{workspaceId,candidateId,jobId},ensureIndex:true});
  return {...result,items:hits};
}

function validateSearch(db,{scope,query,limit=20,asOf=null,sourceTypes=[],pinnedIds=[],maxTokens=4096,signal}){
  signal?.throwIfAborted();
  if(!scope||typeof scope.workspaceId!=='string'||typeof query!=='string'||query.length>1000||!Number.isSafeInteger(limit)||limit<1||limit>20||
    asOf!==null&&!Number.isFinite(Date.parse(asOf))||!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>32000||
    !Array.isArray(sourceTypes)||sourceTypes.length>20||sourceTypes.some(t=>typeof t!=='string'||!t||t.length>100)||
    !Array.isArray(pinnedIds)||pinnedIds.length>20||pinnedIds.some(id=>typeof id!=='string'||!id||id.length>100))fail('invalid_search');
  const {workspaceId,candidateId=null,jobId=null}=scope;
  if(!db.prepare('SELECT id FROM Workspace WHERE id=? AND deleted_at IS NULL').get(workspaceId))fail('workspace_unavailable');
  if(candidateId!==null&&!db.prepare('SELECT id FROM Candidate WHERE workspace_id=? AND id=? AND deleted_at IS NULL').get(workspaceId,candidateId))fail('candidate_unavailable');
  if(jobId!==null&&!db.prepare('SELECT id FROM Job WHERE workspace_id=? AND candidate_id IS ? AND id=? AND deleted_at IS NULL').get(workspaceId,candidateId,jobId))fail('job_unavailable');
}

function rankedCandidates(db,{match,columns,joins,eligible,bindings,signal}){
  const details=db.prepare(`SELECT ${columns} FROM json_each(?) batch
    CROSS JOIN SearchChunk c ON c.id=batch.value ${joins} WHERE ${eligible}`);
  const rows=[],texts=new Set(),counts=new Map();let batch=[];
  const consume=()=>{
    signal?.throwIfAborted();
    const allowed=new Map(details.all(JSON.stringify(batch.map(row=>row.chunk_id)),...bindings).map(row=>[row.id,row]));
    for(const ranked of batch){
      const row=allowed.get(ranked.chunk_id);if(!row||texts.has(row.text_hash))continue;
      // The best eligible copy owns the text even if its source is already full.
      texts.add(row.text_hash);const count=counts.get(row.source_id)||0;if(count>=2)continue;
      counts.set(row.source_id,count+1);rows.push({...row,score:ranked.score});if(rows.length===60)break;
    }
    batch=[];
  };
  // Rank lightweight FTS identifiers once. Every batch is authorized and time
  // filtered before dedup/diversity/candidate limits; rejected rows never use a
  // quota slot. There is no raw-hit LIMIT that could hide a later valid source.
  for(const row of db.prepare(`SELECT chunk_id,bm25(SearchFTS2,0,0,4,2,1) score
    FROM SearchFTS2 WHERE SearchFTS2 MATCH ? ORDER BY score,chunk_id`).iterate(match)){
    signal?.throwIfAborted();batch.push(row);if(batch.length===64)consume();if(rows.length===60)break;
  }
  if(batch.length&&rows.length<60)consume();return rows;
}

export function retrieve(db,{scope,query,limit=20,sourceId=null,asOf=null,sourceTypes=[],pinnedIds=[],maxTokens=4096,signal,ensureIndex=false}){
  validateSearch(db,{scope,query,limit,asOf,sourceTypes,pinnedIds,maxTokens,signal});
  const {workspaceId,candidateId=null,jobId=null}=scope;
  if(ensureIndex)ensureSearchIndex(db,workspaceId);
  const head=db.prepare("SELECT name FROM sqlite_schema WHERE name='SearchHead'").get()&&db.prepare('SELECT generation_id FROM SearchHead WHERE workspace_id=?').get(workspaceId),terms=lexicalTerms(query).slice(0,32);
  const manifest={schemaVersion:1,query,scope:{workspaceId,candidateId,jobId},asOf,sourceTypes,pinnedIds:[...new Set(pinnedIds)],
    generation:head?.generation_id??null,revision:REVISION,maxTokens,budgetUnit:'utf8_bytes_conservative',usedBudget:0,budgetLimited:false,
    perSourceLimit:2,candidatesConsidered:0,unavailablePinnedIds:[],selectedChunkIds:[]};
  const finish=hits=>({mode:'fts',generation:manifest.generation,revision:REVISION,hits,degraded:false,manifest,
    evidenceStatus:hits.length?'candidate_evidence_requires_semantic_check':'insufficient_evidence',queryTerms:terms});
  if(!head){manifest.unavailablePinnedIds=manifest.pinnedIds;return {...finish([]),state:'not_indexed',degraded:true};}
  const scopes=[scopeKey(workspaceId,candidateId,jobId),scopeKey(workspaceId,candidateId,null)];
  const match=`scope:(${[...new Set(scopes)].map(t=>'"'+t+'"').join(' OR ')}) AND {title heading body}:(${terms.map(t=>'"'+t.replaceAll('"','""')+'"').join(' OR ')})`;
  const time=asOf===null?null:new Date(asOf).toISOString();
  const columns='c.*,s.id source_id,s.title,s.kind source_type,d.version,d.text_hash document_hash,d.quality_json,b.page,b.origin_json,b.heading_path_json';
  const joins=`${AVAILABLE} JOIN Block b ON b.id=c.block_id AND b.workspace_id=c.workspace_id`;
  const eligible=`c.workspace_id=? AND c.generation_id=? AND ${AUTHORIZED} AND b.deleted_at IS NULL
    AND (? IS NULL OR s.id=?) AND (?='[]' OR s.kind IN (SELECT value FROM json_each(?)))
    AND ((? IS NULL AND d.active=1) OR (? IS NOT NULL AND d.captured_at<=? AND NOT EXISTS
      (SELECT 1 FROM Document newer WHERE newer.source_id=d.source_id AND newer.state='ready' AND newer.deleted_at IS NULL AND newer.captured_at<=? AND newer.version>d.version)))`;
  const bindings=[workspaceId,head.generation_id,candidateId,jobId,sourceId,sourceId,JSON.stringify(sourceTypes),JSON.stringify(sourceTypes),time,time,time,time];
  const rows=terms.length?rankedCandidates(db,{match,columns,joins,eligible,bindings,signal}):[];
  let pinned=[];
  if(manifest.pinnedIds.length){
    signal?.throwIfAborted();
    const pinJSON=JSON.stringify(manifest.pinnedIds);
    const available=new Set(db.prepare(`SELECT DISTINCT s.id FROM SearchChunk c ${joins} JOIN json_each(?) pins ON pins.value=s.id WHERE ${eligible}`).all(pinJSON,...bindings).map(r=>r.id));
    manifest.unavailablePinnedIds=manifest.pinnedIds.filter(id=>!available.has(id));
    pinned=db.prepare(`WITH eligible_pins AS (
      SELECT ${columns},NULL score,b.ordinal block_ordinal,CAST(pins.key AS INTEGER) pin_rank
      FROM SearchChunk c ${joins} JOIN json_each(?) pins ON pins.value=s.id WHERE ${eligible}), unique_pins AS (
      SELECT *,row_number() OVER(PARTITION BY text_hash ORDER BY pin_rank,block_ordinal,char_start,id) text_rank FROM eligible_pins), diverse_pins AS (
      SELECT *,row_number() OVER(PARTITION BY source_id ORDER BY block_ordinal,char_start,id) source_rank FROM unique_pins WHERE text_rank=1)
      SELECT * FROM diverse_pins WHERE source_rank<=2 ORDER BY pin_rank,block_ordinal,char_start,id LIMIT 40`).all(pinJSON,...bindings);
  }
  const ranks=new Map(rows.map((r,i)=>[r.id,i+1])),texts=new Set(),counts=new Map(),hits=[],candidates=[];
  for(const row of [...pinned,...rows]){
    if(texts.has(row.text_hash)||(counts.get(row.source_id)||0)>=2)continue;
    candidates.push(row);texts.add(row.text_hash);counts.set(row.source_id,(counts.get(row.source_id)||0)+1);
    if(candidates.length===60)break;
  }
  manifest.candidatesConsidered=candidates.length;
  for(const row of candidates){
    signal?.throwIfAborted();
    if(hits.length>=limit)break;
    const citation={schemaVersion:1,documentId:row.document_id,blockId:row.block_id,textHash:row.document_hash,
      start:row.char_start,end:row.char_end,quoteHash:row.text_hash,offsetUnit:'unicode_codepoint'};
    const hit={chunkId:row.id,sourceId:row.source_id,sourceType:row.source_type,documentId:row.document_id,version:row.version,title:row.title,text:row.text,score:row.score,
      lexicalRank:ranks.get(row.id)??null,authority:'source_material',quality:JSON.parse(row.quality_json),headingPath:JSON.parse(row.heading_path_json),page:row.page,
      locator:JSON.parse(row.origin_json),citation,citationId:citationIdentity(citation)};
    // Count metadata as well as source text. This is a conservative byte budget,
    // not a claim to reproduce any provider tokenizer.
    const cost=Buffer.byteLength(JSON.stringify(hit));
    if(manifest.usedBudget+cost>maxTokens){manifest.budgetLimited=true;continue;}
    manifest.usedBudget+=cost;manifest.selectedChunkIds.push(row.id);hits.push(hit);
  }
  signal?.throwIfAborted();return finish(hits);
}

export function resolveCitation(db,{workspaceId,candidateId=null,jobId=null,citation}){
  if(!citation||citation.schemaVersion!==1||citation.offsetUnit!=='unicode_codepoint'||!Number.isSafeInteger(citation.start)||!Number.isSafeInteger(citation.end)||citation.end<=citation.start)fail('invalid_citation');
  const row=db.prepare(`SELECT c.text,c.char_start,c.char_end,d.text_hash document_hash,d.active,s.candidate_id,s.job_id FROM Block c ${AVAILABLE}
    WHERE c.workspace_id=? AND c.id=? AND c.document_id=? AND c.deleted_at IS NULL AND ${AUTHORIZED}`).get(workspaceId,citation.blockId,citation.documentId,candidateId,jobId);
  if(!row||row.document_hash!==citation.textHash||citation.start<row.char_start||citation.end>row.char_end)fail('citation_unavailable');
  const text=[...row.text].slice(citation.start-row.char_start,citation.end-row.char_start).join('');
  if(contentHash(text)!==citation.quoteHash)fail('citation_quote_mismatch');
  return {available:true,current:Boolean(row.active),text,citation,sourceScope:{candidateId:row.candidate_id,jobId:row.job_id},citationId:citationIdentity(citation),semanticSupport:'not_automatically_verified'};
}
