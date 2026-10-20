import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.env.M1_ALLOWED_DELETE_ROOT;assert.ok(root&&path.isAbsolute(root));
const result=spawnSync(path.resolve('backend/.venv-m1/Scripts/python.exe'),['-B','scripts/m5-m8/parser-corpus.py'],{encoding:'utf8',windowsHide:true,timeout:90000});
await writeFile(path.join(root,'parser-corpus-process.json'),JSON.stringify({status:result.status,signal:result.signal,error:result.error?.message,stdout:result.stdout,stderr:result.stderr},null,2),{flag:'wx'});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
process.exitCode=result.status??1;
