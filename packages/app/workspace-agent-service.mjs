import {FetchCVAgentHost} from '../../electron/pi-agent-runtime.mjs';
import {RuntimeRpc} from './runtime-rpc.mjs';
import {ContractError,validateRequest} from '../contracts/runtime.mjs';

// Lives alongside the DB in the APP utility. Provider secrets arrive through
// the parent-only port, live for one request, and are never returned to UI.
export class WorkspaceAgentService {
  constructor(store,{loadModules=null}={}){
    this.workspaceId=store.workspaceId;this.providers=new Map();this.pending=new Set();this.closing=false;
    const bridge=store.createAgentBridge();
    this.host=new FetchCVAgentHost({getProviderConfig:id=>this.providers.get(id),request:bridge.request.bind(bridge),loadModules});
    const run=this.host.run.bind(this.host);
    this.host.run=async(input,emit)=>{
      try{return await run(input,emit);}finally{this.providers.delete(input.requestId);}
    };
    this.rpc=new RuntimeRpc(this.host,{workspaceId:this.workspaceId});
  }
  async dispatch(raw,owner,provider,notify){
    if(this.closing)throw new ContractError('storage_unavailable');
    const request=validateRequest(raw,this.workspaceId);
    if(typeof owner!=='string'||!owner||owner.length>100)throw new ContractError('invalid_owner');
    const starting=['agent.turn','agent.task'].includes(request.method);
    if(starting){
      if(this.providers.has(request.id)||this.rpc.streams.has(request.id))throw new ContractError('duplicate_request');
      if(this.providers.size>=2)throw new ContractError('runtime_busy');
      if(!provider||typeof provider.apiKey!=='string'||!provider.apiKey||provider.apiKey.length>4096||typeof provider.model!=='string'||!provider.model||provider.model.length>240)throw new ContractError('provider_not_configured');
      let endpoint;try{endpoint=new URL(provider.baseUrl);}catch{throw new ContractError('provider_invalid');}
      if(endpoint.username||endpoint.password||!(endpoint.protocol==='https:'||(endpoint.protocol==='http:'&&['localhost','127.0.0.1'].includes(endpoint.hostname))))throw new ContractError('provider_invalid');
      this.providers.set(request.id,structuredClone(provider));
    }
    const pending=this.rpc.dispatch(request,owner,notify);this.pending.add(pending);
    try{
      const result=await pending;
      if(starting&&(request.method==='agent.turn'||!result.ok))this.providers.delete(request.id);
      return result;
    }finally{this.pending.delete(pending);}
  }
  disposeOwner(owner){this.rpc.disposeOwner(owner);}
  async close(){
    this.closing=true;
    for(const id of this.providers.keys())this.host.cancel(id);
    await Promise.allSettled([...this.pending]);
    // Background task invocations are not the initial RPC promise. Await their
    // settlements too, so storage cannot close underneath completion receipts.
    while([...this.rpc.streams.values()].some(s=>s.active))await new Promise(resolve=>setTimeout(resolve,20));
    this.providers.clear();
  }
}
