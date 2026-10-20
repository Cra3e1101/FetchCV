import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ApplicationStore} from '../../packages/storage/application-store.mjs';

const [root,candidateId,jobId,query]=process.argv.slice(2);
const allowed=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(allowed&&root&&query);
const relative=path.relative(path.resolve(allowed),path.resolve(root));
assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'only a guarded synthetic workspace');
const openedAt=performance.now(),store=await ApplicationStore.open(root),openMs=performance.now()-openedAt;
const navigation=[],intervalMs=10;let expected=performance.now()+intervalMs,pending=Promise.resolve(),timerError=null;
const timer=process.argv.includes('--index-build')?setInterval(()=>{
  const lagMs=Math.max(0,performance.now()-expected);expected=performance.now()+intervalMs;
  pending=pending.then(async()=>{const start=performance.now();
    await store.dispatch({v:1,id:randomUUID(),workspaceId:store.workspaceId,method:'workspace.catalogue',payload:{kind:'conversations',limit:50}});
    navigation.push({lagMs,requestMs:performance.now()-start});
  }).catch(error=>{timerError=error;});
},intervalMs):null;
try{
  const start=performance.now();
  const result=await store.dispatch({v:1,id:randomUUID(),workspaceId:store.workspaceId,method:'knowledge.search',payload:{candidateId,jobId,query}});
  const queryMs=performance.now()-start;
  clearInterval(timer);await pending;if(timerError)throw timerError;
  assert.ok(result.items.length>0);
  console.log(JSON.stringify({openMs,queryMs,payloadBytes:Buffer.byteLength(JSON.stringify(result)),hits:result.items.length,generation:result.generation,rss:process.memoryUsage().rss,navigation}));
}finally{clearInterval(timer);await pending;store.close();}
