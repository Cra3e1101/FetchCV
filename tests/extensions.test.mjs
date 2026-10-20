import {randomUUID} from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';
import {activeWorkspace} from './helpers/active-workspace.mjs';import {ExtensionRegistry} from '../packages/extensions/registry.mjs';import {validatePackage} from '../packages/extensions/declarative-package.mjs';import {contentHash} from '../packages/storage/blob-store.mjs';
const bundle=()=>({manifest:{schema:1,id:'local.test',version:'1.0.0',requiresApp:'2.x',skills:[{id:'review',title:'Review',path:'skills/review.md'}],agents:[{id:'reviewer',title:'Reviewer',instructions:'Check source evidence.',skills:['review'],tools:['read_skill','read_artifact'],maxToolCalls:4}],mcp:[],requestedCapabilities:['read_skill','read_artifact'],files:{'skills/review.md':`sha256:${contentHash(Buffer.from('Synthetic review rules.'))}`}},resources:{'skills/review.md':'Synthetic review rules.'}});
test('declarative packages reject paths, unknown fields, code, hash mismatch and unsupported MCP',()=>{
 assert.ok(validatePackage(bundle()).hash);
 for(const change of [b=>b.manifest.files['../escape.md']='sha256:x',b=>b.resources['skills/review.md']='changed',b=>b.manifest.exec='node',b=>b.manifest.mcp.push({command:'node'}),b=>b.manifest.requestedCapabilities.push('shell')]){const b=bundle();change(b);assert.throws(()=>validatePackage(b),{code:'invalid_declarative_package'});}
});
test('installation is disabled by default, immutable, separately granted and revoked for existing snapshots',async()=>{
 const f=await activeWorkspace('extensions');try{
  const r=new ExtensionRegistry(f.store.createIngestion().db,f.workspaceId),b=bundle(),installed=r.install(b);assert.equal(installed.state,'disabled');
  assert.throws(()=>r.select({installId:installed.id,agentId:'reviewer',expectedHash:installed.hash,expectedRevision:1}),{code:'extension_unavailable'});
  const enabled=r.control({installId:installed.id,expectedRevision:1,expectedHash:installed.hash,state:'enabled',grants:b.manifest.requestedCapabilities});
  r.select({installId:enabled.id,agentId:'reviewer',expectedHash:enabled.hash,expectedRevision:enabled.revision});const snap=r.snapshot();assert.equal(r.skill(snap,'review').text,b.resources['skills/review.md']);
  const changed=bundle();changed.manifest.agents[0].instructions='Different';assert.throws(()=>r.install(changed),{code:'extension_version_conflict'});
  const upgrade=bundle();upgrade.manifest.version='1.0.1';assert.equal(r.install(upgrade).state,'disabled');assert.ok(r.assert(snap,'read_artifact'));
  r.control({installId:installed.id,expectedRevision:enabled.revision,expectedHash:installed.hash,state:'removed',grants:[]});assert.throws(()=>r.assert(snap,'read_artifact'),{code:'extension_capability_revoked'});
  assert.ok((await f.request('workspace.catalogue',{kind:'artifacts'})).items.length);r.select({installId:null});assert.equal(r.snapshot(),null);
 }finally{f.store.close();}
});

test('Pi runs freeze granted agent definitions and reject ungranted tools and later revocation',async()=>{
 const f=await activeWorkspace('extension-runtime');try{
 const registry=new ExtensionRegistry(f.store.createIngestion().db,f.workspaceId),b=bundle();b.manifest.agents[0].maxToolCalls=1;
 const installed=registry.install(b),enabled=registry.control({installId:installed.id,expectedRevision:1,expectedHash:installed.hash,state:'enabled',grants:b.manifest.requestedCapabilities});
 registry.select({installId:enabled.id,agentId:'reviewer',expectedHash:enabled.hash,expectedRevision:enabled.revision});
 const bridge=f.store.createAgentBridge(),api=(url,body)=>bridge.request('','',`/api/pi/${url}`,{body:JSON.stringify(body)});
 const start=await api(`conversations/${f.conversation.id}/turns`,{request_id:randomUUID(),content:'Synthetic review',provider:{model:'fixture'}});
 assert.deepEqual(start.tools.map(x=>x.name),['read_skill','read_artifact']);assert.match(start.system_prompt,/Check source evidence/);assert.equal(start.system_prompt.includes('Synthetic review rules.'),false,'skill bodies are lazy');
 const skill=start.tools.find(x=>x.name==='read_skill'),key=randomUUID();
 const read=await api(`runs/${start.run_id}/tools/read_skill`,{arguments:{skillId:'review'},idempotency_key:key,tool_revision:skill.revision});assert.equal(read.result.text,'Synthetic review rules.');
 await assert.rejects(api(`runs/${start.run_id}/tools/propose_artifact`,{arguments:{},idempotency_key:randomUUID(),tool_revision:'x'}),{code:'tool_revision_mismatch'});
 await assert.rejects(api(`runs/${start.run_id}/tools/read_skill`,{arguments:{skillId:'review'},idempotency_key:randomUUID(),tool_revision:skill.revision}),{code:'agent_tool_budget_exceeded'});
 registry.control({installId:installed.id,expectedRevision:enabled.revision,expectedHash:installed.hash,state:'disabled',grants:[]});
 await assert.rejects(api(`runs/${start.run_id}/tools/read_skill`,{arguments:{skillId:'review'},idempotency_key:key,tool_revision:skill.revision}),{code:'extension_capability_revoked'});
 }finally{f.store.close();}
});
