import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {auditAnnotations} from '../scripts/m5-m8/annotation-audit.mjs';

test('pilot exports traceable source bytes and empty review records, never a sealed golden',async()=>{
  const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root);
  const child=spawnSync(process.execPath,['scripts/m5-m8/prepare-review-pilot.mjs'],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(child.status,0,child.stderr);
  const packet=JSON.parse(await readFile(path.join(root,'review-pilot','packet.json')));
  assert.equal(packet.items.filter(i=>i.kind==='retrieval').length,12);
  assert.equal(packet.items.filter(i=>i.kind==='memory').length,10);
  assert.ok(packet.items.every(i=>i.split==='tune'&&i.annotations.length===0&&!i.adjudication));
  assert.equal(auditAnnotations(packet).readyForMetricRun,false);
  assert.equal(packet.items.find(i=>i.id==='m08').asOf,'2026-09-10T00:00:00Z');
  for(const doc of packet.documents){
    const bytes=await readFile(path.join(root,'review-pilot',doc.sourceFile));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),doc.sha256);
    assert.equal(bytes.toString('utf8'),doc.text);
  }
  const before=await readFile(path.join(root,'review-pilot','packet.json'));
  const repeat=spawnSync(process.execPath,['scripts/m5-m8/prepare-review-pilot.mjs'],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.notEqual(repeat.status,0);assert.match(repeat.stderr,/EEXIST/);
  assert.deepEqual(await readFile(path.join(root,'review-pilot','packet.json')),before);
});
