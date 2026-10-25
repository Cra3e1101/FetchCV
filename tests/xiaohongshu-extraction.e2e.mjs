// Default: synthetic pages in a real sandboxed Electron renderer, no site access.
// --live-xhs: one anonymous production-bridge search, stopping on access restrictions.
// Pass --electron <absolute executable> to reuse an already working local runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { resolveElectronRuntime } from '../scripts/electron-runtime.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let mode = 'offline';
let executableOverride;
while (args.length) {
  const arg = args.shift();
  if (arg === '--live-xhs' && mode === 'offline') mode = 'live-xhs';
  else if (arg === '--electron' && args[0] && path.isAbsolute(args[0])) executableOverride = args.shift();
  else throw new Error('Usage: node tests/xiaohongshu-extraction.e2e.mjs [--electron <absolute path>] [--live-xhs]');
}
const runtime = await resolveElectronRuntime({ projectRoot, executable: executableOverride });
const { executable } = runtime;
const output = path.join(projectRoot, '.m1-evidence', `xiaohongshu-extraction-${mode}-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(FETCHCV_|ELECTRON_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$)/i.test(key)) delete env[key];
}
for (const [key, dir] of Object.entries({ APPDATA: 'roaming', LOCALAPPDATA: 'local', TEMP: 'tmp', TMP: 'tmp' })) {
  env[key] = path.join(output, dir);
  await fs.mkdir(env[key], { recursive: true });
}
env.FETCHCV_BRIDGE_E2E_OUTPUT = output;
env.FETCHCV_BRIDGE_E2E_MODE = mode;
const fixture = 'electron-xiaohongshu-extraction.cjs';
const started = new Date().toISOString();
const child = spawn(executable, [`--user-data-dir=${path.join(output, 'profile')}`, path.join(projectRoot, 'tests/fixtures', fixture)], {
  cwd: projectRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
const stdout = [], stderr = [];
child.stdout.on('data', chunk => stdout.push(chunk));
child.stderr.on('data', chunk => stderr.push(chunk));
let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill();
}, 120000);
const outcome = await new Promise(resolve => {
  child.once('error', error => resolve({ error: error.message }));
  child.once('close', (code, signal) => resolve({ code, signal }));
});
clearTimeout(timeout);
// Keep diagnostics, but never print temporary access grants from Chromium logs.
const redact = value => String(value).replace(/([?&](?:xsec_token|token|session|code)=)[^&\s"']+/gi, '$1[redacted]');
await fs.writeFile(path.join(output, 'stdout.log'), redact(Buffer.concat(stdout)));
await fs.writeFile(path.join(output, 'stderr.log'), redact(Buffer.concat(stderr)));
let observed;
try { observed = JSON.parse(await fs.readFile(path.join(output, 'bridge-report.json'), 'utf8')); } catch { /* Startup failure has no report. */ }
const report = { started, finished: new Date().toISOString(), mode, executable, runtime, output, outcome, timedOut,
  ok: outcome.code === 0 && observed?.ok === true, checks: observed?.checks || [],
  livePage: observed?.livePage || { status: 'not_exercised' }, error: observed?.error || null };
await fs.writeFile(path.join(output, 'launcher-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : outcome.code === 3 ? 3 : 1;
