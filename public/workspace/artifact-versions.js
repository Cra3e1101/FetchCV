export async function artifactVersions({parent,request,item,result,scope,isCurrent,onOpen,onError}){
 const region=document.createElement('div');region.setAttribute('aria-label','作品版本');parent.append(region);
 const load=async beforeVersion=>{const page=await request('artifact.versions',{...scope,artifactId:item.id,...(beforeVersion?{beforeVersion}:{})});if(!isCurrent())return;
  for(const version of page.items){const b=document.createElement('button');b.textContent=`作品版本 ${version.version}${version.current?' · 当前':' · 已保留'}${version.status==='draft'?' · 待审阅':''}`;b.disabled=version.id===result.versionId;
   b.addEventListener('click',()=>{if(isCurrent())void onOpen({...item,version_id:version.id}).catch(onError);});region.append(b);}
  if(page.nextVersion){const more=document.createElement('button');more.textContent='继续读取作品版本';more.addEventListener('click',async()=>{more.disabled=true;try{await load(page.nextVersion);more.remove();}catch(error){onError(error);more.disabled=false;}});region.append(more);}
 };await load();
}
