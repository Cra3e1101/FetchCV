// Synthetic data only. Production React components, CSS and standalone stream path.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `agent-motion-performance-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const fixture = String.raw`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{MotionConfig}from'framer-motion';
import{AgentWorkspace}from'./src/components/AgentWorkspace';
import{ConversationWorkspace}from'./src/components/ConversationWorkspace';
import{api}from'./src/lib/api';
import{applyInterfaceTheme}from'./src/ui/interface-theme';
import{motionTransitions}from'./src/ui/motion';
import './src/styles.css';import './src/ui/workspace.css';import './src/ui/replica-alignment.css';import './src/ui/replica-components.css';import './src/ui/agent-motion.css';
window.__counts={messages:{},historyMarkdown:0,liveMarkdown:0};
window.appRuntime={listModelProviders:async()=>({profiles:[]})};
api.permissionSettings=async()=>({workspace_write:'ask',file_delete:'ask',web_access:'ask',browser_bridge:'ask'});
applyInterfaceTheme();localStorage.setItem('fetchcv.context-rail-collapsed','1');
const fence=String.fromCharCode(96).repeat(3);
const history=Array.from({length:240},(_,i)=>({id:'history-'+i,role:i%2?'assistant':'user',content:i%2?['## History '+i,'Synthetic grounded answer with **emphasis**, lists and code.','- First item','- Second item',fence+'js','const value = '+i+';','console.log(value);',fence].join('\n'):'Synthetic user question '+i,metadata_json:{}}));
let saved=[...history];let request=0;
api.conversation=async id=>{if(window.holdRefresh)await new Promise(resolve=>window.releaseRefresh=()=>{window.holdRefresh=false;resolve();});return{id,title:'240-message synthetic fixture',messages:saved};};
api.streamConversation=(id,content,{signal,onEvent})=>new Promise((resolve,reject)=>{
 const number=++request;let text='';
 const user={id:'user-'+number,role:'user',content,metadata_json:{}};saved=[...saved,user];onEvent('user',{message:user});
 window.control={emit(value){text+=value;onEvent('delta',{text:value});},late(value){onEvent('delta',{text:value});},done(){const assistant={id:'assistant-'+number,role:'assistant',content:text,metadata_json:{delivery_status:'completed'}};saved=[...saved,assistant];onEvent('done',{assistant});resolve();}};
 signal.addEventListener('abort',()=>{window.abortSeen=true;setTimeout(()=>reject(new DOMException('Stopped','AbortError')),25);},{once:true});
});
function JobFixture(){
 const[detail,setDetail]=useState({job:{id:'fixture-job',company:'Synthetic',role:'Motion QA',jd_raw:'Synthetic job description'},messages:history,approvals:[],steps:[],facts:[],resumes:[],base_resumes:[],interview_sources:[],interview_briefs:[]});
 const[activity,setActivity]=useState(null);
 const send=content=>new Promise(resolve=>{
   let text='';const user={id:'job-user-'+Date.now(),role:'user',content,metadata_json:{}};
   setDetail(d=>({...d,messages:[...d.messages,user]}));setActivity({kind:'chat',startedAt:Date.now(),label:'Synthetic stream',events:[]});
   window.control={emit(value){text+=value;setDetail(d=>({...d,messages:[...d.messages.filter(m=>m.id!=='streaming-assistant'),{id:'streaming-assistant',role:'assistant',content:text,metadata_json:{delivery_status:'streaming'}}]}));},done(){setDetail(d=>({...d,messages:[...d.messages.filter(m=>m.id!=='streaming-assistant'),{id:'job-final',role:'assistant',content:text,metadata_json:{}}]}));setActivity(null);resolve();}};
 });
 return <AgentWorkspace detail={detail} runtime={{configured:true,model:'synthetic'}} activity={activity} busy={Boolean(activity)} onSendMessage={send} onCancelMessage={()=>window.control.done()} />;
}
window.runBurst=async(duration=1800)=>{const start=performance.now();let count=0;while(performance.now()-start<duration){for(let j=0;j<40;j++){window.control.emit(count%12===0?'\n\nSynthetic sentence '+count+'. ':'text ');count++;}await new Promise(r=>setTimeout(r,5));}return count;};
window.startProbe=()=>{
 window.__counts={messages:{},historyMarkdown:0,liveMarkdown:0};window.__probe={frames:[],longTasks:[],start:performance.now(),running:true};let previous=performance.now();
 const observer=new PerformanceObserver(list=>window.__probe.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask'});
 const tick=time=>{if(!window.__probe.running)return;window.__probe.frames.push(time-previous);previous=time;requestAnimationFrame(tick);};requestAnimationFrame(tick);
 window.stopProbe=()=>{window.__probe.running=false;observer.disconnect();return{...window.__probe,elapsed:performance.now()-window.__probe.start,counts:window.__counts};};
};
const standalone=new URLSearchParams(location.search).has('standalone');
createRoot(document.getElementById('root')).render(<MotionConfig reducedMotion="user" transition={motionTransitions.enter}><div className="app-shell"><div className="app-grid source-grid fixture-grid">{standalone?<ConversationWorkspace conversationId="fixture-chat" jobs={[]} runtime={{configured:true,model:'synthetic'}} onCreated={()=>{}} onChanged={()=>{}}/>:<JobFixture/>}</div></div></MotionConfig>);
`;
await build({
  stdin: { contents: fixture, resolveDir: root, loader: "jsx" }, outfile: path.join(output, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{}' },
  loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file" },
  alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") },
  plugins: [{ name: "test-only-render-counters", setup(builder) {
    builder.onLoad({ filter: /Agent(Message|Markdown)\.jsx$/ }, async args => {
      let contents = await fs.readFile(args.path, "utf8");
      if (args.path.endsWith("AgentMessage.jsx")) {
        contents = contents.replace("  const contentRef = useRef(null);", "  window.__counts.messages[message.id] = (window.__counts.messages[message.id] || 0) + 1;\n  const contentRef = useRef(null);");
        contents = contents.replace("<article className={`agent-message", "<article data-test-message-id={message.id} className={`agent-message");
      } else contents = contents.replace("  const components = useMemo", "  window.__counts[content.startsWith('## History') ? 'historyMarkdown' : 'liveMarkdown']++;\n  const components = useMemo");
      return { contents, loader: "jsx" };
    });
  } }],
});
await fs.writeFile(path.join(output, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}.fixture-grid{height:100vh!important;grid-template-columns:minmax(0,1fr)!important;padding:0!important}.fixture-grid>main{grid-column:1!important}.fixture-grid>aside{display:none!important}</style><div id="root"></div><script type="module" src="fixture.js"></script>');
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  const file = path.resolve(output, name);
  if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try { const data = await fs.readFile(file); res.writeHead(200, { "Content-Type": { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[path.extname(file)] || "application/octet-stream" }); res.end(data); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = { fixture: "240 messages; real production React components and CSS; 40 synthetic delta packets per burst; test-only render counters", limitations: "Warm steady-stream sampling begins after initial mount/lazy Markdown has settled; cold mount is reported separately. No provider/network/Electron IPC benchmark; job stream is a fixture callback, standalone uses its real buffering/cancellation implementation; one local headless Edge run without baseline", checks: [], coldStart: [], measurements: [], pageErrors: [] };
const check = (name, pass) => { report.checks.push({ name, pass }); assert.ok(pass, name); };
const percentile = (values, p) => { const sorted = [...values].sort((a,b)=>a-b); return sorted[Math.min(sorted.length-1, Math.floor(sorted.length*p))] || 0; };
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__coldTasks = [];
    window.__coldObserver = new PerformanceObserver(list => window.__coldTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))));
    window.__coldObserver.observe({ type: "longtask" });
  });
  page.on("pageerror", error => report.pageErrors.push(error.message));
  for (const mode of ["job", "standalone"]) {
    await page.goto(`http://127.0.0.1:${server.address().port}/${mode === "standalone" ? "?standalone=1" : ""}`);
    await page.waitForFunction(() => document.querySelectorAll('.agent-message').length === 240 && document.querySelectorAll('.agent-markdown').length === 120);
    report.coldStart.push({ mode, ...await page.evaluate(() => { window.__coldObserver.disconnect(); return { observedDomReadyMs: performance.now(), longTasks: window.__coldTasks }; }) });
    await page.waitForTimeout(450);
    check(`${mode}: initial history has no entry replay`, await page.locator('.agent-message-entered').count() === 0);
    const scroll = page.locator(mode === "job" ? ".conversation-scroll-v2" : ".standalone-scroll");
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("Synthetic performance request");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.waitForFunction(() => Boolean(window.control));
    await page.evaluate(() => window.control.emit("Synthetic streaming answer.\n\n"));
    await page.waitForTimeout(250);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Tracing.start", { categories: "devtools.timeline,blink.user_timing,v8.execute", transferMode: "ReturnAsStream" });
    await page.evaluate(() => window.startProbe());
    const packets = await page.evaluate(() => window.runBurst(1800));
    const measured = await page.evaluate(() => window.stopProbe());
    const historicalRenders = Object.entries(measured.counts.messages).filter(([id]) => id.startsWith("history-")).reduce((sum,[,count]) => sum+count,0);
    report.measurements.push({ mode, packets, elapsedMs: measured.elapsed, rafSamples: measured.frames.length, rafIntervalP50Ms: percentile(measured.frames,.5), rafIntervalP95Ms: percentile(measured.frames,.95), rafIntervalMaxMs: Math.max(...measured.frames), intervalsOver34Ms: measured.frames.filter(n=>n>34).length, longTaskCount: measured.longTasks.length, maxLongTaskMs: Math.max(0,...measured.longTasks.map(t=>t.duration)), historicalRenders, historyMarkdownRenders: measured.counts.historyMarkdown, liveMarkdownRenders: measured.counts.liveMarkdown });
    check(`${mode}: unchanged 240-message history does not render during streaming`, historicalRenders === 0 && measured.counts.historyMarkdown === 0);
    check(`${mode}: stream was rendered`, measured.counts.liveMarkdown > 0);
    if (mode === "standalone") check("standalone: 40-packet bursts are frame batched", measured.counts.liveMarkdown < packets / 10);
    const complete = new Promise(resolve => cdp.once("Tracing.tracingComplete", resolve));
    await cdp.send("Tracing.end");
    const { stream } = await complete;
    let trace = "";
    for (;;) { const chunk = await cdp.send("IO.read", { handle: stream }); trace += chunk.data; if (chunk.eof) break; }
    await cdp.send("IO.close", { handle: stream });
    await fs.writeFile(path.join(evidence, `${mode}-trace.json`), trace);
    await cdp.detach();
    await page.waitForTimeout(600);
    await scroll.hover(); await page.mouse.wheel(0,-72); await page.waitForTimeout(150);
    const stoppedAt = await scroll.evaluate(e => e.scrollTop);
    await page.evaluate(() => window.control.emit("\n\n" + "New content while reading history.\n\n".repeat(30)));
    await page.waitForTimeout(350);
    check(`${mode}: upward input cancels follow within near-bottom threshold`, Math.abs(await scroll.evaluate(e=>e.scrollTop)-stoppedAt) < 2);
    check(`${mode}: return latest remains available`, await page.getByRole("button", { name: "返回最新消息" }).count() === 1);
    await page.getByRole("button", { name: "返回最新消息" }).click();
    if (mode === "job") {
      await page.waitForTimeout(20);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForTimeout(60);
      check("job: switching reduced motion ends an in-flight scroll", await scroll.evaluate(e => e.scrollHeight-e.clientHeight-e.scrollTop < 3));
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
    await page.waitForTimeout(650);
    check(`${mode}: return latest reaches bottom`, await scroll.evaluate(e => e.scrollHeight-e.clientHeight-e.scrollTop < 3));
    await page.screenshot({ path: path.join(evidence, `${mode}.png`) });
    if (mode === "standalone") {
      await page.evaluate(() => { window.holdRefresh=true; window.control.done(); });
      await page.waitForFunction(() => Boolean(window.releaseRefresh));
      await page.waitForTimeout(80);
      check("standalone: done stops loops before refresh resolves", await page.locator('[data-motion-active="true"]').count() === 0);
      check("standalone: done disables cancellation during refresh", await page.getByRole("button", { name: "正在结束本轮", exact: true }).isDisabled());
      check("standalone: persisted handoff does not replay message entry", await page.locator('[data-test-message-id="assistant-1"]').evaluate(e => !e.classList.contains("agent-message-entered")));
      await page.evaluate(() => window.releaseRefresh());
      await page.waitForTimeout(100);
      await page.getByRole("textbox", { name: "消息", exact: true }).fill("Cancel race");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await page.waitForTimeout(60);
      await page.evaluate(() => { window.control.emit("PENDING_BEFORE_CANCEL"); document.querySelector('.composer-send').click(); window.control.late("LATE_AFTER_CANCEL"); });
      await page.waitForTimeout(200);
      check("standalone: cancelled frame and late packet cannot append text", !(await page.locator('.standalone-transcript').innerText()).match(/PENDING_BEFORE_CANCEL|LATE_AFTER_CANCEL/));
      check("standalone: cancelled histories have no busy loop", await page.locator('[data-motion-active="true"]').count() === 0);
    } else await page.evaluate(() => window.control.done());
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.agent-message').length === 240);
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("Reduced motion");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.waitForTimeout(60);
  await page.evaluate(() => window.control.emit("\nReduced motion content\n".repeat(30)));
  await page.waitForTimeout(100);
  check("reduced motion: no active continuous indicator", await page.locator('[data-motion-active="true"]').count() === 0);
  check("reduced motion: scroll follows immediately", await page.locator('.standalone-scroll').evaluate(e => e.scrollHeight-e.clientHeight-e.scrollTop < 3));
  check("no browser errors", report.pageErrors.length === 0);
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify(report,null,2));
  console.log(JSON.stringify({ report: path.join(evidence,"report.json"), coldStart: report.coldStart, measurements: report.measurements, checks: report.checks.length, errors: report.pageErrors },null,2));
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
