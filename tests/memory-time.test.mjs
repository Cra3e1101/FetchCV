import test from 'node:test';
import assert from 'node:assert/strict';
import {activeWorkspace} from './helpers/active-workspace.mjs';

async function pending(f,text,dates={}){
  const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
  const c=await f.request('conversation.create',{...scope,title:'Synthetic validity'});
  const m=await f.request('conversation.append',{...scope,conversationId:c.id,expectedSequence:0,text});
  return {scope,item:await f.request('memory.propose',{...scope,messageId:m.messageId,start:0,end:[...text].length,kind:'constraint',subject:'search',predicate:'location',...dates})};
}
test('confirmation records activation without inventing the unknown start of a constraint',async()=>{
  const f=await activeWorkspace('memory-unknown-validity');
  try{
    const {scope,item}=await pending(f,'只考虑本地岗位');
    const active=await f.request('memory.decide',{...scope,memoryId:item.id,expectedRevision:item.revision,decision:'confirmed'});
    assert.equal(active.validFrom,null);assert.ok(Number.isFinite(Date.parse(active.activatedAt)));
    assert.equal(active.timeBasis,'explicit_or_unknown');
    assert.equal((await f.request('memory.list',{...scope,asOf:new Date(Date.parse(active.activatedAt)-1).toISOString()})).items.length,0);
    assert.equal((await f.request('memory.list',{...scope,asOf:active.activatedAt})).items[0].id,item.id);
    await new Promise(resolve=>setTimeout(resolve,5));
    const replacement=await pending(f,'接受异地岗位');
    const next=await f.request('memory.decide',{...scope,memoryId:replacement.item.id,expectedRevision:replacement.item.revision,decision:'confirmed',replaceId:item.id});
    assert.equal(next.validFrom,null);
    assert.equal((await f.request('memory.list',{...scope,asOf:active.activatedAt})).items[0].id,item.id);
    assert.equal((await f.request('memory.list',{...scope,asOf:next.activatedAt})).items[0].id,next.id);
  }finally{f.store.close();}
});
test('explicit historical validity remains distinct from the later authorization date',async()=>{
  const f=await activeWorkspace('memory-explicit-validity');
  try{
    const {scope,item}=await pending(f,'当年仅考虑本地岗位',{validFrom:'2020-01-01',validTo:'2021-01-01'});
    const active=await f.request('memory.decide',{...scope,memoryId:item.id,expectedRevision:item.revision,decision:'confirmed'});
    assert.equal(active.validFrom,'2020-01-01T00:00:00.000Z');assert.ok(active.activatedAt>active.validTo);
    assert.equal((await f.request('memory.list',{...scope,asOf:'2020-06-01'})).items[0].id,item.id);
    assert.equal((await f.request('memory.list',scope)).items.length,0);
  }finally{f.store.close();}
});
