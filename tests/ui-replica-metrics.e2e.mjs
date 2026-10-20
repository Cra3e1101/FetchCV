import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const output=process.env.FETCHCV_UI_EVIDENCE;
if(!output)throw new Error('FETCHCV_UI_EVIDENCE must name an isolated evidence directory');
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1296,height:950},deviceScaleFactor:1});
const errors=[],writes=[],measurements={},checks=[],motion={},consoleErrors=[];
page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
const candidate={id:'fixture-c',name:'合成验收用户'};
const job={id:'fixture-j',candidate_id:candidate.id,company:'验收公司',role:'产品经理',jd_raw:'合成岗位：负责需求分析与产品设计。'};
const skill={id:'fixture-skill',name:'资料核对',description:'合成验收说明，仅用于界面与开关测试',enabled:false};
const detail={candidate,job,tasks:[],run:null,steps:[],facts:[],experiences:[],approvals:[],resumes:[],portfolios:[],materials:[],proposals:[],interview_sources:[],interview_briefs:[],messages:[
  {id:'u',role:'user',content:'请核对材料中的产品经历。'},
  {id:'a',role:'assistant',content:'已整理可用的产品经历，后续修改以你的原始材料为依据。\n\n```json\n{"source": "synthetic-test-fixture"}\n```',metadata_json:{processing_duration_ms:2400,processing_trace:[{id:'p',label:'读取岗位资料',status:'completed'}],tool_receipts:[{tool_call_id:'t',tool_name:'read_workspace_file',status:'completed',summary:'已核对合成资料，未访问真实文件。',artifacts:[]},{tool_call_id:'t2',tool_name:'unknown_tool',status:'unknown',summary:'状态字段未知，不得显示成功。'}]}},
]};
page.on('pageerror',error=>errors.push(error.message));
await page.route('http://127.0.0.1:8766/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname;let data;
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
  if(p==='/api/workspace')data={candidates:[candidate],jobs:[job]};
  else if(p==='/api/runtime/status')data={configured:true,model:'test-model',provider_name:'合成测试'};
  else if(p==='/api/conversations')data=[];
  else if(p===`/api/jobs/${job.id}/workspace`)data=detail;
  else if(p===`/api/candidates/${candidate.id}/library`)data={candidate,experiences:[],resumes:[],materials:[],facts:[],interview_sources:[],interview_briefs:[]};
  else if(p==='/api/settings/general')data={theme:'system',density:'comfortable',accent:'coral'};
  else if(p==='/api/settings/permissions')data={web_access:'allow',browser_bridge:'allow',workspace_read:'allow',workspace_write:'ask',file_delete:'ask'};
  else if(p==='/api/skills')data=[skill];
  else if(p.startsWith('/api/skills/')){writes.push({path:p,body:req.postDataJSON()});Object.assign(skill,req.postDataJSON());data=skill;}
  else if(p==='/api/mcp/servers')data=[];
  else {errors.push(`${req.method()} ${p}`);data={};}
  await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
});
await page.addInitScript(()=>{window.appRuntime={apiBase:'http://127.0.0.1:8766',getBackendStatus:async()=>({state:'ready'}),listModelProviders:async()=>({activeId:'fixture-p',profiles:[{id:'fixture-p',providerName:'合成测试',model:'test-model',protocol:'openai',baseUrl:'https://synthetic.invalid',hasApiKey:true,availableModels:[{id:'test-model'}]}]})};});
const read=async selector=>page.locator(selector).first().evaluate(element=>{
  const rect=element.getBoundingClientRect(),s=getComputedStyle(element);
  return {rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},fontSize:s.fontSize,lineHeight:s.lineHeight,fontWeight:s.fontWeight,borderRadius:s.borderRadius,backgroundColor:s.backgroundColor,color:s.color,border:s.border,transition:s.transition,animation:s.animation};
});
function equal(label,actual,expected){checks.push({label,actual,expected,pass:actual===expected});}
function near(label,actual,expected){checks.push({label,actual,expected,pass:Math.abs(actual-expected)<=1});}
try {
  await page.goto(process.env.FETCHCV_UI_TEST_URL||'http://127.0.0.1:5197',{timeout:60000});
  await page.getByRole('heading',{name:'想聊些什么？'}).waitFor();
  await page.screenshot({path:path.join(output,'home-light.png')});
  measurements.root=await read('#root');equal('root.font',measurements.root.fontSize,'16px');equal('root.line',measurements.root.lineHeight,'24px');equal('root.weight',measurements.root.fontWeight,'430');
  near('titlebar.height',(await read('.windowbar')).rect.height,44);
  measurements.sidebarRow=await read('.source-sidebar .rp-row');
  for(const [key,value] of Object.entries({fontSize:'13px',lineHeight:'18.57px',fontWeight:'430'}))equal('sidebarRow.'+key,measurements.sidebarRow[key],value);
  measurements.group=await read('.source-sidebar .rp-sec');
  for(const [key,value] of Object.entries({fontSize:'14px',lineHeight:'21px',fontWeight:'500'}))equal('group.'+key,measurements.group[key],value);
  const railButtons=await page.locator('.workspace-rail button').all();near('rail.pitch',(await railButtons[1].boundingBox()).y-(await railButtons[0].boundingBox()).y,44);
  const press=page.getByRole('button',{name:'搜索岗位',exact:true});await press.hover();motion.hover=await press.evaluate(e=>getComputedStyle(e).transition);const bounds=await press.boundingBox();await page.mouse.down();await page.waitForTimeout(160);motion.press=await press.evaluate(e=>getComputedStyle(e).transform);equal('press.scale',motion.press,'matrix(0.94, 0, 0, 0.94, 0, 0)');await page.mouse.move(bounds.x+80,bounds.y+80);await page.mouse.up();

  await page.keyboard.press('Control+k');await page.getByRole('dialog',{name:'搜索聊天',exact:true}).waitFor();await page.waitForTimeout(350);
  measurements.command=await read('.command-menu');near('command.width',measurements.command.rect.width,520);near('command.height',measurements.command.rect.height,487);near('command.y',measurements.command.rect.y,118);equal('command.radius',measurements.command.borderRadius,'20px');
  await page.screenshot({path:path.join(output,'command-light.png')});
  await page.getByRole('combobox').fill('不匹配');await page.getByText('没有匹配的聊天或岗位').waitFor();
  await page.getByRole('combobox').fill('验收公司');await page.keyboard.press('Alt+1');await page.locator('.agent-code-block').waitFor();
  equal('command navigates to real loaded job',await page.getByRole('dialog',{name:'搜索聊天',exact:true}).count(),0);
  for(const [key,selector] of Object.entries({rail:'.workspace-rail',railButton:'.workspace-rail button',sidebar:'.source-sidebar',header:'.task-header',composer:'.source-composer .rp-composer',bubble:'.agent-message.user',status:'.processing-summary',code:'.agent-code-block'}))measurements[key]=await read(selector);
  for(const [key,selector] of Object.entries({editor:'.source-composer .rp-editor',controls:'.source-composer .rp-controls',send:'.source-composer .composer-send',messageText:'.agent-markdown'}))measurements[key]=await read(selector);near('composer.reference.width',measurements.composer.rect.width,744);near('composer.reference.height',measurements.composer.rect.height,86);near('composer.reference.x',measurements.composer.rect.x,446);near('composer.reference.y',measurements.composer.rect.y,848);near('sidebar.row.reference.x',measurements.sidebarRow.rect.x,62);near('sidebar.row.reference.y',measurements.sidebarRow.rect.y,100);near('sidebar.row.reference.width',measurements.sidebarRow.rect.width,268);near('sidebar.row.reference.height',measurements.sidebarRow.rect.height,30);near('rail.width',measurements.rail.rect.width,52);near('rail.button.width',measurements.railButton.rect.width,36);near('rail.button.height',measurements.railButton.rect.height,36);equal('rail.button.radius',measurements.railButton.borderRadius,'12.5px');near('sidebar.width',measurements.sidebar.rect.width,288);near('sidebar.x',measurements.sidebar.rect.x,52);near('header.height',measurements.header.rect.height,52);equal('composer.radius',measurements.composer.borderRadius,'22px');equal('bubble.radius',measurements.bubble.borderRadius,'18px');equal('bubble.background',measurements.bubble.backgroundColor,'rgb(13, 13, 13)');equal('bubble.text',await page.locator('.agent-message.user p').evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
  for(const [key,value] of Object.entries({fontSize:'13px',lineHeight:'18.57px',fontWeight:'430',color:'rgba(26, 28, 31, 0.4)'}))equal(`status.${key}`,measurements.status[key],value);
  await page.locator('.processing-summary').click();await page.waitForTimeout(350);
  await page.locator('.tool-group-toggle').click();await page.waitForTimeout(350);
  await page.locator('.tool-detail-toggle').first().click();await page.waitForTimeout(350);
  measurements.shell=await read('.tool-output-card');equal('shell.radius',measurements.shell.borderRadius,'12.5px');equal('shell.background',measurements.shell.backgroundColor,'rgba(26, 28, 31, 0.055)');equal('shell.border',measurements.shell.border,'1px solid rgba(26, 28, 31, 0.118)');
  await page.getByRole('button',{name:'unknown_tool 状态未知',exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'conversation-light.png')});
  // Record transition lifecycle in both directions; screenshots alone cannot prove motion.
  await page.evaluate(()=>{window.collapseTransitions=[];document.querySelector('.processing-disclosure .ui-collapse').addEventListener('transitionend',event=>{if(event.propertyName==='height')window.collapseTransitions.push({height:event.target.getBoundingClientRect().height,elapsed:event.elapsedTime});});});
  await page.locator('.processing-summary').click();await page.waitForTimeout(400);await page.locator('.processing-summary').click();await page.waitForTimeout(400);
  motion.collapse=await page.evaluate(()=>window.collapseTransitions);equal('collapse both directions',motion.collapse.length,2);
  await page.locator('.processing-summary').focus();await page.keyboard.press('Space');await page.waitForTimeout(350);equal('collapse keyboard closes',await page.locator('.processing-summary').getAttribute('aria-expanded'),'false');
  await page.getByRole('button',{name:'选择模型和推理强度'}).click();await page.waitForTimeout(350);measurements.popover=await read('.model-effort-popover');near('model.width',measurements.popover.rect.width,254);equal('model.radius',measurements.popover.borderRadius,'20px');near('effort.height',measurements.popover.rect.height,98);measurements.track=await read('.effort-track-shell');near('track.width',measurements.track.rect.width,230);near('track.height',measurements.track.rect.height,24);equal('track.radius',measurements.track.borderRadius,'12px');equal('track.background',measurements.track.backgroundColor,'color(srgb 0.101961 0.109804 0.121569 / 0.1)');await page.screenshot({path:path.join(output,'model-effort-light.png')});
  await page.getByRole('slider',{name:'分析投入',exact:true}).focus();await page.keyboard.press('End');equal('three real effort levels',await page.getByRole('slider').inputValue(),'2');await page.getByRole('button',{name:'打开模型选择'}).click();near('modelList.height',(await read('.model-effort-popover')).rect.height,314);await page.screenshot({path:path.join(output,'model-list-light.png')});await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'模型与推理设置'}).waitFor({state:'hidden'});
  await page.keyboard.press('Control+,');await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();await page.waitForTimeout(350);
  measurements.settings=await read('.settings-window');measurements.nav=await read('.settings-sidebar nav button');measurements.settingsTitle=await read('.settings-pane h2');measurements.settingsSearch=await read('.settings-search input');
  near('settings.x',measurements.settings.rect.x,52);near('settings.y',measurements.settings.rect.y,36);near('settings.width',measurements.settings.rect.width,1244);near('settings.height',measurements.settings.rect.height,914);near('nav.width',measurements.nav.rect.width,262);near('nav.height',measurements.nav.rect.height,30);near('nav.x',measurements.nav.rect.x,60);near('nav.y',measurements.nav.rect.y,163);near('search.x',measurements.settingsSearch.rect.x,94.078125);near('search.y',measurements.settingsSearch.rect.y,95);near('search.width',measurements.settingsSearch.rect.width,218.921875);near('search.height',measurements.settingsSearch.rect.height,18);equal('nav.font',measurements.nav.fontSize,'13px');equal('nav.line',measurements.nav.lineHeight,'18.57px');equal('nav.weight',measurements.nav.fontWeight,'400');equal('nav.radius',measurements.nav.borderRadius,'12.5px');equal('nav.selected',measurements.nav.backgroundColor,'rgba(26, 28, 31, 0.055)');near('pageTitle.x',measurements.settingsTitle.rect.x,448);near('pageTitle.y',measurements.settingsTitle.rect.y,78);equal('pageTitle.font',measurements.settingsTitle.fontSize,'28px');equal('pageTitle.line',measurements.settingsTitle.lineHeight,'33.6px');near('settings.content.width',(await read('.settings-pane')).rect.width,732);
  await page.screenshot({path:path.join(output,'settings-light.png')});
  await page.getByRole('button',{name:'Skills',exact:true}).click();await page.getByRole('switch').waitFor();
  for(const [key,selector] of Object.entries({rowTitle:'.settings-skill-list strong',rowDescription:'.settings-skill-list small',switch:'.settings-skill-list i'}))measurements[key]=await read(selector);
  equal('row.title.font',measurements.rowTitle.fontSize,'13px');equal('row.title.line',measurements.rowTitle.lineHeight,'18.57px');equal('row.title.weight',measurements.rowTitle.fontWeight,'500');equal('row.description.font',measurements.rowDescription.fontSize,'12px');equal('row.description.line',measurements.rowDescription.lineHeight,'16px');equal('row.description.weight',measurements.rowDescription.fontWeight,'430');near('switch.width',measurements.switch.rect.width,32);near('switch.height',measurements.switch.rect.height,20);near('description.offset',measurements.rowDescription.rect.y-measurements.rowTitle.rect.y,21);
  await page.locator('.settings-skill-list i').evaluate(e=>{window.switchMotion=[];e.addEventListener('transitionend',event=>window.switchMotion.push({property:event.propertyName,pseudo:event.pseudoElement,time:event.elapsedTime}));});
  await page.getByRole('switch').click();await page.waitForTimeout(350);equal('switch real update',skill.enabled,true);equal('switch on color',(await read('.settings-skill-list i')).backgroundColor,'rgb(58, 131, 247)');
  motion.switchEvents=await page.evaluate(()=>window.switchMotion);
  motion.switch=await page.locator('.settings-skill-list i').evaluate(e=>({transform:getComputedStyle(e,'::after').transform,transition:getComputedStyle(e,'::after').transition}));
  await page.getByRole('button',{name:'常规',exact:true}).click();await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('neutral-dark');await page.waitForTimeout(250);equal('dark navigation text',(await read('.settings-sidebar nav button')).color,'rgb(236, 236, 236)');await page.screenshot({path:path.join(output,'settings-dark.png')});
  equal('neutral dark surface',(await read('.settings-content')).backgroundColor,'rgb(33, 33, 33)');
  await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('dialog',{name:'设置',exact:true}).waitFor({state:'hidden'});
  await page.screenshot({path:path.join(output,'conversation-dark.png')});
  await page.getByRole('button',{name:'选择模型和推理强度'}).click();await page.waitForTimeout(250);await page.getByRole('button',{name:'打开模型选择'}).click();await page.waitForTimeout(250);measurements.darkModelList=await read('.model-choice-list');equal('dark model list not hardcoded white',measurements.darkModelList.backgroundColor,'rgba(0, 0, 0, 0)');equal('dark model row text',(await read('.model-choice-list button')).color,'rgb(236, 236, 236)');await page.screenshot({path:path.join(output,'model-list-dark.png')});await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'模型与推理设置'}).waitFor({state:'hidden'});

  await page.keyboard.press('Control+k');await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'command-dark.png')});await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'收起侧栏'}).click();
  await page.screenshot({path:path.join(output,'narrow-dark.png')});equal('narrow has no document overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  equal('no page or route errors',JSON.stringify(errors),'[]');
} finally {
  fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify({measurements,checks,motion,writes,errors,consoleErrors,limitations:['Synthetic API fixtures only; no real user data or live model requests.','Tool result card uses Shell visual treatment; runtime supplies no raw Shell output.','Reference dark replica contains hardcoded light panels; dark uses runtime semantic colors.']},null,2));
  await browser.close();
}
const failed=checks.filter(check=>!check.pass);console.log(JSON.stringify({passed:checks.length-failed.length,failed},null,2));assert.equal(failed.length,0);
