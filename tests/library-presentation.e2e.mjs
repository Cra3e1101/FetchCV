// Production UI, synthetic API responses and fresh browser contexts only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

const root=path.resolve(import.meta.dirname,'..'), dist=path.join(root,'dist');
const evidence=path.join(root,'.m1-evidence',`library-presentation-${Date.now()}`);
await fs.mkdir(evidence,{recursive:true});
const candidate={id:'c1',name:'陈知远',title:'产品经理',phone:'13800000000',email:'synthetic@example.invalid',resume_count:1,material_count:2};
const experiences=[
  {id:'e1',kind:'experience',organization:'星云科技',title:'产品实习经历',role:'产品实习生',start_date:'2025.06',end_date:'2025.12',fact_ids:['f1'],details_json:{bullets:['梳理客服反馈，建立问题分类与需求追踪流程。','参与知识库产品原型与交互设计。','整理访谈纪要和可复查的需求来源。','协助团队对版本改动进行验收。']},tags:['用户研究','需求分析']},
  {id:'e2',kind:'project',organization:'校园服务平台',title:'校园服务平台',role:'项目负责人',start_date:'2024.03',end_date:'2025.04',details_json:{bullets:['设计活动报名与通知流程，完成原型及可用性验证。']},fact_ids:[]},
];
const materials=[{id:'m1',kind:'resume_pdf',name:'陈知远_基础简历.pdf',status:'ready',metadata_json:{page_count:2}},
  {id:'m2',kind:'portfolio',name:'知识库产品设计与用户研究作品集_2026.pdf',status:'ready',metadata_json:{page_count:18},source_url:'https://example.invalid/portfolio'}];
const makeSources=()=>[
  {id:'s1',title:'星云科技 · 产品经理二面记录',company:'星云科技',role:'产品经理',platform:'nowcoder',published_at:'2026-10-20T08:00:00Z',source_url:'https://example.invalid/interview/1',status:'analyzed',summary:'围绕需求优先级、指标设计与跨团队协作展开。',extracted_questions:[{question:'如何确定需求优先级？',evidence_quote:'面试官问：如何确定需求优先级？'}],raw_text:'面试官问：如何确定需求优先级？\n我结合用户影响与实施成本说明了取舍过程。',review_content_hash:'synthetic-hash',metadata_json:{coverage_scope:'same_business_role'}},
  {id:'s2',title:'产品实习面试记录：从用户反馈到需求方案的完整讨论',company:'合成公司',role:'产品实习生',platform:'zhihu',published_at:'2026-09-12T08:00:00Z',source_url:'https://example.invalid/interview/2',status:'ocr_pending',summary:'图片识别结果尚待核对。',extracted_questions:[],raw_text:'合成资料正文。',metadata_json:{ocr_text:'待核对的合成图片文本',ocr_status:'completed',image_count:2}},
];
const server=http.createServer(async(req,res)=>{
  const file=path.resolve(dist,decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html');
  if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  try{const content=await fs.readFile(file);res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff':'font/woff','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream'});res.end(content);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
const report={checks:[],errors:[],screenshots:[]};let page;
try{
  const check=(name,value)=>{report.checks.push({name,pass:value});assert.ok(value,name);};
  const url=`http://127.0.0.1:${server.address().port}`;
  for(const width of [1360,600])for(const theme of ['white','neutral-dark']){
    const context=await browser.newContext({viewport:{width,height:960}});
    page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    const prefix=`${width}-${theme}`, mutations=[];
    let sources=makeSources(), briefs=[{id:'b1',company:'星云科技',business_unit:'企业服务',role:'产品经理',summary:'重点准备需求取舍、知识库产品指标及项目复盘。',source_ids:['s1']}];
    let emptyLibrary=false;
    await page.route('**/*',async route=>{
      const request=route.request(), target=new URL(request.url());
      if(target.origin===url)return route.continue();
      if(target.origin!=='http://127.0.0.1:8766')return route.abort();
      const pathname=target.pathname;let data;
      if(request.method()==='DELETE')mutations.push(pathname);
      if(pathname==='/api/workspace')data={candidates:[candidate],jobs:[]};
      else if(pathname==='/api/conversations')data=[];
      else if(pathname==='/api/runtime/status')data={configured:true,model:'synthetic-model'};
      else if(pathname==='/api/candidates/c1/library')data={candidate,resumes:[],experiences:emptyLibrary?[]:experiences,materials:emptyLibrary?[]:materials,facts:[{id:'f1',verified:true}]};
      else if(pathname==='/api/settings/general')data={theme:'system',accent:'coral',density:'comfortable'};
      else if(pathname==='/api/settings/permissions')data={web_access:'allow',workspace_read:'allow',workspace_write:'ask',file_delete:'ask',browser_bridge:'allow'};
      else if(pathname==='/api/interview-knowledge'){
        const q=target.searchParams.get('q')||'';
        data={sources:sources.filter(s=>JSON.stringify(s).includes(q)),briefs:briefs.filter(b=>JSON.stringify(b).includes(q))};
      } else if(pathname.startsWith('/api/interview-sources/')){
        const id=pathname.split('/').at(-1);
        if(request.method()==='DELETE'){sources=sources.filter(s=>s.id!==id);data={deleted:true};}else data=sources.find(s=>s.id===id);
      } else if(pathname==='/api/interview-briefs/b1'&&request.method()==='DELETE'){briefs=[];data={deleted:true};}
      else return route.fulfill({status:404,contentType:'application/json',body:'{}'});
      return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.addInitScript(theme=>{
      localStorage.setItem('fetchcv.interface-theme',theme);
      window.fixtureCalls=[];
      window.appRuntime={apiBase:'http://127.0.0.1:8766',getBackendStatus:async()=>({state:'ready',dataReady:true,agentReady:true}),
        openInterviewSource:async source=>{window.fixtureCalls.push({kind:'original',...source});return{opened:true};},
        importWorkspaceFiles:async()=>{window.fixtureCalls.push({kind:'files'});return[];},
        selectResumePdf:async()=>{window.fixtureCalls.push({kind:'pdf'});return null;},
      };
    },theme);
    const shot=async name=>{await page.waitForTimeout(300);await page.screenshot({path:path.join(evidence,`${name}-${prefix}.png`)});report.screenshots.push(`${name}-${prefix}.png`);};
    const noOverflow=()=>page.locator('.library-pane').evaluate(el=>el.scrollWidth<=el.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth);
    await page.goto(url);await page.getByRole('heading',{name:'想聊些什么？'}).waitFor();
    if(width<760)await page.getByRole('button',{name:'收起侧栏',exact:true}).click();
    await page.getByRole('button',{name:'我的资料',exact:true}).click();
    await page.getByRole('heading',{name:'个人资料库',exact:true}).waitFor();
    check(`${prefix}: one page title and one candidate heading`,await page.getByRole('heading',{name:'个人资料库',exact:true}).count()===1&&await page.getByRole('heading',{name:candidate.name,exact:true}).count()===1);
    check(`${prefix}: contact details remain available`,await page.getByText(/synthetic@example.invalid/).isVisible());
    check(`${prefix}: material metadata stays concise`,!(await page.locator('.material-grid').innerText()).includes('可用'));
    check(`${prefix}: library has no horizontal overflow`,await noOverflow());await shot('library');
    await page.getByRole('button',{name:'查看 星云科技 经历',exact:true}).click();
    const experience=page.getByRole('dialog',{name:'星云科技',exact:true});await experience.waitFor();
    check(`${prefix}: experience surface follows the selected theme`,await experience.evaluate(el=>getComputedStyle(el).backgroundColor===getComputedStyle(document.querySelector('.library-pane')).backgroundColor));
    check(`${prefix}: detail retains every experience bullet`,await experience.getByText('协助团队对版本改动进行验收。',{exact:true}).isVisible());await shot('experience');
    await page.keyboard.press('Escape');await experience.waitFor({state:'hidden'});
    await page.locator('.library-header-actions').getByRole('button',{name:'添加资料',exact:true}).click();
    check(`${prefix}: add-material action still invokes picker`,await page.evaluate(()=>window.fixtureCalls.some(c=>c.kind==='files')));
    await page.getByRole('button',{name:'导入简历',exact:true}).click();
    const importer=page.getByRole('dialog',{name:'导入基础简历',exact:true});await importer.waitFor();
    check(`${prefix}: import privacy and file constraints remain visible`,(await importer.innerText()).includes('最大 20MB')&&(await importer.innerText()).includes('不会上传 PDF'));
    await shot('import');await importer.getByRole('button',{name:/选择 PDF 简历/}).click();
    check(`${prefix}: import invokes PDF picker`,await page.evaluate(()=>window.fixtureCalls.some(c=>c.kind==='pdf')));await importer.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'面试知识',exact:true}).click();await page.locator('.ik-node-company').first().waitFor();
    check(`${prefix}: knowledge has one page heading and a graph`,await page.getByRole('heading',{name:'面试知识',exact:true}).count()===1&&await page.getByRole('group',{name:'面试知识图谱',exact:true}).isVisible());
    check(`${prefix}: knowledge has no horizontal overflow`,await page.locator('.ik-pane').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth));await shot('knowledge');
    emptyLibrary=true;await page.getByRole('button',{name:'我的资料',exact:true}).click();await page.getByText('还没有经历',{exact:true}).waitFor();
    check(`${prefix}: empty library gives a real action instead of migration status`,await page.locator('.library-zero').getByRole('button',{name:'导入简历',exact:true}).isVisible());await shot('empty-library');
    await context.close();page=null;
  }
  check('no renderer errors',report.errors.length===0);report.pass=true;
}catch(error){report.pass=false;report.error=error.stack;if(page)await page.screenshot({path:path.join(evidence,'failure.png')});throw error;}
finally{await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,evidence}));await browser.close();await new Promise(resolve=>server.close(resolve));}
