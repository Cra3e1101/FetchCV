import assert from 'node:assert/strict';
import path from 'node:path';
import {stageNsis} from '../m4/stage-nsis.mjs';
const root=process.env.M1_ALLOWED_DELETE_ROOT;
assert.ok(root&&path.isAbsolute(root));
const zipTool=path.resolve(root,'../m58-package-11/builder-cache/7zip@1.0.0/7zip-win-x64-a34pt/bin/7za.exe');
const archives=process.argv.includes('--offline-verified')?{
  'nsis-3.0.4.1':path.resolve(root,'../m58-package-11/builder-cache/nsis-3.0.4.1/nsis-3.0.4.1.7z'),
  'nsis-resources-3.4.1':path.resolve(root,'../m4a-packaged-01/builder-cache/nsis-resources-3.4.1/nsis-resources-3.4.1.7z'),
}:undefined;
const records=await stageNsis(root,zipTool,archives);
console.log(JSON.stringify({passed:true,toolsets:records.map(({name,files})=>({name,files:files.length})),compilerExecuted:false}));
