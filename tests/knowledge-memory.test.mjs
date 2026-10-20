import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {activeWorkspace} from './helpers/active-workspace.mjs';

test('memory requires review, retains exact user evidence, handles conflicts and expires or revokes reads',async()=>{
  const f=await activeWorkspace('knowledge-memory');
  try{
    const c=f.conversation,scope={candidateId:c.candidate_id,jobId:c.job_id};
    const message=async text=>{
      const history=await f.request('history.read',{...scope,conversationId:c.id});
      return f.request('conversation.append',{...scope,conversationId:c.id,expectedSequence:history.messages.at(-1).sequence,text});
    };
    const first=await message('记住：简历保持一页');
    const input={...scope,messageId:first.messageId,start:3,end:9,kind:'preference',subject:'resume',predicate:'length',validFrom:'2020-01-01'};
    const proposed=await f.request('memory.propose',input);
    assert.equal(proposed.status,'pending');assert.equal((await f.request('memory.list',scope)).items.length,0);
    assert.equal((await f.request('memory.propose',input)).id,proposed.id);
    await f.request('memory.decide',{...scope,memoryId:proposed.id,expectedRevision:1,decision:'confirmed'});
    assert.equal((await f.request('memory.list',scope)).items[0].value,'简历保持一页');
    assert.equal((await f.request('memory.source',{...scope,memoryId:proposed.id})).text,'记住：简历保持一页');
    const second=await message('记住：简历改成两页');
    const replacement=await f.request('memory.propose',{...input,messageId:second.messageId,validFrom:'2021-01-01'});
    await assert.rejects(f.request('memory.decide',{...scope,memoryId:replacement.id,expectedRevision:1,decision:'confirmed'}),{code:'memory_conflict_requires_review'});
    await f.request('memory.decide',{...scope,memoryId:replacement.id,expectedRevision:1,decision:'confirmed',replaceId:proposed.id});
    assert.equal((await f.request('memory.list',scope)).items[0].value,'简历改成两页');
    assert.equal((await f.request('memory.list',{...scope,asOf:'2020-06-01'})).items[0].value,'简历保持一页');
    assert.equal((await f.request('memory.list',{...scope,asOf:'2019-01-01'})).items.length,0);
    await assert.rejects(f.request('memory.propose',{...input,candidateId:'foreign'}),{code:'memory_evidence_unavailable'});
    const secret=await message('记住：api_key=synthetic-secret-123456');
    await assert.rejects(f.request('memory.propose',{...input,messageId:secret.messageId,start:3,end:33}),{code:'memory_secret_forbidden'});
    const token='sk-proj-'+'X'.repeat(32),rawSecret=await message(token);
    await assert.rejects(f.request('memory.propose',{...input,messageId:rawSecret.messageId,start:0,end:token.length}),{code:'memory_secret_forbidden'});
    const page1=await f.request('memory.list',{...scope,includeInactive:true,limit:1});assert.ok(page1.nextId);
    const page2=await f.request('memory.list',{...scope,includeInactive:true,limit:1,afterId:page1.nextId});assert.equal(page2.nextId,null);assert.notEqual(page1.items[0].id,page2.items[0].id);
    const db=new DatabaseSync(f.copy.archivePath);db.prepare('UPDATE Message SET deleted_at=? WHERE id=?').run(new Date().toISOString(),second.messageId);db.close();
    assert.equal((await f.request('memory.list',scope)).items.length,0,'evidence revocation takes effect immediately');
    await assert.rejects(f.request('memory.source',{...scope,memoryId:replacement.id}),{code:'memory_evidence_unavailable'});
    await f.request('memory.decide',{...scope,memoryId:replacement.id,expectedRevision:2,decision:'revoked'});
    assert.equal((await f.request('memory.list',{...scope,includeInactive:true})).items.length,2);
    assert.equal((await f.request('memory.list',{...scope,includeInactive:true})).items.find(r=>r.id===replacement.id).value,undefined);
    const expiring=await f.request('memory.propose',{...input,predicate:'expired',validFrom:'2020-01-01',validTo:'2020-02-01'});
    await f.request('memory.decide',{...scope,memoryId:expiring.id,expectedRevision:1,decision:'confirmed'});
    assert.equal((await f.request('memory.list',scope)).items.length,0);
    assert.equal((await f.request('memory.list',{...scope,asOf:'2020-01-15'})).items.length,2);
  }finally{f.store.close();}
});
