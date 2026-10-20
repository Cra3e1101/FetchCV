import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {activeWorkspace} from '../../tests/helpers/active-workspace.mjs';
import {createWindowsParser} from '../../packages/knowledge/windows-parser.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root&&path.isAbsolute(root));
const python=path.resolve('backend/.venv-m1/Scripts/python.exe');
const fixture=spawnSync(python,['-B','tests/fixtures/pdf-layout.py'],{encoding:'utf8',windowsHide:true,timeout:30000});
assert.equal(fixture.status,0,fixture.stderr);
const runtime=path.join(root,'parser-assets'),workRoot=path.join(root,'parser-work');
const staged=spawnSync(python,['-B','-c','import sys;from workers.parser.stage_runtime import stage;stage(*sys.argv[1:])',runtime,
  path.resolve(root,'../m5-runtime-download-02/python-3.14.7-embed-amd64.zip'),path.resolve('.m1-work/w3-python-20260911-192209/wheelhouse/pypdf-6.4.1-py3-none-any.whl')],{encoding:'utf8',windowsHide:true,timeout:60000});
assert.equal(staged.status,0,staged.stderr);await mkdir(workRoot);
const parse=await createWindowsParser({runtime,workRoot,workspaceRoot:root});
const f=await activeWorkspace('pdf-layout-app');
try{
  const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
  const file=path.join(root,'rotated-layout.pdf'),bytes=await readFile(file),hash=b=>createHash('sha256').update(b).digest('hex');
  const captured=await f.request('source.import',{...scope,title:'Synthetic rotated PDF',format:'pdf',contentBase64:bytes.toString('base64')});
  const ingestion=f.store.createIngestion(),parsed=await ingestion.process(captured.jobId,parse);
  const doc=await f.request('document.read',{...scope,documentId:parsed.documentId});
  assert.ok(doc.text.includes('ROTATED-0: 17 NOT 71'));
  const stored=ingestion.db.prepare('SELECT parser_revision,quality_json FROM Document WHERE id=?').get(parsed.documentId);
  const quality=JSON.parse(stored.quality_json);
  assert.equal(stored.parser_revision,'local-structured-1.2');assert.equal(quality.status,'needs_review');assert.equal(quality.layoutWarning,true);
  const found=await f.request('knowledge.search',{...scope,query:'ROTATED',maxTokens:4000});
  assert.equal(found.items.length,0,'review-only evidence must not enter trusted retrieval');
  assert.equal(hash(await readFile(file)),hash(bytes));
  await writeFile(path.join(root,'pdf-layout-app-report.json'),JSON.stringify({success:true,parserRevision:stored.parser_revision,quality,
    rotatedFactPreserved:true,searchHits:0,inputSha256:hash(bytes),formalM5ToM8Complete:false},null,2),{flag:'wx'});
  console.log(JSON.stringify({success:true,rotatedFactPreserved:true,searchHits:0,quality}));
}finally{f.store.close();}
