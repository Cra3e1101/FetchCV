import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium} from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(root, 'artifacts/t2-independent');
fs.mkdirSync(outputRoot, {recursive: true});
const run = fs.mkdtempSync(path.join(outputRoot, 'ui-'));
const screenshots = path.join(root, 'docs/reviews/multi-role-review-20261024-005649/t2-screenshots');
fs.mkdirSync(screenshots, {recursive: true});
const python = process.env.FETCHCV_TEST_PYTHON || path.join(root, 'backend/.venv/Scripts/python.exe');
const token = randomBytes(24).toString('hex');
const report = {run, synthetic_data: true, production_app: true, mocked_task_model: true,
  production_api_routes: true, mocked_collection: true, scenarios: [], screenshots: [], external_requests: [], errors: []};
const sourceFiles = ['src/App.jsx','src/components/AgentWorkspace.jsx','src/components/ConversationWorkspace.jsx',
  'src/components/JobProgressPanel.jsx','src/components/JobProgressPanel.css','src/lib/job-progress.js',
  'src/components/InterviewIntelligence.jsx','src/components/InterviewIntelligence.css','src/lib/interview-progress.js',
  'src/lib/interview-research.js','src/lib/processing.js','tests/t2-workflow.e2e.mjs','tests/fixtures/t2-workflow/server.py'];
const hashFile = filename => createHash('sha256').update(fs.readFileSync(path.join(root,filename))).digest('hex');
report.source_hashes = sourceFiles.filter(filename=>fs.existsSync(path.join(root,filename))).map(filename=>({path:filename,sha256:hashFile(filename)}));

function isolatedEnv(folder) {
  const env = {...process.env};
  for (const key of Object.keys(env)) if (/^(FETCHCV_|OPENAI_|ANTHROPIC_|DEEPSEEK_|FIRECRAWL_|NODE_OPTIONS$|APPDATA$|LOCALAPPDATA$|TEMP$|TMP$|HOME$|USERPROFILE$)/i.test(key)) delete env[key];
  for (const [key, leaf] of [['APPDATA','roaming'],['LOCALAPPDATA','local'],['TEMP','temp'],['TMP','temp'],['HOME','home'],['USERPROFILE','home']]) {
    env[key] = path.join(folder, leaf); fs.mkdirSync(env[key], {recursive:true});
  }
  return {...env, PYTHONIOENCODING: 'utf-8', FETCHCV_DATABASE_URL: `sqlite:///${path.join(folder,'fixture.db').replaceAll('\\','/')}`,
    FETCHCV_SETTINGS_FILE: path.join(folder,'settings.json'), FETCHCV_ARTIFACT_ROOT: path.join(folder,'artifacts'),
    FETCHCV_WORKSPACE_ROOT: path.join(folder,'workspace'), FETCHCV_AGENT_RUNTIME: 'mock', FETCHCV_ALLOW_MOCK_RUNTIME: '1',
    FETCHCV_PROVIDER_MODEL: 'T2_OFFLINE_MOCK', FETCHCV_PROVIDER_NAME: 'T2 synthetic offline fixture',
    FETCHCV_DESKTOP_STARTUP_GATE: '0', FETCHCV_CONTROL_TOKEN: token, FETCHCV_INSTANCE_NONCE: path.basename(folder)};
}
// Vite/esbuild subprocesses also inherit only these isolated paths.
const buildEnv = isolatedEnv(path.join(run,'build-runtime'));
for (const key of Object.keys(process.env)) if (/^(FETCHCV_|OPENAI_|ANTHROPIC_|DEEPSEEK_|FIRECRAWL_|NODE_OPTIONS$|APPDATA$|LOCALAPPDATA$|TEMP$|TMP$|HOME$|USERPROFILE$)/i.test(key)) delete process.env[key];
Object.assign(process.env, buildEnv);

let server;
async function waitFor(check, description, processHandle, timeout=30000) {
  const start = Date.now();
  while (Date.now()-start < timeout) {
    if (processHandle?.exitCode !== null && processHandle?.exitCode !== undefined) throw Error(`API exited ${processHandle.exitCode}: ${description}`);
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve,100));
  }
  throw Error(`Timed out: ${description}`);
}
function stop(processHandle) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  if (process.platform === 'win32') return spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/taskkill.exe'),['/PID',String(processHandle.pid),'/T','/F'],{windowsHide:true,timeout:5000});
  processHandle.kill('SIGTERM');
}
async function capture(page, filename, description) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400); // Let the actual dialog transition finish before the persisted screenshot.
  await page.screenshot({path:path.join(screenshots,filename),fullPage:true});
  report.screenshots.push({file:filename,description,provenance:'Production App, isolated real SQLite/API, deterministic fixture task/model/collection'});
}
async function scenario(name, origin) {
  const folder = path.join(run,name); fs.mkdirSync(folder);
  const scenarioReport = {name,checks:[],api_receipts:[],page_errors:[],status:'running'};
  report.scenarios.push(scenarioReport);
  const logs = ['stdout','stderr'].map(kind=>fs.openSync(path.join(folder,`api-${kind}.log`),'wx'));
  const api = spawn(python,[path.join(root,'tests/fixtures/t2-workflow/server.py'),'--run-root',folder,'--scenario',name],
    {cwd:root,env:{...isolatedEnv(folder),FETCHCV_ALLOWED_ORIGINS:origin},windowsHide:true,stdio:['ignore',...logs]});
  let context, page;
  try {
    await waitFor(()=>fs.existsSync(path.join(folder,'api-address.json')),'fixture API address',api);
    const apiBase = `http://127.0.0.1:${JSON.parse(fs.readFileSync(path.join(folder,'api-address.json'))).port}`;
    const headers = {'x-fetchcv-control-token':token,'content-type':'application/json'};
    async function request(url,body) {
      const response=await fetch(apiBase+url,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
      return {status:response.status,body:await response.json()};
    }
    await waitFor(async()=>{try{return (await request('/health')).body.instance_nonce===path.basename(folder);}catch{return false;}},'fixture API health',api);
    context = await chromium.launchPersistentContext(path.join(folder,'browser-profile'), {channel:'msedge',headless:true,
      viewport:{width:1440,height:1000},reducedMotion:'reduce',env:isolatedEnv(folder),timeout:30000,
      args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
    const allowed = new Set([origin,apiBase]);
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if (allowed.has(url.origin)||url.protocol==='data:'||url.protocol==='blob:') return route.continue();
      report.external_requests.push({scenario:name,url:url.origin}); return route.abort();
    });
    await context.addInitScript(({apiBase,token})=>{
      window.appRuntime={apiBase,apiToken:token,
        getBackendStatus:async()=>({state:'ready',dataReady:true,agentReady:true}),
        startPiTask:async(runId,kind)=>{
          const response=await fetch(`${apiBase}/fixture/task/${runId}`,{method:'POST',headers:{'x-fetchcv-control-token':token}});
          if(!response.ok)throw Error(`Synthetic task ${kind} failed: ${await response.text()}`); return response.json();
        },
        streamPiMessage:async(input,onEvent)=>{
          const response=await fetch(`${apiBase}/fixture/research/${input.jobId}`,{method:'POST',headers:{'x-fetchcv-control-token':token}});
          if(!response.ok)throw Error(await response.text());const result=await response.json();onEvent?.('done',result);return result;
        }};
      localStorage.setItem('fetchcv.context-rail-collapsed','1');
    },{apiBase,token});
    page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror',error=>scenarioReport.page_errors.push(error.message));
    page.on('response',response=>{if(response.url().startsWith(apiBase)&&response.request().method()!=='GET')scenarioReport.api_receipts.push({method:response.request().method(),path:new URL(response.url()).pathname,status:response.status()});});
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'分析一个岗位',exact:true}).waitFor();
    assert.ok(await page.locator('.standalone-chat textarea').count(),'chat composer remains on home');
    if(name==='no-profile'){
      await capture(page,'00-home-without-profile.png','真正空SQLite：首页入口明确先导入本人简历；聊天仍在');
      await page.getByRole('button',{name:'分析一个岗位',exact:true}).click();
      await page.getByRole('dialog').filter({hasText:'导入'}).waitFor();
      await capture(page,'00-import-required.png','空资料库点击分析岗位，进入真实导入对话框；未绕过候选人约束');
      assert.equal((await request('/fixture/inspect')).body.candidates,0);
      assert.equal((await request('/fixture/inspect')).body.jobs,0);
      scenarioReport.checks.push('Empty real SQLite: homepage analysis entry opens production import prerequisite; no candidate/job was silently created');
      scenarioReport.status='passed';return;
    }
    if(name==='usable')await capture(page,'01-home-analyze-job.png','全新合成候选人、零岗位：首页主入口与聊天同时存在');
    await page.getByRole('button',{name:'分析一个岗位',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'新增岗位项目'});
    await modal.getByRole('tab',{name:'导入文本',exact:true}).click();
    await modal.getByLabel('公司',{exact:true}).fill('合成科技');
    await modal.getByLabel('岗位',{exact:true}).fill('数据分析');
    await modal.getByLabel('岗位描述',{exact:true}).fill('整理订单数据，核对数据质量。使用 SQL 分析订单异常，参与指标核对。');
    const created=page.waitForResponse(response=>response.url()===apiBase+'/api/jobs'&&response.request().method()==='POST');
    await modal.getByRole('button',{name:'创建项目',exact:true}).click();
    const jobReceipt=await created;assert.equal(jobReceipt.status(),201);const job=await jobReceipt.json();
    const railToggle=page.locator('.source-context-toggle');
    await railToggle.waitFor();
    assert.equal(await railToggle.getAttribute('aria-expanded'),'false','right rail starts closed');
    assert.equal(await page.locator('.agent-workspace-v2 .job-progress-panel').count(),0,'progress does not occupy the conversation');
    await railToggle.click();
    const progress=page.locator('.agent-rail-v2').getByRole('region',{name:'岗位进度',exact:true});
    await progress.waitFor();
    assert.equal(await progress.locator('button.primary-button,button.primary').count(),1,'one primary next step');
    assert.equal(await progress.locator('.job-progress-details').evaluate(node=>node.open),false,'supporting details start collapsed');
    if(name==='usable')await capture(page,'02-job-progress.png','岗位创建真实POST=201；从顶部按钮打开右栏，进度与唯一主操作位于右侧，详情默认收起');
    await progress.getByRole('button',{name:'分析这个岗位',exact:true}).click();
    const facts=page.locator('.agent-rail-v2 .rail-selector');
    await facts.waitFor();
    assert.equal(await progress.locator('button.primary-button,button.primary').count(),0,'inline experience selector owns the confirmation action');
    if(name==='usable')await capture(page,'03-central-experience-confirmation.png','右栏直接选择经历并确认；不重复显示确认入口，无默认审批绕过');
    await facts.getByRole('button',{name:'确认并生成策略',exact:true}).click();
    await facts.waitFor({state:'hidden'});
    await progress.getByRole('button',{name:/处理待补证|审阅改写建议/,exact:true}).click();
    const review=page.getByRole('dialog',{name:'简历改写审阅',exact:true});
    const unsafe=review.locator('.proposal-list > article').filter({hasText:'无支持的合成攻击草稿'});
    const safe=review.locator('.proposal-list > article').filter({hasText:'保留支持原句（合成正例）'});
    assert.equal(await unsafe.getByRole('button',{name:'采用建议',exact:true}).isDisabled(),true);
    assert.equal(await safe.getByRole('button',{name:'采用建议',exact:true}).isDisabled(),false);
    assert.match(await safe.innerText(),/支持原句.*t2-fact.*v3/s);
    const workspace=await request(`/api/jobs/${job.id}/workspace`);
    const runId=workspace.body.run.id;
    const approval=workspace.body.approvals.find(item=>item.action_type==='apply_resume_changes');
    const attack=await request(`/api/agent-runs/${runId}/proposals/review`,{approval_id:approval.id,approved_by:'synthetic-attacker',
      expected_revision:Number(approval.decision_payload?.draft?.revision||0),expected_target_content_hash:approval.decision_payload.target_content_hash,
      decisions:[{proposal_id:'t2-safe',decision:'accepted'},{proposal_id:'t2-unsupported',decision:'accepted'}]});
    assert.ok([400,409,422].includes(attack.status),JSON.stringify(attack));
    scenarioReport.backend_unsupported_adoption=attack;
    if(name==='usable'){
      await capture(page,'04-central-review-needs-evidence.png','可定位事实版本和支持原句；无支持建议采用按钮disabled，真实后端强制请求被拒绝');
      await unsafe.getByRole('button',{name:'采用建议',exact:true}).scrollIntoViewIfNeeded();
      await capture(page,'04b-needs-evidence-disabled.png','待补证草稿的disabled采用按钮、原句和追问实际可见');
    }
    await unsafe.getByRole('button',{name:'保留原文',exact:true}).click();
    await safe.getByRole('button',{name:'采用建议',exact:true}).click();
    await review.getByRole('button',{name:'应用已确认修改',exact:true}).click();
    await review.waitFor({state:'hidden'});
    const progressDetails=progress.locator('.job-progress-details');
    if(!await progressDetails.evaluate(node=>node.open))await progressDetails.locator(':scope > summary').click();
    assert.doesNotMatch(await progress.innerText(),/\d+\s*条改写待补证/,'A rejected unsupported draft is retained as history, not an outstanding evidence task');
    scenarioReport.checks.push('Real job POST, sidebar mock analysis and direct fact approval, central T1 review, disabled unsupported adoption and production API rejection, real mixed approve/reject POST, expanded details clear rejected evidence todos');
    await railToggle.click();
    assert.equal(await railToggle.getAttribute('aria-expanded'),'false','right rail can close after workflow actions');
    await page.locator('.workspace-tabs').getByRole('button',{name:'面试',exact:true}).click();
    await page.getByRole('button',{name:'开始面试调研',exact:true}).click();
    await page.locator('[aria-label="面试证据状态"]').getByText('本轮调研已结束',{exact:true}).waitFor();
    await page.locator('.interview-page').waitFor();
    await capture(page,`05-interview-${name}.png`,`${name}面试路径：7个合成工具回执；离线来源；右栏关闭`);
    const text=await page.locator('.interview-page').innerText();
    assert.equal(text.includes('悬空旧问题不应显示'),false,'stale unsupported question hidden');
    assert.equal(text.includes('遗留简报：多源高频，必须隐藏。'),false,'stale summary hidden');
    assert.equal(text.includes('我主导上线了数据库。'),false,'unsupported personal recommendation hidden');
    if(name==='usable'){
      assert.match(text,/如何核对订单数据质量/);
      assert.match(text,/证据有限|覆盖有限|不能.*充分/);
      assert.match(text,/累计已保存正文 1 篇/);
      assert.match(text,/已完成问题提取 1 篇/);
      assert.match(text,/支持当前问题 1 篇/);
      assert.match(text,/图片 OCR 待核对 1 篇/);
      assert.match(text,/本轮读取或复用 1 篇正文/);
      assert.equal(/7\s*篇/.test(text),false,'tool count not called article count');
    }else{
      assert.match(text,/JD.*推导|基于.*JD|来自.*JD/s,'explicit JD-derived practice');
      assert.equal(await page.locator('.interview-page .interview-question-frequency').count(),0);
      assert.equal(await page.locator('.interview-rail-common').count(),0);
    }
    if(name==='restricted')assert.match(text,/验证码|访问受限|平台受限/);
    if(name!=='usable'){
      await page.getByRole('button',{name:'按 JD 准备',exact:true}).click();
      const preparation=page.getByRole('region',{name:'基于 JD 推导的准备建议',exact:true});
      await preparation.waitFor();
      await page.waitForFunction(()=>document.querySelector('.interview-jd-preparation').getBoundingClientRect().top < innerHeight);
      if(name==='empty')await capture(page,'07-empty-jd-preparation-action.png','实际点击按JD准备，滚动到带原始JD依据的练习清单');
      await page.getByRole('button',{name:'补充原文或查看历史对话',exact:true}).click();
      await page.locator('.workspace-tabs button.active').filter({hasText:'对话'}).waitFor();
      assert.equal(await page.locator('.agent-workspace-v2 textarea').isEnabled(),true);
      if(name==='restricted')await capture(page,'08-restricted-conversation-next-step.png','实际点击补充原文，回到可输入的岗位对话；右栏仍关闭');
      await page.locator('.workspace-tabs').getByRole('button',{name:'面试',exact:true}).click();
      scenarioReport.checks.push('Actual JD preparation click scrolls to source-grounded practice; actual supplement-original click opens enabled central composer with rail closed');
    }
    if(name==='empty'){
      assert.match(text,/未发现候选来源/);
      for(const [reason,label] of [['read_failed','读取失败'],['irrelevant','证据不相关']]){
        assert.equal((await request(`/fixture/reason/${job.id}/${reason}`,{})).status,200);
        await page.evaluate(()=>window.dispatchEvent(new CustomEvent('fetchcv:interview-evidence-changed')));
        await page.locator('[aria-label="本轮调研原因"]').getByText(label,{exact:false}).waitFor();
        await capture(page,`06-reason-${reason}.png`,`${label}：明确注入结构化ToolInvocation回执并刷新真实App，不是实时采集结果`);
        assert.match(await page.locator('.interview-page').innerText(),/基于.*JD|JD.*推导/s);
        scenarioReport.checks.push(`${reason}: structured fixture reason and JD next step rendered by production App`);
      }
    }
    scenarioReport.checks.push(`${name}: current evidence boundary, stale brief filtering, JD practice or source question, explicit round ending`);
    assert.equal(await railToggle.getAttribute('aria-expanded'),'false');
    scenarioReport.database=await request('/fixture/inspect');
    assert.equal(scenarioReport.database.body.jobs,1);
    assert.deepEqual(scenarioReport.page_errors,[]);
    scenarioReport.status='passed';
  }catch(error){
    scenarioReport.status='failed';scenarioReport.failure=error.stack;
    if(page)await capture(page,`failure-${name}.png`,'失败时真实页面状态').catch(()=>{});
    throw error;
  }finally{
    await context?.close().catch(error=>report.errors.push(error.message));
    stop(api);for(const descriptor of logs)fs.closeSync(descriptor);
  }
}

try{
  assert.ok(fs.existsSync(python),'Existing synthetic-test Python required');
  const webRoot=path.join(run,'web');
  await build({root,envFile:false,logLevel:'error',build:{outDir:webRoot,emptyOutDir:false}});
  server=http.createServer((request,response)=>{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const filename=path.resolve(webRoot,pathname==='/'?'index.html':'.'+pathname);
    if(!filename.startsWith(webRoot+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){response.writeHead(404);response.end();return;}
    response.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.png':'image/png'})[path.extname(filename)]||'application/octet-stream');
    fs.createReadStream(filename).pipe(response);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const name of ['no-profile','usable','empty','restricted'])await scenario(name,origin);
  assert.deepEqual(report.external_requests,[]);
  report.source_changed_during_run=report.source_hashes.filter(item=>hashFile(item.path)!==item.sha256).map(item=>item.path);
  assert.deepEqual(report.source_changed_during_run,[],'UI source changed after this production build');
  const protectedBaseline=path.join(root,'.tmp/t2-synthetic/protected-source-before.json');
  if(fs.existsSync(protectedBaseline)){
    report.protected_sources=JSON.parse(fs.readFileSync(protectedBaseline,'utf8')).map(item=>({path:item.path,before:item.sha256,after:hashFile(item.path),unchanged:item.sha256.toLowerCase()===hashFile(item.path)}));
    assert.equal(report.protected_sources.every(item=>item.unchanged),true,'T1/domain/collection protected sources changed');
  }
  report.success=true;
}catch(error){report.success=false;report.failure=error.stack;process.exitCode=1;}
finally{
  if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(screenshots,'latest-run.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({success:report.success,report:path.join(run,'report.json'),scenarios:report.scenarios.map(item=>({name:item.name,status:item.status,failure:item.failure})),failure:report.failure},null,2));
}
