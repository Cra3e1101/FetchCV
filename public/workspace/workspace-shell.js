// Presentation state only. Scope, authorization and content stay in the existing APP readers.
export function workspaceShell(){
 const el=id=>document.getElementById(id),drawer=el('utility-drawer'),sidebar=el('sidebar');
 const narrow=matchMedia('(max-width: 720px)');
 const titles={conversations:'对话历史',jobs:'岗位',artifacts:'简历与作品',documents:'来源资料',approvals:'待审阅草稿',runs:'运行活动',activities:'审批与投递'};
 const panels={source:'导入来源资料',knowledge:'检索资料',memory:'记忆与偏好',note:'本地备注'};
 let previousFocus=null;
 function navigation(open){document.body.classList.toggle('navigation-open',open);sidebar.inert=!open;el('work-content').inert=narrow.matches&&open;el('sidebar-toggle').setAttribute('aria-expanded',String(open));}
 function closeUtility(){if(drawer.open)drawer.close();}
 function openUtility(name){
  if(!Object.hasOwn(panels,name))return;
  previousFocus=document.activeElement;el('utility-title').textContent=panels[name];
  for(const view of document.querySelectorAll('[data-utility-view]'))view.hidden=view.dataset.utilityView!==name;
  if(!drawer.open)drawer.showModal();el('utility-close').focus();
 }
 for(const button of document.querySelectorAll('[data-utility]'))button.addEventListener('click',()=>openUtility(button.dataset.utility));
 el('utility-close').addEventListener('click',closeUtility);drawer.addEventListener('close',()=>previousFocus?.isConnected&&previousFocus.focus());
 el('sidebar-toggle').addEventListener('click',()=>{navigation(!document.body.classList.contains('navigation-open'));if(narrow.matches&&!sidebar.inert)el('sidebar-close').focus();});
 el('sidebar-close').addEventListener('click',()=>{navigation(false);el('sidebar-toggle').focus();});
 sidebar.addEventListener('keydown',event=>{if(event.key==='Escape'&&narrow.matches){navigation(false);el('sidebar-toggle').focus();}});
 narrow.addEventListener('change',()=>navigation(!narrow.matches));navigation(!narrow.matches);
 el('welcome-chat').addEventListener('click',()=>el('new-conversation').click());
 el('welcome-jobs').addEventListener('click',()=>document.querySelector('[data-kind="jobs"]').click());
 const available={knowledge:'knowledge-form',memory:'memory-panel',note:'note-form'};
 const update=()=>{for(const [name,id] of Object.entries(available))document.querySelector(`[data-utility="${name}"]`).disabled=el(id).hidden;};
 const observer=new MutationObserver(update);for(const id of Object.values(available))observer.observe(el(id),{attributes:true,attributeFilter:['hidden']});update();
 return {openUtility,closeUtility,
  catalogue(kind){el('list-heading').textContent=titles[kind];for(const button of document.querySelectorAll('[data-kind]'))button.setAttribute('aria-pressed',String(button.dataset.kind===kind));},
  browse(kind){el('welcome').hidden=true;el('detail-title').hidden=false;el('detail-title').textContent=titles[kind];el('notice').textContent='从左侧选择一条记录。';document.body.dataset.view=kind;},
  select(kind,item){el('welcome').hidden=true;el('detail-title').hidden=false;document.body.dataset.view=kind;el('reading-pane').scrollTop=0;for(const button of el('items').querySelectorAll('button'))button.setAttribute('aria-current',String(button.dataset.objectId===item.id));if(narrow.matches){navigation(false);el('detail-title').tabIndex=-1;el('detail-title').focus();}},
 };
}
