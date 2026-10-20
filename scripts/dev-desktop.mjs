import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createServer } from "vite";
import { developmentProfile } from "./dev-profile.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const option = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const workRoot = path.resolve(option("--work-root") || path.join(project, ".m1-work", "desktop-dev"));
const run = path.join(workRoot, `run-${Date.now()}`);
await fs.mkdir(run, { recursive: true });
const log = createWriteStream(path.join(run, "desktop.log"), { flags: "a" });
let server, child;
try {
  const profile = developmentProfile({ workRoot, userData: option("--user-data") });
  const { data } = profile;
  if (profile.shared) {
    // Fail closed on a mistyped/deleted installed profile instead of showing an empty workspace.
    await fs.access(path.join(data, "data", "fetchcv.db"));
  }
  const temp = path.join(run, "temp");
  const runtime = path.join(run, "runtime");
  for (const dir of [data, profile.session, temp, runtime]) await fs.mkdir(dir, { recursive: true });
  process.env.TEMP = temp;
  process.env.TMP = temp;
  // New per-run build/cache paths: no existing build, installer or database is removed.
  const banner = "import {createRequire as __fetchcvCreateRequire} from 'node:module'; const require=__fetchcvCreateRequire(import.meta.url);";
  for (const name of ["main", "storage-worker"]) {
    await build({ entryPoints: [path.join(project, "electron", `${name}.mjs`)], outfile: path.join(runtime, `${name}.mjs`), bundle: true, platform: "node", format: "esm", target: "node22", external: ["electron"], banner: { js: banner } });
  }
  for (const name of ["preload.cjs", "storage-preload.cjs"]) await fs.copyFile(path.join(project, "electron", name), path.join(runtime, name));
  const bootstrap = path.join(run, "bootstrap.cjs");
  const softwareRendering = process.argv.includes("--software-rendering");
  const packageName = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8")).name;
  await fs.writeFile(bootstrap, `const {app}=require('electron');${softwareRendering ? "app.disableHardwareAcceleration();" : ""}app.setName(${JSON.stringify(packageName)});app.setAppPath(${JSON.stringify(project)});app.on('render-process-gone',(_event,_contents,details)=>console.error('renderer-exit',JSON.stringify(details)));app.on('child-process-gone',(_event,details)=>console.error('child-exit',JSON.stringify(details)));import(${JSON.stringify(pathToFileURL(path.join(runtime, "main.mjs")).href)}).catch(e=>{console.error(e);app.exit(1)});`);
  server = await createServer({ root: project, cacheDir: path.join(run, "vite-cache"), server: { host: "127.0.0.1", port: 14361, strictPort: false, open: false } });
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  const python = process.env.FETCHCV_PYTHON || path.join(project, "backend", ".venv-m1", "Scripts", "python.exe");
  await fs.access(python);
  const env = { ...process.env, FETCHCV_DEV_SERVER_URL: url, FETCHCV_DEV_USER_DATA: data, FETCHCV_DEV_SESSION_DATA: profile.session, FETCHCV_DEV_TEMP: temp,
    FETCHCV_PYTHON: python, PYTHONDONTWRITEBYTECODE: "1", FETCHCV_SIDECAR_LOG: "1", TEMP: temp, TMP: temp };
  // Never inherit a test workspace or another app's model credentials/data paths.
  for (const key of Object.keys(env)) {
    if (/^FETCHCV_(E2E_|PROVIDER_)/.test(key) || ["ELECTRON_RUN_AS_NODE", "FETCHCV_V2_STORAGE_ROOT", "FETCHCV_DATABASE_URL", "FETCHCV_ARTIFACT_ROOT", "FETCHCV_WORKSPACE_ROOT", "FETCHCV_SETTINGS_FILE", "FETCHCV_XHS_CREDENTIAL_FILE"].includes(key)) delete env[key];
  }
  const args = [bootstrap];
  const debugPort = option("--inspect-ui");
  if (debugPort) {
    if (!/^\d+$/.test(debugPort) || Number(debugPort) < 1024 || Number(debugPort) > 65535) throw Error("Invalid inspection port");
    args.push(`--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1");
    env.ELECTRON_ENABLE_LOGGING = "1";
    env.ELECTRON_LOG_FILE = path.join(run, "chromium.log");
  }
  const executable = option("--electron") || path.join(project, "node_modules", "electron", "dist", "electron.exe");
  child = spawn(executable, args, { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const status = { project, workRoot, run, userData: data, sessionData: profile.session, sharedProfile: profile.shared, url, pid: child.pid, launcherPid: process.pid, startedAt: new Date().toISOString(), inspectionPort: debugPort || null };
  await fs.writeFile(path.join(workRoot, "current.json"), JSON.stringify(status, null, 2));
  console.log(JSON.stringify(status));
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  await fs.writeFile(path.join(run, "exit.json"), JSON.stringify({ exitCode: code, closedAt: new Date().toISOString() }));
  process.exitCode = code || 0;
} catch (error) {
  log.write(String(error.stack || error) + "\n");
  console.error(error);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) child.kill();
  await server?.close();
  log.end();
}
