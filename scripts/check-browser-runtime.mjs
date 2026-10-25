import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronRuntime } from "./electron-runtime.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = process.argv.slice(2);
if (options.includes("--help")) {
  console.log("Usage: node scripts/check-browser-runtime.mjs [--timeout-ms 15000] [--electron PATH] [--renderer]\nUses the shared desktop Electron selection. Checks app.ready; --renderer also verifies a sandboxed hidden window with a local data document. Never starts a sidecar or reads the configured user profile. Diagnostics remain in .m1-evidence/browser-runtime-check-*/. Exit: 0 ready, 1 unavailable, 2 setup error, 130 interrupted.");
  process.exit(0);
}
let timeoutMs = 15000;
let executableOverride;
let rendererRequested = false;
try {
  const seen = new Set();
  for (let index = 0; index < options.length; index++) {
    const name = options[index];
    if (seen.has(name)) throw new Error(`Duplicate option: ${name}`);
    seen.add(name);
    if (name === "--renderer") { rendererRequested = true; continue; }
    if (!["--timeout-ms", "--electron"].includes(name)) throw new Error(`Unknown option: ${name}`);
    const value = options[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value: ${name}`);
    if (name === "--electron") executableOverride = value;
    else timeoutMs = Number(value);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new Error("--timeout-ms must be an integer from 1000 to 30000.");
  }
} catch (error) {
  console.error(JSON.stringify({ success: false, verdict: "invalid_arguments", error: error.message }));
  process.exit(2);
}

let interrupted = false;
let activeChild;
let stopActive;
const onInterrupt = () => {
  interrupted = true;
  stopActive?.("interrupted");
};
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onInterrupt);

function runChild(executable, args, env, directory) {
  const stdoutFile = path.join(directory, "stdout.log");
  const stderrFile = path.join(directory, "stderr.log");
  const out = fs.openSync(stdoutFile, "wx");
  const err = fs.openSync(stderrFile, "wx");
  const started = Date.now();
  return new Promise((resolve) => {
    let finished = false;
    let stopReason = null;
    let cleanup = null;
    let cleanupProcess;
    let cleanupTimer;
    let emergencyTimer;
    const child = spawn(executable, args, { env, cwd: directory, windowsHide: true, stdio: ["ignore", out, err] });
    activeChild = child;
    const finish = (code, signal, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      clearTimeout(emergencyTimer);
      cleanupProcess?.kill();
      if (activeChild === child) { activeChild = null; stopActive = null; }
      fs.closeSync(out);
      fs.closeSync(err);
      resolve({
        exit_code: code,
        exit_code_hex: code === null ? null : `0x${(code >>> 0).toString(16)}`,
        signal, error: error?.message || null, stop_reason: stopReason, cleanup,
        duration_ms: Date.now() - started, stdout_file: stdoutFile, stderr_file: stderrFile,
      });
    };
    stopActive = (reason) => {
      if (finished || stopReason || child.exitCode !== null || child.signalCode !== null) return;
      stopReason = reason;
      // This PID belongs to the child spawned above; never kill by executable name.
      if (process.platform === "win32" && child.pid) {
        cleanup = "owned_process_tree_taskkill_requested";
        cleanupProcess = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        cleanupProcess.on("error", () => { cleanup = "taskkill_failed_child_kill_requested"; child.kill(); });
        cleanupProcess.on("exit", (code) => { if (code !== 0 && !finished) { cleanup = "taskkill_failed_child_kill_requested"; child.kill(); } });
      } else { cleanup = "owned_child_kill_requested"; child.kill("SIGKILL"); }
      cleanupTimer = setTimeout(() => { if (!finished) child.kill("SIGKILL"); }, 3000);
      emergencyTimer = setTimeout(() => {
        if (!finished) {
          cleanup = "termination_not_confirmed";
          child.unref();
          finish(null, null, new Error("owned_child_termination_not_confirmed"));
        }
      }, 5000);
    };
    const timer = setTimeout(() => stopActive?.("timeout"), timeoutMs);
    child.once("error", (error) => finish(null, null, error));
    child.once("exit", (code, signal) => finish(code, signal));
  });
}

let runDirectory;
try {
  const evidence = path.join(projectRoot, ".m1-evidence");
  fs.mkdirSync(evidence, { recursive: true });
  runDirectory = fs.mkdtempSync(path.join(evidence, `browser-runtime-check-${new Date().toISOString().replace(/[:.]/g, "-")}-`));
  const runtime = await resolveElectronRuntime({ projectRoot, executable: executableOverride });
  const { executable } = runtime;
  const resources = path.join(path.dirname(executable), "resources");
  if (fs.existsSync(path.join(resources, "app.asar")) || fs.existsSync(path.join(resources, "app"))) {
    throw new Error("preflight_requires_unpacked_electron: packaged applications may ignore the probe entry point");
  }
  const report = {
    schema_version: 2, started_at: new Date().toISOString(), executable, runtime, timeout_ms_per_mode: timeoutMs,
    renderer_requested: rendererRequested,
    scope: rendererRequested
      ? "Electron app.ready and sandboxed hidden renderer with local data DOM; no sidecar, external page, provider, bridge or user database"
      : "Electron app.ready only; no window, webpage, provider, bridge or user database is opened",
    checks: [], success: false, verdict: "browser_runtime_unavailable",
    live_xiaohongshu_verified: false, report_file: path.join(runDirectory, "report.json"),
  };
  const modes = rendererRequested ? ["node", "app", "renderer"] : ["node", "app"];
  for (const mode of modes) {
    if (interrupted) break;
    const directory = path.join(runDirectory, mode);
    for (const name of ["profile", "session", "crashes", "temp", "roaming", "local"]) fs.mkdirSync(path.join(directory, name), { recursive: true });
    const env = { ...process.env };
    // Case-insensitive environment names on Windows must not retain duplicate aliases.
    for (const name of Object.keys(env)) {
      if (/^(APPDATA|LOCALAPPDATA|TEMP|TMP|NODE_OPTIONS|ELECTRON_RUN_AS_NODE|ELECTRON_ENABLE_LOGGING|ELECTRON_NO_ASAR|ELECTRON_DISABLE_SANDBOX)$/i.test(name)) delete env[name];
    }
    Object.assign(env, { APPDATA: path.join(directory, "roaming"), LOCALAPPDATA: path.join(directory, "local"), TEMP: path.join(directory, "temp"), TMP: path.join(directory, "temp"), FETCHCV_BROWSER_CHECK_DIRECTORY: directory });
    let args;
    if (mode === "node") {
      env.ELECTRON_RUN_AS_NODE = "1";
      args = ["-e", "process.stdout.write(JSON.stringify({electron:process.versions.electron,node:process.versions.node}))"];
    } else {
      const entry = path.join(directory, "probe.cjs");
      fs.writeFileSync(entry, `const fs=require('node:fs'); const path=require('node:path');
const root=process.env.FETCHCV_BROWSER_CHECK_DIRECTORY;
fs.writeFileSync(path.join(root,'main-entered.json'),JSON.stringify({electron:process.versions.electron}));
const {app,BrowserWindow,session}=require('electron');
app.setPath('userData',path.join(root,'profile'));
app.setPath('sessionData',path.join(root,'session'));
app.setPath('crashDumps',path.join(root,'crashes'));
app.disableHardwareAcceleration();
const failure=error=>{fs.writeFileSync(path.join(root,'main-failure.json'),JSON.stringify({error:String(error?.stack||error)}));console.error(error);app.exit(1);};
app.whenReady().then(async()=>{
  fs.writeFileSync(path.join(root,'ready.json'),JSON.stringify({ready:true}));
  if (${mode === "renderer"}) {
    session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    session.defaultSession.on('will-download',event=>event.preventDefault());
    session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!(details.url==='about:blank'||details.url.startsWith('data:'))}));
    const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    const onRendererGone=(_event,details)=>failure(new Error('renderer_gone: '+JSON.stringify(details)));
    window.webContents.once('render-process-gone',onRendererGone);
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><title>Isolated runtime probe</title><main id="probe">FetchCV renderer ready</main>'));
    const dom=await window.webContents.executeJavaScript("({text:document.querySelector('#probe')?.textContent,readyState:document.readyState,protocol:location.protocol,nodeRequire:typeof require,nodeProcess:typeof process})");
    const prefs=window.webContents.getLastWebPreferences();
    const security={sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,nodeIntegration:prefs.nodeIntegration};
    const verified=dom.text==='FetchCV renderer ready'&&dom.readyState==='complete'&&dom.protocol==='data:'&&dom.nodeRequire==='undefined'&&dom.nodeProcess==='undefined'&&security.sandbox===true&&security.contextIsolation===true&&security.nodeIntegration===false;
    if(!verified) throw new Error('renderer_dom_or_isolation_failed: '+JSON.stringify({dom,security}));
    fs.writeFileSync(path.join(root,'renderer-ready.json'),JSON.stringify({verified,dom,security}));
    window.webContents.removeListener('render-process-gone',onRendererGone);
    window.destroy();
  }
  app.quit();
}).catch(failure);
`, { flag: "wx" });
      args = [entry, `--user-data-dir=${path.join(directory, "profile")}`, "--disable-background-networking", "--disable-component-update", "--disable-gpu", "--enable-logging=file", `--log-file=${path.join(directory, "chromium.log")}`];
    }
    const result = await runChild(executable, args, env, directory);
    const rendererFile = path.join(directory, "renderer-ready.json");
    const failureFile = path.join(directory, "main-failure.json");
    report.checks.push({ mode, ...result, main_entered: fs.existsSync(path.join(directory, "main-entered.json")), ready: fs.existsSync(path.join(directory, "ready.json")),
      renderer: fs.existsSync(rendererFile) ? JSON.parse(fs.readFileSync(rendererFile, "utf8")) : null,
      entry_error: fs.existsSync(failureFile) ? JSON.parse(fs.readFileSync(failureFile, "utf8")) : null });
    // Do not repeat a native startup failure merely to attempt a deeper stage.
    if (result.exit_code !== 0 || result.stop_reason || (mode === "app" && !report.checks.at(-1).ready)) break;
  }
  report.skipped_modes = modes.filter(mode => !report.checks.some(check => check.mode === mode));
  report.renderer_verified = report.checks.some(check => check.mode === "renderer" && check.renderer?.verified === true && check.exit_code === 0 && !check.stop_reason);
  report.success = !interrupted && report.checks.length === modes.length && report.checks.every((check) => check.exit_code === 0 && !check.stop_reason) && report.checks[1].ready && (!rendererRequested || report.checks[2].renderer?.verified === true);
  report.verdict = interrupted ? "interrupted" : report.success ? "browser_runtime_ready_live_collection_unverified" : "browser_runtime_unavailable";
  report.finished_at = new Date().toISOString();
  fs.writeFileSync(report.report_file, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = interrupted ? 130 : report.success ? 0 : 1;
} catch (error) {
  const report = { success: false, verdict: "preflight_setup_failed", error: error.message, run_directory: runDirectory || null };
  if (runDirectory) fs.writeFileSync(path.join(runDirectory, "setup-failure.json"), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report));
  process.exitCode = 2;
} finally {
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onInterrupt);
}
