import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,copyFile,writeFile,readFile,stat} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {retrieve} from '../../packages/knowledge/retrieval.mjs';

const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root);
const baseline=path.resolve(process.argv[2]);
assert.equal(path.dirname(baseline),path.dirname(root),'only sibling synthetic baseline');
for(const distribution of ['uniform','skewed']){
  const dir=path.join(root,distribution);await mkdir(dir);
  const original=path.join(baseline,`scale-${distribution}/copies/v2/archive.db`),copy=path.join(dir,'archive.db');
  for(const suffix of ['','-wal','-shm']){
    try{await stat(original+suffix);}catch(e){if(e.code==='ENOENT'&&suffix)continue;throw e;}
    await copyFile(original+suffix,copy+suffix,1);
  }
  const db=new DatabaseSync(copy,{readOnly:true});
  try{
    const workspaceId=db.prepare('SELECT id FROM Workspace').get().id;
    const {candidate_id:candidateId,id:jobId}=db.prepare('SELECT * FROM Job ORDER BY id LIMIT 1').get();
    let captured;
    const proxy={prepare(sql){const statement=db.prepare(sql);return sql.startsWith('WITH scored')?{all(...bindings){captured={sql,bindings};return [];}}:statement;}};
    const saved=process.argv.find(arg=>arg.startsWith('--plans='));
    if(saved)captured=JSON.parse(await readFile(path.join(saved.slice(8),`${distribution}-query-plan.json`),'utf8')).baseline;
    else retrieve(proxy,{scope:{workspaceId,candidateId,jobId},query:'Synthetic'});
    assert.ok(captured);
    const cross=captured.sql.replace('FROM SearchFTS2 JOIN SearchChunk c','FROM SearchFTS2 CROSS JOIN SearchChunk c');
    const columns=cross.match(/SELECT (c\.\*,.*?),bm25/)[1];
    const joins=cross.match(/(JOIN Document[\s\S]*?)\s+WHERE SearchFTS2 MATCH/)[1];
    const narrow=cross.replace(`SELECT ${columns},bm25`,'SELECT c.id,c.text_hash,s.id source_id,bm25')
      .replace('SELECT * FROM diverse WHERE source_rank<=2 ORDER BY score,id LIMIT 60',
        `SELECT ${columns},picked.score,picked.text_rank,picked.source_rank FROM (SELECT * FROM diverse WHERE source_rank<=2 ORDER BY score,id LIMIT 60) picked JOIN SearchChunk c ON c.id=picked.id ${joins} ORDER BY picked.score,c.id`);
    const plans={baseline:db.prepare('EXPLAIN QUERY PLAN '+captured.sql).all(...captured.bindings),cross:db.prepare('EXPLAIN QUERY PLAN '+cross).all(...captured.bindings)};
    const execution=[];
    function lazy(){
      const eligible=cross.split('WHERE SearchFTS2 MATCH ? AND ')[1].split('), unique_text AS (')[0];
      const details=db.prepare(`SELECT ${columns} FROM json_each(?) batch CROSS JOIN SearchChunk c ON c.id=batch.value ${joins} WHERE ${eligible}`);
      const result=[],texts=new Set(),counts=new Map();let batch=[];
      function consume(){
        const allowed=new Map(details.all(JSON.stringify(batch.map(row=>row.chunk_id)),...captured.bindings.slice(1)).map(row=>[row.id,row]));
        for(const item of batch){const row=allowed.get(item.chunk_id);if(!row||texts.has(row.text_hash))continue;texts.add(row.text_hash);
          const count=counts.get(row.source_id)||0;if(count>=2)continue;counts.set(row.source_id,count+1);
          result.push(Object.assign(row,{score:item.score,text_rank:1,source_rank:count+1}));if(result.length===60)break;}
        batch=[];
      }
      for(const row of db.prepare('SELECT chunk_id,bm25(SearchFTS2,0,0,4,2,1) score FROM SearchFTS2 WHERE SearchFTS2 MATCH ? ORDER BY score,chunk_id').iterate(captured.bindings[0])){
        batch.push(row);if(batch.length===64)consume();if(result.length===60)break;
      }
      if(batch.length&&result.length<60)consume();return result;
    }
    function stream(){
      const sql=cross.replace(`SELECT ${columns},bm25`,'SELECT c.id,c.text_hash,s.id source_id,bm25')
        .replace('SELECT * FROM diverse WHERE source_rank<=2 ORDER BY score,id LIMIT 60','SELECT * FROM scored ORDER BY score,id');
      const picked=[],texts=new Set(),counts=new Map();
      for(const row of db.prepare(sql).iterate(...captured.bindings)){
        if(texts.has(row.text_hash))continue;texts.add(row.text_hash);
        const count=counts.get(row.source_id)||0;if(count>=2)continue;
        counts.set(row.source_id,count+1);picked.push({...row,text_rank:1,source_rank:count+1});if(picked.length===60)break;
      }
      const details=new Map(db.prepare(`SELECT ${columns} FROM SearchChunk c ${joins} WHERE c.id IN(SELECT value FROM json_each(?))`).all(JSON.stringify(picked.map(row=>row.id))).map(row=>[row.id,row]));
      return picked.map(row=>Object.assign(details.get(row.id),{score:row.score,text_rank:row.text_rank,source_rank:row.source_rank}));
    }
    if(process.argv.includes('--execute')){
      for(let i=0;i<5;i++){
        let reference;
        if(distribution==='uniform'){
          const start=performance.now();reference=db.prepare(captured.sql).all(...captured.bindings);
          execution.push({variant:'baseline',ms:performance.now()-start,rows:reference.length});
        }
        const start=performance.now(),result=db.prepare(cross).all(...captured.bindings);
        execution.push({variant:'cross',ms:performance.now()-start,rows:result.length});
        if(reference)assert.deepEqual(result,reference,'all SQL rows including rank and score must be identical');
        const narrowStart=performance.now(),narrowResult=db.prepare(narrow).all(...captured.bindings);
        execution.push({variant:'narrow',ms:performance.now()-narrowStart,rows:narrowResult.length});
        assert.deepEqual(narrowResult,result,'late materialization must retain all ranked rows and fields');
        const streamStart=performance.now(),streamResult=stream();
        execution.push({variant:'stream',ms:performance.now()-streamStart,rows:streamResult.length});
        assert.deepEqual(streamResult,result,'ordered streaming must retain global dedup and per-source diversity');
        const lazyStart=performance.now(),lazyResult=lazy();
        execution.push({variant:'lazy',ms:performance.now()-lazyStart,rows:lazyResult.length});
        assert.deepEqual(lazyResult,result,'batched eligibility must retain all candidate rows and order');
      }
    }
    await writeFile(path.join(root,`${distribution}-query-plan.json`),JSON.stringify({distribution,copy,baseline:captured,crossSQL:cross,narrowSQL:narrow,plans,execution,baselineSkipped:distribution==='skewed'},null,2),{flag:'wx'});
    console.log(JSON.stringify({distribution,execution,planFile:path.join(root,`${distribution}-query-plan.json`)}));
  }finally{db.close();}
}
