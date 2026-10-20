import {readFile,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {evaluateRetrieval} from './retrieval-evaluation.mjs';
import {evaluateReviewedRetrieval} from './reviewed-retrieval.mjs';

const [datasetFile,resultFile,output,mode]=process.argv.slice(2);
assert.ok(process.argv.length<=6&&(mode===undefined||mode==='--reviewed'),'optional mode must be --reviewed');
assert.ok(datasetFile&&resultFile&&output,'usage: evaluate-retrieval.mjs dataset.json results.jsonl report.json');
const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root&&path.isAbsolute(root),'guarded run root required');
const inside=(parent,file)=>{const rel=path.relative(parent,file);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const allowed=await realpath(root),project=await realpath(fileURLToPath(new URL('../../',import.meta.url))),stable=path.dirname(allowed);
for(const file of [datasetFile,resultFile]){const resolved=await realpath(file);assert.ok(inside(project,resolved)||inside(stable,resolved),'input outside project/stable work root');}
const destination=path.resolve(output),parent=await realpath(path.dirname(destination));
assert.ok(parent===allowed||inside(allowed,parent),'report outside guarded root');
const datasetBytes=await readFile(datasetFile),resultBytes=await readFile(resultFile);
const dataset=JSON.parse(datasetBytes),results=resultBytes.toString('utf8').split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));
const digest=b=>createHash('sha256').update(b).digest('hex');
const score=mode==='--reviewed'?evaluateReviewedRetrieval:evaluateRetrieval;
const report={...score(dataset,results),mode:mode==='--reviewed'?'reviewed':'standalone',inputs:{datasetSha256:digest(datasetBytes),resultsSha256:digest(resultBytes)},createdAt:new Date().toISOString()};
await writeFile(destination,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({report:destination,splits:report.splits,formalM5ToM8Complete:false}));
