import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {activeWorkspace} from './helpers/active-workspace.mjs';

test('offline evaluator consumes actual APP retrieval and refuses to overwrite evidence',async()=>{
  const f=await activeWorkspace('retrieval-evaluation-cli');
  try{
    const scope={candidateId:f.conversation.candidate_id,jobId:f.conversation.job_id};
    const text='OfflineMetricMarker781 is a synthetic measurement label, not a real resume.';
    const imported=await f.request('source.import',{...scope,title:'Synthetic evaluation',format:'txt',contentBase64:Buffer.from(text).toString('base64')});
    const ingestion=f.store.createIngestion();
    await ingestion.process(imported.jobId,async()=>({schemaVersion:1,parserId:'fetchcv-local',parserRevision:'local-structured-1',format:'txt',offsetUnit:'unicode_codepoint',source_text:text,
      blocks:[{type:'text',text,charStart:0,charEnd:[...text].length,headingPath:[],originRef:{type:'text'}}],quality:{status:'ready'}}));
    const document=ingestion.db.prepare('SELECT id FROM Document WHERE source_id=? AND active=1').get(imported.sourceId);
    assert.ok(document);
    const dataset={version:1,revision:'synthetic-cli-1',annotationOrigin:'synthetic',documents:[{id:document.id,family:'synthetic-marker',split:'sealed'}],
      queries:[{id:'positive',split:'sealed',families:['synthetic-marker'],slices:['exact-id'],answerable:true,judgments:[{documentId:document.id,grade:2}]},
        {id:'absent',split:'sealed',families:['synthetic-marker'],slices:['no-answer'],answerable:false,judgments:[]}]};
    const results=[];
    for(const [queryId,query]of [['positive','OfflineMetricMarker781'],['absent','NoSuchMarker479']]){
      const result=await f.request('knowledge.search',{...scope,query});
      results.push({queryId,datasetRevision:dataset.revision,revisions:{index:result.generation,config:result.revision,model:'none',prompt:'none'},documentIds:[...new Set(result.items.map(hit=>hit.documentId))]});
    }
    const input=path.join(f.root,'dataset.json'),ranking=path.join(f.root,'results.jsonl'),output=path.join(f.root,'evaluation.json');
    await writeFile(input,JSON.stringify(dataset),{flag:'wx'});await writeFile(ranking,results.map(r=>JSON.stringify(r)).join('\n')+'\n',{flag:'wx'});
    const args=['scripts/m5-m8/evaluate-retrieval.mjs',input,ranking,output];
    execFileSync(process.execPath,args,{encoding:'utf8',windowsHide:true,timeout:30000});
    const bytes=await readFile(output),report=JSON.parse(bytes);
    assert.equal(report.splits.sealed.recall20,1);assert.equal(report.splits.sealed.ndcg10,1);
    assert.equal(report.splits.sealed.answerableQueries,1);assert.equal(report.splits.sealed.noAnswerQueries,1);
    assert.equal(report.annotationOrigin,'synthetic');assert.equal(report.formalM5ToM8Complete,false);
    assert.equal(report.inputs.datasetSha256,createHash('sha256').update(await readFile(input)).digest('hex'));
    const duplicate=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,timeout:30000});
    assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/EEXIST/);assert.deepEqual(await readFile(output),bytes);
    // Launch from Node's installation directory: cwd must not expand the input
    // boundary to allow reading its executable as an evaluation dataset.
    const foreign=spawnSync(process.execPath,[path.resolve(args[0]),process.execPath,ranking,path.join(f.root,'foreign.json')],
      {cwd:path.dirname(process.execPath),encoding:'utf8',windowsHide:true,timeout:30000});
    assert.notEqual(foreign.status,0);assert.match(foreign.stderr,/input outside project\/stable work root/);
  }finally{f.store.close();}
});
