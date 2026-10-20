import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
test('actual Windows parser token blocks synthetic outside paths and loopback in the authorized dedicated profile',()=>{
  const result=spawnSync(path.resolve('backend/.venv-m1/Scripts/python.exe'),['-B','tests/fixtures/parser-container.py'],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:1024*1024});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const report=JSON.parse(result.stdout);assert.equal(report.launch.profile,'FetchCV.Parser.M5.20260922');assert.equal(report.result.appcontainer,true);
});
