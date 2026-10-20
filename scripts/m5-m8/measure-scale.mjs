import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {appendFile,writeFile} from 'node:fs/promises';
import {scaleFixture} from './scale-fixture.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root&&path.isAbsolute(root));
const samples=30,rows=[],file=path.join(root,'scale-report.json');
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]??null;
const summary=values=>({n:values.length,p50:percentile(values,.5),p95:percentile(values,.95),max:values.length?Math.max(...values):null});
const jsonl=path.join(root,'scale-queries.jsonl');await writeFile(jsonl,'',{flag:'wx'});
for(const distribution of ['uniform','skewed']){
  console.log(JSON.stringify({stage:'fixture',distribution}));
  const fixtureStarted=performance.now(),f=await scaleFixture(distribution),fixtureMs=performance.now()-fixtureStarted;
  f.store.close();
  // A synchronous SQLite query cannot be interrupted by a same-thread timer.
  // Each build/query therefore runs in a bounded child, including the first one.
  const initial=JSON.parse(execFileSync(process.execPath,['scripts/m5-m8/measure-first-query.mjs',f.root,f.scope.candidateId,f.scope.jobId,'Synthetic','--index-build'],{encoding:'utf8',windowsHide:true,timeout:120000}));
  const {queryMs:initialBuildAndQueryMs,generation,navigation}=initial;
  console.log(JSON.stringify({stage:'index-ready',distribution,initialBuildAndQueryMs,navigationSamples:navigation.length}));
  const queries=[];
  for(let i=0;i<samples;i++){
    const started=performance.now();
    const output=execFileSync(process.execPath,['scripts/m5-m8/measure-first-query.mjs',f.root,f.scope.candidateId,f.scope.jobId,i%2===0?'Synthetic':'SQL'],{encoding:'utf8',windowsHide:true,timeout:120000});
    const result={distribution,sample:i+1,...JSON.parse(output),processWallMs:performance.now()-started};
    assert.equal(result.generation,generation,'query must use the completed generation');
    queries.push(result);await appendFile(jsonl,JSON.stringify(result)+'\n');
  }
  const query=summary(queries.map(r=>r.queryMs)),payload=summary(queries.map(r=>r.payloadBytes)),navLag=summary(navigation.map(r=>r.lagMs));
  rows.push({distribution,counts:f.counts,sourceDistribution:f.sourceDistribution,messageDistribution:f.messageDistribution,fixtureMs,initialBuildAndQueryMs,
    firstQueryMs:query,openMs:summary(queries.map(r=>r.openMs)),processWallMs:summary(queries.map(r=>r.processWallMs)),payloadBytes:payload,
    navigation:{timerLagMs:navLag,requestMs:summary(navigation.map(r=>r.requestMs)),samples:navigation,acceptance:'observation_only_not_a_navigation_latency_gate'},
    observedGate:{readyIndexFirstQuery:query.p95<=200,payload:payload.max<=256*1024}});
}
const report={version:1,revision:'scale-app-dispatch-3',createdAt:new Date().toISOString(),queryDeadlineMs:120000,environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0].model,memoryBytes:os.totalmem()},rows,
  limitations:['synthetic captured text; not parser-quality or semantic-relevance measurement','fresh child process per query, existing ready index; OS cache is not flushed','APP dispatch timing excludes Electron IPC and painting; workspace open and process wall time reported separately','initialBuildAndQueryMs includes initial indexing AND retrieval, and is not included in ready-index p95','navigation samples include draining pending callbacks; sampling alone does not establish non-blocking UI or a latency gate','two fixed queries, one selected candidate/job; no claim to cover all query distributions','single-version sources with 5% long text; repeated-version stress and human sealed benchmark still pending'],formalM5ToM8Complete:false};
await writeFile(file,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({file,rows:rows.map(({distribution,firstQueryMs,initialBuildAndQueryMs,observedGate})=>({distribution,firstQueryMs,initialBuildAndQueryMs,observedGate}))}));
if(rows.some(row=>Object.values(row.observedGate).includes(false)))process.exitCode=2;
