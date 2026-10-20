import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {auditAnnotations} from './annotation-audit.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT;
assert.ok(root&&path.isAbsolute(root),'guarded run root required');
const stable=await realpath('D:/hesan/Desktop/VSCODES/FetchCV_M1_work/20260910-235136');
const actual=await realpath(root),relative=path.relative(stable,actual);
assert.ok(relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'stable child root required');
const bytes=await readFile(fileURLToPath(new URL('./review-pilot.json',import.meta.url)));
const draft=JSON.parse(bytes),hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const documents=draft.documents.map(d=>{
  assert.match(d.id,/^[a-z0-9-]+$/);
  return {...d,split:'tune',sourceFile:`${d.id}.txt`,sha256:hash(Buffer.from(d.text,'utf8'))};
});
const item=(x,kind)=>({...x,kind,split:'tune',families:x.families??['memory-dialogues'],
  scope:{candidateId:'pilot-a'},asOf:x.asOf??'2026-08-10T00:00:00Z',annotations:[]});
const packet={revision:draft.revision,provenance:draft.provenance,documents,
  items:[...draft.retrieval.map(x=>item(x,'retrieval')),...draft.memory.map(x=>item(x,'memory'))]};
const audit=auditAnnotations(packet);
const output=path.join(actual,'review-pilot');await mkdir(output);
for(const doc of documents)await writeFile(path.join(output,doc.sourceFile),doc.text,{flag:'wx'});
await writeFile(path.join(output,'packet.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
await writeFile(path.join(output,'audit.json'),JSON.stringify({...audit,draftSha256:hash(bytes)},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,documents:documents.length,items:packet.items.length,reviewed:audit.reviewed,formalM5ToM8Complete:false}));
