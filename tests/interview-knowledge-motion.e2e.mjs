// Motion acceptance against production dist and synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createKnowledgeHarness,createKnowledgeFixture} from './interview-knowledge-fixture.mjs';
import {buildKnowledgeGraph} from '../src/lib/interview-knowledge-graph.js';

const evidence=path.resolve(import.meta.dirname,'..','.m1-evidence',`interview-knowledge-motion-${Date.now()}`);
await fs.mkdir(evidence,{recursive:true});
const report={checks:[],errors:[],unhandledRequests:[],samples:{},screenshots:[],videos:[]};
const harness=await createKnowledgeHarness({report,evidence});let page;
const check=(name,value,details)=>{report.checks.push({name,pass:!!value,...(details===undefined?{}:{details})});assert.ok(value,name);};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const maxShift=(a,b)=>Math.max(0,...Object.keys(a.nodes).filter(id=>b.nodes[id]).map(id=>distance(a.nodes[id],b.nodes[id])));
const topology=buildKnowledgeGraph(createKnowledgeFixture());
const sourceId=topology.nodes.find(node=>node.kind==='source'&&node.source.id==='s1').id;
const sourceLabel='面经：需求优先级二面记录';
const neighborIds=new Set(topology.edges.flatMap(edge=>edge.source===sourceId?[edge.target]:edge.target===sourceId?[edge.source]:[]));
const expectedRadius=node=>{const degree=1+new Set(topology.edges.flatMap(edge=>edge.source===node.id?[edge.target]:edge.target===node.id?[edge.source]:[])).size;return node.kind==='company'?Math.max(14,Math.min(38,5*Math.sqrt(degree))):node.kind==='role'?Math.max(9,Math.min(26,3.5*Math.sqrt(degree))):Math.max(4,Math.min(14,2*Math.sqrt(degree)));};
const expectedFont=node=>node.kind==='company'?15:node.kind==='role'?13:11;
const snapshot=()=>page.locator('.ik-graph').evaluate(graph=>{
  const parse=value=>(value||'').match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number)||[];
  const effectiveOpacity=element=>{let opacity=1;for(let current=element;current&&current!==graph.parentElement;current=current.parentElement)opacity*=+getComputedStyle(current).opacity;return opacity;};
  const camera=parse(graph.querySelector(':scope > g')?.getAttribute('transform'));
  return {time:performance.now(),camera:{x:camera[0],y:camera[1],zoom:camera[2]},engine:graph.dataset.motionEngine,active:graph.dataset.simulationActive,
    width:graph.getBoundingClientRect().width,height:graph.getBoundingClientRect().height,
    nodes:Object.fromEntries([...graph.querySelectorAll('.ik-node')].map(node=>{
      const position=parse(node.getAttribute('transform')),dot=node.querySelector('.ik-node-dot'),text=node.querySelector('text'),matrix=dot.getScreenCTM(),labelMatrix=text.getScreenCTM(),dotRect=dot.getBoundingClientRect(),textRect=text.getBoundingClientRect();
      return [node.dataset.nodeId,{x:position[0],y:position[1],opacity:effectiveOpacity(dot),selected:node.getAttribute('aria-pressed')==='true',screenRadius:+dot.getAttribute('r')*Math.hypot(matrix.a,matrix.b),labelOpacity:effectiveOpacity(text),labelHidden:text.dataset.labelHidden,ringOpacity:effectiveOpacity(node.querySelector('.ik-node-ring')),ringWidth:parseFloat(getComputedStyle(node.querySelector('.ik-node-ring')).strokeWidth),color:getComputedStyle(dot).fill,screenFont:parseFloat(getComputedStyle(text).fontSize)*Math.hypot(labelMatrix.a,labelMatrix.b),label:text.textContent,anchor:text.getAttribute('text-anchor'),below:textRect.top>dotRect.y+dotRect.height/2}];
    }))};
});
async function sampleAfter(delays){const result=[await snapshot()];for(const delay of delays){await page.waitForTimeout(delay);result.push(await snapshot());}return result;}
async function settleCamera(){let prior=await snapshot(),stable=0;for(let i=0;i<120;i++){await page.waitForTimeout(25);const next=await snapshot();const difference=distance(prior.camera,next.camera)+Math.abs(prior.camera.zoom/next.camera.zoom-1);if(difference<.000001)stable++;else stable=0;if(stable>=3)return next;prior=next;}throw Error('camera animation did not settle');}
async function settleSimulation(){let prior=await snapshot(),stable=0;for(let i=0;i<100;i++){await page.waitForTimeout(150);const next=await snapshot();if(maxShift(prior,next)<.08)stable++;else stable=0;if(stable>=3)return next;prior=next;}throw Error('simulation did not settle');}
const select=async label=>{await page.getByRole('button',{name:label,exact:true}).focus();await page.keyboard.press('Enter');};
const pointFor=async label=>{const box=await page.getByRole('button',{name:label,exact:true}).locator('.ik-node-dot').boundingBox();assert.ok(box,'node dot has a box');return {x:box.x+box.width/2,y:box.y+box.height/2};};
async function moveAway(){const box=await page.locator('.ik-header').boundingBox();await page.mouse.move(box.x+8,box.y+8);}
async function wheel(deltaY,deltaMode=0,point){const box=await page.locator('.ik-graph').boundingBox();const target=point||{x:box.x+box.width/2,y:box.y+box.height/2};return page.locator('.ik-graph').evaluate((graph,init)=>{const event=new WheelEvent('wheel',init);graph.dispatchEvent(event);return{x:event.clientX,y:event.clientY};},{deltaY,deltaMode,clientX:target.x,clientY:target.y,bubbles:true,cancelable:true});}
async function zoomTo(zoom,deltaMode=0,point){const current=(await snapshot()).camera.zoom;await wheel(-120*Math.log(zoom/current)/Math.log(1.5)/[1,40,800][deltaMode],deltaMode,point);return settleCamera();}
async function fit(){await page.getByRole('button',{name:'适应图谱',exact:true}).click();return settleCamera();}
async function shot(name){const file=`${name}.png`;await page.screenshot({path:path.join(evidence,file)});report.screenshots.push(file);}
const cameraEqual=(a,b,tolerance=.1)=>distance(a,b)<tolerance&&Math.abs(a.zoom-b.zoom)<.0001;
const readEdges=()=>page.locator('.ik-edges line').evaluateAll(lines=>lines.map(line=>({key:`${line.dataset.source}\0${line.dataset.target}`,opacity:+getComputedStyle(line).opacity,color:getComputedStyle(line).stroke})));
const workerCreates=()=>page.evaluate(()=>window.fixtureWorkerEvents.filter(event=>event.kind==='create').length);
const colorFor=(kind,dark=false)=>`rgb(${Array(3).fill(dark?({company:216,role:184,source:122}[kind]):({company:58,role:90,source:138}[kind])).join(', ')})`;

async function exerciseDenseHierarchy(){
  for(const theme of ['white','neutral-dark']){
    const opened=await harness.open({sourceCount:40,theme,reducedMotion:'reduce'});page=opened.page;
    await settleSimulation();await fit();await moveAway();const baseline=await snapshot(),dark=theme==='neutral-dark';
    check(`40-source ${theme} graph suppresses all source labels by default`,await page.locator('.ik-node-source').count()===40&&Object.entries(baseline.nodes).filter(([id])=>id.startsWith('source:')).every(([,node])=>node.labelOpacity===0&&node.labelHidden==='true'));
    check(`40-source ${theme} graph uses distinct company role and source grays`,await page.locator('.ik-node').evaluateAll((nodes,expected)=>nodes.every(node=>getComputedStyle(node.querySelector('.ik-node-dot')).fill===expected[node.classList.contains('ik-node-company')?'company':node.classList.contains('ik-node-role')?'role':'source']),{company:colorFor('company',dark),role:colorFor('role',dark),source:colorFor('source',dark)}));
    await shot(`hierarchy-40-${theme}-default`);
    const hoverPoint=await pointFor('面经：分页来源 01');await page.mouse.move(hoverPoint.x,hoverPoint.y);await page.waitForTimeout(60);
    const hover=await snapshot();check(`40-source ${theme} hover reveals only its complete source label`,hover.nodes['source:large-0'].labelOpacity===1&&hover.nodes['source:large-0'].ringOpacity===1&&Object.entries(hover.nodes).filter(([id])=>id.startsWith('source:')&&id!=='source:large-0').every(([,node])=>node.labelOpacity===0));await shot(`hierarchy-40-${theme}-hover`);
    await moveAway();const beforeSelect=await snapshot(),creates=await workerCreates();
    await page.getByLabel('搜索面试知识库',{exact:true}).fill('分页正文');await page.locator('.ik-result-item').waitFor();await page.locator('.ik-result-item').click();await moveAway();await page.waitForTimeout(60);
    const selected=await snapshot(),selectedNode=selected.nodes['source:large-31'];
    check(`40-source ${theme} search selection paints its source label and ring`,selectedNode.selected&&selectedNode.labelOpacity===1&&selectedNode.ringOpacity===1&&selectedNode.labelHidden==='false');
    check(`40-source ${theme} selection retains coordinates zoom and worker`,maxShift(beforeSelect,selected)<.3&&Math.abs(beforeSelect.camera.zoom-selected.camera.zoom)<.0001&&await workerCreates()===creates&&selected.engine==='worker');
    check(`40-source ${theme} selection retains ancestor search-match color`,Object.entries(selected.nodes).filter(([id])=>!id.startsWith('source:')).every(([,node])=>node.color===(dark?'rgb(212, 168, 86)':'rgb(176, 125, 58)')));
    await shot(`hierarchy-40-${theme}-selected-search`);
    await page.getByRole('button',{name:'清空搜索',exact:true}).click();await moveAway();await page.waitForTimeout(60);const cleared=await snapshot();
    check(`40-source ${theme} clear selection restores hidden source label`,!cleared.nodes['source:large-31'].selected&&cleared.nodes['source:large-31'].labelOpacity===0&&cleared.nodes['source:large-31'].ringOpacity===0);
    await opened.context.close();page=null;
  }
}

async function exerciseFallback(){
  let opened=await harness.open({sourceCount:360,disableWorker:true,emptyInitially:true});page=opened.page;
  check('an empty graph remains usable when Worker construction is unavailable',await page.locator('.ik-empty-card').isVisible()&&await page.locator('.ik-graph').getAttribute('data-motion-engine')==='fallback');
  opened.state.sources=opened.state.fullData.sources;opened.state.briefs=opened.state.fullData.briefs;
  const fallbackFrames=await page.evaluate(()=>new Promise(resolve=>{const intervals=[],start=performance.now();let prior=start;window.dispatchEvent(new CustomEvent('fetchcv:interview-evidence-changed'));function frame(now){intervals.push(now-prior);prior=now;if(now-start<1000)requestAnimationFrame(frame);else resolve(intervals);}requestAnimationFrame(frame);}));
  await page.locator('.ik-node-source').first().waitFor();const fallbackPositions=await sampleAfter([100,200]);report.samples.fallback={frameCount:fallbackFrames.length,maxFrameMs:Math.max(...fallbackFrames),positions:fallbackPositions.map(sample=>({time:sample.time,node:sample.nodes['source:large-0']}))};
  check('the fallback fills an initially empty graph with finite live positions',await page.locator('.ik-node').count()===362&&Object.values(fallbackPositions.at(-1).nodes).every(node=>Number.isFinite(node.x)&&Number.isFinite(node.y))&&fallbackPositions.some(sample=>maxShift(fallbackPositions[0],sample)>.1));
  check('main-thread fallback yields between simulation batches',fallbackFrames.length>=15&&Math.max(...fallbackFrames)<250&&await page.evaluate(()=>window.fixtureWorkerEvents.every(event=>event.kind!=='create')));
  const fallbackZoomBefore=(await snapshot()).camera.zoom;await wheel(-120);const fallbackZoomAfter=await settleCamera();check('fallback graph zoom stays interactive',Math.abs(fallbackZoomAfter.camera.zoom-fallbackZoomBefore*1.5)<.001);await shot('worker-unavailable-fallback');
  await opened.context.close();page=null;
  opened=await harness.open({disableWorker:true,reducedMotion:'reduce',theme:'neutral-dark'});page=opened.page;await settleSimulation();await fit();
  opened.state.sources.push({...opened.state.sources[0],id:'refresh-added',title:'刷新后新增来源 C'});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('fetchcv:interview-evidence-changed')));
  await page.getByRole('button',{name:'面经：刷新后新增来源 C',exact:true}).waitFor();
  const refreshDragPoint=await pointFor(sourceLabel);await page.mouse.move(refreshDragPoint.x,refreshDragPoint.y);await page.mouse.down();await page.mouse.move(refreshDragPoint.x+55,refreshDragPoint.y+20,{steps:4});await page.mouse.up();
  const refreshedSettled=await settleSimulation();await page.waitForTimeout(200);const refreshedLater=await snapshot();
  check('reduced fallback retains newly added nodes after refresh followed by pin and release',await page.locator('.ik-node-source').count()===7&&refreshedSettled.nodes['source:refresh-added']&&Number.isFinite(refreshedSettled.nodes['source:refresh-added'].x)&&maxShift(refreshedSettled,refreshedLater)<.3&&await page.locator('.ik-detail').count()===0);
  await select('面经：刷新后新增来源 C');check('a node added during reduced fallback refresh remains selectable',(await page.getByLabel('知识详情',{exact:true}).innerText()).includes('刷新后新增来源 C'));
  await shot('reduced-fallback-refresh-pin');await opened.context.close();page=null;
}

try{
  if(process.env.FETCHCV_GRAPH_MOTION_ONLY!=='fallback'){
  let opened=await harness.open({recordVideo:true});page=opened.page;
  const initial=await sampleAfter([50,100,200]);report.samples.initial=initial.map(sample=>({time:sample.time,node:sample.nodes[sourceId],camera:sample.camera}));
  check('initial graph coordinates evolve across rendered frames',initial.some(sample=>maxShift(initial[0],sample)>.1));
  await settleSimulation();await fit();await moveAway();
  const ready=await snapshot();await shot('fitted-global-white');
  check('all saved nodes and relationships remain in the global graph',Object.keys(ready.nodes).length===11&&await page.locator('.ik-edges line').count()===11);
  check('the production worker loads and delivers live position messages',ready.engine==='worker'&&await page.evaluate(()=>window.fixtureWorkerEvents.some(event=>event.kind==='create')&&window.fixtureWorkerEvents.some(event=>event.kind==='message')));
  check('graph omits grid, stagger animations and glow',await page.locator('.ik-graph').evaluate(graph=>!graph.querySelector('pattern,.ik-bg-dots')&&[...graph.querySelectorAll('.ik-node')].every(node=>getComputedStyle(node).animationName==='none'&&getComputedStyle(node.querySelector('.ik-node-dot')).filter==='none')));
  check('three node kinds start with their own light gray fill',topology.nodes.every(node=>ready.nodes[node.id].color===colorFor(node.kind)));
  check('company role and source rings use the required stroke widths',topology.nodes.every(node=>ready.nodes[node.id].ringWidth===({company:2.2,role:1.8,source:1.4}[node.kind])));

  const hoverPoint=await pointFor(sourceLabel);await page.mouse.move(hoverPoint.x,hoverPoint.y);
  const hover=await sampleAfter([35,100,1050]);report.samples.hover=hover.map(sample=>({time:sample.time,opacities:Object.fromEntries(Object.entries(sample.nodes).map(([id,node])=>[id,node.opacity]))}));
  const unrelated=Object.keys(ready.nodes).filter(id=>id!==sourceId&&!neighborIds.has(id));
  check('hover visibly eases unrelated nodes toward 0.2 opacity',unrelated.some(id=>hover.slice(0,-1).some(sample=>sample.nodes[id].opacity>.21&&sample.nodes[id].opacity<.99))&&unrelated.every(id=>Math.abs(hover.at(-1).nodes[id].opacity-.2)<.015));
  check('hover keeps the current node and each direct neighbor bright',[sourceId,...neighborIds].every(id=>hover.at(-1).nodes[id].opacity>.99));
  check('hover reveals a complete label beneath its node',hover.at(-1).nodes[sourceId].label==='需求优先级二面记录'&&hover.at(-1).nodes[sourceId].labelOpacity>.99&&hover.at(-1).nodes[sourceId].below);
  const formerlyDimmedPoint=await pointFor('面经：合成公司产品实习面试');await page.mouse.move(formerlyDimmedPoint.x,formerlyDimmedPoint.y);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  const dimToHover=(await snapshot()).nodes['source:s4'];report.samples.dimToHover=dimToHover;
  check('a dimmed node reveals its hovered label and ring at full effective opacity on the next paint',dimToHover.opacity<.8&&dimToHover.labelOpacity>.99&&dimToHover.ringOpacity>.99);
  await moveAway();const hoverOut=await sampleAfter([50,1100]);
  check('leaving a node restores the full graph opacity',Object.values(hoverOut.at(-1).nodes).every(node=>node.opacity>.99));

  await zoomTo(1);await moveAway();const beforeZoom=await snapshot();
  const graphBox=await page.locator('.ik-graph').boundingBox(),anchor={x:graphBox.x+graphBox.width*.3,y:graphBox.y+graphBox.height*.3};
  const deliveredAnchor=await wheel(-120,0,anchor);const zoomFrames=await sampleAfter([20,70,400]);const afterZoom=await settleCamera();
  report.samples.zoom=zoomFrames.map(sample=>({time:sample.time,camera:sample.camera}));
  check('wheel zoom animates through intermediate scales before reaching 1.5x',zoomFrames.some(sample=>sample.camera.zoom>1.001&&sample.camera.zoom<1.499)&&Math.abs(afterZoom.camera.zoom-1.5)<.001);
  const localAnchor={x:deliveredAnchor.x-graphBox.x,y:deliveredAnchor.y-graphBox.y};
  const anchoredBefore={x:(localAnchor.x-beforeZoom.camera.x)/beforeZoom.camera.zoom,y:(localAnchor.y-beforeZoom.camera.y)/beforeZoom.camera.zoom};
  const anchoredAfter={x:(localAnchor.x-afterZoom.camera.x)/afterZoom.camera.zoom,y:(localAnchor.y-afterZoom.camera.y)/afterZoom.camera.zoom};
  check('zooming in preserves the world point beneath the mouse',distance(anchoredBefore,anchoredAfter)<.05,{worldDelta:distance(anchoredBefore,anchoredAfter),before:beforeZoom.camera,after:afterZoom.camera,localAnchor,graphBox});
  await wheel(120,0,anchor);const zoomOut=await settleCamera();
  const center={x:graphBox.width/2,y:graphBox.height/2};
  const worldBefore={x:(center.x-afterZoom.camera.x)/afterZoom.camera.zoom,y:(center.y-afterZoom.camera.y)/afterZoom.camera.zoom};
  const worldAfter={x:(center.x-zoomOut.camera.x)/zoomOut.camera.zoom,y:(center.y-zoomOut.camera.y)/zoomOut.camera.zoom};
  check('zooming out preserves the viewport center',distance(worldBefore,worldAfter)<.05&&Math.abs(zoomOut.camera.zoom-1)<.001,{worldDelta:distance(worldBefore,worldAfter),before:afterZoom.camera,after:zoomOut.camera,center});
  for(const mode of [1,2]){await zoomTo(1);await wheel(-120/[1,40,800][mode],mode);const result=await settleCamera();check(`wheel deltaMode ${mode} uses the specified pixel normalization`,Math.abs(result.camera.zoom-1.5)<.001);}
  const minimum=await zoomTo(.00001),maximum=await zoomTo(100);
  check('zoom supports the complete 1/128 through 8 range',Math.abs(minimum.camera.zoom-1/128)<.000001&&Math.abs(maximum.camera.zoom-8)<.001,{minimum:minimum.camera,maximum:maximum.camera});
  const labelSamples=[];
  for(const zoom of [.2,.35,.5,1,2]){const result=await zoomTo(zoom);labelSamples.push(result);const expectedOpacity=Math.max(0,Math.min(1,Math.log2(zoom)+2));check(`zoom ${zoom} follows each kind's radius and square-root screen scaling`,topology.nodes.every(node=>Math.abs(result.nodes[node.id].screenRadius-expectedRadius(node)*Math.sqrt(zoom))<.1));check(`zoom ${zoom} fades company and role labels logarithmically while source labels stay hidden`,topology.nodes.every(node=>Math.abs(result.nodes[node.id].labelOpacity-(node.kind==='source'?0:expectedOpacity))<.025&&result.nodes[node.id].labelHidden===((node.kind==='source'||expectedOpacity<.001)?'true':'false')));check(`zoom ${zoom} follows each kind's label font and square-root screen scaling`,topology.nodes.every(node=>Math.abs(result.nodes[node.id].screenFont-expectedFont(node)*Math.sqrt(zoom))<.15));}
  report.samples.labelThresholds=labelSamples.map(sample=>({zoom:sample.camera.zoom,node:sample.nodes[sourceId]}));
  await zoomTo(.2);const smallLabelPoint=await pointFor(sourceLabel);await page.mouse.move(smallLabelPoint.x,smallLabelPoint.y);await page.waitForTimeout(400);const hoveredSmall=(await snapshot()).nodes[sourceId];
  check('hover below unit zoom reveals a source label at its fixed 11px screen font size',hoveredSmall.labelOpacity>.99&&Math.abs(hoveredSmall.screenFont-11)<.15);await moveAway();

  await fit();await settleSimulation();await moveAway();const beforeDrag=await snapshot(),dragPoint=await pointFor(sourceLabel);
  await page.mouse.move(dragPoint.x,dragPoint.y);await page.mouse.down();
  for(let step=1;step<=6;step++){await page.mouse.move(dragPoint.x+step*12,dragPoint.y+step*5);await page.waitForTimeout(16);}
  await page.waitForTimeout(200);const pinned=await snapshot();await page.mouse.up();const released=await snapshot();
  const releaseFrames=await sampleAfter([100,250,500]);const settled=await settleSimulation();await page.waitForTimeout(350);const settledLater=await snapshot();
  report.samples.nodeDrag={before:beforeDrag.nodes[sourceId],pinned:pinned.nodes[sourceId],released:released.nodes[sourceId],frames:releaseFrames.map(sample=>sample.nodes[sourceId]),settled:settled.nodes[sourceId]};
  check('dragging a node moves its physical position without moving the camera',distance(beforeDrag.nodes[sourceId],pinned.nodes[sourceId])>30&&cameraEqual(beforeDrag.camera,pinned.camera));
  check('dragging a node physically pulls at least one real neighbor',[...neighborIds].some(id=>distance(beforeDrag.nodes[id],pinned.nodes[id])>1));
  check('a node drag beyond five pixels does not select or open details',await page.locator('.ik-detail').count()===0&&Object.values(released.nodes).every(node=>!node.selected));
  check('release unpins the node and the simulation returns to equilibrium',releaseFrames.some(sample=>distance(pinned.nodes[sourceId],sample.nodes[sourceId])>.1)&&maxShift(settled,settledLater)<.3);

  await moveAway();const beforePan=await snapshot();
  const panPoint=await page.locator('.ik-graph').evaluate(graph=>{const box=graph.getBoundingClientRect();for(const [dx,dy] of [[20,20],[20,80],[box.width-25,25]]){const x=box.left+dx,y=box.top+dy;if(!document.elementFromPoint(x,y)?.closest('.ik-node'))return{x,y};}throw Error('no background drag point');});
  await page.mouse.move(panPoint.x,panPoint.y);await page.mouse.down();
  for(let step=1;step<=5;step++){await page.mouse.move(panPoint.x+step*17,panPoint.y+step*7);await page.waitForTimeout(17);}
  await page.mouse.up();const panFrames=await sampleAfter([45,100,350,400]);report.samples.inertia=panFrames.map(sample=>({time:sample.time,camera:sample.camera}));
  const earlySpeed=distance(panFrames[0].camera,panFrames[1].camera)/(panFrames[1].time-panFrames[0].time),lateSpeed=distance(panFrames[3].camera,panFrames[4].camera)/(panFrames[4].time-panFrames[3].time);
  check('background drag continues with decaying inertia after release',panFrames[0].camera.x-beforePan.camera.x>70&&distance(panFrames[0].camera,panFrames[3].camera)>2&&earlySpeed>lateSpeed*2);
  check('background panning does not disturb physical world coordinates',maxShift(beforePan,panFrames.at(-1))<.3);

  await settleCamera();await zoomTo(.65);const beforeSelect=await snapshot();await select(sourceLabel);await settleCamera();const afterSelect=await snapshot();
  check('selection retains global coordinates and the current zoom',Object.keys(afterSelect.nodes).length===11&&maxShift(beforeSelect,afterSelect)<.3&&Math.abs(beforeSelect.camera.zoom-afterSelect.camera.zoom)<.0001);
  await page.getByRole('button',{name:'关闭知识详情',exact:true}).click();await settleCamera();
  const roleButton=page.locator('.ik-node-role').filter({has:page.locator('text').filter({hasText:/^产品经理$/})});
  const detailWorkerCount=await workerCreates();
  await roleButton.focus();await page.keyboard.press('Enter');await page.locator('.ik-source-title').filter({hasText:'需求优先级二面记录'}).click();await moveAway();await page.waitForTimeout(500);
  const fromDetail=await snapshot();
  check('selecting a source from a detail-list button reveals its persistent label and ring',fromDetail.nodes[sourceId].selected&&fromDetail.nodes[sourceId].labelOpacity===1&&fromDetail.nodes[sourceId].ringOpacity===1);
  const otherPoint=await pointFor('面经：合成公司产品实习面试');await page.mouse.move(otherPoint.x,otherPoint.y);await page.waitForTimeout(500);const selectedWithOtherHover=await snapshot();
  check('a selected source label and ring remain fully visible while another node is hovered',selectedWithOtherHover.nodes[sourceId].labelOpacity===1&&selectedWithOtherHover.nodes[sourceId].ringOpacity===1&&selectedWithOtherHover.nodes['source:s4'].labelOpacity===1&&selectedWithOtherHover.nodes['source:s4'].ringOpacity===1);
  check('detail selection and subsequent hover retain the layout zoom and worker',maxShift(afterSelect,selectedWithOtherHover)<.3&&Math.abs(afterSelect.camera.zoom-selectedWithOtherHover.camera.zoom)<.0001&&await workerCreates()===detailWorkerCount);
  await page.getByRole('button',{name:'关闭知识详情',exact:true}).click();await moveAway();await page.waitForTimeout(500);const afterClear=await snapshot();
  check('closing details clears selection and hides the source label and ring',!afterClear.nodes[sourceId].selected&&afterClear.nodes[sourceId].labelOpacity===0&&afterClear.nodes[sourceId].ringOpacity===0);
  const beforeSearch=await snapshot();await page.getByLabel('搜索面试知识库',{exact:true}).fill('紫杉指标');await page.locator('.ik-result-item').waitFor();const afterSearch=await snapshot();
  check('body search preserves world coordinates and zoom',maxShift(beforeSearch,afterSearch)<.3&&Math.abs(beforeSearch.camera.zoom-afterSearch.camera.zoom)<.0001);
  await page.locator('.ik-result-item').click();await moveAway();await page.waitForTimeout(500);const searchSelected=await snapshot();
  check('search-result selection reveals the source while keeping matching ancestor nodes amber',searchSelected.nodes[sourceId].selected&&searchSelected.nodes[sourceId].labelOpacity===1&&searchSelected.nodes[sourceId].ringOpacity===1&&topology.nodes.filter(node=>node.kind!=='source'&&neighborIds.has(node.id)||node.id==='company:星云科技').every(node=>searchSelected.nodes[node.id].color==='rgb(176, 125, 58)'));
  await page.getByLabel('搜索面试知识库',{exact:true}).fill('最新结果');await page.locator('.ik-result-item').waitFor();await page.waitForTimeout(500);const searchChanged=await snapshot();
  check('typing a new search clears the previous selection and paints the new match amber',!searchChanged.nodes[sourceId].selected&&searchChanged.nodes[sourceId].labelOpacity===0&&searchChanged.nodes[sourceId].ringOpacity===0&&searchChanged.nodes['source:s2'].color==='rgb(176, 125, 58)');
  await page.getByRole('button',{name:'清空搜索',exact:true}).click();const refreshHover=await pointFor(sourceLabel);await page.mouse.move(refreshHover.x,refreshHover.y);await page.waitForTimeout(1200);const beforeRefresh=await snapshot(),edgesBeforeRefresh=await readEdges();
  opened.state.sources=opened.state.sources.map(source=>({...source,summary:`更新的合成摘要：${source.id}`}));const callsBefore=opened.state.searches.length;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('fetchcv:interview-evidence-changed')));const edgeRefreshFrames=[await readEdges()];for(const delay of [20,50,150,250]){await page.waitForTimeout(delay);edgeRefreshFrames.push(await readEdges());}
  const afterRefresh=await snapshot();
  check('same-ID data refresh retains coordinates and zoom without re-fitting',opened.state.searches.length>callsBefore&&maxShift(beforeRefresh,afterRefresh)<1&&Math.abs(beforeRefresh.camera.zoom-afterRefresh.camera.zoom)<.0001);
  report.samples.edgeRefresh=edgeRefreshFrames;
  check('same-ID metadata refresh preserves hovered edge alpha and color across frames',edgeRefreshFrames.every(edges=>edges.every(edge=>{const prior=edgesBeforeRefresh.find(item=>item.key===edge.key);return prior&&Math.abs(edge.opacity-prior.opacity)<.015&&edge.color===prior.color;})));
  await moveAway();
  const beforeResize=await snapshot();await page.setViewportSize({width:1100,height:840});await page.waitForTimeout(300);const afterResize=await snapshot();
  check('resize preserves zoom and compensates only the viewport center',Math.abs(beforeResize.camera.zoom-afterResize.camera.zoom)<.0001&&Math.abs((afterResize.camera.x-beforeResize.camera.x)-(afterResize.width-beforeResize.width)/2)<1&&Math.abs((afterResize.camera.y-beforeResize.camera.y)-(afterResize.height-beforeResize.height)/2)<1&&maxShift(beforeResize,afterResize)<.3);
  await shot('motion-final-white');
  await page.evaluate(()=>{document.documentElement.dataset.interfaceTheme='neutral-dark';document.documentElement.dataset.colorScheme='dark';});await page.waitForTimeout(1200);
  check('changing interface theme updates the mounted graph background and painted node colors',await page.locator('.ik-canvas').evaluate(canvas=>{const channels=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);return channels(getComputedStyle(canvas).backgroundColor).every(value=>value<65)&&channels(getComputedStyle(canvas.querySelector('.ik-node-dot')).fill).every(value=>value>128);}));
  await shot('motion-live-theme-dark');
  await fit();await page.locator('.ik-graph').evaluate(graph=>graph.addEventListener('pointerdown',event=>{window.fixturePointerId=event.pointerId;},{once:true}));
  const cancelPoint=await pointFor(sourceLabel);await page.mouse.move(cancelPoint.x,cancelPoint.y);await page.mouse.down();await page.mouse.move(cancelPoint.x+40,cancelPoint.y+15,{steps:3});
  await page.locator('.ik-graph').dispatchEvent('pointercancel',{pointerId:await page.evaluate(()=>window.fixturePointerId),pointerType:'mouse',bubbles:true});await page.mouse.up();await page.waitForTimeout(100);
  check('pointer cancellation releases dragging and suppresses selection',await page.locator('.ik-canvas.is-dragging').count()===0&&await page.locator('.ik-detail').count()===0);
  await select(sourceLabel);check('the graph remains operable after pointer cancellation',await page.getByRole('button',{name:sourceLabel,exact:true}).getAttribute('aria-pressed')==='true');
  await page.getByRole('button',{name:'新对话',exact:true}).click();await page.getByRole('heading',{name:'想聊些什么？'}).waitFor();
  check('leaving the graph terminates its worker',await page.evaluate(()=>window.fixtureWorkerEvents.filter(event=>event.kind==='create').length===window.fixtureWorkerEvents.filter(event=>event.kind==='terminate').length));
  const recording=page.video();await opened.context.close();await fs.copyFile(await recording.path(),path.join(evidence,'obsidian-publish-motion-demo.webm'));report.videos.push('obsidian-publish-motion-demo.webm');page=null;

  opened=await harness.open({reducedMotion:'reduce',theme:'neutral-dark'});page=opened.page;await settleSimulation();await fit();await moveAway();await shot('fitted-global-dark');const reducedBefore=await snapshot();
  await wheel(-120);await page.waitForTimeout(150);const reducedZoom=await snapshot();
  check('reduced motion completes zoom with fewer intermediate frames',Math.abs(reducedZoom.camera.zoom-reducedBefore.camera.zoom*1.5)<.002);
  await select(sourceLabel);check('reduced motion preserves keyboard selection',await page.getByRole('button',{name:sourceLabel,exact:true}).getAttribute('aria-pressed')==='true');
  await page.keyboard.press('Escape');await fit();const reducedPoint=await pointFor(sourceLabel),reducedStart=await snapshot();await page.mouse.move(reducedPoint.x,reducedPoint.y);await page.mouse.down();await page.mouse.move(reducedPoint.x+50,reducedPoint.y+20,{steps:4});await page.waitForTimeout(120);const reducedPinned=await snapshot();await page.mouse.up();await page.waitForTimeout(200);const reducedDrag=await snapshot();
  check('reduced motion retains physical dragging without accidental selection',distance(reducedStart.nodes[sourceId],reducedDrag.nodes[sourceId])>5&&await page.locator('.ik-detail').count()===0);await shot('reduced-motion-dark');
  const reducedSettled=await settleSimulation();await page.waitForTimeout(200);const reducedSettledLater=await snapshot();
  check('reduced-motion release lets neighboring nodes converge again',[...neighborIds].some(id=>distance(reducedPinned.nodes[id],reducedSettled.nodes[id])>.2)&&maxShift(reducedSettled,reducedSettledLater)<.3&&reducedSettled.active==='false');
  await opened.context.close();page=null;

  await exerciseDenseHierarchy();
  const performanceStart=Date.now();opened=await harness.open({sourceCount:420,theme:'neutral-dark'});page=opened.page;
  check('a 420-source fixture renders its complete global graph',await page.locator('.ik-node').count()===422&&await page.locator('.ik-edges line').count()===421);
  const firstGraphRenderMs=Date.now()-performanceStart;await fit();
  const denseHits=await page.locator('.ik-graph').evaluate(graph=>{const bounds=graph.getBoundingClientRect();return [...graph.querySelectorAll('.ik-node')].map(node=>{const dot=node.querySelector('.ik-node-dot'),box=dot.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;if(x<bounds.left||x>=bounds.right||y<bounds.top||y>=bounds.bottom)return null;const hit=document.elementFromPoint(x,y)?.closest('.ik-node');return{id:node.dataset.nodeId,hit:hit?.dataset.nodeId,pass:hit===node};}).filter(Boolean);});
  report.samples.denseHits={visible:denseHits.length,failures:denseHits.filter(hit=>!hit.pass)};
  check('visible dots in the dense graph receive their own center hit',denseHits.length>=300&&denseHits.every(hit=>hit.pass),report.samples.denseHits);
  const frameTimes=await page.evaluate(()=>new Promise(resolve=>{const times=[],start=performance.now();let previous=start;function frame(now){times.push(now-previous);previous=now;if(now-start<800)requestAnimationFrame(frame);else resolve(times);}requestAnimationFrame(frame);}));
  const sorted=frameTimes.slice(1).sort((a,b)=>a-b),p95=sorted[Math.floor(sorted.length*.95)];report.samples.performance={firstGraphRenderMs,setupAndSamplingMs:Date.now()-performanceStart,frameCount:frameTimes.length,p95FrameMs:p95};
  check('large-graph worker frames keep the renderer responsive',frameTimes.length>=10&&p95<150&&await page.locator('.ik-graph').getAttribute('data-motion-engine')==='worker');
  const interactionStart=Date.now();await page.getByLabel('搜索面试知识库',{exact:true}).fill('分页正文');await page.locator('.ik-result-item').waitFor();const interactionMs=Date.now()-interactionStart;report.samples.performance.searchResponseMs=interactionMs;
  check('large-graph search stays responsive while the layout runs',interactionMs<1500&&await page.locator('.ik-node-source').count()===420);
  await page.locator('.ik-result-item').click();check('large-graph result selection preserves all nodes',await page.getByRole('button',{name:'面经：分页来源 32',exact:true}).getAttribute('aria-pressed')==='true'&&await page.locator('.ik-node').count()===422);
  await shot('large-420-dark');await opened.context.close();page=null;
  }
  await exerciseFallback();
  check('all synthetic API requests were handled',report.unhandledRequests.length===0);check('no renderer errors across motion scenarios',report.errors.length===0);report.pass=true;
}catch(error){report.pass=false;report.error=error.stack;if(page)await page.screenshot({path:path.join(evidence,'failure.png')});throw error;}
finally{await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,evidence}));await harness.close();}
