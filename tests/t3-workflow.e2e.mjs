import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outputRoot=path.join(root,'artifacts/t3-independent');fs.mkdirSync(outputRoot,{recursive:true});
const run=fs.mkdtempSync(path.join(outputRoot,'ui-'));
const screenshots=path.join(root,'docs/reviews/multi-role-review-20261024-005649/t3-screenshots');fs.mkdirSync(screenshots,{recursive:true});
const python=path.join(root,'backend/.venv/Scripts/python.exe');
const token=randomBytes(24).toString('hex');
const report={run,synthetic_data:true,production_app:true,production_api:true,mocked_web_io:true,mocked_analysis_seeding:true,
  real_model_or_platform_calls:false,checks:[],screenshots:[],api_receipts:[],external_requests:[],page_errors:[]};
const hashFile=filename=>createHash('sha256').update(fs.readFileSync(path.join(root,filename))).digest('hex');
const sources=['src/App.jsx','src/components/AgentWorkspace.jsx','src/components/InterviewIntelligence.jsx','src/components/JobContextCard.jsx','src/components/JobContextCard.css','src/lib/job-description.js','src/lib/job-progress.js','src/lib/interview-progress.js'];
report.source_hashes=sources.map(filename=>({path:filename,sha256:hashFile(filename)}));
function isolatedEnv(folder){
  const env={...process.env};
  for(const key of Object.keys(env))if(/^(FETCHCV_|OPENAI_|ANTHROPIC_|DEEPSEEK_|FIRECRAWL_|NODE_OPTIONS$|APPDATA$|LOCALAPPDATA$|TEMP$|TMP$|HOME$|USERPROFILE$)/i.test(key))delete env[key];
  for(const [key,leaf] of [['APPDATA','roaming'],['LOCALAPPDATA','local'],['TEMP','temp'],['TMP','temp'],['HOME','home'],['USERPROFILE','home']]){
    env[key]=path.join(folder,leaf);fs.mkdirSync(env[key],{recursive:true});
  }
  return {...env,PYTHONIOENCODING:'utf-8',FETCHCV_DATABASE_URL:`sqlite:///${path.join(folder,'fixture.db').replaceAll('\\','/')}`,
    FETCHCV_SETTINGS_FILE:path.join(folder,'settings.json'),FETCHCV_ARTIFACT_ROOT:path.join(folder,'artifacts'),FETCHCV_WORKSPACE_ROOT:path.join(folder,'workspace'),
    FETCHCV_AGENT_RUNTIME:'mock',FETCHCV_ALLOW_MOCK_RUNTIME:'1',FETCHCV_PROVIDER_MODEL:'T3_OFFLINE_MOCK',FETCHCV_DESKTOP_STARTUP_GATE:'0',FETCHCV_CONTROL_TOKEN:token,FETCHCV_INSTANCE_NONCE:path.basename(folder)};
}
const buildEnv=isolatedEnv(path.join(run,'build-runtime'));
for(const key of Object.keys(process.env))if(/^(FETCHCV_|OPENAI_|ANTHROPIC_|DEEPSEEK_|FIRECRAWL_|NODE_OPTIONS$|APPDATA$|LOCALAPPDATA$|TEMP$|TMP$|HOME$|USERPROFILE$)/i.test(key))delete process.env[key];
Object.assign(process.env,buildEnv);
let server,api,context,page;
const logs=[];
async function waitFor(check,label){
  const start=Date.now();
  while(Date.now()-start<30000){if(api?.exitCode!==null&&api?.exitCode!==undefined)throw Error(`API exited ${api.exitCode}: ${label}`);if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}
  throw Error(`Timeout: ${label}`);
}
async function capture(filename,description){
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(350);
  await page.screenshot({path:path.join(screenshots,filename),fullPage:true});
  report.screenshots.push({file:filename,description,provenance:'Actual production App browser screenshot; isolated SQLite and production API; synthetic library/web IO/analysis fixture'});
}
async function openJobProgress(){
  const toggle=page.locator('.source-context-toggle');
  await toggle.waitFor();
  if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
  const progress=page.locator('.agent-rail-v2').getByRole('region',{name:'岗位进度',exact:true});
  await progress.waitFor();
  return progress;
}
async function openJobDetails(){
  const progress=await openJobProgress();
  const details=progress.locator('.job-progress-details');
  if(!await details.evaluate(node=>node.open))await details.locator(':scope > summary').click();
  return progress;
}
function stop(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  if(process.platform==='win32')spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000});
  else child.kill('SIGTERM');
}
try{
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
  const folder=path.join(run,'browser');fs.mkdirSync(folder);
  logs.push(...['stdout','stderr'].map(kind=>fs.openSync(path.join(folder,`api-${kind}.log`),'wx')));
  api=spawn(python,[path.join(root,'tests/fixtures/t3-workflow/server.py'),'--run-root',folder],{cwd:root,env:{...isolatedEnv(folder),FETCHCV_ALLOWED_ORIGINS:origin},windowsHide:true,stdio:['ignore',...logs]});
  await waitFor(()=>fs.existsSync(path.join(folder,'api-address.json')),'API address');
  const apiBase=`http://127.0.0.1:${JSON.parse(fs.readFileSync(path.join(folder,'api-address.json'))).port}`;
  const headers={'x-fetchcv-control-token':token,'content-type':'application/json'};
  const request=async(url,body,method=body?'POST':'GET')=>{
    const response=await fetch(apiBase+url,{method,headers,body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json()};
  };
  await waitFor(async()=>{try{return (await request('/health')).body.instance_nonce==='browser';}catch{return false;}},'API readiness');
  context=await chromium.launchPersistentContext(path.join(folder,'browser-profile'),{channel:'msedge',headless:true,viewport:{width:1440,height:1100},reducedMotion:'reduce',env:isolatedEnv(folder),timeout:30000,
    args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
  const allowed=new Set([origin,apiBase]);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(allowed.has(url.origin)||['data:','blob:'].includes(url.protocol))return route.continue();report.external_requests.push(url.origin);return route.abort();});
  await context.addInitScript(({apiBase,token})=>{
    window.appRuntime={apiBase,apiToken:token,getBackendStatus:async()=>({state:'ready',dataReady:true,agentReady:true})};
    localStorage.setItem('fetchcv.context-rail-collapsed','1');
  },{apiBase,token});
  page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>report.page_errors.push(error.message));
  page.on('response',response=>{if(response.url().startsWith(apiBase)&&response.request().method()!=='GET')report.api_receipts.push({method:response.request().method(),path:new URL(response.url()).pathname,status:response.status()});});
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'分析一个岗位',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'新增岗位项目',exact:true});await modal.waitFor();
  await modal.getByLabel('招聘网页 URL',{exact:true}).fill('https://synthetic.invalid/job/42');
  await modal.getByRole('button',{name:'读取网页',exact:true}).click();
  await modal.getByText('预览尚未保存',{exact:false}).waitFor();
  let inspected=(await request('/fixture/inspect')).body;
  assert.deepEqual(inspected.jobs,[]);assert.equal(inspected.materials,0);
  report.checks.push('Actual Read web click called production preview; SQLite has zero Job and zero MaterialAsset before save');
  await modal.getByLabel('公司',{exact:true}).fill('合成科技');await modal.getByLabel('岗位',{exact:true}).fill('数据分析');
  const contextCard=modal.getByRole('group',{name:'确认岗位语境',exact:true});
  assert.equal(await contextCard.getByLabel('招聘类型',{exact:true}).inputValue(),'campus');
  await contextCard.locator('.job-context-evidence').filter({hasText:'位置 17'}).locator('summary').click();
  await capture('00-original-context-basis.png','实际preview自动字段为原文依据；展开招聘类型原句，尚未用户确认或写库');
  await contextCard.getByRole('button',{name:'确认招聘类型',exact:true}).click();
  await contextCard.getByLabel('招聘类型',{exact:true}).selectOption('social');
  await contextCard.getByLabel('职能',{exact:true}).fill('风险分析');
  await contextCard.getByLabel('子方向',{exact:true}).fill('反欺诈策略');
  await contextCard.getByLabel('部门 / 业务线',{exact:true}).fill('合成风控事业部');
  await contextCard.getByLabel('JD 发布日期',{exact:true}).fill('2026-10-25');
  await capture('01-context-preview-unsaved.png','实际读取后的确认卡；原文来源与用户确认分项显示；preview尚未写数据库');
  await modal.getByRole('button',{name:'创建项目',exact:true}).scrollIntoViewIfNeeded();
  await capture('01b-context-confirmation-actions.png','实际新建对话内滚动：五字段与确认状态、底部创建动作可达');
  const created=page.waitForResponse(response=>response.url()===apiBase+'/api/jobs'&&response.request().method()==='POST');
  await modal.getByRole('button',{name:'创建项目',exact:true}).click();
  const receipt=await created;assert.equal(receipt.status(),201);const job=await receipt.json();
  await openJobDetails();
  assert.equal(job.context_json.fields.recruitment_type.value,'social');
  assert.equal(job.context_json.fields.recruitment_type.basis,'user_confirmed');
  assert.equal(job.context_json.fields.business_unit.value,'合成风控事业部');
  await page.locator('.job-context-summary > summary').click();
  await capture('02-saved-context.png','实际POST=201后展开右栏岗位详情与岗位语境，显示已保存字段及用户确认basis');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'合成科技 数据分析',exact:true}).click();
  await openJobDetails();
  await page.locator('.job-context-summary > summary').click();
  await page.getByRole('button',{name:'编辑岗位与语境',exact:true}).click();
  const manage=page.getByRole('dialog',{name:'管理岗位项目',exact:true});await manage.waitFor();
  assert.equal(await manage.getByLabel('招聘类型',{exact:true}).inputValue(),'social');
  assert.equal(await manage.getByLabel('部门 / 业务线',{exact:true}).inputValue(),'合成风控事业部');
  await capture('03-reopened-context.png','刷新真实App后重开管理对话框；语境从真实API持久化重读');
  await manage.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal((await request(`/fixture/analysis/${job.id}`,{})).status,200);
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'合成科技 数据分析',exact:true}).click();await openJobDetails();
  await page.locator('.job-context-summary > summary').click();
  await page.getByRole('button',{name:'编辑岗位与语境',exact:true}).click();await manage.waitFor();
  await manage.getByLabel('岗位描述',{exact:true}).fill(job.jd_raw+'\n新增职责：核对合成报表。');
  await manage.getByLabel('招聘类型',{exact:true}).selectOption('internship');
  const patched=page.waitForResponse(response=>response.url()===apiBase+`/api/jobs/${job.id}`&&response.request().method()==='PATCH');
  await manage.getByRole('button',{name:'保存修改',exact:true}).click();
  const patch=await patched;assert.equal(patch.status(),200);const modified=await patch.json();assert.equal(modified.input_revision,job.input_revision+1);
  await page.getByRole('status',{name:'岗位结果过期提示',exact:true}).waitFor();
  await page.getByRole('button',{name:'重新分析当前岗位',exact:true}).waitFor();
  await capture('04-edited-results-stale.png','实际编辑正文和招聘类型并PATCH；旧Profile/Brief显示过期，右栏提供重新分析');
  await page.locator('.workspace-tabs').getByRole('button',{name:'面试',exact:true}).click();
  await page.getByRole('status',{name:'岗位结果过期提示',exact:true}).waitFor();
  assert.equal(await page.getByText('旧简报不得继续作为当前成果',{exact:false}).count(),0);
  await capture('05-stale-interview-boundary.png','切换面试tab后持续过期提示；旧Brief不作为当前成果显示');
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'合成科技 数据分析',exact:true}).click();await page.getByRole('status',{name:'岗位结果过期提示',exact:true}).waitFor();
  inspected=(await request('/fixture/inspect')).body;
  assert.equal(inspected.jobs[0].input_revision,modified.input_revision);
  assert.equal(inspected.briefs[0].metadata_json.analysis_status,'stale');
  const noop=await request(`/api/jobs/${job.id}`,{jd_raw:modified.jd_raw,context_json:modified.context_json},'PATCH');
  assert.equal(noop.body.input_revision,modified.input_revision);
  assert.equal((await request(`/fixture/new-profile/${job.id}`,{})).status,200);
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'合成科技 数据分析',exact:true}).click();
  const progress=await openJobDetails();
  await page.getByRole('button',{name:'查看并更新面试简报',exact:true}).waitFor();
  assert.match(await progress.innerText(),/岗位相关性已过期/);
  await capture('06-new-profile-old-draft-stale.png','合成Suite通过真实AgentService重做Profile；旧简历相关性仍过期，Brief仍待更新');
  assert.equal(await page.locator('.agent-workspace-v2 .job-progress-panel').count(),0,'job progress stays outside the conversation');
  await page.locator('.source-context-toggle').click();
  assert.equal(await page.locator('.source-context-toggle').getAttribute('aria-expanded'),'false','right rail remains collapsible after context actions');
  report.checks.push('Production create=201; reload and real manage dialog preserves confirmed fields; production PATCH=200 marks profile and brief stale; reload and interview tab preserve stale; identical PATCH does not increment revision');
  assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.external_requests,[]);
  report.source_changed_during_run=report.source_hashes.filter(item=>hashFile(item.path)!==item.sha256).map(item=>item.path);
  assert.deepEqual(report.source_changed_during_run,[],'Production source changed after build');
  report.database=inspected;report.success=true;
}catch(error){report.success=false;report.failure=error.stack;process.exitCode=1;if(page)await capture('failure.png','Historical failed run; not a successful acceptance screenshot').catch(()=>{});}
finally{
  await context?.close().catch(()=>{});stop(api);for(const fd of logs)fs.closeSync(fd);
  if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(screenshots,'latest-run.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({success:report.success,run,failure:report.failure,screenshots:report.screenshots.length},null,2));
}
