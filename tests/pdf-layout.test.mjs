import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

test('PDF double columns, cell values and rotated facts remain recoverable with exact ranges',()=>{
  const child=spawnSync(path.resolve('backend/.venv-m1/Scripts/python.exe'),['-B','tests/fixtures/pdf-layout.py'],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(child.status,0,child.stderr||child.stdout);
  const report=JSON.parse(child.stdout);
  assert.equal(report.documents,10);assert.equal(report.expected,140);assert.equal(report.recovered,140);
  assert.ok(report.results.every(r=>r.quality.status==='needs_review'&&r.quality.layoutWarning===true&&!r.quality.ocrRequired));
});
