import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewCorpus} from '../scripts/m5-m8/review-corpus.mjs';
import {auditAnnotations} from '../scripts/m5-m8/annotation-audit.mjs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

test('review draft covers 400 retrieval and 100 memory items without inventing labels',()=>{
  const packet=buildReviewCorpus();const audit=auditAnnotations(packet);
  assert.equal(packet.documents.length,60);
  assert.equal(audit.retrieval,400);assert.equal(audit.memory,100);
  assert.deepEqual(audit.splitCounts,{tune:200,validation:100,sealed:100});
  assert.equal(audit.reviewed,0);assert.equal(audit.readyForMetricRun,false);
  assert.equal(packet.sealedStatus,'proposed_not_sealed');
  assert.equal(new Set(packet.items.map(i=>i.prompt)).size,500);
  assert.equal(new Set(packet.documents.map(d=>d.family)).size,20);
  assert.ok(packet.items.every(i=>i.annotations.length===0&&!i.adjudication));
  for(const d of packet.documents)assert.equal(d.sha256,createHash('sha256').update(d.text).digest('hex'));
  assert.ok(packet.items.some(i=>i.slices.includes('historical')));
  assert.ok(packet.items.some(i=>i.slices.includes('revocation')));
  assert.ok(packet.items.some(i=>i.slices.includes('secret')));
});

test('export includes exact source bytes, reviewer pages and hashes, and refuses overwrite',async()=>{
  const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root);
  const run=()=>spawnSync(process.execPath,['scripts/m5-m8/prepare-review-corpus.mjs'],{encoding:'utf8',windowsHide:true,timeout:15000});
  const child=run();assert.equal(child.status,0,child.stderr);
  const output=path.join(root,'review-corpus'),manifest=JSON.parse(await readFile(path.join(output,'manifest.json')));
  assert.equal(manifest.files.length,66);assert.equal(manifest.reviewed,0);
  const assignments=JSON.parse(await readFile(path.join(output,'review-assignments.json')));
  assert.equal(assignments.status,'unassigned');assert.equal(assignments.primary.length,500);
  assert.equal(new Set(assignments.secondary).size,100);
  assert.equal(assignments.secondary.filter(id=>/-q\d+$/.test(id)).length,80);
  assert.equal(assignments.secondary.filter(id=>/-m\d+$/.test(id)).length,20);
  for(const file of manifest.files){const bytes=await readFile(path.join(output,file.path));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
  const before=await readFile(path.join(output,'packet.json'));const repeat=run();assert.notEqual(repeat.status,0);assert.match(repeat.stderr,/EEXIST/);
  assert.deepEqual(await readFile(path.join(output,'packet.json')),before);
});
