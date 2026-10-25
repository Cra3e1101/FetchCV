// Real conversation UI and API stream adapter, with synthetic persistence/native
// bridge events only. No model calls, backend, or personal profile required.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `conversation-activity-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const fixture = `
import React, {useState} from 'react';import {createRoot} from 'react-dom/client';
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
api.conversation=async id=>structuredClone(id===state.saved.id?state.saved:{id,title:'另一合成对话',messages:[]});
api.createConversation=()=>new Promise(resolve=>{state.createPending=true;state.resolveCreate=resolve;});
window.appRuntime={
 listModelProviders:async()=>({profiles:[]}),
 streamPiMessage(input,callback){return new Promise((resolve,reject)=>state.streams.push({input,callback,resolve,reject}));},
 cancelPiMessage(requestId){state.streams.find(stream=>stream.input.requestId===requestId).cancelled=true;},
};
function Fixture(){
 const [selection,select]=useState(fresh?null:state.saved.id);state.navigate=select;
 return <div className="source-grid" style={{display:'block',height:'100vh',background:'var(--ui-surface)'}}>{selection!=='away'&&<ConversationWorkspace key={selection||'draft'} sessionKey={selection||'draft'} conversationId={selection} jobs={[]} runtime={{configured:true,model:'synthetic-model'}} onCreated={id=>state.created.push(id)} onChanged={()=>state.changed++}/>}</div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
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
  const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
  page.on("pageerror", error => results.pageErrors.push(error.message));
  const check = (name, condition) => { results.checks.push({ name, pass: condition }); assert.ok(condition, name); };
  const emit = (index, event, data) => page.evaluate(({ index, event, data }) => window.conversationFixture.emit(index, event, data), { index, event, data });
  const directEmit = (index, event, data) => page.evaluate(({ index, event, data }) => window.conversationFixture.streams[index].callback(event, data), { index, event, data });
  const submit = async (text, index) => {
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await input.fill(text); await input.press("Enter");
    await page.locator(".processing-disclosure.running").waitFor();
    if (index !== undefined) await page.waitForFunction(index => window.conversationFixture.streams.length > index, index);
  };
  const receipt = (id, name, status, summary = "合成工具结果") => ({ tool_call_id: id, tool_name: name, status, summary, artifacts: [] });
  const reasoning = (id, label, status = "active") => ({ id, kind: "tool", label, status });
  const persistUser = (index, content) => emit(index, "user", { message: { id: `user-${index}`, role: "user", content, metadata_json: {} } });
  const finish = async (index, content, receipts = [], trace = []) => {
    await emit(index, "done", { assistant: { id: `assistant-${index}`, role: "assistant", content, metadata_json: { processing_status: "completed", processing_duration_ms: 2200, processing_trace: trace, tool_receipts: receipts } } });
    await page.evaluate(index => window.conversationFixture.streams[index].resolve({}), index);
    await page.waitForFunction(index => window.conversationFixture.changed > index, index);
    await page.waitForFunction(() => !document.querySelector('.source-composer.working'));
  };
  const expectNoMotion = async name => {
    await page.waitForFunction(() => !document.querySelector('.processing-disclosure.running, .processing-disclosure.stopping'));
    check(name, await page.locator('.activity-indicator[data-motion-active="true"]').count() === 0);
  };

  await page.goto(url);
  await submit("明天昌平区什么天气", 0);
  let active = page.locator(".agent-message.assistant").last();
  const timer = active.locator(".processing-summary time");
  check("submit shows timer before any runtime event", await timer.isVisible());
  await active.locator('.activity-indicator[data-motion-active="true"]').waitFor();
  check("submit shows one processing indicator", await active.locator('.activity-indicator[data-motion-active="true"]').count() === 1);
  check("no inert waiting-only placeholder", await page.locator('.standalone-status').count() === 0);
  const initialTime = await timer.innerText();
  await page.waitForFunction(initial => document.querySelector('.processing-summary time')?.textContent !== initial, initialTime);
  check("elapsed timer advances before first event", await timer.innerText() !== initialTime);
  await persistUser(0, "明天昌平区什么天气");
  await emit(0, "status", { label: "正在检索天气资料" });
  await active.locator(".processing-current").filter({ hasText: "正在检索天气资料" }).waitFor();
  check("status updates visible processing summary", (await active.locator(".processing-current").innerText()).includes("正在检索天气资料"));
  const trace = reasoning("search-stage", "检索天气资料");
  await emit(0, "reasoning", { event: trace });
  await active.locator(".processing-detail .activity-line").filter({ hasText: "检索天气资料" }).waitFor();
  check("processing event expands immediately", await active.locator('.processing-summary').getAttribute('aria-expanded') === 'true');
  await emit(0, "tool_receipt", { receipt: receipt("search-1", "search_web", "running") });
  const group = active.locator(".processing-detail");
  const searchRow = group.locator(".tool-receipt-detail").first();
  await searchRow.getByRole("button", { name: "运行中 搜索网页", exact: true }).waitFor();
  check("running tool row is visible without expanding group", await searchRow.isVisible() && await active.locator('.processing-summary').getAttribute('aria-expanded') === 'true');
  await emit(0, "tool_receipt", { receipt: receipt("search-1", "search_web", "completed", "已找到天气来源") });
  await searchRow.getByRole("button", { name: "已运行 搜索网页", exact: true }).waitFor();
  check("same tool receipt updates in place", await group.locator('.tool-receipt-detail').count() === 1);
  await searchRow.locator('.tool-detail-toggle').click();
  await searchRow.getByText("已找到天气来源", { exact: true }).waitFor();
  await emit(0, "tool_receipt", { receipt: receipt("read-1", "read_web_page", "running") });
  await group.getByRole("button", { name: "运行中 读取网页", exact: true }).waitFor();
  await emit(0, "tool_receipt", { receipt: { ...receipt("approval-1", "approved_lookup", "awaiting_approval"), requires_user_action: true } });
  await active.locator('.processing-disclosure.awaiting_approval').waitFor();
  const waitingTime = await active.locator('.processing-summary time').innerText();
  await page.waitForTimeout(1100);
  check("approval waiting freezes timer and processing indicator", await active.locator('.processing-summary time').innerText() === waitingTime && await active.locator('.activity-indicator').count() === 0);
  await emit(0, "tool_receipt", { receipt: receipt("read-1", "read_web_page", "completed") });
  await group.getByRole("button", { name: "已运行 读取网页", exact: true }).waitFor();
  check("another tool completing preserves outstanding approval wait", await active.locator('.processing-disclosure.awaiting_approval').count() === 1 && await active.locator('.activity-indicator').count() === 0);
  await emit(0, "tool_receipt", { receipt: receipt("read-2", "read_web_page", "running") });
  await group.getByRole("button", { name: "运行中 读取网页", exact: true }).waitFor();
  await emit(0, "tool_receipt", { receipt: receipt("read-2", "read_web_page", "failed", "合成网页读取失败") });
  await group.getByRole("button", { name: "失败 读取网页", exact: true }).waitFor();
  check("failed tool updates before final answer", await group.locator('.tool-receipt-detail').count() === 4 && await group.locator('.tool-receipt-detail.failed').count() === 1);
  check("another tool failing preserves outstanding approval wait", await active.locator('.processing-disclosure.awaiting_approval').count() === 1 && await active.locator('.activity-indicator').count() === 0);
  await emit(0, "status", { label: "正在核对检索结果" });
  check("status event cannot override outstanding approval wait", await active.locator('.processing-disclosure.awaiting_approval').count() === 1);
  await emit(0, "tool_receipt", { receipt: { ...receipt("approval-1", "approved_lookup", "completed"), requires_user_action: false } });
  await active.locator('.processing-disclosure.running').waitFor();
  await active.locator('.activity-indicator[data-motion-active="true"]').waitFor();
  check("resolved approval resumes processing indicator", await active.locator('.activity-indicator[data-motion-active="true"]').count() === 1);
  const completedTrace = { ...trace, status: "completed" };
  await emit(0, "reasoning", { event: completedTrace });
  await emit(0, "status", { label: "正在生成回答" });
  await active.locator('.processing-current').filter({ hasText: '正在生成回答' }).waitFor();
  await active.locator('.processing-current .activity-indicator[data-motion-active="true"]').waitFor();
  check("answer generation keeps a live header indicator after every trace completes", await active.locator('.activity-line.active').count() === 0 && await active.locator('.processing-current .activity-indicator[data-motion-active="true"]').count() === 1);
  await active.evaluate(node => { window.liveAssistantNode = node; });
  await emit(0, "delta", { text: "天气资料已找到。" });
  await active.getByText("天气资料已找到。", { exact: true }).waitFor();
  check("delta retains live assistant DOM and receipts", await active.evaluate(node => node === window.liveAssistantNode) && await group.locator('.tool-receipt-detail').count() === 4);
  check("delta preserves expanded tool result", await searchRow.locator('.tool-detail-toggle').getAttribute('aria-expanded') === 'true');
  await page.screenshot({ path: path.join(evidence, "live-tools-before-done.png") });
  await finish(0, "第一轮合成最终回答", [receipt("search-1", "search_web", "completed"), receipt("read-1", "read_web_page", "completed"), receipt("read-2", "read_web_page", "failed"), receipt("approval-1", "approved_lookup", "completed")], [completedTrace]);
  await page.getByText("第一轮合成最终回答", { exact: true }).waitFor();
  check("done leaves one final assistant and history", await page.locator('.agent-message.assistant').count() === 1 && await page.locator('.processing-disclosure.completed').count() === 1 && await page.locator('.processing-detail').count() === 1);
  await expectNoMotion("done stops live processing animation");
  check("saved tool history starts collapsed", await page.locator('.processing-summary').getAttribute('aria-expanded') === 'false');
  await directEmit(0, "delta", { text: "过期增量不得出现" });
  await directEmit(0, "tool_receipt", { receipt: receipt("late-1", "late_tool", "running") });
  await page.waitForTimeout(80);
  check("late events after done do not change history", !(await page.locator('.standalone-transcript').innerText()).includes('过期增量') && await page.locator('.tool-receipt-detail').count() === 4);

  await submit("后天呢", 1);
  active = page.locator(".agent-message.assistant").last();
  check("second turn starts fresh timer and empty activity", await active.locator('.processing-summary time').isVisible() && await active.locator('.agent-tool-receipt').count() === 0 && await active.locator('.activity-line').count() === 0);
  check("second turn retains preceding completed history", await page.locator('.agent-message.assistant').count() === 2 && await page.locator('.processing-disclosure.completed').count() === 1);
  await persistUser(1, "后天呢");
  await emit(1, "reasoning", { event: reasoning("second-stage", "核对后天天气") });
  await emit(1, "tool_receipt", { receipt: receipt("second-tool", "search_web", "running") });
  await active.getByRole('button', { name: '运行中 搜索网页', exact: true }).waitFor();
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await active.locator('.processing-disclosure.stopping').waitFor();
  check("stop reaches native bridge and freezes live motion", await page.evaluate(() => window.conversationFixture.streams[1].cancelled) && await active.locator('.activity-indicator').count() === 0);
  const beforeStop = await active.innerText();
  await directEmit(1, "delta", { text: "停止后不得追加" });
  await directEmit(1, "status", { label: "停止后不得恢复" });
  await directEmit(1, "tool_receipt", { receipt: receipt("late-stop", "late_tool", "running") });
  await page.waitForTimeout(80);
  check("events after cancellation are ignored", await active.innerText() === beforeStop);
  await page.evaluate(() => { const error = new Error('合成停止'); error.name = 'AbortError'; window.conversationFixture.streams[1].reject(error); });
  await active.locator('.processing-disclosure.cancelled').waitFor();
  await expectNoMotion("cancelled history has no processing animation");
  check("cancelled tools remain visible as interrupted", await active.locator('.tool-receipt-detail.interrupted').count() === 1);
  await page.waitForFunction(() => !document.querySelector('.source-composer.working'));
  await submit("再试一轮", 2);
  active = page.locator(".agent-message.assistant").last();
  await persistUser(2, "再试一轮");
  await emit(2, "tool_receipt", { receipt: receipt("error-tool", "search_web", "running") });
  await page.evaluate(() => window.conversationFixture.streams[2].reject(new Error('合成连接失败')));
  await page.getByRole('alert').filter({ hasText: '合成连接失败' }).waitFor();
  await active.locator('.processing-disclosure.failed').waitFor();
  await expectNoMotion("stream failure stops live processing animation");
  const beforeError = await active.innerText();
  await directEmit(2, "delta", { text: "错误后不得追加" });
  await directEmit(2, "tool_receipt", { receipt: receipt("late-error", "late_tool", "running") });
  await page.waitForTimeout(80);
  check("events after failure are ignored", await active.innerText() === beforeError && await active.locator('.tool-receipt-detail.interrupted').count() === 1);

  await submit("核对学校校史与现任校长", 3);
  await persistUser(3, "核对学校校史与现任校长");
  const sourceUrl = 'https://example.org/university/leadership';
  const searchReceipt = {...receipt('background-search', 'search_web', 'completed'), activity: {kind: 'search', text: '学校 校史 现任校长 官网'}};
  const readReceipt = {...receipt('background-read', 'read_web_page', 'running'), activity: {kind: 'url', text: sourceUrl, href: sourceUrl}};
  await emit(3, 'tool_receipt', {receipt: searchReceipt});
  await emit(3, 'tool_receipt', {receipt: readReceipt});
  await active.getByText('“学校 校史 现任校长 官网”', {exact: true}).waitFor();
  check('the live row shows a compact domain while retaining its complete target', await active.getByRole('link', {name: 'example.org', exact: true}).getAttribute('href') === sourceUrl && await active.getByRole('link', {name: 'example.org', exact: true}).getAttribute('title') === sourceUrl);
  await page.evaluate(() => window.conversationFixture.navigate('other-chat'));
  await page.getByRole('heading', {name: '另一合成对话', exact: true}).waitFor();
  check('switching to another chat does not cancel or leak the first chat', !await page.evaluate(() => window.conversationFixture.streams[3].cancelled) && !(await page.locator('.standalone-transcript').innerText()).includes('学校'));
  await emit(3, 'status', {label: '正在核对官网信息'});
  await emit(3, 'tool_receipt', {receipt: {...readReceipt, status: 'completed'}});
  await page.evaluate(() => window.conversationFixture.navigate('existing-chat'));
  await page.locator('.processing-disclosure.running').waitFor();
  await page.getByRole('button', {name: '停止生成', exact: true}).waitFor();
  check('returning restores running state and background tool updates without starting again', await page.evaluate(() => window.conversationFixture.streams.length === 4) && await page.locator('.agent-message.assistant').last().locator('.tool-receipt-detail.completed').count() === 2);
  for (const [width, theme] of [[960, 'white'], [960, 'neutral-dark'], [390, 'white'], [390, 'neutral-dark']]) {
    await page.setViewportSize({width, height: 760});
    await page.evaluate(theme => {document.documentElement.dataset.interfaceTheme = theme; document.documentElement.dataset.colorScheme = theme === 'white' ? 'light' : 'dark';}, theme);
    await page.locator('.agent-message.assistant').last().scrollIntoViewIfNeeded();
    check(`${width}/${theme}: operation rows fit the transcript`, await page.locator('.agent-message.assistant').last().evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({path: path.join(evidence, `background-activity-${width}-${theme}.png`)});
  }
  await page.evaluate(() => window.conversationFixture.navigate('away'));
  await finish(3, `据[学校官网](${sourceUrl})核对。另见 https://example.org/university/history 。`, [searchReceipt, {...readReceipt, status: 'completed'}]);
  await page.evaluate(() => window.conversationFixture.navigate('existing-chat'));
  const answer = page.locator('.agent-message.assistant').last();
  const citation = answer.locator('.agent-markdown').getByRole('link', {name: '学校官网', exact: true});
  await citation.waitFor();
  check('a background completion returns one final answer and an idle composer', await answer.locator('.processing-disclosure.completed').count() === 1 && await page.getByRole('button', {name: '停止生成', exact: true}).count() === 0 && await page.getByText('核对学校校史与现任校长', {exact: true}).count() === 1);
  check('Markdown citations and bare URLs are real links', await citation.getAttribute('href') === sourceUrl && await answer.locator('.agent-markdown a').count() === 2);
  check('citation uses a subtle background without an underline', await citation.evaluate(el => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(el).textDecorationLine === 'none'));
  const popupPromise = page.waitForEvent('popup');
  await page.context().route(sourceUrl, route => route.fulfill({contentType: 'text/html', body: '<h1>Synthetic source</h1>'}));
  await citation.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  check('clicking a source opens its exact address without leaving the conversation', popup.url() === sourceUrl && await citation.isVisible());
  await popup.close();
  await page.setViewportSize({width: 960, height: 760});
  for (const theme of ['white', 'neutral-dark']) {
    await page.evaluate(theme => {document.documentElement.dataset.interfaceTheme = theme; document.documentElement.dataset.colorScheme = theme === 'white' ? 'light' : 'dark';}, theme);
    await answer.scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(evidence, `background-answer-${theme}.png`)});
  }

  await page.goto(url + '?new=1');
  await submit("新对话问题");
  await page.waitForFunction(() => window.conversationFixture.createPending);
  check("new conversation shows user then processing while creation is pending", await page.locator('.agent-message').evaluateAll(nodes => nodes.length === 2 && nodes[0].classList.contains('user') && nodes[0].textContent.includes('新对话问题') && nodes[1].classList.contains('assistant') && !!nodes[1].querySelector('.processing-disclosure.running time')));
  check("creation pending does not dispatch prematurely", await page.evaluate(() => window.conversationFixture.streams.length === 0));
  await page.evaluate(() => window.conversationFixture.releaseCreate());
  await page.waitForFunction(() => window.conversationFixture.streams.length === 1);
  await persistUser(0, "新对话问题");
  check("persisted new user replaces pending message without reordering", await page.locator('.agent-message').evaluateAll(nodes => nodes.length === 2 && nodes[0].classList.contains('user') && !nodes[0].classList.contains('pending') && nodes[1].classList.contains('assistant')));
  await emit(0, "tool_receipt", { receipt: receipt("new-tool", "search_web", "running") });
  await page.getByRole('button', { name: '运行中 搜索网页', exact: true }).waitFor();
  check("new conversation renders live tools before done", await page.locator('.tool-receipt-detail').isVisible());
  await finish(0, "新对话合成最终回答", [receipt("new-tool", "search_web", "completed")]);
  check("new conversation settles with one user and one answer", await page.locator('.agent-message.user').count() === 1 && await page.locator('.agent-message.assistant').count() === 1);
  check("no browser errors", results.pageErrors.length === 0);
  results.pass = true;
} catch (error) {
  results.pass = false; results.error = error.stack; throw error;
} finally {
  await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ pass: results.pass, checks: results.checks.length, evidence }));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
