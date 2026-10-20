import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,cp,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {scaleFixture} from '../scripts/m5-m8/scale-fixture.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root&&path.isAbsolute(root));
const f=await scaleFixture('skewed');f.store.close();
await writeFile(path.join(root,'input.json'),JSON.stringify({workspaceRoot:f.root}),{flag:'wx'});
await mkdir(path.join(root,'stage','dist'),{recursive:true});await mkdir(path.join(root,'runtime'));
await cp(path.resolve('public/workspace'),path.join(root,'stage','dist','workspace'),{recursive:true,errorOnExist:true,force:false});
await cp(path.resolve('electron/storage-preload.cjs'),path.join(root,'runtime','storage-preload.cjs'),{errorOnExist:true,force:false});
await build({entryPoints:[path.resolve('electron/storage-worker.mjs')],outfile:path.join(root,'runtime','storage-worker.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',
  banner:{js:`import {createRequire as guardRequire} from 'node:module'; guardRequire(import.meta.url)(${JSON.stringify(path.resolve('scripts/m1/guard-node-deletions.cjs'))});`}});
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!['NODE_OPTIONS','ELECTRON_RUN_AS_NODE'].includes(key)));
const app=await electron.launch({args:[path.resolve('tests/fixtures/electron-workspace-ui.cjs')],env,cwd:process.cwd(),timeout:40000});
try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
  await page.getByText('本地工作区已打开',{exact:true}).waitFor({timeout:20000});
  await page.locator('#items button').first().waitFor();
  await page.evaluate(({workspaceId,scope})=>{
    const probe=window.__indexNavigation={started:performance.now(),finished:null,result:null,error:null,samples:[],longTasks:[]};
    probe.longTaskObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries())probe.longTasks.push({start:entry.startTime,duration:entry.duration});});
    probe.longTaskObserver.observe({entryTypes:['longtask']});
    let navigation=null;
    for(const button of document.querySelectorAll('[data-kind]'))button.addEventListener('click',()=>{navigation={kind:button.dataset.kind,start:performance.now(),pendingAtStart:probe.finished===null};},true);
    probe.observer=new MutationObserver(()=>{
      if(!navigation||!document.querySelector('#items button'))return;
      const item=navigation;navigation=null;item.domReady=performance.now();item.items=document.querySelectorAll('#items button').length;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{item.twoAnimationFrames=performance.now();item.pendingAtPaint=probe.finished===null;probe.samples.push(item);}));
    });
    probe.observer.observe(document.querySelector('#items'),{childList:true});
    window.workspaceStorage.request({v:1,id:crypto.randomUUID(),workspaceId,method:'knowledge.search',payload:{...scope,query:'Synthetic'}})
      .then(result=>{probe.result=result;}).catch(error=>{probe.error=String(error);}).finally(()=>{probe.finished=performance.now();});
  },{workspaceId:f.workspaceId,scope:f.scope});
  for(let i=0;i<20;i++){
    if(await page.evaluate(()=>window.__indexNavigation.finished!==null))break;
    await page.locator(`[data-kind="${i%2?'conversations':'documents'}"]`).click();
    await page.waitForFunction(n=>window.__indexNavigation.samples.length>n,i);
  }
  await page.waitForFunction(()=>window.__indexNavigation.finished!==null,{},{timeout:60000});
  const observed=await page.evaluate(()=>{
    const p=window.__indexNavigation;p.observer.disconnect();p.longTaskObserver.disconnect();
    return {started:p.started,finished:p.finished,error:p.error,ok:p.result?.ok,hits:p.result?.result?.items?.length,generation:p.result?.result?.generation,samples:p.samples,longTasks:p.longTasks};
  });
  await page.screenshot({path:path.join(root,'navigation-during-index.png'),fullPage:true,timeout:45000});
  const overlapping=observed.samples.filter(s=>s.pendingAtStart&&s.pendingAtPaint&&s.start>=observed.started&&s.twoAnimationFrames<observed.finished);
  const report={revision:'electron-index-navigation-1',counts:f.counts,observed,overlappingNavigations:overlapping.length,errors,
    passed:observed.ok===true&&observed.hits>0&&overlapping.length>0&&!observed.error&&!errors.length,
    limitations:['one synthetic 5000-source skewed run; not a 30-launch distribution','two requestAnimationFrame callbacks are a rendering opportunity, not display-hardware paint proof','first search started through the real preload IPC; directory switches use real UI clicks','no parser/OCR work in this fixture; no claim that all renderer interactions stay below a latency threshold']};
  await writeFile(path.join(root,'navigation-report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  assert.equal(report.passed,true,JSON.stringify(report));
  console.log(JSON.stringify({passed:true,overlappingNavigations:overlapping.length,searchMs:observed.finished-observed.started,rendererLongTasks:observed.longTasks.length}));
}finally{await app.close();}
