import test from 'node:test';
import assert from 'node:assert/strict';
import {activeWorkspace} from './helpers/active-workspace.mjs';
import {IngestScheduler} from '../packages/app/ingest-scheduler.mjs';
import {ApplicationStore} from '../packages/storage/application-store.mjs';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';

const ir=bytes=>({schemaVersion:1,parserId:'fetchcv-local',parserRevision:'local-structured-1',offsetUnit:'unicode_codepoint',format:'txt',source_text:bytes.toString(),quality:{status:'ready'},blocks:[{type:'text',text:bytes.toString(),charStart:0,charEnd:[...bytes.toString()].length,headingPath:[]}]});
async function until(predicate){const end=Date.now()+5000;while(!await predicate()){if(Date.now()>end)throw Error('condition timed out');await new Promise(r=>setTimeout(r,10));}}
test('durable local ingestion queue completes once, cancels active work, and drains before DB close',async()=>{
  const f=await activeWorkspace('ingest-scheduler');let scheduler;
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
    const first=await f.request('source.import',{...scope,title:'First material',format:'txt',contentBase64:Buffer.from('first').toString('base64')});
    let calls=0,aborted=false;
    scheduler=new IngestScheduler(f.store.createIngestion(),async(bytes,format,{signal})=>{
      calls++;
      if(bytes.toString()==='hold')await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});});
      return ir(bytes);
    },{intervalMs:10});
    await until(async()=> (await f.request('source.status',{...scope,sourceId:first.sourceId})).jobs[0].state==='completed');
    assert.equal(calls,1);
    const second=await f.request('source.import',{...scope,title:'Second material',format:'txt',contentBase64:Buffer.from('hold').toString('base64')});
    scheduler.notify();await until(()=>calls===2);
    await f.request('source.revoke',{...scope,sourceId:second.sourceId,expectedRevision:1});scheduler.notify();
    await until(()=>aborted);await scheduler.close();
    assert.equal((await f.request('source.status',{...scope,sourceId:second.sourceId})).jobs[0].state,'cancelled');
    scheduler=new IngestScheduler(f.store.createIngestion(),async()=>{throw Error('completed work must not replay');},{intervalMs:10});
    await scheduler.close();
    assert.equal(calls,2);
  }finally{await scheduler?.close();f.store.close();}
});

test('graceful shutdown preserves a pending job and a reopened APP resumes it',async()=>{
  const f=await activeWorkspace('ingest-shutdown');let store=f.store,scheduler;
  try{
    const captured=await f.request('source.import',{title:'resume after close',format:'txt',contentBase64:Buffer.from('resumed').toString('base64')});let started=false;
    scheduler=new IngestScheduler(store.createIngestion(),async(bytes,format,{signal})=>{started=true;await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},{intervalMs:10});
    await until(()=>started);await scheduler.close();
    assert.equal((await f.request('source.status',{sourceId:captured.sourceId})).jobs[0].state,'pending');
    store.close();store=await ApplicationStore.open(f.root);const ingestion=store.createIngestion();let calls=0;
    scheduler=new IngestScheduler(ingestion,async bytes=>{calls++;return ir(bytes);},{intervalMs:10});
    await until(()=>ingestion.status({sourceId:captured.sourceId}).jobs[0].state==='completed');assert.equal(calls,1);
  }finally{await scheduler?.close();store.close();}
});

test('legacy, non-parse and mismatched document jobs cannot invoke the parser through direct process calls',async()=>{
  const f=await activeWorkspace('ingest-protocol');
  try{
    const ingestion=f.store.createIngestion();let called=0;
    for(const [i,change,code]of [[1,"config_revision='legacy'",'ingest_protocol_unsupported'],[2,"stage='chunk'",'ingest_protocol_unsupported'],[3,"input_hash='"+'a'.repeat(64)+"'",'ingest_not_pending']]){
      const job=await f.request('source.import',{title:'protocol '+i,format:'txt',contentBase64:Buffer.from('closed protocol').toString('base64')});
      ingestion.db.prepare(`UPDATE IngestJob SET ${change} WHERE id=?`).run(job.jobId);
      await assert.rejects(ingestion.process(job.jobId,async bytes=>{called++;return ir(bytes);}),{code});
    }
    assert.equal(called,0);assert.equal(ingestion.nextPending(),undefined);
  }finally{f.store.close();}
});

test('native host import supports files above RPC size without altering the selected original',async()=>{
  const f=await activeWorkspace('native-import');
  try{
    const selected=path.join(process.env.M1_ALLOWED_DELETE_ROOT,'selected-synthetic.txt'),bytes=Buffer.alloc(3*1024*1024,65);
    await writeFile(selected,bytes,{flag:'wx'});
    const request={v:1,id:randomUUID(),workspaceId:f.workspaceId,method:'source.import',payload:{title:'Selected synthetic file',format:'txt'}};
    const result=await f.store.importSelectedFile(request,selected);assert.equal(result.state,'pending');
    assert.deepEqual(await f.store.importSelectedFile(request,selected),result);
    assert.deepEqual(await readFile(selected),bytes);
    await assert.rejects(f.store.importSelectedFile({...request,payload:{...request.payload,contentBase64:'YQ=='}},selected),{code:'invalid_host_import'});
    await assert.rejects(f.store.dispatch({...request,payload:{...request.payload,path:selected}}),{code:'invalid_payload'});
  }finally{f.store.close();}
});

test('runtime preflight and capacity failures pause the queue without consuming pending jobs',async()=>{
  const f=await activeWorkspace('ingest-infrastructure');let scheduler;
  try{
    const a=await f.request('source.import',{title:'infra a',format:'txt',contentBase64:'YQ=='});
    const b=await f.request('source.import',{title:'infra b',format:'txt',contentBase64:'Yg=='});
    const ingestion=f.store.createIngestion();let available=false,full=true,prepares=0,calls=0;
    scheduler=new IngestScheduler(ingestion,async bytes=>{calls++;if(full)throw Object.assign(new Error('full'),{code:'parser_retention_limit'});return ir(bytes);},{intervalMs:10,prepare:async()=>{prepares++;if(!available)throw Object.assign(new Error('missing'),{code:'parser_unavailable'});}});
    await until(()=>scheduler.status.state==='unavailable');
    assert.equal(prepares,1);assert.equal(calls,0);
    for(const job of [a,b]){const status=ingestion.status({sourceId:job.sourceId}).jobs[0];assert.equal(status.state,'pending');assert.equal(status.attempt,0);}
    available=true;scheduler.resume();await until(()=>calls===1&&scheduler.status.state==='unavailable');
    for(const job of [a,b])assert.equal(ingestion.status({sourceId:job.sourceId}).jobs[0].state,'pending');
    full=false;scheduler.resume();await until(()=>[a,b].every(job=>ingestion.status({sourceId:job.sourceId}).jobs[0].state==='completed'));
    assert.equal(calls,3);
  }finally{await scheduler?.close();f.store.close();}
});
