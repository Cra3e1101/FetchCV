export function draftDifference(original,proposed){
  const before=[...original],after=[...proposed];let left=0,right=0;
  while(left<before.length&&left<after.length&&before[left]===after[left])left++;
  while(right<before.length-left&&right<after.length-left&&before[before.length-1-right]===after[after.length-1-right])right++;
  return {prefix:before.slice(0,left).join(''),removed:before.slice(left,before.length-right).join(''),added:after.slice(left,after.length-right).join(''),suffix:right?before.slice(-right).join(''):''};
}
const text=value=>typeof value==='string'?value:JSON.stringify(value,null,2)??'';
export function showDraftReview(parent,result){
  const diff=draftDifference(text(result.original.content.content),text(result.proposed.content.content));
  const note=document.createElement('p');note.textContent=diff.removed||diff.added?'标记首尾相同内容之间的整段差异，请核对完整上下文与事实。':'草稿文字与原版本相同。';
  const grid=document.createElement('div');grid.className='draft-comparison';
  for(const [label,version,value,tag]of [['原版本',result.original.version,diff.removed,'del'],['待审阅草稿',result.proposed.version,diff.added,'ins']]){
    const panel=document.createElement('div'),h=document.createElement('h3'),pre=document.createElement('pre'),mark=document.createElement(tag);
    h.textContent=`${label} · 版本 ${version}`;mark.textContent=value;pre.append(document.createTextNode(diff.prefix),mark,document.createTextNode(diff.suffix));panel.append(h,pre);grid.append(panel);
  }
  const reason=document.createElement('p');reason.textContent=`修改理由：${result.proposed.content.reason||'未提供'}`;parent.append(note,grid,reason);
}
