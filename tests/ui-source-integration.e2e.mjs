import {_electron as electron, chromium} from 'playwright';
import {resolveElectronRuntime} from '../scripts/electron-runtime.mjs';
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const root=process.env.M1_ALLOWED_DELETE_ROOT;if(!root)throw Error('isolated root required');
const project=path.resolve('.');const build=process.argv[2]||process.env.FETCHCV_UI_TEST_BUILD||'.m1-work/ui-integration-20261011-final';
const hashes=JSON.parse(fs.readFileSync('src/vendor/openbitfun/source-manifest.json','utf8').replace(/^\uFEFF/,''));for(const [name,expected]of Object.entries(hashes)){const bytes=fs.readFileSync(path.join('src/vendor/openbitfun',name));assert.equal(crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),expected,name)}
const env={...process.env};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
const browserMode=process.env.FETCHCV_UI_TEST_BROWSER==='1';
const application=browserMode
  ? await chromium.launch({channel:'msedge',headless:true})
  : await electron.launch({executablePath:(await resolveElectronRuntime({projectRoot:project})).executable,args:[path.join(project,'tests/helpers/ui-renderer-host.cjs')],env});
const candidate={id:'c1',name:'合成验收用户',title:'产品经理'};
const job={id:'j1',candidate_id:'c1',company:'星云科技',role:'AI 产品经理',jd_raw:'梳理知识库需求，完成产品设计与验证。'};
const detail={candidate,job,run:null,tasks:[],facts:[],experiences:[],steps:[],approvals:[],resumes:[],portfolios:[],materials:[],proposals:[],interview_sources:[],interview_briefs:[],messages:[{id:'m1',role:'user',content:'帮我准备这个岗位的申请，先看看哪些经历值得展开。'},{id:'m2',role:'assistant',content:'建议从 **企业知识库项目** 开始。它与岗位中的需求分析、AI 产品设计最相关。\n\n1. **为什么做：** 团队资料分散，查找与核对信息耗时。\n2. **做了什么：** 梳理检索场景，设计问答与来源查看流程。\n3. **如何验证：** 用典型问题核对回答与引用，记录失败案例。'}]};
const chats = [];
let permissions={web_access:'allow',browser_bridge:'allow',workspace_read:'allow',workspace_write:'ask',file_delete:'ask'};
const runtime={configured:true,provider_id:'p1',provider_name:'合成测试连接',model:'test-model'};
const writes=[],unexpected=[],errors=[];let rejectPermission=false;
try{
const page=browserMode ? await application.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1}) : await application.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
let runtimeAttempted=false;
await page.route('http://127.0.0.1:8766/**',async route=>{const req=route.request(),url=new URL(req.url()),p=url.pathname,method=req.method();let data;
if(method==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
if(p==='/api/conversations' && method==='GET')data=chats.map(({messages:_messages,...chat})=>chat);
else if(p==='/api/conversations' && method==='POST'){data={id:'chat-'+(chats.length+1),title:'新对话',job_id:null,messages:[]};chats.push(data);}
else if(p.startsWith('/api/conversations/'))data=chats.find(c=>c.id===p.split('/').pop());
else if(p==='/api/interview-knowledge')data={sources:[],briefs:[{id:'brief1',company:'独立知识公司',role:'合成岗位',summary:'可重复使用的公开面经',source_ids:[]}]};
else if(p==='/api/workspace')data={candidates:[candidate],jobs:[job]};
else if(p==='/api/runtime/status'){if(!runtimeAttempted){runtimeAttempted=true;return route.abort('connectionrefused')}data=runtime;}
else if(p==='/api/candidates/c1/library')data={candidate,experiences:[],resumes:[],materials:[],facts:[],interview_sources:[],interview_briefs:[]};
else if(p==='/api/jobs/j1/workspace')data=detail;
else if(p==='/api/settings/general')data={theme:'system',accent:'coral',density:'comfortable'};
else if(p==='/api/settings/permissions'){if(method==='PATCH'){if(rejectPermission)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'合成保存失败'})});const patch=req.postDataJSON();writes.push({kind:'permission',patch});permissions={...permissions,...patch}}data=permissions;}
else if(p==='/api/candidates/c1/materials'&&method==='POST'){writes.push({kind:'material',body:req.postDataJSON()});data={id:'mat1',...req.postDataJSON()};}
else if(p==='/api/skills'||p==='/api/mcp/servers')data=[];
else {unexpected.push(method+' '+p);return route.fulfill({status:404,contentType:'application/json',body:'{}'})}
await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
});
await page.exposeFunction('recordSend',payload=>{writes.push({kind:'send',payload});if(payload.conversationId){const chat=chats.find(c=>c.id===payload.conversationId);chat.title=payload.content;chat.messages.push({id:'cm-'+writes.length,role:'user',content:payload.content},{id:'ca-'+writes.length,role:'assistant',content:'独立对话回答'});}else detail.messages.push({id:'sent-'+writes.length,role:'user',content:payload.content});return {ok:true}});
await page.addInitScript(()=>{window.appRuntime={apiBase:'http://127.0.0.1:8766',listModelProviders:async()=>({activeId:'p1',profiles:[window.savedProvider||{id:'p1',providerName:'合成测试连接',model:'test-model',protocol:'openai',baseUrl:'https://synthetic.example/v1',hasApiKey:true,availableModels:[{id:'test-model',contextWindow:128000},{id:'other-model',contextWindow:262144}]}]}),fetchModelProviderModels:async()=>({endpoint:'https://synthetic.example/v1/models',models:[{id:'test-model',contextWindow:256000},{id:'other-model',contextWindow:262144}]}),saveModelProvider:async p=>{window.savedProvider={...p,hasApiKey:true};return {activeId:'p1',runtime:{configured:true,model:p.model},store:{profiles:[window.savedProvider]}}},importWorkspaceFiles:async()=>[{name:'synthetic-notes.txt',workspacePath:'synthetic/synthetic-notes.txt',mimeType:'text/plain',sizeBytes:20}],streamPiMessage:async payload=>window.recordSend(payload),cancelPiMessage:async()=>{},getBackendStatus:async()=>({state:'ready'})};});
await page.goto(process.env.FETCHCV_UI_TEST_URL||pathToFileURL(path.join(project,build,'index.html')).href);await page.getByRole('heading',{name:'想聊些什么？'}).waitFor();
await page.getByRole('textbox',{name:'消息',exact:true}).fill('无需岗位的聊天');await page.getByRole('button',{name:'发送消息',exact:true}).click();
await page.getByText('独立对话回答',{exact:true}).waitFor();assert.equal(chats.length,1);assert.equal(chats[0].job_id,null);
assert(writes.some(w=>w.kind==='send'&&w.payload.conversationId&&!w.payload.jobId));
await page.getByRole('button',{name:'面试知识',exact:true}).click();await page.getByText('独立知识公司',{exact:true}).waitFor();
await page.getByRole('button',{name:'我的资料',exact:true}).click();assert.equal(await page.locator('main').getByText('面试知识',{exact:true}).count(),0);
await page.getByRole('button',{name:'无需岗位的聊天',exact:true}).click();await page.getByText('独立对话回答',{exact:true}).waitFor();
await page.getByRole('button',{name:'新对话',exact:true}).click();await page.getByRole('heading',{name:'想聊些什么？'}).waitFor();assert.equal(await page.getByText('独立对话回答',{exact:true}).count(),0);
await page.reload();await page.getByRole('button',{name:'无需岗位的聊天',exact:true}).click();await page.getByText('独立对话回答',{exact:true}).waitFor();
await page.getByRole('heading',{name:'无需岗位的聊天',exact:true}).waitFor();const alignment=await page.evaluate(()=>{
 const text=document.querySelector('.standalone-transcript'),surface=document.querySelector('.source-composer .rp-composer'),message=document.querySelector('.agent-message.assistant'),box=e=>({left:e.getBoundingClientRect().left,width:e.getBoundingClientRect().width});
 return {text:box(text),composer:box(surface),font:getComputedStyle(message).fontFamily,fontSize:getComputedStyle(message).fontSize};
});
fs.writeFileSync(path.join(root,'chat-geometry.json'),JSON.stringify(alignment,null,2));
const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const dom=await cdp.send('DOM.getDocument');const node=await cdp.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'.agent-message.assistant .agent-message-content'});const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});fs.writeFileSync(path.join(root,'rendered-fonts.json'),JSON.stringify(fonts,null,2));await cdp.detach();

await page.screenshot({path:path.join(root,'chat-geometry.png'),animations:'disabled'});
assert(Math.abs((alignment.text.left+alignment.text.width/2)-(alignment.composer.left+alignment.composer.width/2))<2);assert.equal(alignment.fontSize,'14px');assert(alignment.font.includes('Segoe UI'));
assert.equal(alignment.composer.width,888);

await page.screenshot({path:path.join(root,'standalone-chat.png'),animations:'disabled'});
await page.getByRole('button',{name:'搜索岗位',exact:true}).click();
await page.getByRole('textbox',{name:'搜索侧栏岗位',exact:true}).fill('不存在的岗位');
await page.getByText('没有匹配的岗位',{exact:true}).waitFor();
await page.keyboard.press('Escape');
assert.equal(await page.getByRole('textbox',{name:'搜索侧栏岗位',exact:true}).count(),0);
await page.getByRole('button',{name:'星云科技 AI 产品经理',exact:true}).click();await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();await page.getByText('团队资料分散，查找与核对信息耗时。',{exact:false}).waitFor();
assert.equal(await page.getByRole('button',{name:'星云科技 AI 产品经理',exact:true}).getAttribute('aria-current'),'page');assert.equal(await page.getByRole('button',{name:'新对话',exact:true}).getAttribute('aria-current'),null);
assert.equal(await page.getByText('模型状态暂时无法读取，个人资料和岗位仍可使用。',{exact:true}).count(),0);
assert.equal(await page.locator('.rp-sidebar').count(),1);assert.equal(await page.locator('.source-composer .rp-composer').count(),1);
assert.equal(await page.locator('html').getAttribute('data-interface-theme'),'white');assert.equal(await page.locator('.source-sidebar .rp-scroll').evaluate(e=>getComputedStyle(e).paddingLeft),'10px');
assert.equal(await page.locator('.agent-rail-v2').isVisible(),false);assert.equal(await page.getByRole('button',{name:/麦克风|语音/}).count(),0);assert(await page.getByRole('button',{name:'发送消息',exact:true}).isDisabled());
const geometry=await page.getByRole('button',{name:'发送消息',exact:true}).boundingBox();assert.equal(geometry.width,32);assert.equal(geometry.height,32);
await page.mouse.move(1400,800);await page.screenshot({path:path.join(root,'desktop-full.png'),animations:'disabled'});
// Exercise actual message components with isolated fixture data, not product demo UI.
detail.messages[1].metadata_json={processing_duration_ms:12000,processing_trace:[{id:'trace-1',label:'读取岗位资料',detail:'已读取本次验收的合成资料',status:'completed'}],tool_receipts:[{tool_call_id:'tool-1',tool_name:'read_workspace_file',status:'completed',summary:'已核对合成资料中的项目经历',artifacts:[]}]};
detail.messages[1].content+='\n\n```json\n{"focus": "需求分析与证据核对", "source": "synthetic-fixture"}\n```';
await page.getByRole('button',{name:'新对话',exact:true}).click();
await page.getByRole('button',{name:'星云科技 AI 产品经理',exact:true}).click();
await page.locator('.agent-code-block').waitFor();
await page.locator('.processing-summary').click();
await page.locator('.processing-detail').getByText('读取岗位资料',{exact:true}).waitFor();
assert.equal(await page.locator('.processing-summary').getAttribute('aria-expanded'),'true');
assert.equal(await page.getByText('已读取本次验收的合成资料',{exact:true}).count(),0);
await page.locator('.tool-group-toggle').click();
await page.locator('.tool-detail-toggle').click();await page.getByText('已核对合成资料中的项目经历',{exact:true}).waitFor();
const messageGeometry=await page.evaluate(()=>{
 const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}};
 return {code:rect('.agent-code-block'),composer:rect('.source-composer .rp-composer'),scroll:rect('.conversation-scroll-v2'),sidebar:rect('.source-sidebar')};
});
assert(Math.abs((messageGeometry.code.left+messageGeometry.code.width/2)-(messageGeometry.composer.left+messageGeometry.composer.width/2))<2,'response and composer share the reference center');
assert.equal(messageGeometry.code.width,752,'reference thread has 800px outer width and 24px gutters');
assert(messageGeometry.scroll.bottom<=messageGeometry.composer.top,'composer does not overlay the transcript');
assert.equal(messageGeometry.sidebar.width,288);
fs.writeFileSync(path.join(root,'job-geometry.json'),JSON.stringify(messageGeometry,null,2));
await page.screenshot({path:path.join(root,'desktop-tools-code.png'),animations:'disabled'});
await page.locator('.processing-summary').click();await page.locator('.tool-group-toggle').click();
await page.getByRole('button',{name:'审批模式',exact:true}).click();await page.getByRole('menuitemradio',{name:/^请求批准/}).waitFor();assert.equal(await page.getByRole('menuitemradio',{name:/完全访问权限/}).count(),0);
await page.screenshot({path:path.join(root,'approval-menu.png'),animations:'disabled'});
await page.getByRole('menuitemradio',{name:/^请求批准/}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="审批模式"]').textContent.includes('请求批准'));assert.equal(permissions.web_access,'ask');assert.equal(permissions.workspace_write,'ask');assert.equal(permissions.file_delete,'ask');
rejectPermission=true;await page.getByRole('button',{name:'审批模式',exact:true}).click();await page.getByRole('menuitemradio',{name:/帮我批准/}).click();await page.getByRole('alert').filter({hasText:'合成保存失败'}).waitFor();assert.equal(permissions.web_access,'ask');await page.keyboard.press('Escape');rejectPermission=false;await page.getByRole('button',{name:'审批模式',exact:true}).click();await page.getByRole('menuitemradio',{name:/帮我批准/}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="审批模式"]').textContent.includes('帮我批准'));
await page.getByRole('button',{name:'上传内容',exact:true}).click();await page.getByRole('button',{name:'移除 synthetic-notes.txt'}).waitFor();assert(writes.some(w=>w.kind==='material'&&w.body.source_path==='synthetic/synthetic-notes.txt'));
await page.getByRole('textbox',{name:'消息',exact:true}).fill('请读取附件');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.agent-message.user:last-of-type')?.textContent.includes('请读取附件')||document.body.textContent.includes('请读取附件'));
await page.waitForFunction(()=>document.querySelector('[aria-label="发送消息"]')!==null);assert(writes.some(w=>w.kind==='send'&&w.payload.attachmentPaths[0]==='synthetic/synthetic-notes.txt'));
await page.getByRole('button',{name:'展开任务上下文',exact:true}).click();await page.locator('.standard-rail').waitFor();await page.getByRole('button',{name:'折叠任务上下文',exact:true}).first().click();
await page.getByRole('button',{name:'选择模型和推理强度'}).click();await page.getByRole('button',{name:'打开模型选择'}).click();await page.getByRole('menuitemradio',{name:'test-model',exact:true}).waitFor();await page.keyboard.press('Escape');
await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();
await page.getByRole('button',{name:'模型 API',exact:true}).click();
const secretGeometry=await page.locator('.secret-input').evaluate(el=>{
 const input=el.querySelector('input'),icon=el.querySelector('svg'),actions=el.querySelector('.secret-actions');
 const r=input.getBoundingClientRect(),s=getComputedStyle(input);
 return {textLeft:r.left+parseFloat(s.paddingLeft),textRight:r.right-parseFloat(s.paddingRight),iconRight:icon.getBoundingClientRect().right,actionsLeft:actions.getBoundingClientRect().left};
});
assert(secretGeometry.textLeft>=secretGeometry.iconRight+4,'API key text must clear its icon');
assert(secretGeometry.textRight<=secretGeometry.actionsLeft,'API key text must clear its actions');
await page.getByText('128,000 tokens · 服务商返回',{exact:true}).waitFor();
assert.equal(await page.getByLabel('Models URL',{exact:true}).isVisible(),false);
await page.getByText('高级连接设置',{exact:true}).click();
await page.getByLabel('Models URL',{exact:true}).fill('https://synthetic.invalid/models');
await page.getByText('高级连接设置',{exact:true}).click();
await page.getByText('高级连接设置',{exact:true}).click();
assert.equal(await page.getByLabel('Models URL',{exact:true}).inputValue(),'https://synthetic.invalid/models');
await page.getByLabel('Models URL',{exact:true}).fill('');
await page.getByText('高级连接设置',{exact:true}).click();
// Changing the discovery URL invalidates the previous endpoint's model catalog.
await page.getByRole('button',{name:'读取模型',exact:true}).click();
await page.getByText('256,000 tokens · 服务商返回',{exact:true}).waitFor();
await page.getByLabel('上下文窗口（tokens）',{exact:true}).fill('64000');
await page.getByLabel('最大输出（tokens）',{exact:true}).fill('4096');
await page.getByLabel('模型名称',{exact:true}).fill('other-model');
assert.equal(await page.getByLabel('上下文窗口（tokens）',{exact:true}).inputValue(),'');
await page.getByText('262,144 tokens · 服务商返回',{exact:true}).waitFor();
await page.getByLabel('最大输出（tokens）',{exact:true}).fill('8192');
await page.getByLabel('模型名称',{exact:true}).fill('test-model');
assert.equal(await page.getByLabel('上下文窗口（tokens）',{exact:true}).inputValue(),'64000');
await page.getByRole('button',{name:'读取模型',exact:true}).click();
await page.getByText('已从服务读取 2 个模型。',{exact:true}).waitFor();
await page.getByText('64,000 tokens · 手动设置',{exact:true}).waitFor();
await page.getByRole('button',{name:'保存并启用',exact:true}).click();
await page.getByText('连接已保存并设为当前模型。',{exact:true}).waitFor();
const savedProfiles=await page.evaluate(()=>window.savedProvider.modelProfiles);
assert.equal(savedProfiles['test-model'].contextWindow,'64000');
assert.equal(savedProfiles['test-model'].maxOutputTokens,'4096');
assert.equal(savedProfiles['other-model'].maxOutputTokens,'8192');
await page.screenshot({path:path.join(root,'model-parameters.png')});
await page.getByRole('button',{name:'常规',exact:true}).click();
for(const value of ['light','dark','white']){await page.getByRole('combobox',{name:'主题',exact:true}).selectOption(value);assert.equal(await page.locator('html').getAttribute('data-interface-theme'),value);await page.screenshot({path:path.join(root,`settings-theme-${value}.png`),animations:'disabled'});}
const settingsGeometry=[];
for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:900});
  for(const [id,label] of [['general','常规'],['models','模型 API'],['skills','Skills'],['mcp','MCP Servers'],['permissions','权限与浏览器']]){
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.locator('.settings-content').evaluate(el=>{el.scrollTop=0});
    const geometry=await page.locator('.settings-window').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,contentWidth:el.querySelector('.settings-content').clientWidth,contentScroll:el.querySelector('.settings-content').scrollWidth,font:getComputedStyle(el).fontSize,surface:getComputedStyle(el.querySelector('.settings-content')).backgroundColor}));
    settingsGeometry.push({viewport:width,section:id,...geometry});
    assert(geometry.scrollWidth<=geometry.width+1,`${label}: dialog horizontal overflow at ${width}`);
    assert(geometry.contentScroll<=geometry.contentWidth+1,`${label}: content horizontal overflow at ${width}`);
    assert.equal(geometry.surface,'rgb(255, 255, 255)');
    const bounds=await page.locator('.settings-window').boundingBox();
    assert(bounds.y>=0 && bounds.y+bounds.height<=901,`${label}: dialog vertical overflow at ${width}`);
    if(id==='models'){
      const save=await page.getByRole('button',{name:'保存并启用',exact:true}).boundingBox();
      assert(save.y>=0 && save.y+save.height<=901,`save action clipped at ${width}`);
    }
    await page.screenshot({path:path.join(root,`settings-${id}-${width}.png`),animations:'disabled'});
  }
}
fs.writeFileSync(path.join(root,'settings-geometry.json'),JSON.stringify(settingsGeometry,null,2));
await page.setViewportSize({width:1440,height:900});
await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'收起侧栏'}).click();assert.equal(await page.locator('.source-sidebar').count(),0);await page.getByRole('button',{name:'打开侧栏'}).click();
for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:900});if(width<760)await page.getByRole('button',{name:'收起侧栏'}).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(width===390)await page.screenshot({path:path.join(root,'desktop-narrow.png')});}
assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);fs.writeFileSync(path.join(root,'ui-integration.json'),JSON.stringify({pass:true,sourceHashes:Object.keys(hashes).length,writes,errors,unexpected,limitations:['API and native file chooser responses use synthetic fixtures; no real model call or user data access.']},null,2),{flag:'wx'});console.log('PASS: source components, sidebar, upload-to-send path, persisted approval policy, rejected save, themes, panel, model menu, 4 viewport widths.');
}finally{await application.close()}
