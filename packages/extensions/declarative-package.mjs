import {ContractError} from '../contracts/runtime.mjs';
import {canonicalJSON} from '../storage/legacy-archive.mjs';
import {contentHash} from '../storage/blob-store.mjs';
export const NATIVE_CAPABILITIES=['list_mcp_tools','propose_mcp_call','read_mcp_receipt','read_memory','propose_memory','search_knowledge','read_evidence','inspect_application_workspace','read_artifact','read_document','read_conversation','propose_artifact','read_skill'];
const fail=()=>{throw new ContractError('invalid_declarative_package');};
const keys=(x,allowed)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!allowed.includes(k)))fail();};
const id=x=>{if(typeof x!=='string'||! /^[a-z][a-z0-9._-]{0,79}$/.test(x))fail();};
const text=(x,max)=>{if(typeof x!=='string'||!x.trim()||x.length>max)fail();};
const list=(x,max)=>{if(!Array.isArray(x)||x.length>max||new Set(x).size!==x.length)fail();};
export function validatePackage(bundle){
 keys(bundle,['manifest','resources']);const m=bundle.manifest;keys(m,['schema','id','version','requiresApp','skills','agents','mcp','requestedCapabilities','files']);
 id(m.id);if(m.schema!==1||m.requiresApp!=='2.x'||!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(m.version))fail();
 list(m.skills,16);list(m.agents,16);list(m.mcp,0);list(m.requestedCapabilities,16);
 if(m.requestedCapabilities.some(x=>!NATIVE_CAPABILITIES.includes(x)))fail();
 keys(m.files,Object.keys(m.files??{}));keys(bundle.resources,Object.keys(bundle.resources??{}));
 const paths=Object.keys(m.files);if(paths.length>32||paths.length!==Object.keys(bundle.resources).length)fail();
 for(const name of paths){
  if(!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(md|txt|json)$/.test(name)||/^(?:.*\/)?(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name))fail();
  const body=bundle.resources[name];text(body,65536);if(m.files[name]!==`sha256:${contentHash(Buffer.from(body,'utf8'))}`)fail();
 }
 const skills=new Set();for(const s of m.skills){keys(s,['id','title','path']);id(s.id);text(s.title,120);if(skills.has(s.id)||!Object.hasOwn(m.files,s.path))fail();skills.add(s.id);}
 const agents=new Set();for(const a of m.agents){keys(a,['id','title','instructions','skills','tools','maxToolCalls']);id(a.id);text(a.title,120);text(a.instructions,12000);list(a.skills,16);list(a.tools,16);
  if(agents.has(a.id)||a.skills.some(x=>!skills.has(x))||a.tools.some(x=>!m.requestedCapabilities.includes(x))||!Number.isSafeInteger(a.maxToolCalls)||a.maxToolCalls<1||a.maxToolCalls>32||(a.skills.length&&!a.tools.includes('read_skill')))fail();agents.add(a.id);
 }
 const canonical=canonicalJSON(bundle);if(Buffer.byteLength(canonical)>262144)fail();return {bundle:JSON.parse(canonical),hash:contentHash(canonical)};
}
