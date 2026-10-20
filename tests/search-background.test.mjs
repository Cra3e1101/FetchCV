import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {activeWorkspace} from './helpers/active-workspace.mjs';
import {searchKnowledgeAsync,createSearchIndex} from '../packages/knowledge/retrieval.mjs';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';

function parsedEvent(db,workspaceId){
  const now=new Date().toISOString(),id=randomUUID();
  const sequence=db.prepare('SELECT coalesce(max(sequence),0)+1 n FROM Event WHERE workspace_id=?').get(workspaceId).n;
  db.prepare('INSERT INTO Event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,workspaceId,null,'source',id,sequence,'source.parsed','{}',1,'app',now,now,now);
}

test('search yields before publication, shares a build, and leaves navigation usable',async()=>{
  const f=await activeWorkspace('search-background');
  try{
    const db=f.store.createIngestion().db;
    let finished=false;
    const search=f.request('knowledge.search',{query:'Synthetic'}).then(r=>{finished=true;return r;});
    const second=f.request('knowledge.search',{query:'Synthetic'});
    await f.request('workspace.info');
    assert.equal(finished,false,'building must yield to another request');
    const results=await Promise.all([search,second]);
    assert.equal(results[0].generation,results[1].generation);
    assert.equal(db.prepare("SELECT count(*) n FROM SearchGeneration WHERE state='ready'").get().n,1);
  }finally{f.store.close();}
});

test('a cancelled caller does not cancel another search sharing the index',async()=>{
  const f=await activeWorkspace('search-cancel-sharing');
  try{
    const db=f.store.createIngestion().db,controller=new AbortController();
    const cancelled=searchKnowledgeAsync(db,{workspaceId:f.workspaceId,query:'Synthetic',signal:controller.signal});
    const rejected=assert.rejects(cancelled,{name:'AbortError'});
    const other=f.request('knowledge.search',{query:'Synthetic'});
    controller.abort();await rejected;
    assert.ok((await other).generation);
  }finally{f.store.close();}
});

test('source revision changes cannot publish a stale replacement over a complete index',async()=>{
  const f=await activeWorkspace('search-revision-fence');
  try{
    const db=f.store.createIngestion().db;
    const old=createSearchIndex(db,f.workspaceId);
    // Import a new immutable synthetic block through the actual ingestion path.
    const text='Synthetic '.repeat(10000);
    const imported=await f.request('source.import',{title:'Synthetic large source',format:'txt',contentBase64:Buffer.from(text).toString('base64')});
    await f.store.createIngestion().process(imported.jobId,async()=>({schemaVersion:1,parserId:'fetchcv-local',parserRevision:'local-structured-1',format:'txt',offsetUnit:'unicode_codepoint',source_text:text,
      quality:{status:'ready'},blocks:[{type:'text',text,charStart:0,charEnd:[...text].length,headingPath:[],originRef:{type:'text'}}]}));
    const pending=f.request('knowledge.search',{query:'Synthetic'});
    const rejected=assert.rejects(pending,{code:'index_source_changed'});
    await yieldTurn();
    assert.equal(db.prepare('SELECT generation_id FROM SearchHead').get().generation_id,old.generation);
    assert.ok(db.prepare("SELECT count(*) n FROM SearchGeneration WHERE state='building'").get().n>0);
    parsedEvent(db,f.workspaceId);await rejected;
    assert.equal(db.prepare('SELECT generation_id FROM SearchHead').get().generation_id,old.generation);
  }finally{f.store.close();}
});

test('a source revoked while rebuilding cannot be returned by the waiting query',async()=>{
  const f=await activeWorkspace('search-revoke-building');
  try{
    const db=f.store.createIngestion().db;
    const pending=f.request('knowledge.search',{query:'Synthetic'});
    db.prepare("UPDATE Source SET access_state='revoked'").run();
    assert.equal((await pending).items.length,0);
  }finally{f.store.close();}
});

test('whitespace scanning yields between batches and close keeps the incomplete head hidden',async()=>{
  const f=await activeWorkspace('search-whitespace');
  try{
    const ingestion=f.store.createIngestion(),db=ingestion.db,text=' '.repeat(100000);
    const imported=await f.request('source.import',{title:'Synthetic whitespace',format:'txt',contentBase64:Buffer.from(text).toString('base64')});
    await ingestion.process(imported.jobId,async()=>({schemaVersion:1,parserId:'fetchcv-local',parserRevision:'local-structured-1',format:'txt',offsetUnit:'unicode_codepoint',source_text:text,
      quality:{status:'ready'},blocks:[{type:'text',text,charStart:0,charEnd:text.length,headingPath:[],originRef:{type:'text'}}]}));
    let finished=false;
    const pending=f.request('knowledge.search',{query:'Synthetic'}).then(result=>{finished=true;return result;});
    const rejected=assert.rejects(pending,{name:'AbortError'});
    await yieldTurn();await f.request('workspace.info');
    assert.equal(finished,false);
    assert.equal(db.prepare('SELECT count(*) n FROM SearchHead').get().n,0);
    f.store.close();await rejected;
  }finally{f.store.close();}
});

test('closing storage during a build rejects safely without publishing partial work',async()=>{
  const f=await activeWorkspace('search-close');
  const pending=f.request('knowledge.search',{query:'Synthetic'});
  const rejected=assert.rejects(pending,{name:'AbortError'});
  f.store.close();
  await rejected;
  await yieldTurn();
});

test('real storage port answers navigation before a queued search finishes',async()=>{
  const f=await activeWorkspace('search-port-navigation');f.store.close();
  const child=fork(new URL('./helpers/storage-port-child.mjs',import.meta.url),[f.root],{silent:true});
  let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes;});child.stdout.resume();
  const messages=[],waiters=new Map();
  child.on('message',message=>{messages.push(message);waiters.get(message.token??message.kind)?.(message);});
  const wait=key=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(`port timed out: ${key}; ${stderr}`)),15000);
    const finish=value=>{clearTimeout(timer);waiters.delete(key);resolve(value);};
    const found=messages.find(m=>(m.token??m.kind)===key);if(found)finish(found);else waiters.set(key,finish);
  });
  try{
    await wait('ready');
    child.send({kind:'request',token:'malformed',request:null});
    assert.equal((await wait('malformed')).ok,false,'malformed input must not terminate the storage process');
    // Deliver both port events in one turn; separate IPC deliveries may arrive
    // only after this tiny fixture has already finished its index.
    child.send([['search','knowledge.search',{query:'Synthetic'}],['nav','workspace.info',{}]].map(([token,method,payload])=>
      ({kind:'request',token,request:{v:1,id:randomUUID(),workspaceId:f.workspaceId,method,payload}})));
    assert.equal((await wait('nav')).ok,true);
    assert.equal((await wait('search')).ok,true);
    assert.ok(messages.findIndex(m=>m.token==='nav')<messages.findIndex(m=>m.token==='search'));
    const exited=once(child,'exit');child.send({kind:'close'});assert.equal((await exited)[0],0,stderr);
  }finally{if(child.exitCode===null){child.kill();await once(child,'exit');}}
});
