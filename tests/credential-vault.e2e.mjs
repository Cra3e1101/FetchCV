import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.env.M1_ALLOWED_DELETE_ROOT;
assert.ok(root && path.isAbsolute(root));
for (const name of ['user-data','session-data','vault']) await mkdir(path.join(root,name));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['NODE_OPTIONS','ELECTRON_RUN_AS_NODE'].includes(key)));
for (const stage of ['create','recover']) {
  await new Promise((resolve,reject) => {
    const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('tests/fixtures/electron-credential-vault.cjs'),stage], { env,stdio:'inherit',windowsHide:true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('credential probe timeout')); },35000);
    child.on('error',error => { clearTimeout(timer); reject(error); });
    child.on('exit',code => { clearTimeout(timer); if (code !== 0) reject(new Error(`credential ${stage} exited ${code}`)); else resolve(); });
  });
  const report = JSON.parse(await readFile(path.join(root,`${stage}-report.json`),'utf8'));
  assert.equal(report.success,true); assert.equal(report.recovered,true); assert.equal(report.crossScopeDenied,true);
  console.log(JSON.stringify(report));
}
