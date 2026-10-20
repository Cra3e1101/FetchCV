import {settingsPage} from "./settings-shell.js";
const el=id=>document.getElementById(id);
const key="fetchcv.interface-theme";
function apply(theme){const selected=["white","neutral-dark","light","dark"].includes(theme)?theme:"white";document.documentElement.dataset.interfaceTheme=selected;for(const input of document.querySelectorAll('[name="interface-theme"]'))input.checked=input.value===selected;return selected}
let stored="white";try{stored=localStorage.getItem(key)}catch{/* Use the default appearance. */}apply(stored);
for(const input of document.querySelectorAll('[name="interface-theme"]'))input.addEventListener('change',()=>{const selected=apply(input.value);try{localStorage.setItem(key,selected)}catch{/* Keep this session's appearance. */}});
for(const [trigger,dialog,close] of [['interface-settings','interface-settings-dialog','interface-close'],['approval-mode','approval-mode-dialog','approval-mode-close']]){el(trigger).addEventListener('click',()=>{el(dialog).showModal();el(close).focus()});el(close).addEventListener('click',()=>el(dialog).close());el(dialog).addEventListener('close',()=>el(trigger).focus())}
el('composer-upload').addEventListener('click',()=>{if(!el('import-source').disabled)el('import-source').click()});
el('agent-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!el('agent-send').disabled){event.preventDefault();el('agent-form').requestSubmit()}});

settingsPage(el('interface-settings-dialog'),'interface-settings');
const rail=document.createElement('nav');rail.className='ipc-rail';rail.setAttribute('aria-label','应用导航');
for(const [kind,label]of [['conversations','工作区'],['documents','来源资料'],['approvals','待审阅草稿']]){
 const original=document.querySelector('.primary-nav [data-kind="'+kind+'"]');
 const button=document.createElement('button');button.type='button';button.title=label;button.setAttribute('aria-label',label);button.append(original.querySelector('svg').cloneNode(true));button.addEventListener('click',()=>original.click());rail.append(button);
}
const settings=document.createElement('button');settings.type='button';settings.title='设置';settings.setAttribute('aria-label','打开设置');settings.textContent='⚙';settings.addEventListener('click',()=>el('interface-settings').click());rail.append(settings);document.querySelector('.app-shell').prepend(rail);
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key===','&&!document.querySelector('dialog[open]')){event.preventDefault();el('interface-settings').click();}});
