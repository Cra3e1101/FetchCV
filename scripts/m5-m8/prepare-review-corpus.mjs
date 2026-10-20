import assert from 'node:assert/strict';
import {realpath,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildReviewCorpus} from './review-corpus.mjs';
import {auditAnnotations} from './annotation-audit.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root&&path.isAbsolute(root));
const stable=await realpath('D:/hesan/Desktop/VSCODES/FetchCV_M1_work/20260910-235136'),actual=await realpath(root),relative=path.relative(stable,actual);
assert.ok(relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'stable child required');
const packet=buildReviewCorpus(),audit=auditAnnotations(packet),output=path.join(actual,'review-corpus');
await mkdir(output);await mkdir(path.join(output,'sources'));
const manifest=[],hash=b=>createHash('sha256').update(b).digest('hex');
async function save(name,content){const bytes=Buffer.from(content);await writeFile(path.join(output,name),bytes,{flag:'wx'});manifest.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}
for(const d of packet.documents){d.sourceFile=`sources/${d.id}.txt`;await save(d.sourceFile,d.text);}
await save('packet.json',JSON.stringify(packet,null,2)+'\n');
await save('audit.json',JSON.stringify(audit,null,2)+'\n');
const families=[...new Set(packet.documents.map(d=>d.family))],secondary=[];
families.forEach((family,index)=>{
  const retrieval=packet.items.filter(i=>i.kind==='retrieval'&&i.families.includes(family));
  const memory=packet.items.filter(i=>i.kind==='memory'&&i.families.includes(family));
  for(let n=0;n<4;n++)secondary.push(retrieval[(index+n*5)%retrieval.length].id);
  secondary.push(memory[index%memory.length].id);
});
await save('review-assignments.json',JSON.stringify({status:'unassigned',primary:packet.items.map(i=>i.id),secondary,
  instructions:['Assign two distinct human reviewers; these arrays are assignments, not completed reviews.',
    'Secondary reviewer must not see primary judgments before submitting.',
    'Disagreements require an independent third reviewer; never auto-adjudicate.',
    'Deterministic balanced coverage sample, not a statistically random sample.']},null,2)+'\n');
for(const split of ['tune','validation','sealed']){
  const sections=[`# ${split} — 未封存的人工评审草稿`,
    '所有材料为 AI 起草的虚构内容，当前零标注。split 只是拟议分配，共用问题框架，不是独立 sealed 质量证据。',
    '先检查题意、来源家族和时间/权限边界；不合理的题先修订并版本化，再独立标注。不应看模型答题结果后改标签。',
    '来源全文与 TXT 字节 SHA256 在 packet.json；证据区间用 Unicode 码点半开范围。不得只改 origin 字段假装 human。'];
  for(const family of [...new Set(packet.documents.filter(d=>d.split===split).map(d=>d.family))]){
    sections.push(`## ${family}`);
    for(const d of packet.documents.filter(d=>d.family===family))sections.push(`### 来源 ${d.id}\n\n候选人：${d.candidateId}；可用时间：${d.availableFrom}\n\n${d.text}`);
    for(const i of packet.items.filter(i=>i.families.includes(family)))sections.push(`### ${i.id} · ${i.kind}\n\n时间：${i.asOf}；范围：${i.scope.candidateId}；切片：${i.slices.join(', ')}\n\n${i.prompt}\n\n评审：未填写。`);
  }
  await save(`${split}-review.md`,sections.join('\n\n')+'\n');
}
const generatorHashes=[];
for(const name of ['review-scenarios.mjs','review-corpus.mjs','prepare-review-corpus.mjs'])generatorHashes.push({name,sha256:hash(await readFile(new URL(name,import.meta.url)))});
await save('manifest.json',JSON.stringify({revision:packet.revision,sealedStatus:packet.sealedStatus,generatorHashes,files:[...manifest],reviewed:0,formalM5ToM8Complete:false},null,2)+'\n');
console.log(JSON.stringify({output,documents:packet.documents.length,retrieval:audit.retrieval,memory:audit.memory,reviewed:audit.reviewed,readyForMetricRun:audit.readyForMetricRun}));
