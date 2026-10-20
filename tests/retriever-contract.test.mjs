import test from 'node:test';
import assert from 'node:assert/strict';
import {activeWorkspace} from './helpers/active-workspace.mjs';
import * as retrieval from '../packages/knowledge/retrieval.mjs';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const parse=async(bytes,format)=>{const text=bytes.toString();return {schemaVersion:1,parserId:'fetchcv-local',parserRevision:'local-structured-1',format,offsetUnit:'unicode_codepoint',source_text:text,
  quality:{status:'ready'},blocks:[{type:'text',text,charStart:0,charEnd:[...text].length,headingPath:[],originRef:{type:'text'}}]};};

test('Retriever applies type, pin, authorization, diversity and conservative budgets before returning evidence',async()=>{
  const f=await activeWorkspace('retriever-contract');
  try{
    const scope={workspaceId:f.workspaceId,candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},ingestion=f.store.createIngestion();
    const empty=retrieval.retrieve(ingestion.db,{scope,query:'星河'});
    assert.equal(empty.degraded,true);assert.equal(empty.state,'not_indexed');
    await assert.rejects(f.request('knowledge.search',{candidateId:scope.candidateId,jobId:scope.jobId,query:'星河',maxTokens:-1}),{code:'invalid_search'});
    assert.equal(ingestion.db.prepare("SELECT name FROM sqlite_schema WHERE name='SearchHead'").get(),undefined,'invalid requests do not create indexes');
    const capture=async(title,text,format='txt',target=scope)=>{
      const {workspaceId,...p}=target;assert.equal(workspaceId,f.workspaceId);
      const item=await f.request('source.import',{...p,title,format,contentBase64:Buffer.from(text).toString('base64')});
      await ingestion.process(item.jobId,(b)=>parse(b,format));return item;
    };
    const long=await capture('多段材料','星河 37 未增长。'.repeat(200));
    const markdown=await capture('Markdown 材料','星河只有 12 个岗位。','md');
    const pinned=await capture('固定资料','海岚原文的固定参考。');
    const foreign=await capture('其他范围','星河 999。','txt',{workspaceId:f.workspaceId});
    const db=ingestion.db;retrieval.ensureSearchIndex(db,f.workspaceId);
    assert.equal(typeof retrieval.retrieve,'function');
    assert.throws(()=>retrieval.retrieve(db,{scope:{...scope,jobId:'missing'},query:'星河'}),{code:'job_unavailable'});
    assert.throws(()=>retrieval.retrieve(db,{scope:{workspaceId:f.workspaceId,jobId:scope.jobId},query:'星河'}),{code:'job_unavailable'});
    const result=retrieval.retrieve(db,{scope,query:'星河 未',sourceTypes:['document:txt'],pinnedIds:[pinned.sourceId,foreign.sourceId],maxTokens:3000,limit:20});
    assert.equal(result.hits[0].sourceId,pinned.sourceId);
    assert.equal(result.hits.some(x=>[markdown.sourceId,foreign.sourceId].includes(x.sourceId)),false);
    assert.ok(result.hits.filter(x=>x.sourceId===long.sourceId).length<=2);
    assert.ok(result.hits.length>=2);assert.equal(result.degraded,false);
    assert.ok(result.manifest.candidatesConsidered<=60);
    assert.deepEqual(result.manifest.unavailablePinnedIds,[foreign.sourceId]);
    assert.equal(result.manifest.query,'星河 未');assert.equal(result.manifest.budgetUnit,'utf8_bytes_conservative');
    assert.ok(result.manifest.usedBudget<=3000);
    for(const hit of result.hits){assert.ok(hit.chunkId);assert.ok(hit.version);assert.equal(retrieval.resolveCitation(db,{...scope,citation:hit.citation}).text,hit.text);}
    const small=retrieval.retrieve(db,{scope,query:'星河',pinnedIds:[pinned.sourceId],maxTokens:1,limit:20});
    assert.deepEqual(small.hits,[]);assert.equal(small.manifest.budgetLimited,true);
    const filtered=retrieval.retrieve(db,{scope,query:'星河',sourceTypes:['document:md'],maxTokens:2000,limit:1});
    assert.equal(filtered.hits[0].sourceId,markdown.sourceId);
    const controller=new AbortController();controller.abort();
    assert.throws(()=>retrieval.retrieve(db,{scope,query:'星河',maxTokens:2000,limit:20,signal:controller.signal}),{name:'AbortError'});
    await f.request('source.revoke',{candidateId:scope.candidateId,jobId:scope.jobId,sourceId:pinned.sourceId,expectedRevision:1});
    const revoked=retrieval.retrieve(db,{scope,query:'星河',pinnedIds:[pinned.sourceId],maxTokens:2000,limit:20});
    assert.ok(revoked.manifest.unavailablePinnedIds.includes(pinned.sourceId));
    assert.equal(revoked.hits.some(x=>x.sourceId===pinned.sourceId),false);
    await assert.rejects(f.request('knowledge.search',{candidateId:scope.candidateId,jobId:scope.jobId,query:'星河',sourceTypes:'txt'}),{code:'invalid_search'});
  }finally{f.store.close();}
});

test('Search v1 upgrade retains its cache and generations while publishing a complete weighted replacement',async()=>{
  const f=await activeWorkspace('search-v1-migration');
  try{
    const db=f.store.createIngestion().db,previous=randomUUID();
    db.exec(await readFile(new URL('./helpers/search-v1.sql',import.meta.url),'utf8'));
    db.exec("CREATE TABLE FeatureSchema(feature TEXT PRIMARY KEY,revision INTEGER NOT NULL,created_at TEXT NOT NULL) STRICT; INSERT INTO FeatureSchema VALUES('search',1,'2026-09-01T00:00:00.000Z')");
    db.prepare("INSERT INTO SearchGeneration VALUES(?,?,'structure-fts-1:0','ready','2026-09-01T00:00:00.000Z')").run(previous,f.workspaceId);
    db.prepare('INSERT INTO SearchHead VALUES (?,?)').run(f.workspaceId,previous);
    db.exec("INSERT INTO SearchFTS(chunk_id,scope,body) VALUES('retained-fixture','old-scope','retained body')");
    const result=retrieval.ensureSearchIndex(db,f.workspaceId);
    assert.notEqual(result.generation,previous);
    assert.equal(db.prepare("SELECT revision FROM FeatureSchema WHERE feature='search'").get().revision,2);
    assert.equal(db.prepare('SELECT body FROM SearchFTS').get().body,'retained body');
    assert.equal(db.prepare('SELECT state FROM SearchGeneration WHERE id=?').get(previous).state,'ready');
    assert.equal(db.prepare('SELECT generation_id FROM SearchHead').get().generation_id,result.generation);
    assert.ok(db.prepare('SELECT count(*) n FROM SearchFTS2').get().n>0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(retrieval.ensureSearchIndex(db,f.workspaceId).reused,true);
  }finally{f.store.close();}
});

test('title-only matches are indexed and weighted ahead of otherwise equal body matches',async()=>{
  const f=await activeWorkspace('retriever-title');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},ingestion=f.store.createIngestion();
    const created=[];
    for(const [title,text] of [['AnchorTitle','OtherBody'],['OtherTitle','AnchorTitle']]){
      const item=await f.request('source.import',{...scope,title,format:'txt',contentBase64:Buffer.from(text).toString('base64')});
      await ingestion.process(item.jobId,b=>parse(b,'txt'));created.push(item);
    }
    const result=await f.request('knowledge.search',{...scope,query:'AnchorTitle',maxTokens:4000});
    assert.equal(result.items[0].sourceId,created[0].sourceId);
    assert.ok(result.items.some(x=>x.sourceId===created[1].sourceId));
  }finally{f.store.close();}
});

test('duplicate text across many sources cannot occupy the complete candidate pool',async()=>{
  const f=await activeWorkspace('retriever-duplicate-pool');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},ingestion=f.store.createIngestion();let unique;
    for(let i=0;i<66;i++){
      const text=i===65?'Needle '+Array.from({length:45},(_,j)=>`word${j}`).join(' '):'Needle';
      const item=await f.request('source.import',{...scope,title:`source${i}`,format:'txt',contentBase64:Buffer.from(text).toString('base64')});
      await ingestion.process(item.jobId,b=>parse(b,'txt'));if(i===65)unique=item;
    }
    const result=await f.request('knowledge.search',{...scope,query:'Needle',maxTokens:5000,limit:20});
    assert.ok(result.items.some(hit=>hit.sourceId===unique.sourceId));
    assert.equal(new Set(result.items.map(hit=>hit.text)).size,result.items.length);
  }finally{f.store.close();}
});

test('pinned source duplicate leading blocks do not hide its next distinct block',async()=>{
  const f=await activeWorkspace('retriever-pin-duplicates');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},ingestion=f.store.createIngestion(),text='Needle\nNeedle\nUniqueThird';
    const item=await f.request('source.import',{...scope,title:'pinned',format:'txt',contentBase64:Buffer.from(text).toString('base64')});
    await ingestion.process(item.jobId,async b=>({...await parse(b,'txt'),blocks:[
      {type:'text',text:'Needle',charStart:0,charEnd:6,headingPath:[],originRef:{type:'text'}},
      {type:'text',text:'Needle',charStart:7,charEnd:13,headingPath:[],originRef:{type:'text'}},
      {type:'text',text:'UniqueThird',charStart:14,charEnd:25,headingPath:[],originRef:{type:'text'}},
    ]}));
    const result=await f.request('knowledge.search',{...scope,query:'',pinnedIds:[item.sourceId],maxTokens:4000});
    assert.deepEqual(result.items.map(h=>h.text),['Needle','UniqueThird']);
  }finally{f.store.close();}
});

test('unavailable high-ranked sources do not exhaust a batch or consume valid candidate slots',async()=>{
  const f=await activeWorkspace('retriever-unavailable-batch');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id},ingestion=f.store.createIngestion(),revoked=[];let valid;
    for(let i=0;i<67;i++){
      const text=i<66?'BatchNeedle':`BatchNeedle ${'uncommon '.repeat(40)}`;
      const item=await f.request('source.import',{...scope,title:`batch ${i}`,format:'txt',contentBase64:Buffer.from(text).toString('base64')});
      await ingestion.process(item.jobId,b=>parse(b,'txt'));if(i<66)revoked.push(item);else valid=item;
    }
    const generation=retrieval.ensureSearchIndex(ingestion.db,f.workspaceId).generation;
    for(const item of revoked)await f.request('source.revoke',{...scope,sourceId:item.sourceId,expectedRevision:1});
    const result=await f.request('knowledge.search',{...scope,query:'BatchNeedle',maxTokens:5000});
    assert.equal(result.generation,generation,'retained index still contains withdrawn matches');
    assert.ok(result.items.length>0);
    assert.ok(result.items.every(hit=>hit.sourceId===valid.sourceId));
    for(const hit of result.items)assert.equal(retrieval.resolveCitation(ingestion.db,{workspaceId:f.workspaceId,...scope,citation:hit.citation}).text,hit.text);
  }finally{f.store.close();}
});
