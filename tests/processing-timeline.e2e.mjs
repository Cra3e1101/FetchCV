// Real conversation UI and API stream adapter, with synthetic persistence/native
// bridge events only. No model calls, backend, or personal profile required.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `processing-timeline-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import './src/styles.css';import './src/ui/workspace.css';import './src/ui/replica-alignment.css';import './src/ui/replica-components.css';import './src/ui/agent-motion.css';
import {ConversationWorkspace} from './src/components/ConversationWorkspace';
import {api} from './src/lib/api';
import {applyInterfaceTheme} from './src/ui/interface-theme';
applyInterfaceTheme();
const fresh=new URLSearchParams(location.search).has('new');
const state=window.conversationFixture={
 saved:{id:fresh?'new-chat':'existing-chat',title:'合成验收对话',messages:[]},
 streams:[],created:[],changed:0,createPending:false,
 emit(index,event,data){
  const stream=this.streams[index];
  if(event==='user')this.saved.messages.push(data.message);
  if(event==='done'&&data.assistant)this.saved.messages.push(data.assistant);
  stream.callback(event,data);
 },
 releaseCreate(){this.createPending=false;this.resolveCreate(structuredClone(this.saved));},
};
api.conversation=async()=>structuredClone(state.saved);
api.createConversation=()=>new Promise(resolve=>{state.createPending=true;state.resolveCreate=resolve;});
window.appRuntime={
 listModelProviders:async()=>({profiles:[]}),
 streamPiMessage(input,callback){return new Promise((resolve,reject)=>state.streams.push({input,callback,resolve,reject}));},
 cancelPiMessage(requestId){state.streams.find(stream=>stream.input.requestId===requestId).cancelled=true;},
};
createRoot(document.getElementById('root')).render(<div className="source-grid" style={{display:'block',height:'100vh',background:'var(--ui-surface)'}}><ConversationWorkspace conversationId={fresh?null:state.saved.id} jobs={[]} runtime={{configured:true,model:'synthetic-model'}} onCreated={id=>state.created.push(id)} onChanged={()=>state.changed++}/></div>);
`;
await build({
  stdin: { contents: fixture, resolveDir: root, loader: "jsx" },
  outfile: path.join(output, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{}' },
  loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file" },
  alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") },
});
await fs.writeFile(path.join(output, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script type="module" src="fixture.js"></script>');
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  const file = path.resolve(output, name);
  if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const content = await fs.readFile(file);
    const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2", ".woff": "font/woff" }[path.extname(file)];
    res.writeHead(200, { "Content-Type": mime || "application/octet-stream" }); res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.FETCHCV_BROWSER_CHANNEL || "msedge", headless: true });
const results = { fixture: "real ConversationWorkspace and stream adapter; synthetic bridge and persistence", checks: [], pageErrors: [] };
try {
  const page = await browser.newPage({ viewport: {width:960,height:760} });
  page.on("pageerror", error=>results.pageErrors.push(error.message));
  const check = (name, condition) => { results.checks.push({name,pass:condition}); assert.ok(condition,name); };
  await page.goto(url);
  await page.getByRole("textbox",{name:"消息",exact:true}).fill("昌平区近一周的天气");
  await page.getByRole("textbox",{name:"消息",exact:true}).press("Enter");
  await page.waitForFunction(()=>window.conversationFixture.streams.length===1);
  await page.evaluate(()=>window.conversationFixture.emit(0,'user',{message:{id:'user',role:'user',content:'昌平区近一周的天气',metadata_json:{}}}));
  const header=page.locator('.processing-summary');
  check('elapsed line is the only parent toggle', (await header.innerText()).startsWith('用时 ') && await header.getAttribute('aria-expanded')==='true');
  const events=[
    {id:'tool-a',sequence:1,kind:'tool',label:'搜索网页',status:'completed'},
    {id:'tool-b',sequence:2,kind:'tool',label:'读取网页',status:'completed'},
    {id:'tool-c',sequence:3,kind:'tool',label:'搜索网页',status:'active'},
  ];
  const receipts=[
    {tool_call_id:'c',tool_name:'search_web',status:'running',summary:'第三次操作'},
    {tool_call_id:'a',tool_name:'search_web',status:'completed',summary:'第一次操作'},
    {tool_call_id:'b',tool_name:'read_web_page',status:'completed',summary:'第二次操作'},
  ];
  await page.evaluate(({events,receipts})=>{
    const f=window.conversationFixture;
    for(const event of events) f.emit(0,'reasoning',{event});
    for(const receipt of receipts) f.emit(0,'tool_receipt',{receipt});
  },{events,receipts});
  const rows=page.locator('.processing-detail .tool-receipt-detail');
  await rows.nth(2).waitFor();
  check('three interleaved operations remain in execution order', JSON.stringify(await rows.locator('.tool-detail-toggle').allTextContents())!=='' && (await rows.nth(0).innerText()).includes('搜索网页') && (await rows.nth(1).innerText()).includes('读取网页') && (await rows.nth(2).innerText()).includes('运行中'));
  check('no duplicated stage summaries or separate tool group', await page.locator('.activity-line').count()===0 && await page.locator('.tool-group-toggle').count()===0);
  await header.click();
  await page.waitForFunction(()=>document.querySelector('.processing-disclosure > .fold-body').hidden);
  await rows.first().waitFor({state:'hidden'});
  check('elapsed toggle hides every operation', !(await rows.first().isVisible()));
  await page.evaluate(()=>window.conversationFixture.emit(0,'tool_receipt',{receipt:{tool_call_id:'c',tool_name:'search_web',status:'failed',summary:'第三次操作失败'}}));
  check('new results do not force collapsed timeline open',await header.getAttribute('aria-expanded')==='false');
  await header.click();
  await rows.nth(2).getByRole('button',{name:'失败 搜索网页',exact:true}).waitFor();
  check('updated result stays at original position',await rows.count()===3);
  await page.waitForTimeout(500);
  check('expanded timeline has full visible height',await page.locator('.processing-disclosure > .fold-body').evaluate(n=>n.getBoundingClientRect().height>100));
  await page.screenshot({path:path.join(evidence,'expanded.png')});
  await page.evaluate(({events,receipts})=>{
    const f=window.conversationFixture;
    f.emit(0,'done',{assistant:{id:'final',role:'assistant',content:'最终回答保留在过程折叠区域之外。',metadata_json:{processing_duration_ms:759000,processing_trace:events.map(e=>({...e,status:'completed'})),tool_receipts:receipts}}});
    f.streams[0].resolve({});
  },{events,receipts});
  await page.getByText('最终回答保留在过程折叠区域之外。',{exact:true}).waitFor();
  check('completed fold lives on duration line',await header.innerText()==='用时 12分 39秒' && await header.getAttribute('aria-expanded')==='false');
  check('finished timeline has only one parent control',await header.count()===1 && await page.locator('.processing-elapsed').count()===0);
  await page.screenshot({path:path.join(evidence,'collapsed.png')});
  await header.click();
  await rows.first().waitFor();
  check('complete history reopens from duration line',await rows.count()===3);
  check('no browser errors',results.pageErrors.length===0);
  results.pass=true;
} catch(error) {results.pass=false;results.error=error.stack;throw error;}
finally {
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({pass:results.pass,checks:results.checks.length,evidence}));
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
