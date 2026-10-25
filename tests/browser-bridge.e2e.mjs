import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { resolveElectronRuntime } from '../scripts/electron-runtime.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = process.argv.slice(2);
if (flags.some(flag=>!['--live-public','--live-xhs'].includes(flag)) || flags.length > 1) {
  throw new Error('Usage: node tests/browser-bridge.e2e.mjs [--live-public|--live-xhs]');
}
const mode = flags[0]?.slice(2) || 'offline';
const output = path.join(projectRoot,'.m1-work',`browser-bridge-e2e-${mode}-${Date.now()}`);
await fs.mkdir(output,{recursive:true});
const env = {...process.env};
for (const key of Object.keys(env)) {
  if (/^(FETCHCV_|ELECTRON_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$)/i.test(key)) delete env[key];
}
for (const [key,dir] of Object.entries({APPDATA:'roaming',LOCALAPPDATA:'local',TEMP:'tmp',TMP:'tmp'})) {
  env[key]=path.join(output,dir); await fs.mkdir(env[key],{recursive:true});
}
env.FETCHCV_BRIDGE_E2E_OUTPUT=output;
env.FETCHCV_BRIDGE_E2E_MODE=mode;
const runtime = await resolveElectronRuntime({projectRoot});
const started = new Date().toISOString();
const args = [`--user-data-dir=${path.join(output,'profile')}`,path.join(projectRoot,'tests/fixtures/electron-browser-bridge.cjs')];
const child = spawn(runtime.executable,args,{cwd:projectRoot,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
const stdout=[], stderr=[];
child.stdout.on('data',chunk=>stdout.push(chunk));
child.stderr.on('data',chunk=>stderr.push(chunk));
let timedOut=false;
const timer=setTimeout(()=>{
  timedOut=true;
  if (process.platform==='win32' && child.pid) {
    spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  } else child.kill();
},120000);
const outcome=await new Promise(resolve=>{
  child.once('error',error=>resolve({error:error.message}));
  child.once('close',(code,signal)=>resolve({code,signal}));
});
clearTimeout(timer);
await fs.writeFile(path.join(output,'stdout.log'),Buffer.concat(stdout));
await fs.writeFile(path.join(output,'stderr.log'),Buffer.concat(stderr));
let observed=null;
try { observed=JSON.parse(await fs.readFile(path.join(output,'bridge-report.json'),'utf8')); } catch { /* Startup crashes have no report. */ }
const report={started,finished:new Date().toISOString(),mode,runtime,output,outcome,timedOut,
  ok:outcome.code===0 && observed?.ok===true,checks:observed?.checks||[],
  livePage:observed?.livePage||{status:'not_observed'},error:observed?.error||null};
await fs.writeFile(path.join(output,'launcher-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
process.exitCode=report.ok ? 0 : outcome.code===3 ? 3 : 1;
