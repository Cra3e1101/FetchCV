import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { findFreePort, startSidecar, stopSidecar } from "../electron/sidecar.mjs";
import { prepareDevelopmentRuntime } from "./dev-runtime.mjs";
import { createStartupTrace } from "../electron/startup.mjs";
import { readStartupLogs, summarizeStartup } from "./startup-report.mjs";
import { resolveElectronRuntime } from "./electron-runtime.mjs";

// Exercises the actual development launcher with an isolated synthetic profile.
// Repeat within one work root to compare first launch and cache reuse.
const project = path.resolve(import.meta.dirname, "..");
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const workRoot = path.resolve(option("--work-root") || path.join(project, ".m1-work", `startup-${Date.now()}`));
const packaged = process.argv.includes("--packaged");
const launchElectron = !process.argv.includes("--sidecar-only") && !process.argv.includes("--runtime-only");
const electronRuntime = !packaged && launchElectron ? await resolveElectronRuntime({ projectRoot: project, executable: option("--electron") }) : null;
const executable = packaged ? option("--electron") || path.join(project, "release", "win-unpacked", "FetchCV.exe") : electronRuntime?.executable;
const runs = Number(option("--runs") || 3);
const kind = option("--kind") || "unclassified";
assert.ok(["cold", "warm", "unclassified"].includes(kind), "--kind must be cold, warm or unclassified");
assert.ok(Number.isInteger(runs) && runs > 0 && runs <= 30);
assert.ok(kind !== "cold" || runs === 1, "Cold startup requires one launch after each actual reboot; use --runs 1");
await fs.mkdir(workRoot, { recursive: true });
const results = [];
for (let run = 0; run < runs; run++) {
  if (process.argv.includes("--sidecar-only")) {
    const started = performance.now();
    const trace = createStartupTrace({ directory: path.join(workRoot, "logs"), kind, now: () => performance.now() - started });
    const token = randomUUID();
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^FETCHCV_/.test(key)) delete env[key];
    Object.assign(env, {
      FETCHCV_PYTHON: process.env.FETCHCV_PYTHON || path.join(project, "backend", ".venv-m1", "Scripts", "python.exe"),
      FETCHCV_CONTROL_TOKEN: token, FETCHCV_DESKTOP_STARTUP_GATE: "1", PYTHONDONTWRITEBYTECODE: "1",
      FETCHCV_PYTHON_IMPORTTIME: process.argv.includes("--importtime") ? "1" : "0",
    });
    let sidecar;
    try {
      sidecar = await startSidecar({ isPackaged: false, projectRoot: project, resourcesPath: project,
        userDataPath: path.join(workRoot, "user-data"), port: await findFreePort(), env, startupTrace: trace });
      trace.mark("data.ready");
      const post = async (url, payload) => {
        const response = await fetch(`${sidecar.apiBase}${url}`, { method: "POST", headers: { "content-type": "application/json", "x-fetchcv-control-token": token }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
        assert.equal(response.ok, true, `Startup operation ${url} failed (${response.status})`);
      };
      trace.mark("agent.reconcile_start");
      await post("/api/pi/hosts/reconcile", { host_id: `startup-benchmark:${trace.id}` });
      trace.mark("agent.reconciled");
      await post("/api/runtime/startup-ready", { instance_nonce: sidecar.instanceNonce });
      trace.mark("agent.ready");
      const result = { run: run + 1, kind, sidecarOnly: true, readyMs: Math.round(performance.now() - started), runId: trace.id };
      results.push(result); console.log(JSON.stringify(result));
    } finally {
      if (sidecar) {
        const exited = new Promise(resolve => sidecar.child.once("exit", resolve));
        stopSidecar(sidecar);
        await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(Error("Sidecar failed to exit")), 10000).unref())]);
      }
      await trace.flush();
    }
    continue;
  }
  if (process.argv.includes("--runtime-only")) {
    const outputDir = path.join(workRoot, `prepare-${Date.now()}-${run}`, "runtime");
    await fs.mkdir(outputDir, { recursive: true });
    const started = performance.now();
    const runtime = await prepareDevelopmentRuntime({ project, workRoot, outputDir });
    const result = { run: run + 1, runtimeReused: runtime.reused, runtimePreparationMs: Math.round(performance.now() - started) };
    results.push(result);
    console.log(JSON.stringify(result));
    continue;
  }
  const debugPort = await findFreePort();
  const apiPort = await findFreePort();
  const started = performance.now();
  const childEnv = { ...process.env, FETCHCV_API_PORT: String(apiPort), FETCHCV_STARTUP_KIND: kind };
  for (const key of Object.keys(childEnv)) {
    if (/^(APPDATA|LOCALAPPDATA|TEMP|TMP|NODE_OPTIONS|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete childEnv[key];
  }
  for (const [key, directory] of Object.entries({ APPDATA: "roaming", LOCALAPPDATA: "local", TEMP: "temp", TMP: "temp" })) {
    childEnv[key] = path.join(workRoot, directory);
    await fs.mkdir(childEnv[key], { recursive: true });
  }
  if (packaged) {
    for (const key of Object.keys(childEnv)) if (/^FETCHCV_/.test(key) || key === "ELECTRON_RUN_AS_NODE") delete childEnv[key];
    for (const name of ["user-data", "session", "temp"]) await fs.mkdir(path.join(workRoot, name), { recursive: true });
    Object.assign(childEnv, { FETCHCV_API_PORT: String(apiPort), FETCHCV_STARTUP_KIND: kind,
      FETCHCV_E2E_USER_DATA: path.join(workRoot, "user-data"), FETCHCV_E2E_SESSION_DATA: path.join(workRoot, "session"), FETCHCV_E2E_TEMP: path.join(workRoot, "temp") });
  }
  const args = packaged ? [`--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1", ...(process.argv.includes("--software-rendering") ? ["--disable-gpu"] : [])]
    : [path.join(project, "scripts", "dev-desktop.mjs"), "--work-root", workRoot,
      "--electron", executable, "--inspect-ui", String(debugPort), ...(process.argv.includes("--software-rendering") ? ["--software-rendering"] : [])];
  const child = spawn(packaged ? executable : process.execPath, args, {
    cwd: project, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: childEnv,
  });
  let output = "", failure = null, browser, page;
  const errors = [];
  const failedRequests = [], pendingRequests = new Set();
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  child.once("error", error => { failure = error; });
  const exited = new Promise(resolve => child.once("exit", resolve));
  try {
    let endpoint;
    while (performance.now() - started < 240000) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Launcher exited (${child.exitCode}): ${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        if (response.ok) {
          const version = await response.json();
          const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(result => result.json());
          // Don't attach to the initial empty document: Electron 43 can run its
          // sandbox preload before startupData arrives when CDP enables Runtime.
          if (targets.some(target => target.type === "page" && /^(file:|http:\/\/127\.0\.0\.1:)/.test(target.url))) {
            endpoint = version.webSocketDebuggerUrl;
            break;
          }
        }
      } catch { /* Electron has not bound its inspection port yet. */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(endpoint, "Electron did not become available within 240 seconds");
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    page = context.pages()[0] || await context.waitForEvent("page", { timeout: 30000 });
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => pendingRequests.add(request));
    page.on("requestfinished", request => pendingRequests.delete(request));
    page.on("requestfailed", request => { pendingRequests.delete(request); failedRequests.push({ url: request.url(), failure: request.failure() }); });
    // A new Vite cache can spend time transforming dependencies before the first
    // paint. Record that time instead of conflating it with an Electron crash.
    await page.locator(".startup-workspace, .standalone-chat").first().waitFor({ timeout: 120000 });
    const shellMs = Math.round(performance.now() - started);
    await page.locator(".standalone-chat textarea").waitFor({ timeout: 30000 });
    await page.waitForFunction(async () => (await window.appRuntime.getBackendStatus()).agentReady === true);
    const readyMs = Math.round(performance.now() - started);
    assert.deepEqual(errors, []);
    // Verify a deferred dialog is usable too; no model calls or real files.
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("dialog", { name: "设置" }).waitFor();
    await page.screenshot({ path: path.join(workRoot, `settings-${run + 1}.png`) });
    await page.getByRole("dialog", { name: "设置" }).getByRole("button", { name: "关闭", exact: true }).click();
    await page.screenshot({ path: path.join(workRoot, `workspace-${run + 1}.png`) });
    const status = packaged ? {} : JSON.parse(await fs.readFile(path.join(workRoot, "current.json"), "utf8"));
    const result = { run: run + 1, kind, packaged, electronRuntime: electronRuntime || status.electronRuntime, shellMs, readyMs, runtimeReused: status.runtimeReused, runtimePreparationMs: status.runtimePreparationMs };
    results.push(result);
    console.log(JSON.stringify(result));
    await page.evaluate(() => window.desktopWindow.close()).catch(() => {});
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("Launcher did not exit")), 10000).unref())]);
    assert.equal(child.exitCode, 0);
  } catch (error) {
    const diagnostic = { error: String(error.stack || error), pageUrl: page?.url(), pages: browser?.contexts().flatMap(context => context.pages().map(item => item.url())), pageErrors: errors, failedRequests, pendingRequests: [...pendingRequests].map(request => request.url()), output };
    if (page) {
      diagnostic.document = await page.evaluate(() => ({ title: document.title, readyState: document.readyState, bodyText: document.body?.innerText?.slice(0, 4000), runtimeBridge: typeof window.appRuntime })).catch(error => ({ unavailable: error.message }));
      await page.screenshot({ path: path.join(workRoot, `failure-${run + 1}.png`), timeout: 5000 }).catch(() => {});
    }
    await fs.writeFile(path.join(workRoot, `failure-${run + 1}.json`), JSON.stringify(diagnostic, null, 2));
    throw error;
  } finally {
    if (child.exitCode === null && child.pid) {
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        await new Promise(resolve => { killer.once("exit", resolve); killer.once("error", resolve); });
      } else child.kill("SIGTERM");
    }
    await browser?.close().catch(() => {});
  }
}
const logDirectory = path.join(workRoot, process.argv.includes("--sidecar-only") ? "logs" : "user-data/logs");
const measured = await readStartupLogs(logDirectory).catch(() => []);
await fs.writeFile(path.join(workRoot, "startup-results.json"), JSON.stringify({ workRoot, results, summary: summarizeStartup(measured) }, null, 2));
