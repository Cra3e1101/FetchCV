// Shared production-renderer fixture. Every API request is synthetic.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

const root=path.resolve(import.meta.dirname,'..');
export const createKnowledgeFixture=()=>{
  const source=(id,title,extra={})=>({id,title,company:'星云科技',business_unit:'企业服务',role:'产品经理',platform:'nowcoder',published_at:'2026-10-20T08:00:00Z',source_url:`https://example.invalid/interview/${id}`,status:'analyzed',summary:'需求判断与项目复盘。',extracted_questions:[],raw_text:'保存的合成正文。',metadata_json:{coverage_scope:'same_business_role'},...extra});
  return {
    sources:[
      source('s1','需求优先级二面记录',{raw_text:'面试官问：如何确定需求优先级？\n我通过紫杉指标解释用户影响和实施成本。',extracted_questions:[{question:'如何确定需求优先级？',evidence_quote:'面试官问：如何确定需求优先级？'}],review_content_hash:'synthetic-hash'}),
      source('s2','图片面经待核对',{platform:'zhihu',status:'ocr_pending',summary:'图片识别结果尚待核对。',metadata_json:{ocr_text:'待核对的合成图片文本',ocr_status:'completed',image_count:2}}),
      source('s3','数据平台交叉引用来源',{business_unit:'数据平台',role:'数据产品经理'}),
      source('s4','合成公司产品实习面试',{company:'合成公司',business_unit:'通用',role:'产品实习生'}),
      source('s5','独立保留的产品面经'),
      source('s6','非常长的面经标题用于验证窄屏详情中的中文换行与内容完整性'),
    ],
    briefs:[
      {id:'b-new',company:'星云科技',business_unit:'企业服务',role:'产品经理',summary:'最新简报：优先准备指标设计。',common_questions:[{question:'如何衡量知识库价值？',source_ids:['s1','missing']}],source_ids:['s1','s2','s3'],created_at:'2026-10-22T08:00:00Z'},
      {id:'b-old',company:'星云科技',business_unit:'企业服务',role:'产品经理',summary:'历史简报：补充项目复盘。',source_ids:['s1'],created_at:'2026-10-10T08:00:00Z'},
      {id:'b-data',company:'星云科技',business_unit:'数据平台',role:'数据产品经理',summary:'数据岗位简报。',source_ids:['s1','s3'],created_at:'2026-10-21T08:00:00Z'},
      {id:'b-other',company:'合成公司',business_unit:'通用',role:'产品实习生',summary:'实习岗位简报。',source_ids:['s4'],created_at:'2026-10-20T08:00:00Z'},
    ],
  };
};

export async function createKnowledgeHarness({report,evidence,video=false}={}){
  const dist=path.join(root,'dist');
  const server=http.createServer(async(req,res)=>{
    const file=path.resolve(dist,decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html');
    if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
    try{const content=await fs.readFile(file);res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff':'font/woff','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream'});res.end(content);}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const candidate={id:'c1',name:'图谱测试用户',title:'产品经理',resume_count:0,material_count:0};
  async function open({width=1360,height=960,theme='white',sourceCount=0,reducedMotion='no-preference',recordVideo=video,disableWorker=false,emptyInitially=false}={}){
    const context=await browser.newContext({viewport:{width,height},reducedMotion,serviceWorkers:'block',...(recordVideo?{recordVideo:{dir:path.join(evidence,'video'),size:{width:1360,height:960}}}:{})});
    const page=await context.newPage();
    page.on('pageerror',error=>report?.errors.push(error.message));
    const state={...createKnowledgeFixture(),mutations:[],searches:[],unhandled:[],failSearch:true};
    if(sourceCount){
      state.sources=Array.from({length:sourceCount},(_,index)=>({...state.sources[0],id:`large-${index}`,title:`分页来源 ${String(index+1).padStart(2,'0')}`,source_url:`https://example.invalid/interview/large-${index}`,published_at:new Date(Date.UTC(2026,9,25)-index*86400000).toISOString()}));
      state.briefs=[{...state.briefs[0],id:'b-large',source_ids:state.sources.map(source=>source.id)}];
    }
    if(emptyInitially){state.fullData={sources:state.sources,briefs:state.briefs};state.sources=[];state.briefs=[];}
    await page.route('**/*',async route=>{
      const request=route.request(),target=new URL(request.url());
      if(target.origin===origin)return route.continue();
      if(target.origin!=='http://127.0.0.1:8766')return route.abort();
      const pathname=target.pathname;let data;
      if(pathname==='/api/workspace')data={candidates:[candidate],jobs:[]};
      else if(pathname==='/api/candidates/c1/library')data={candidate,resumes:[],experiences:[],materials:[],facts:[]};
      else if(pathname==='/api/conversations')data=[];
      else if(pathname==='/api/runtime/status')data={configured:true,model:'synthetic-model'};
      else if(pathname==='/api/settings/general')data={theme:'system',accent:'coral',density:'comfortable'};
      else if(pathname==='/api/settings/permissions')data={web_access:'allow',workspace_read:'allow',workspace_write:'ask',file_delete:'ask',browser_bridge:'allow'};
      else if(pathname==='/api/interview-knowledge'){
        const q=target.searchParams.get('q')||'';state.searches.push(q);
        if(q==='触发错误'&&state.failSearch){state.failSearch=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'合成搜索错误'})});}
        if(q==='慢结果')await new Promise(resolve=>setTimeout(resolve,850));
        if(!q)data={sources:state.sources,briefs:state.briefs};
        else if(q==='紫杉指标'||q==='慢结果')data={sources:state.sources.filter(source=>source.id==='s1'),briefs:[]};
        else if(q==='最新结果')data={sources:state.sources.filter(source=>source.id==='s2'),briefs:[]};
        else if(q==='历史简报')data={sources:[],briefs:state.briefs.filter(brief=>brief.id==='b-old')};
        else if(q==='分页正文')data={sources:state.sources.filter(source=>source.id==='large-31'),briefs:[]};
        else data={sources:[],briefs:[]};
      }else if(pathname.startsWith('/api/interview-sources/')){
        const id=pathname.split('/').at(-1);
        if(request.method()==='DELETE'){state.mutations.push(pathname);state.sources=state.sources.filter(source=>source.id!==id);data={deleted:true};}
        else{const source=state.sources.find(source=>source.id===id);data=source?{...source,review_content_hash:`synthetic-${id}`}:{detail:'not found'};}
      }else if(pathname.startsWith('/api/interview-briefs/')&&request.method()==='DELETE'){
        const id=pathname.split('/').at(-1);state.mutations.push(pathname);state.briefs=state.briefs.filter(brief=>brief.id!==id);data={deleted:true};
      }else{const unhandled=`${request.method()} ${pathname}`;state.unhandled.push(unhandled);report?.unhandledRequests.push({width,theme,unhandled});return route.fulfill({status:404,contentType:'application/json',body:'{}'});}
      try{return await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});}catch(error){if(!/closed|disposed|cancel/i.test(error.message))throw error;}
    });
    await page.addInitScript(({theme,disableWorker})=>{
      localStorage.setItem('fetchcv.interface-theme',theme);window.fixtureCalls=[];window.fixtureWorkerEvents=[];
      const NativeWorker=window.Worker;
      window.Worker=class extends NativeWorker{
        constructor(...args){if(disableWorker)throw Error('Synthetic fixture disables Worker');super(...args);this.fixtureId=window.fixtureWorkerEvents.length;window.fixtureWorkerEvents.push({kind:'create',id:this.fixtureId,url:String(args[0])});this.addEventListener('message',event=>window.fixtureWorkerEvents.push({kind:'message',id:this.fixtureId,type:event.data?.type}));}
        terminate(){window.fixtureWorkerEvents.push({kind:'terminate',id:this.fixtureId});return super.terminate();}
      };
      window.appRuntime={apiBase:'http://127.0.0.1:8766',getBackendStatus:async()=>({state:'ready',dataReady:true,agentReady:true}),openInterviewSource:async source=>{window.fixtureCalls.push({kind:'original',...source});return{opened:true};}};
    },{theme,disableWorker});
    await page.goto(origin);await page.getByRole('heading',{name:'想聊些什么？'}).waitFor();
    if(width<760){const collapse=page.getByRole('button',{name:'收起侧栏',exact:true});if(await collapse.isVisible())await collapse.click();}
    await page.getByRole('button',{name:'面试知识',exact:true}).click();await page.locator(emptyInitially?'.ik-empty-card':'.ik-node-company').first().waitFor();
    return {page,context,state};
  }
  return {open,origin,browser,close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));}};
}
