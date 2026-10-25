import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";
import { developmentProfile } from "./dev-profile.mjs";
import { prepareDevelopmentRuntime } from "./dev-runtime.mjs";
import { resolveElectronRuntime } from "./electron-runtime.mjs";
import { ownedProcessOptions, stopOwnedProcessTree } from "./owned-process-tree.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const option = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const workRoot = path.resolve(option("--work-root") || path.join(project, ".m1-work", "desktop-dev"));
const run = path.join(workRoot, `run-${Date.now()}`);
await fs.mkdir(run, { recursive: true });
const log = createWriteStream(path.join(run, "desktop.log"), { flags: "a" });
let server, child;
let cleanup, interruptedCode, finishInterruption;
const interrupted = new Promise(resolve => { finishInterruption = resolve; });
const stop = signal => {
  interruptedCode ||= signal === "SIGINT" ? 130 : 143;
  cleanup ||= stopOwnedProcessTree(child);
  cleanup.then(() => finishInterruption(interruptedCode), error => {
    console.error(error);
    finishInterruption(1);
  });
};
const checkInterrupted = () => { if (interruptedCode) throw new Error("Desktop launch interrupted"); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const electronRuntime = await resolveElectronRuntime({ projectRoot: project, executable: option("--electron") });
  const profile = developmentProfile({ workRoot, userData: option("--user-data") });
  const { data } = profile;
  if (profile.shared) {
    // Fail closed on a mistyped/deleted installed profile instead of showing an empty workspace.
    await fs.access(path.join(data, "data", "fetchcv.db"));
  }
  const temp = path.join(run, "temp");
  const outputDir = path.join(run, "runtime");
  for (const dir of [data, profile.session, temp, outputDir]) await fs.mkdir(dir, { recursive: true });
  process.env.TEMP = temp;
  process.env.TMP = temp;
  // Keep Vite's dependency cache across launches; Vite invalidates it when its
  // lockfile/config changes. Electron output is reused only after validation.
  const preparationStarted = performance.now();
  const prepared = await prepareDevelopmentRuntime({ project, workRoot, outputDir });
  checkInterrupted();
  const runtime = prepared.directory;
  const runtimePreparationMs = Math.round(performance.now() - preparationStarted);
  const bootstrap = path.join(run, "bootstrap.cjs");
  const softwareRendering = process.argv.includes("--software-rendering");
  const packageName = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8")).name;
  await fs.writeFile(bootstrap, `const {app}=require('electron');${softwareRendering ? "app.disableHardwareAcceleration();" : ""}app.setName(${JSON.stringify(packageName)});app.setAppPath(${JSON.stringify(project)});app.on('render-process-gone',(_event,_contents,details)=>console.error('renderer-exit',JSON.stringify(details)));app.on('child-process-gone',(_event,details)=>console.error('child-exit',JSON.stringify(details)));import(${JSON.stringify(pathToFileURL(path.join(runtime, "main.mjs")).href)}).catch(e=>{console.error(e);app.exit(1)});`);
  server = await createServer({ root: project, cacheDir: path.join(workRoot, "vite-cache"), server: { host: "127.0.0.1", port: 14361, strictPort: false, open: false } });
  checkInterrupted();
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  const python = process.env.FETCHCV_PYTHON || path.join(project, "backend", ".venv-m1", "Scripts", "python.exe");
  await fs.access(python);
  const env = { ...process.env, FETCHCV_DEV_SERVER_URL: url, FETCHCV_DEV_USER_DATA: data, FETCHCV_DEV_SESSION_DATA: profile.session, FETCHCV_DEV_TEMP: temp,
    FETCHCV_PYTHON: python, PYTHONDONTWRITEBYTECODE: "1", FETCHCV_SIDECAR_LOG: "1", TEMP: temp, TMP: temp };
  // Never inherit a test workspace or another app's model credentials/data paths.
  for (const key of Object.keys(env)) {
    if (/^FETCHCV_(E2E_|PROVIDER_)/.test(key) || ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "FETCHCV_V2_STORAGE_ROOT", "FETCHCV_DATABASE_URL", "FETCHCV_ARTIFACT_ROOT", "FETCHCV_WORKSPACE_ROOT", "FETCHCV_SETTINGS_FILE", "FETCHCV_XHS_CREDENTIAL_FILE"].includes(key.toUpperCase())) delete env[key];
  }
  const args = [bootstrap];
  const debugPort = option("--inspect-ui");
  if (debugPort) {
    if (!/^\d+$/.test(debugPort) || Number(debugPort) < 1024 || Number(debugPort) > 65535) throw Error("Invalid inspection port");
    args.push(`--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1");
    env.ELECTRON_ENABLE_LOGGING = "1";
    env.ELECTRON_LOG_FILE = path.join(run, "chromium.log");
  }
  const executable = electronRuntime.executable;
  checkInterrupted();
  child = spawn(executable, args, { cwd: project, env, stdio: ["ignore", "pipe", "pipe"], ...ownedProcessOptions });
  const finished = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
  // Observe an immediate launch failure even while writing the launch record.
  void finished.catch(() => {});
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const status = { project, workRoot, run, runtime, electronRuntime, runtimeReused: prepared.reused, runtimePreparationMs, userData: data, sessionData: profile.session, sharedProfile: profile.shared, url, pid: child.pid, launcherPid: process.pid, startedAt: new Date().toISOString(), inspectionPort: debugPort || null };
  await fs.writeFile(path.join(workRoot, "current.json"), JSON.stringify(status, null, 2));
  await fs.writeFile(path.join(run, "launch.json"), JSON.stringify(status, null, 2));
  console.log(JSON.stringify(status));
  const code = await Promise.race([finished, interrupted]);
  await fs.writeFile(path.join(run, "exit.json"), JSON.stringify({ exitCode: code, closedAt: new Date().toISOString() }));
  process.exitCode = interruptedCode || code || 0;
} catch (error) {
  log.write(String(error.stack || error) + "\n");
  console.error(error);
  process.exitCode = interruptedCode || 1;
} finally {
  try { await (cleanup ||= stopOwnedProcessTree(child)); }
  catch (error) { console.error(error); process.exitCode = 1; }
  await server?.close();
  log.end();
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
