import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createWindowsParser} from '../packages/knowledge/windows-parser.mjs';
import {IngestScheduler} from '../packages/app/ingest-scheduler.mjs';
import {activeWorkspace} from './helpers/active-workspace.mjs';
import {mkdir,writeFile,readFile,readdir,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('real LPAC parsing flows through the durable APP queue into searchable, citable document versions',async()=>{
  const root=process.env.M1_ALLOWED_DELETE_ROOT,runtime=path.join(root,'parser-assets');
  const staged=spawnSync(path.resolve('backend/.venv-m1/Scripts/python.exe'),['-B','-c','import sys;from workers.parser.stage_runtime import stage;stage(*sys.argv[1:])',runtime,path.resolve(root,'../m5-runtime-download-02/python-3.14.7-embed-amd64.zip'),path.resolve('.m1-work/w3-python-20260911-192209/wheelhouse/pypdf-6.4.1-py3-none-any.whl')],{encoding:'utf8',windowsHide:true});
  assert.equal(staged.status,0,staged.stderr);
  const workRoot=path.join(root,'parser-work');await mkdir(workRoot);
  const manifest=await readFile(path.join(runtime,'runtime-manifest.json')),key=createHash('sha256').update(manifest).digest('hex').slice(0,24);
  const partial=path.join(workRoot,'runtime-'+key);await mkdir(partial);await writeFile(path.join(partial,'interrupted-copy.txt'),'retained partial copy',{flag:'wx'});
  const parse=await createWindowsParser({runtime,workRoot,workspaceRoot:root});
  const isolated=(await readdir(workRoot)).filter(name=>name.startsWith('isolated-runtime-'));assert.equal(isolated.length,1);
  assert.equal(await readFile(path.join(workRoot,isolated[0],'interrupted-copy.txt'),'utf8'),'retained partial copy');
  assert.equal((await readdir(workRoot)).filter(name=>name.startsWith('staging-runtime-')).length,0);
  const outside=path.join(root,'synthetic-external'),linkedWorkspace=path.join(root,'linked-workspace');await mkdir(outside);await mkdir(linkedWorkspace);
  await symlink(outside,path.join(linkedWorkspace,'derived'),'junction');
  await assert.rejects(createWindowsParser({runtime,workspaceRoot:linkedWorkspace,workRoot:path.join(linkedWorkspace,'derived','parser')}),{code:'parser_work_root_escape'});
  assert.deepEqual(await readdir(outside),[]);
  const f=await activeWorkspace('parser-application');let scheduler;
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
    const captured=await f.request('source.import',{...scope,title:'Synthetic LPAC source',format:'txt',contentBase64:Buffer.from('SQL 中文😀 isolated parser evidence').toString('base64')});
    scheduler=new IngestScheduler(f.store.createIngestion(),parse);
    let job;const deadline=Date.now()+60000;
    do{job=(await f.request('source.status',{...scope,sourceId:captured.sourceId})).jobs[0];if(Date.now()>deadline)throw Error('APP parse timed out');if(['failed','cancelled'].includes(job.state))assert.fail(JSON.stringify(job));if(job.state!=='completed')await new Promise(r=>setTimeout(r,100));}while(job.state!=='completed');
    const read=await f.request('document.read',{...scope,documentId:job.document_id});assert.match(read.text,/SQL 中文😀/);
    const found=await f.request('knowledge.search',{...scope,query:'isolated parser'});assert.ok(found.items.length);
    const cited=await f.request('citation.resolve',{...scope,citation:found.items[0].citation});assert.match(cited.text,/isolated parser evidence/);
    await f.request('source.revoke',{...scope,sourceId:captured.sourceId,expectedRevision:1});scheduler.notify();
    assert.equal((await f.request('knowledge.search',{...scope,query:'isolated parser'})).items.length,0);
  }finally{await scheduler?.close();f.store.close();}
});
