// Production renderer with synthetic API responses. Never touches the local database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createKnowledgeHarness} from './interview-knowledge-fixture.mjs';

const root=path.resolve(import.meta.dirname,'..');
const evidence=path.join(root,'.m1-evidence',`interview-knowledge-graph-${Date.now()}`);
await fs.mkdir(evidence,{recursive:true});
const report={checks:[],errors:[],unhandledRequests:[],screenshots:[]};
const harness=await createKnowledgeHarness({report,evidence});let page;
const check=(name,value)=>{report.checks.push({name,pass:!!value});assert.ok(value,name);};
const waitCount=async(selector,count)=>page.waitForFunction(({selector,count})=>document.querySelectorAll(selector).length===count,{selector,count});
const graphSignature=()=>page.locator('.ik-node').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')).sort());
const camera=()=>page.locator('.ik-graph > g').getAttribute('transform');
const cameraValues=value=>value.match(/translate\(([-.\de]+)\s+([-.\de]+)\) scale\(([-.\de]+)\)/).slice(1).map(Number);
const noOverflow=()=>page.locator('.ik-pane').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth);
const select=async locator=>{await locator.focus();await page.keyboard.press('Enter');};
const settleCamera=async()=>{let prior=await camera();for(let i=0;i<80;i++){await page.waitForTimeout(50);const next=await camera();if(next===prior)return next;prior=next;}throw Error('camera animation did not settle');};
const settleLabels=async()=>{const header=await page.locator('.ik-header').boundingBox();await page.mouse.move(header.x+10,header.y+8);await page.getByLabel('搜索面试知识库',{exact:true}).focus();await page.waitForTimeout(170);};
const shot=async name=>{await page.waitForTimeout(160);const file=`${name}.png`;await page.screenshot({path:path.join(evidence,file)});report.screenshots.push(file);};
async function openFixture(width,theme,large=false){const opened=await harness.open({width,theme,sourceCount:large?32:0});page=opened.page;await page.waitForFunction(()=>document.querySelector('.ik-graph')?.dataset.simulationActive==='false',{},{timeout:15000});await settleCamera();return opened;}
try{
  for(const width of [1360,900,600,390])for(const theme of ['white','neutral-dark']){
    const prefix=`${width}-${theme}`,{context,state}=await openFixture(width,theme);
    const graph=page.getByRole('group',{name:'面试知识图谱',exact:true}),detail=page.getByLabel('知识详情',{exact:true}),search=page.getByLabel('搜索面试知识库',{exact:true});
    await waitCount('.ik-node-role',3);await waitCount('.ik-node-source',6);
    check(`${prefix}: repeated briefs merge into three roles and shared sources stay unique`,await page.locator('.ik-node-company').count()===2&&await page.locator('.ik-node-source').count()===6);
    check(`${prefix}: graph draws only membership and recorded cross-role references`,await page.locator('.ik-edges :is(line,path)').count()===11);
    const graphColors=await page.locator('.ik-canvas').evaluate(canvas=>{const values=element=>getComputedStyle(element).fill.match(/[\d.]+/g).slice(0,3).map(Number);return {background:getComputedStyle(canvas).backgroundColor.match(/[\d.]+/g).slice(0,3).map(Number),node:values(canvas.querySelector('.ik-node-dot')),label:values(canvas.querySelector('.ik-node text'))};});
    check(`${prefix}: graph canvas and text follow the active interface theme`,theme==='white'?graphColors.background.every(value=>value>220)&&graphColors.node.every(value=>value<150)&&graphColors.label.every(value=>value<100):graphColors.background.every(value=>value<65)&&graphColors.node.every(value=>value>128)&&graphColors.label.every(value=>value>180));
    check(`${prefix}: graph fits without horizontal overflow`,await noOverflow());await shot(`base-${prefix}`);
    const signature=await graphSignature();
    const product=page.getByRole('button',{name:'岗位：产品经理',exact:true});
    await product.focus();await page.keyboard.press('Enter');await detail.waitFor();
    check(`${prefix}: keyboard selection opens the merged role`,await product.getAttribute('aria-pressed')==='true'&&(await detail.innerText()).includes('最新简报：优先准备指标设计。'));
    check(`${prefix}: question citations only resolve saved source IDs`,await detail.locator('.ik-question-sources button').count()===1&&await detail.locator('.ik-question-sources').getByText('需求优先级二面记录',{exact:true}).isVisible());
    if(width===1360&&theme==='white'){
      check('role selection preserves the complete global graph',JSON.stringify(await graphSignature())===JSON.stringify(signature));
      const version=detail.getByLabel('选择简报版本',{exact:true});await version.selectOption('b-old');
      check('merged roles retain selectable brief history',(await detail.innerText()).includes('历史简报：补充项目复盘。')&&await version.locator('option').count()===2);await version.selectOption('b-new');
    }
    check(`${prefix}: selected detail fits without horizontal overflow`,await noOverflow());await settleLabels();await shot(`role-${prefix}`);
    check(`${prefix}: detail selection retains every global graph node`,JSON.stringify(await graphSignature())===JSON.stringify(signature));
    check(`${prefix}: graph labels preserve the full saved titles`,await page.locator('.ik-node-source text').evaluateAll(labels=>labels.some(label=>label.textContent==='非常长的面经标题用于验证窄屏详情中的中文换行与内容完整性')));
    const sourceNode=page.getByRole('button',{name:'面经：需求优先级二面记录',exact:true});
    if(width===1360&&theme==='white'){
      await page.getByRole('button',{name:'适应图谱',exact:true}).click();await settleCamera();
      const dot=await sourceNode.locator('.ik-node-dot').boundingBox(),point={x:dot.x+dot.width/2,y:dot.y+dot.height/2};
      await page.mouse.click(point.x,point.y);
      check('clicking the rendered source dot selects the source',await sourceNode.getAttribute('aria-pressed')==='true');
    }else await select(sourceNode);
    await detail.getByText('需求优先级二面记录',{exact:true}).waitFor();
    check(`${prefix}: source selection retains company and role`,(await detail.innerText()).includes('星云科技')&&(await detail.innerText()).includes('产品经理'));
    check(`${prefix}: a shared source retains both real parent roles`,await detail.locator('.ik-role-list button').count()===2);
    if(width===1360&&theme==='white')check('source selection preserves all global relationships',await page.locator('.ik-node-source').count()===6&&await page.locator('.ik-node-role').count()===3&&await page.locator('.ik-edges :is(line,path)').count()===11);
    await shot(`source-${prefix}`);
    await detail.getByRole('button',{name:'查看本地备份',exact:true}).click();
    const reader=page.getByRole('dialog',{name:'面经原文：需求优先级二面记录',exact:true});await reader.locator('.interview-reader-raw').first().waitFor();
    check(`${prefix}: reader preserves body, evidence, scope and theme`,(await reader.innerText()).includes('实施成本')&&await reader.getByText('同事业部同岗',{exact:true}).isVisible()&&await reader.locator('.interview-evidence-review summary').isVisible()&&await reader.evaluate(el=>getComputedStyle(el).backgroundColor===getComputedStyle(document.querySelector('.library-pane')).backgroundColor));
    await shot(`reader-${prefix}`);await page.keyboard.press('Escape');await reader.waitFor({state:'hidden'});
    if(width===1360&&theme==='white'){
      await detail.getByRole('button',{name:'查看原帖',exact:true}).click();
      check('original source action retains the exact destination',await page.evaluate(()=>window.fixtureCalls.find(call=>call.kind==='original')?.url==='https://example.invalid/interview/s1'));
      await page.getByRole('button',{name:'适应图谱',exact:true}).click();const fitted=cameraValues(await settleCamera());
      await page.getByRole('button',{name:'放大图谱',exact:true}).click();await settleCamera();
      check('zoom control changes the camera scale',Math.abs(cameraValues(await camera())[2]-fitted[2])>.01);
      await page.getByRole('button',{name:'适应图谱',exact:true}).click();await settleCamera();
      check('fit control restores the graph scale',Math.abs(cameraValues(await camera())[2]-fitted[2])<.02);
      await select(product);
      check('node selection remains available after zoom and fit',await product.getAttribute('aria-pressed')==='true');
      await select(page.getByRole('button',{name:'面经：需求优先级二面记录',exact:true}));
      await graph.focus();const beforeKey=cameraValues(await camera());await page.keyboard.down('ArrowRight');await page.waitForTimeout(120);await page.keyboard.up('ArrowRight');await settleCamera();
      check('focused graph supports keyboard pan',Math.abs(cameraValues(await camera())[0]-beforeKey[0])>10);
      await page.keyboard.press('+');await settleCamera();await page.keyboard.press('0');await settleCamera();
      check('keyboard reset fits the graph',Math.abs(cameraValues(await camera())[2]-fitted[2])<.02);await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
      await search.fill('紫杉指标');const results=page.getByRole('region',{name:'面试知识搜索结果',exact:true});await results.locator('.ik-result-item').waitFor();
      check('FTS body-only hits preserve the complete base graph',state.searches.includes('紫杉指标')&&JSON.stringify(await graphSignature())===JSON.stringify(signature));
      await results.locator('.ik-result-item').click();await detail.getByText('需求优先级二面记录',{exact:true}).waitFor();
      check('a body-only hit selects its full source and associated role',await page.getByRole('button',{name:'面经：需求优先级二面记录',exact:true}).getAttribute('aria-pressed')==='true'&&(await detail.innerText()).includes('产品经理'));
      await shot('search-body-1360-white');await search.fill('历史简报');await results.locator('.ik-result-item').waitFor();await results.locator('.ik-result-item').click();
      check('brief search resolves to its existing merged role',await product.getAttribute('aria-pressed')==='true'&&await detail.getByLabel('选择简报版本',{exact:true}).locator('option').count()===2);
      await page.getByRole('button',{name:'关闭知识详情',exact:true}).click();
      await search.fill('不会匹配');await page.getByText('没有匹配的面试知识',{exact:true}).waitFor();
      check('an unmatched search keeps the full graph available',JSON.stringify(await graphSignature())===JSON.stringify(signature));await shot('search-empty-1360-white');
      const slow=page.waitForRequest(request=>new URL(request.url()).searchParams.get('q')==='慢结果');await search.fill('慢结果');await slow;
      await search.fill('最新结果');await results.locator('.ik-result-item').getByText('图片面经待核对',{exact:true}).waitFor();await page.waitForTimeout(1000);
      check('a late previous search cannot replace the latest results',(await results.innerText()).includes('图片面经待核对')&&!(await results.innerText()).includes('需求优先级二面记录'));
      await results.locator('.ik-result-item').click();
      check('OCR uncertainty stays visible in source detail',(await detail.innerText()).includes('OCR 待核对'));
      await detail.getByRole('button',{name:'查看本地备份',exact:true}).click();const ocr=page.getByRole('dialog',{name:'面经原文：图片面经待核对',exact:true});await ocr.getByRole('button',{name:'我已核对 OCR 文本',exact:true}).waitFor();
      check('OCR reader retains review text and confirmation control',(await ocr.innerText()).includes('尚未作为面试题证据'));await page.keyboard.press('Escape');await ocr.waitFor({state:'hidden'});
      await page.getByRole('button',{name:'清空搜索',exact:true}).click();await page.locator('.ik-result-item').waitFor({state:'hidden'});
      if(await detail.isVisible())await page.getByRole('button',{name:'关闭知识详情',exact:true}).click();
      await select(page.getByRole('button',{name:'面经：需求优先级二面记录',exact:true}));await detail.getByRole('button',{name:'删除来源',exact:true}).click();
      check('first source deletion click only asks for confirmation',state.mutations.length===0);
      await detail.getByRole('button',{name:'确认删除来源',exact:true}).click();await waitCount('.ik-node-source',5);
      check('confirmed source deletion refreshes the graph',state.mutations[0]==='/api/interview-sources/s1');
      await select(product);await detail.getByRole('button',{name:'删除简报',exact:true}).first().click();
      check('first brief deletion click leaves source records intact',state.mutations.length===1);
      await detail.getByRole('button',{name:'确认删除简报',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.ik-detail')?.textContent.includes('最新简报：优先准备指标设计。'));
      check('brief deletion stays separate from source deletion',state.mutations.includes('/api/interview-briefs/b-new')&&state.sources.length===5);
      await page.getByRole('button',{name:'关闭知识详情',exact:true}).click();await waitCount('.ik-node-source',5);
      await search.fill('触发错误');await page.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'});await page.getByText('没有匹配的面试知识',{exact:true}).waitFor();
      check('search failures can be retried without losing base nodes',await page.getByRole('alert').count()===0&&await page.locator('.ik-node-source').count()===5);
    }
    check(`${prefix}: fixture serves every requested endpoint`,state.unhandled.length===0);await context.close();page=null;
  }
  const {context,state}=await openFixture(1360,'white',true);
  await waitCount('.ik-node-source',32);
  check('large libraries render every source in the global graph',await page.locator('.ik-node-source').count()===32&&await page.locator('.ik-edges :is(line,path)').count()===33);
  await page.getByLabel('搜索面试知识库',{exact:true}).fill('分页正文');await page.locator('.ik-result-item').click();
  check('search selects an older source while preserving the full graph',await page.getByRole('button',{name:'面经：分页来源 32',exact:true}).getAttribute('aria-pressed')==='true'&&await page.locator('.ik-node-source').count()===32);
  await page.getByRole('button',{name:'清空搜索',exact:true}).click();await select(page.getByRole('button',{name:'岗位：产品经理',exact:true}));await waitCount('.ik-node-source',32);
  check('role selection keeps all global sources without expansion controls',await page.locator('.ik-node-source').count()===32&&await page.getByRole('button',{name:/展开更多面经/}).count()===0);
  await settleLabels();await shot('large-global-1360-white');
  check('large library fixture serves every requested endpoint',state.unhandled.length===0);await context.close();page=null;check('no renderer errors',report.errors.length===0);report.pass=true;
}catch(error){report.pass=false;report.error=error.stack;if(page)await page.screenshot({path:path.join(evidence,'failure.png')});throw error;}
finally{await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,evidence}));await harness.close();}
