export async function documentVersions({parent,request,item,scope,isCurrent,onOpen,onError}){
 const region=document.createElement('div');region.setAttribute('aria-label','来源版本');parent.append(region);
 const load=async afterVersion=>{const page=await request('document.versions',{...scope,documentId:item.id,...(afterVersion?{afterVersion}:{})});if(!isCurrent())return;
  for(const version of page.items){const button=document.createElement('button');button.textContent=`来源版本 ${version.version}${version.active?' · 当前':' · 历史'}${version.id===item.id?' · 正在查看':''}`;button.disabled=version.id===item.id||version.state!=='ready';
   button.addEventListener('click',()=>{if(isCurrent())void onOpen({...item,id:version.id,version:version.version,blob_hash:version.blob_hash}).catch(onError);});region.append(button);}
  if(page.nextVersion){const more=document.createElement('button');more.textContent='继续读取来源版本';more.addEventListener('click',async()=>{more.disabled=true;try{await load(page.nextVersion);more.remove();}catch(e){onError(e);more.disabled=false;}});region.append(more);}
 };await load();
}
