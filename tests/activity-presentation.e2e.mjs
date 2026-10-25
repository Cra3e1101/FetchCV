// Real message components, synthetic activity and fresh browser context only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const run = `activity-presentation-${Date.now()}`;
const output = path.join(root, '.m1-work', run), evidence = path.join(root, '.m1-evidence', run);
await fs.mkdir(output, {recursive: true}); await fs.mkdir(evidence, {recursive: true});
const fixture = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import './src/styles.css'; import './src/ui/workspace.css'; import './src/ui/replica-alignment.css'; import './src/ui/replica-components.css'; import './src/ui/agent-motion.css';
import {AgentMessage} from './src/components/AgentMessage';
import {applyInterfaceTheme} from './src/ui/interface-theme';
applyInterfaceTheme();
const urls = ['https://example.org/archive', 'https://example.org/history', 'https://example.org/about', 'https://example.org/staff',
  'https://example.org/news', 'https://example.org/reference', 'https://example.org/contact', 'https://example.org/leadership',
  'https://baike.baidu.com/item/%E4%B8%AD%E5%8D%97%E8%B4%A2%E7%BB%8F%E6%94%BF%E6%B3%95%E5%A4%A7%E5%AD%A6',
  'https://cn.bing.com/search?q='+encodeURIComponent('中南财经政法大学 学校历史沿革 校长 site:zuel.edu.cn'),
  'https://www.zuel.edu.cn/xxjj.htm', 'https://english.zuel.edu.cn/'];
const receipt = (url, index) => ({tool_call_id:'read-'+index, tool_name:'read_web_page', status:index===8?'failed':'completed',
  summary:'合成网页结果 '+index, activity:{kind:'url', text:url, href:url}});
function Fixture(){
 const [receipts,setReceipts]=useState(urls.map(receipt));
 const [finished,setFinished]=useState(false);
 window.presentationFixture={
  append(){setReceipts(rows=>[...rows,receipt('https://example.org/new/'+rows.length, rows.length)]);},
  approval(value){setReceipts(rows=>rows.map((row,index)=>index===0?{...row,status:value?'awaiting_approval':'completed',requires_user_action:value}:row));},
  finish(){setFinished(true);},
 };
 return <div className="source-grid" style={{display:'block',minHeight:'100vh',background:'var(--ui-surface)',padding:'32px 24px'}}>
  <div style={{maxWidth:752,margin:'0 auto'}}>
   <AgentMessage message={{id:'user',role:'user',content:'核对学校校史与现任校长'}}/>
   <AgentMessage message={{id:'answer',role:'assistant',content:finished?'已整理可供核对的来源，包括 [中南财经政法大学首页](https://www.zuel.edu.cn/xxjj.htm) 的新闻与简介，以及 [学校概况—历史沿革](https://www.zuel.edu.cn/history.htm)。具体任职信息请结合公告日期查看。':'',
    metadata_json:{processing_status:finished?'completed':'running',processing_started_at:Date.now()-42000,processing_duration_ms:42000,
     processing_label:'正在核对官网信息', tool_receipts:receipts}}}/>
  </div></div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
await build({stdin:{contents:fixture,resolveDir:root,loader:'jsx'},outfile:path.join(output,'fixture.js'),bundle:true,format:'esm',platform:'browser',jsx:'automatic',
  define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},loader:{'.woff2':'file','.woff':'file','.png':'file','.svg':'file'},alias:{'lucide-react':path.join(root,'src/ui/lucide-compat.js')}});
await fs.writeFile(path.join(output,'index.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script type="module" src="fixture.js"></script>');
const server=http.createServer(async(req,res)=>{
  const file=path.resolve(output,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');
  if(!file.startsWith(output+path.sep)){res.writeHead(403).end();return;}
  try {const content=await fs.readFile(file);res.writeHead(200,{'content-type':{'.js':'text/javascript','.css':'text/css','.html':'text/html'}[path.extname(file)]||'application/octet-stream'});res.end(content);}
  catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
const report={checks:[],errors:[],screenshots:[]};
let page;
try {
  page=await browser.newPage({viewport:{width:960,height:760}});
  page.on('pageerror',error=>report.errors.push(error.message));
  const check=(name,value)=>{report.checks.push({name,pass:value});assert.ok(value,name);};
  const settle=()=>page.waitForTimeout(400);
  const url=`http://127.0.0.1:${server.address().port}`;
  const rows=page.locator('.tool-receipt-detail'), history=page.locator('.processing-history-toggle');
  const screenshot=async(name)=>{await page.screenshot({path:path.join(evidence,name)});report.screenshots.push(name);};
  for(const width of [960,390]) for(const theme of ['white','neutral-dark']){
    await page.setViewportSize({width,height:760}); await page.goto(url);
    await page.evaluate(theme=>{document.documentElement.dataset.interfaceTheme=theme;document.documentElement.dataset.colorScheme=theme==='white'?'light':'dark';},theme);
    await history.waitFor(); await settle();
    check(`${width}/${theme}: twelve operations roll up to four recent rows`,await rows.count()===4 && (await history.innerText()).includes('8'));
    const link=page.getByRole('link',{name:'cn.bing.com',exact:true});
    check(`${width}/${theme}: domain label retains full URL in target and tooltip`,(await link.getAttribute('href')).includes('/search?q=') && await link.getAttribute('title')===await link.getAttribute('href'));
    check(`${width}/${theme}: operation link is neutral and has no underline`,await link.evaluate(el=>{
      const style=getComputedStyle(el), channels=style.color.match(/[\d.]+/g).slice(0,3).map(Number);
      return Math.max(...channels)-Math.min(...channels)<=12 && style.textDecorationLine==='none';
    }));
    check(`${width}/${theme}: rows remain single-line without overflow`,await rows.evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1 && el.getBoundingClientRect().height<30)));
    check(`${width}/${theme}: no page overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await screenshot(`compact-${width}-${theme}.png`);
    await history.click(); await settle();
    check(`${width}/${theme}: earlier operations can all be reopened`,await rows.count()===12 && await history.getAttribute('aria-expanded')==='true');
    await history.click(); await settle();
    const earliest=rows.first(); const pinnedUrl=await earliest.locator('a').getAttribute('href');
    // Click the operation label; the adjacent domain is a separate link target.
    await earliest.getByRole('button').click({position:{x:10,y:10}});
    await page.evaluate(()=>window.presentationFixture.append()); await settle();
    const pinned=rows.filter({has:page.locator(`a[href="${pinnedUrl}"]`)});
    check(`${width}/${theme}: streaming does not hide an open result`,await rows.count()===5 && await pinned.locator('.tool-detail-toggle').getAttribute('aria-expanded')==='true');
    await pinned.locator('.tool-detail-toggle').click({position:{x:10,y:10}}); await settle();
    check(`${width}/${theme}: closing old result restores the four-step window`,await rows.count()===4);
    await page.evaluate(()=>window.presentationFixture.approval(true)); await settle();
    check(`${width}/${theme}: pending decisions remain visible outside the recent window`,await rows.count()===5 && await page.getByRole('button',{name:'等待确认 读取网页',exact:true}).isVisible());
    await page.evaluate(()=>window.presentationFixture.approval(false)); await settle();
    await history.click(); await page.evaluate(()=>window.presentationFixture.append()); await settle();
    check(`${width}/${theme}: explicitly opened history stays open as events arrive`,await rows.count()===14 && await history.getAttribute('aria-expanded')==='true');
    await page.evaluate(()=>window.presentationFixture.finish()); await page.waitForTimeout(850);
    const citation=page.locator('.agent-markdown a').first(); await citation.waitFor();
    check(`${width}/${theme}: citation is softly highlighted with no underline`,await citation.evaluate(el=>getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)' && getComputedStyle(el).textDecorationLine==='none'));
    check(`${width}/${theme}: citation retains readable label and exact destination`,await citation.innerText()==='中南财经政法大学首页' && await citation.getAttribute('href')==='https://www.zuel.edu.cn/xxjj.htm');
    await screenshot(`answer-${width}-${theme}.png`);
    await page.keyboard.press('Tab'); await citation.focus();
    check(`${width}/${theme}: keyboard focus remains visible`,await citation.evaluate(el=>getComputedStyle(el).outlineStyle!=='none'));
    await page.mouse.move(1,1); const previousBg=await citation.evaluate(el=>getComputedStyle(el).backgroundColor); await citation.hover();
    check(`${width}/${theme}: hover gives a clear response`,await citation.evaluate(el=>getComputedStyle(el).backgroundColor)!==previousBg);
  }
  const citation=page.locator('.agent-markdown a').first();
  await page.context().route('https://www.zuel.edu.cn/xxjj.htm',route=>route.fulfill({contentType:'text/html',body:'Synthetic source'}));
  const popupPromise=page.waitForEvent('popup');await citation.click();const popup=await popupPromise;await popup.waitForLoadState();
  check('citation opens the original URL',popup.url()==='https://www.zuel.edu.cn/xxjj.htm');await popup.close();
  check('no browser errors',report.errors.length===0);report.pass=true;
} catch(error){report.pass=false;report.error=error.stack;if(page)await screenshotFailure();throw error;}
finally{await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,evidence}));await browser.close();await new Promise(resolve=>server.close(resolve));}
async function screenshotFailure(){await page.screenshot({path:path.join(evidence,'failure.png')});}
