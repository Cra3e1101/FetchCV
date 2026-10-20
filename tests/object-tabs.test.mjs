import test from 'node:test';
import assert from 'node:assert/strict';
import {readTabs,objectTabs} from '../public/workspace/object-tabs.js';
import {activeWorkspace} from './helpers/active-workspace.mjs';
test('navigation cache retains IDs only and discards malformed entries',()=>{
 const read=value=>readTabs({getItem:()=>value},'test');
 assert.deepEqual(read('bad'),[]);
 assert.deepEqual(read(JSON.stringify([{kind:'documents',id:'one',text:'do not persist',candidateId:'invented'},{kind:'documents',id:'one'},{kind:'sql',id:'two'}])),[{kind:'documents',id:'one'}]);
});
test('object lookup returns exactly the requested live ID and hides tombstones',async()=>{
 const f=await activeWorkspace('object-lookup');
 try{const rows=await f.request('workspace.catalogue',{kind:'conversations'}),item=rows.items[0];
 assert.ok(item);assert.deepEqual((await f.request('workspace.catalogue',{kind:'conversations',objectId:item.id})).items,[item]);
 assert.deepEqual((await f.request('workspace.catalogue',{kind:'conversations',objectId:'missing'})).items,[]);
 f.store.createIngestion().db.prepare('UPDATE Conversation SET deleted_at=? WHERE id=?').run(new Date().toISOString(),item.id);
 assert.deepEqual((await f.request('workspace.catalogue',{kind:'conversations',objectId:item.id})).items,[]);
 }finally{f.store.close();}
});

test('closing or superseding a pending tab prevents stale navigation and error notices',async()=>{
 const oldDocument=globalThis.document,oldStorage=globalThis.localStorage;
 class Element{children=[];events={};append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}setAttribute(){}addEventListener(name,fn){this.events[name]=fn;}querySelector(){return null;}}
 globalThis.document={createElement:()=>new Element()};globalThis.localStorage={getItem:()=>JSON.stringify([{kind:'documents',id:'one'}]),setItem:()=>{}};
 try{
  for(const mode of ['close','switch']){
   const parent=new Element();let resolve,reject,epoch=0,opened=0,errors=0;
   const query=new Promise((yes,no)=>{resolve=yes;reject=no;});
   const tabs=objectTabs({parent,request:()=>query,canNavigate:()=>true,getEpoch:()=>epoch,onOpen:()=>{opened++;},onUnavailable:()=>{errors++;}});
   const pending=tabs.restore('workspace');
   if(mode==='close'){parent.children[0].children[1].events.click();resolve({items:[{id:'one'}]});}
   else{epoch++;reject(new Error('late failure'));}
   await pending;assert.equal(opened,0);assert.equal(errors,0);
  }
  const parent=new Element();let finish,opened=0,entered;
  const started=new Promise(resolve=>{entered=resolve;});const catalogue=new Promise(resolve=>{finish=resolve;});
  const tabs=objectTabs({parent,request:async()=>({items:[{id:'one'}]}),canNavigate:()=>true,getEpoch:()=>0,
   onOpen:async(_kind,_item,isLive)=>{entered();await catalogue;if(isLive())opened++;},onUnavailable:()=>assert.fail('unexpected failure')});
  const pending=tabs.restore('workspace');await started;parent.children[0].children[1].events.click();finish();await pending;assert.equal(opened,0);
 }finally{globalThis.document=oldDocument;globalThis.localStorage=oldStorage;}
});
