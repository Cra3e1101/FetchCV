import {ApplicationStore} from '../storage/application-store.mjs';
import {ContractError,MAX_RPC_BYTES} from '../contracts/runtime.mjs';
import {WorkspaceAgentService} from './workspace-agent-service.mjs';
import {IngestScheduler} from './ingest-scheduler.mjs';
import {createWindowsParser} from '../knowledge/windows-parser.mjs';
import path from 'node:path';

// Only the Electron parent has this port. Renderer inputs must be wrapped as
// requests by the trusted-frame host; they cannot send lifecycle controls.
export async function serveStoragePort(port,root,{parserRuntime=null}={}) {
  const store=await ApplicationStore.open(root);
  const agent=new WorkspaceAgentService(store);
  let parser;
  const ingestion=new IngestScheduler(store.createIngestion(),async(...args)=>(await parser)(...args),{prepare:async()=>{
    if(!parserRuntime)throw new ContractError('parser_unavailable');
    parser??=createWindowsParser({runtime:parserRuntime,workspaceRoot:root,workRoot:path.join(root,'derived','parser')}).catch(error=>{parser=null;throw error;});
    await parser;
  }});
  let queue=Promise.resolve(),pending=0,closing=false;
  const searches=new Set();
  port.on('message',({data})=>{
    if(closing) return;
    if(data?.kind==='close') {
      closing=true;
      void queue.then(()=>{store.cancelSearch();return Promise.allSettled([...searches,store.closeMcp(),agent.close(),ingestion.close()]);}).finally(async()=>{await store.close();port.postMessage({kind:'closed'});process.exit(0);});
      return;
    }
    if(data?.kind==='agent-owner-closed'){if(typeof data.owner==='string')agent.disposeOwner(data.owner);return;}
    if(!['request','agent-request','file-import','extension-import'].includes(data?.kind) || typeof data.token!=='string' || data.token.length>100) return;
    const send=message=>port.postMessage({kind:'response',token:data.token,...message});
    const control=data.kind==='agent-request'&&['agent.cancel','agent.ack'].includes(data.request?.method)||data.kind==='request'&&['mcp.cancel','mcp.control'].includes(data.request?.method);
    if(pending>=32&&!control) {send({ok:false,error:{code:'storage_busy'}});return;}
    let size;
    try {size=Buffer.byteLength(JSON.stringify(data.request));} catch {size=Infinity;}
    if(!Number.isFinite(size) || size>MAX_RPC_BYTES) {send({ok:false,error:{code:'payload_too_large'}});return;}
    if(data.kind==='agent-request'){
      pending++;
      // Never enqueue cancellation behind the long-running model request.
      void agent.dispatch(data.request,data.owner,data.provider,event=>port.postMessage({kind:'agent-event',owner:data.owner,event}))
        .then(result=>send({ok:true,result}),error=>send({ok:false,error:{code:error instanceof ContractError?error.code:'runtime_failed'}})).finally(()=>{pending--;});
      return;
    }
    pending++;
    if(data.kind==='request'&&['mcp.cancel','mcp.control'].includes(data.request?.method)){
      // Safety controls must not wait for a queued import or unrelated async write.
      // SQLite mutations are synchronous on this APP thread; manager rechecks after awaits.
      const task=store.dispatch(data.request)
        .then(result=>send({ok:true,result}),error=>send({ok:false,error:{code:error instanceof ContractError?error.code:'storage_failed'}}))
        .finally(()=>{pending--;searches.delete(task);});
      searches.add(task);return;
    }
    if(data.kind==='request'&&['knowledge.search','mcp.discover','mcp.execute'].includes(data.request?.method)){
      // Respect earlier queued writes, but do not block later navigation or
      // revocation behind an index build. Search rechecks scope after yielding.
      const task=queue.then(()=>store.dispatch(data.request))
        .then(result=>send({ok:true,result}),error=>send({ok:false,error:{code:error instanceof ContractError?error.code:'storage_failed'}}))
        .finally(()=>{pending--;searches.delete(task);});
      searches.add(task);return;
    }
    queue=queue.then(async()=>{
      try {const result=data.kind==='extension-import'?await store.importSelectedExtension(data.request,data.selectedPath):data.kind==='file-import'?await store.importSelectedFile(data.request,data.selectedPath):await store.dispatch(data.request);
        if(data.request.method==='ingest.retry')ingestion.resume();else ingestion.notify();
        if(data.request.method==='source.status')result.parser=ingestion.status;
        send({ok:true,result});}
      catch(error) {send({ok:false,error:{code:error instanceof ContractError ? error.code : 'storage_failed'}});}
    }).finally(()=>{pending--;}).catch(async()=>{closing=true;await ingestion.close();await store.close();process.exit(1);});
  });
  port.postMessage({kind:'ready',workspaceId:store.workspaceId});
}
