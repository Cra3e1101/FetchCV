// Real settings components with in-memory APIs and a fresh browser profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const run = `settings-presentation-${Date.now()}`;
const output = path.join(root, '.m1-work', run), evidence = path.join(root, '.m1-evidence', run);
await fs.mkdir(output, {recursive: true}); await fs.mkdir(evidence, {recursive: true});
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import './src/styles.css'; import './src/ui/workspace.css'; import './src/ui/replica-alignment.css'; import './src/ui/replica-components.css'; import './src/ui/agent-motion.css';
import {ModelSettingsDialog} from './src/components/ModelSettingsDialog';
import {api} from './src/lib/api'; import {applyInterfaceTheme} from './src/ui/interface-theme';
applyInterfaceTheme();
const calls = []; window.settingsFixture = {calls};
let skills = [
 {id:'research',name:'interview-research',enabled:true,content_hash:'synthetic-hash',path:'fixture/skills/interview-research',description:'搜索岗位与公司资料，整理可核实的证据和面试准备材料；保留资料来源，避免把推测当作事实。'},
 {id:'resume',name:'resume-review',enabled:false,content_hash:'changed-hash',description:'检查简历中的事实、表达与岗位匹配。',metadata_json:{change_reason:'内容已变化，请重新确认后启用。'}},
];
let servers = [{id:'demo',name:'workspace_tools',status:'ready',enabled:true,approved:true,allowed_tools:['read_note'],tool_policies:{},discovered_tools:[
 {name:'read_note',read_only:true,description:'读取工作区内指定资料的正文与来源信息。'},
 {name:'update_resume',read_only:false,input_schema:{properties:{resume_id:{type:'string'}}}},
]}];
let permissions = {web_access:'allow',workspace_read:'allow',workspace_write:'ask',file_delete:'ask',browser_bridge:'allow'};
let general = {accent:'coral',density:'comfortable',theme:'light'};
Object.assign(api, {
 skills:async()=>skills, reloadSkills:async()=>skills, mcpServers:async()=>servers,
 permissionSettings:async()=>permissions, generalSettings:async()=>general,
 updateSkill:async(id,enabled,hash)=>{calls.push({action:'skill',id,enabled,hash});skills=skills.map(s=>s.id===id?{...s,enabled}:s);return skills.find(s=>s.id===id);},
 updatePermissionSettings:async patch=>{calls.push({action:'permissions',patch});permissions={...permissions,...patch};return permissions;},
 updateGeneralSettings:async patch=>{calls.push({action:'general',patch});general={...general,...patch};return general;},
 createMcpServer:async config=>{calls.push({action:'mcp-create',config});const server={...config,id:'new',status:'saved',enabled:false,approved:false};servers=[...servers,server];return server;},
 updateMcpServer:async(id,patch)=>{calls.push({action:'mcp-update',id,patch});servers=servers.map(s=>s.id===id?{...s,...patch}:s);return servers.find(s=>s.id===id);},
});
window.appRuntime = {listModelProviders:async()=>({activeId:'saved',profiles:[{id:'saved',providerName:'现有连接',protocol:'openai',baseUrl:'https://example.invalid/v1',model:'synthetic-model',hasApiKey:true,health:'unknown'}]})};
createRoot(document.getElementById('root')).render(<div className="source-grid"><ModelSettingsDialog open initialSection={new URLSearchParams(location.search).get("section") || "general"} user={{name:'合成用户'}} runtime={{configured:true}} stats={{jobs:4,resumes:3,materials:8}} onClose={()=>{}} onSaved={()=>{}}/></div>);
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
const report={checks:[],errors:[],screenshots:[]}; let page;
try {
  page=await browser.newPage({viewport:{width:1360,height:960}});
  page.on('pageerror',error=>report.errors.push(error.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
  const check=(name,value)=>{report.checks.push({name,pass:value});assert.ok(value,name);};
  const navigate=async name=>{await page.locator('.settings-sidebar').getByRole('button',{name,exact:true}).click();await page.locator('.settings-content').evaluate(el=>{el.scrollTop=0;});};
  const shot=async name=>{await page.waitForTimeout(250);await page.screenshot({path:path.join(evidence,name)});report.screenshots.push(name);};
  const noOverflow=()=>page.locator('.settings-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth);
  const themePicker=()=>page.getByRole('group',{name:'主题',exact:true});
  const densityPicker=()=>page.getByRole('group',{name:'界面密度',exact:true});
  const themes=[['white','简约白'],['neutral-dark','简约深色'],['light','暖色浅色'],['dark','暖色深色']];
  const activeLabel=group=>group.locator('button[aria-pressed="true"]').getAttribute('aria-label');
  const previewLabelsVisible=group=>group.locator('.segmented-control-label').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0));
  for(const section of ['skills','mcp','mcp-add']){
    await page.goto(url+'/?section='+section);
    await page.locator(section==='skills'?'#settings-skills-title':'#settings-mcp-title').waitFor();
    check('composer shortcut opens '+section+' directly',await page.locator('.settings-sidebar [aria-current="page"]').innerText()===(section==='skills'?'Skills':'MCP Servers'));
    if(section==='mcp-add'){
      await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='MCP 名称');
      check('add connector focuses the actual MCP configuration form',await page.getByRole('textbox',{name:'MCP 名称',exact:true}).evaluate(node=>node===document.activeElement));
    }
  }
  for(const width of [1360,600]) for(const theme of ['white','neutral-dark']){
    const prefix=`${width}-${theme}`;
    await page.setViewportSize({width,height:960});await page.goto(url);
    await page.getByRole('heading',{name:'常规',exact:true}).waitFor();
    await themePicker().getByRole('button',{name:themes.find(([value])=>value===theme)[1],exact:true}).click();
    check(`${prefix}: theme and density expose their own preview options`,await themePicker().locator('.segmented-control-preview').count()===4&&await densityPicker().locator('.segmented-control-preview').count()===2);
    check(`${prefix}: preview labels remain visible`,await previewLabelsVisible(themePicker())&&await previewLabelsVisible(densityPicker()));
    check(`${prefix}: theme and density each own one selection block`,await themePicker().locator('.segmented-control-indicator').count()===1&&await densityPicker().locator('.segmented-control-indicator').count()===1);
    check(`${prefix}: appearance controls have no horizontal overflow`,await noOverflow());
    await shot(`general-${prefix}.png`);
    if(width===1360&&theme==='white'){
      await page.locator('.settings-group').filter({has:page.getByRole('heading',{name:'外观',exact:true})}).screenshot({path:path.join(evidence,'appearance-preview.png')});report.screenshots.push('appearance-preview.png');
      const densityBefore=await activeLabel(densityPicker());
      await themePicker().getByRole('button',{name:'暖色深色',exact:true}).click();
      for(const [value,label] of themes){
        await themePicker().getByRole('button',{name:label,exact:true}).click();
        check(`theme ${value}: applies immediately and persists`,await page.evaluate(value=>document.documentElement.dataset.interfaceTheme===value&&localStorage.getItem('fetchcv.interface-theme')===value,value)&&await activeLabel(themePicker())===label);
      }
      check('theme changes do not change density or call its API',await activeLabel(densityPicker())===densityBefore&&await page.evaluate(()=>!window.settingsFixture.calls.some(c=>c.action==='general')));
      await page.reload();
      await themePicker().waitFor();
      check('theme selection restores after reload',await activeLabel(themePicker())==='暖色深色'&&await page.locator('html').getAttribute('data-interface-theme')==='dark');
      await themePicker().getByRole('button',{name:'简约白',exact:true}).click();
    }
    await densityPicker().getByRole('button',{name:'紧凑',exact:true}).click();
    check(`${prefix}: density changes still save`,await page.evaluate(()=>window.settingsFixture.calls.some(c=>c.action==='general'&&c.patch.density==='compact')));
    check(`${prefix}: density applies immediately without moving theme selection`,await page.locator('html').getAttribute('data-density')==='compact'&&await activeLabel(themePicker())===themes.find(([value])=>value===theme)[1]);
    await navigate('模型 API');
    check(`${prefix}: existing connection opens without exposing saved credentials`,await page.getByLabel('API Key',{exact:true}).getAttribute('placeholder')==='已安全保存；留空继续使用');
    await page.getByRole('button',{name:'新连接',exact:true}).click();
    await page.locator('[data-preset-id="gemini"]').click();
    check(`${prefix}: presets remain compact single-line controls`,await page.locator('.provider-presets > button').evaluateAll(nodes=>nodes.length>=14&&nodes.every(el=>el.getBoundingClientRect().height<=44)));
    const help=page.locator('.provider-preset-detail details');
    check(`${prefix}: compatibility scope remains visible`,(await help.locator('summary').innerText()).includes('OpenAI'));
    check(`${prefix}: full guidance is collapsed initially`,await help.getAttribute('open')===null);
    await help.locator('summary').click();
    check(`${prefix}: full guidance and documentation remain accessible`,await help.locator('p').isVisible() && (await page.getByRole('link',{name:'接入文档'}).getAttribute('href')).startsWith('https://'));
    await help.locator('summary').click();
    check(`${prefix}: settings content has no horizontal overflow`,await noOverflow());
    await shot(`models-${prefix}.png`);
    await page.getByLabel('Base URL',{exact:true}).fill('not-a-url');
    check(`${prefix}: invalid endpoint error stays visible`,await page.getByRole('alert').filter({hasText:'请输入有效地址'}).isVisible());
    await page.getByLabel('Base URL',{exact:true}).fill('https://example.invalid/v1');
    await page.getByRole('button',{name:'高级选项',exact:true}).click();
    check(`${prefix}: actual endpoint is available under advanced options`,(await page.locator('.provider-endpoint').innerText()).includes('https://example.invalid/v1/chat/completions'));
    await page.getByRole('button',{name:'配置 JSON',exact:true}).click();
    check(`${prefix}: JSON remains accessible`,await page.getByRole('textbox',{name:'配置 JSON',exact:true}).isVisible());
    await navigate('Skills');await shot(`skills-${prefix}.png`);
    const skill=page.getByRole('switch').first();await skill.click();
    check(`${prefix}: skills retain version-aware enabling logic`,await page.evaluate(()=>window.settingsFixture.calls.some(c=>c.action==='skill'&&c.hash==='synthetic-hash'&&c.enabled===false)));
    check(`${prefix}: capability descriptions retain full tooltips`,await skill.locator('small').getAttribute('title')===await skill.locator('small').textContent());
    check(`${prefix}: changed-skill reason is readable`,await page.locator('.skill-change-reason').evaluate(el=>getComputedStyle(el).whiteSpace==='normal' && el.scrollHeight<=el.clientHeight+1));
    await navigate('MCP Servers');await shot(`mcp-${prefix}.png`);
    check(`${prefix}: MCP permission controls remain visible`,await page.getByText('写入工具默认关闭',{exact:true}).isVisible() && await page.getByLabel('update_resume 目标参数').inputValue()==='resume_id');
    check(`${prefix}: MCP content has no horizontal overflow`,await noOverflow());
    await page.getByLabel('MCP 名称',{exact:true}).fill('local_tools');
    await page.getByLabel('MCP 可执行文件',{exact:true}).fill('C:/synthetic/tools.exe');
    await page.getByLabel('MCP 参数 1',{exact:true}).fill('--stdio');
    await page.getByRole('button',{name:'添加参数',exact:true}).click();
    await page.getByLabel('MCP 参数 2',{exact:true}).fill('--debug');
    await page.getByRole('button',{name:'删除 MCP 参数 2',exact:true}).click();
    await page.getByLabel('MCP 环境变量 1',{exact:true}).fill('SYNTHETIC_TOKEN');
    await page.getByRole('button',{name:'添加 Server',exact:true}).click();
    const created=await page.evaluate(()=>window.settingsFixture.calls.find(c=>c.action==='mcp-create')?.config);
    check(`${prefix}: MCP editor preserves argument and environment-name handling`,created?.args.length===1&&created.args[0]==='--stdio'&&created.env_keys[0]==='SYNTHETIC_TOKEN');
    await page.getByRole('button',{name:'流式 HTTP',exact:true}).click();
    check(`${prefix}: transport switch exposes URL and hides local-only controls`,await page.getByLabel('MCP 服务器 URL',{exact:true}).isVisible() && await page.getByLabel('MCP 可执行文件',{exact:true}).count()===0);
    await navigate('权限与浏览器');await shot(`permissions-${prefix}.png`);
    check(`${prefix}: permission labels retain space beside selectors`,await page.locator('.settings-capabilities label').evaluateAll(nodes=>nodes.every(el=>el.getBoundingClientRect().width>150)));
    await page.getByLabel('网页访问权限',{exact:true}).selectOption('ask');
    check(`${prefix}: permission changes still save`,await page.evaluate(()=>window.settingsFixture.calls.some(c=>c.action==='permissions'&&c.patch.web_access==='ask')));
  }
  await page.setViewportSize({width:390,height:900});await page.goto(url);
  await page.getByRole('heading',{name:'常规',exact:true}).waitFor();
  await themePicker().getByRole('button',{name:'简约白',exact:true}).click();
  check('narrow appearance preview remains within the screen',await noOverflow());
  check('narrow preview controls retain every option label',await previewLabelsVisible(themePicker())&&await previewLabelsVisible(densityPicker()));
  await shot('general-390-white.png');
  await densityPicker().getByRole('button',{name:'舒适',exact:true}).focus();
  await page.keyboard.press('End');
  check('density keyboard selection saves through the existing API',await activeLabel(densityPicker())==='紧凑'&&await page.evaluate(()=>window.settingsFixture.calls.some(c=>c.action==='general'&&c.patch.density==='compact')));
  await themePicker().getByRole('button',{name:'简约白',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  check('theme keyboard selection remains independent of density',await activeLabel(themePicker())==='简约深色'&&await activeLabel(densityPicker())==='紧凑');
  await page.emulateMedia({reducedMotion:'reduce'});
  check('appearance selection blocks respect reduced motion',await page.locator('.segmented-control[data-variant="preview"] .segmented-control-indicator').evaluateAll(nodes=>nodes.length===2&&nodes.every(node=>getComputedStyle(node).transitionDuration.split(',').every(value=>parseFloat(value)===0))));
  check('no browser errors',report.errors.length===0);report.pass=true;
} catch(error){report.pass=false;report.error=error.stack;if(page)await page.screenshot({path:path.join(evidence,'failure.png')});throw error;}
finally{await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,evidence}));await browser.close();await new Promise(resolve=>server.close(resolve));}
