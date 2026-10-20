import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

test('local parser preserves Unicode/table/heading origins and rejects hostile containers without disk writes',()=>{
  const result=spawnSync(path.resolve('backend/.venv-m1/Scripts/python.exe'),['-B','tests/fixtures/parser-formats.py'],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const report=JSON.parse(result.stdout);assert.ok(report.checks>=12);assert.equal(report.deletions,0);
});
