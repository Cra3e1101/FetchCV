import {randomUUID} from 'node:crypto';
import {ContractError} from '../contracts/runtime.mjs';
import {canonicalJSON} from '../storage/legacy-archive.mjs';
import {ensureFeatureSchema} from '../storage/feature-schema.mjs';
import {validatePackage} from './declarative-package.mjs';
const ddl=`CREATE TABLE ExtensionInstall(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES Workspace(id),package_id TEXT NOT NULL,version TEXT NOT NULL,bundle_hash TEXT NOT NULL,bundle_json TEXT NOT NULL CHECK(json_valid(bundle_json)),grants_json TEXT NOT NULL CHECK(json_valid(grants_json)),state TEXT NOT NULL CHECK(state IN ('disabled','enabled','removed')),revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(workspace_id,package_id,version)) STRICT;`;
export class ExtensionRegistry{
 constructor(db,workspaceId){this.db=db;this.workspaceId=workspaceId;ensureFeatureSchema(db,'extensions',ddl);}
 row(id){const row=this.db.prepare('SELECT * FROM ExtensionInstall WHERE workspace_id=? AND id=?').get(this.workspaceId,id);if(!row)throw new ContractError('extension_unavailable');const parsed=validatePackage(JSON.parse(row.bundle_json));if(parsed.hash!==row.bundle_hash)throw new ContractError('extension_corrupt');return {...row,bundle:parsed.bundle,grants:JSON.parse(row.grants_json)};}
 install(bundle){const {bundle:b,hash}=validatePackage(bundle),m=b.manifest;
  const existing=this.db.prepare('SELECT id,bundle_hash FROM ExtensionInstall WHERE workspace_id=? AND package_id=? AND version=?').get(this.workspaceId,m.id,m.version);
  if(existing){if(existing.bundle_hash!==hash)throw new ContractError('extension_version_conflict');return this.describe(this.row(existing.id));}
  const id=randomUUID(),now=new Date().toISOString();this.db.prepare("INSERT INTO ExtensionInstall VALUES (?,?,?,?,?,?,'[]','disabled',1,?,?)").run(id,this.workspaceId,m.id,m.version,hash,canonicalJSON(b),now,now);return this.describe(this.row(id));
 }
 describe(r){return {id:r.id,packageId:r.package_id,version:r.version,hash:r.bundle_hash,state:r.state,revision:r.revision,grants:r.grants,requestedCapabilities:r.bundle.manifest.requestedCapabilities,agents:r.bundle.manifest.agents.map(({id,title})=>({id,title})),skills:r.bundle.manifest.skills.map(({id,title})=>({id,title}))};}
 list(afterId=''){const rows=this.db.prepare('SELECT id FROM ExtensionInstall WHERE workspace_id=? AND id>? ORDER BY id LIMIT 21').all(this.workspaceId,afterId);return {items:rows.slice(0,20).map(x=>this.describe(this.row(x.id))),nextId:rows.length>20?rows[19].id:null,selected:this.selection()};}
 selection(){const row=this.db.prepare("SELECT value_json FROM Setting WHERE workspace_id=? AND key='m9.agent-selection'").get(this.workspaceId);return row?JSON.parse(row.value_json):null;}
 control(p){const r=this.row(p.installId);if(r.revision!==p.expectedRevision||r.bundle_hash!==p.expectedHash)throw new ContractError('extension_revision_conflict');
  if(!['enabled','disabled','removed'].includes(p.state)||r.state==='removed'||!Array.isArray(p.grants)||p.grants.some(x=>!r.bundle.manifest.requestedCapabilities.includes(x))||new Set(p.grants).size!==p.grants.length)throw new ContractError('invalid_extension_grant');
  this.db.prepare('UPDATE ExtensionInstall SET state=?,grants_json=?,revision=revision+1,updated_at=? WHERE workspace_id=? AND id=?').run(p.state,canonicalJSON(p.state==='enabled'?p.grants:[]),new Date().toISOString(),this.workspaceId,r.id);return this.describe(this.row(r.id));
 }
 select(p){let value=null;if(p.installId!=null){const r=this.row(p.installId);if(r.state!=='enabled'||r.revision!==p.expectedRevision||r.bundle_hash!==p.expectedHash||!r.bundle.manifest.agents.some(x=>x.id===p.agentId))throw new ContractError('extension_unavailable');value={installId:r.id,hash:r.bundle_hash,agentId:p.agentId};}
  const now=new Date().toISOString();this.db.prepare("INSERT INTO Setting VALUES (?,'m9.agent-selection',?,1,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(this.workspaceId,canonicalJSON(value),now,now);return value;
 }
 snapshot(){const selected=this.selection();if(!selected)return null;const r=this.row(selected.installId);if(r.state!=='enabled'||r.bundle_hash!==selected.hash)throw new ContractError('extension_unavailable');const agent=r.bundle.manifest.agents.find(x=>x.id===selected.agentId);if(!agent||agent.tools.some(x=>!r.grants.includes(x)))throw new ContractError('extension_capability_denied');return {...selected,agent,grants:[...r.grants]};}
 assert(snapshot,tool){if(!snapshot)return;const r=this.row(snapshot.installId);if(r.state!=='enabled'||r.bundle_hash!==snapshot.hash||snapshot.agent.tools.some(x=>!r.grants.includes(x))||(tool&&!snapshot.agent.tools.includes(tool)))throw new ContractError('extension_capability_revoked');return r;}
 skill(snapshot,id){const row=this.assert(snapshot,'read_skill');if(!row||!snapshot.agent.skills.includes(id))throw new ContractError('skill_unavailable');const s=row.bundle.manifest.skills.find(x=>x.id===id);return {id,title:s.title,packageId:row.package_id,version:row.version,manifestHash:row.bundle_hash,text:row.bundle.resources[s.path],grantsNoAdditionalAuthority:true};}
}
