import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const HOST = "127.0.0.1";
const PREFERRED_PORT = 8766;

export async function isFetchCVHealthy(apiBase, timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase}/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.status === "ok" && payload?.service === "fetchcv-api";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function canBind(port, host = HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

export function findFreePort(host = HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host, port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => port ? resolve(port) : reject(new Error("Unable to allocate loopback port")));
    });
  });
}

export async function choosePort(preferred = PREFERRED_PORT) {
  if (await canBind(preferred)) return { port: preferred, reuse: false };
  return { port: await findFreePort(), reuse: false };
}

export async function waitForHealth(apiBase, child, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child?.exitCode !== null) throw new Error(`Local API exited before startup (code ${child.exitCode})`);
    if (await isFetchCVHealthy(apiBase)) return;
    // Cold startup is measured in seconds; a 250 ms polling quantum made an
    // already-ready API feel slower. Poll briefly while launching, then back
    // off so a genuinely slow/failing sidecar does not spin aggressively.
    const elapsed = Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, elapsed < 3000 ? 50 : 250));
  }
  throw new Error("Local API health check timed out");
}

function databaseUrl(userDataPath) {
  const dataDir = path.join(userDataPath, "data");
  const legacy = path.join(dataDir, "applyos.db");
  const current = path.join(dataDir, "fetchcv.db");
  if (!fs.existsSync(current) && fs.existsSync(legacy)) fs.copyFileSync(legacy, current);
  const file = current.replaceAll("\\", "/");
  return `sqlite:///${file}`;
}

export async function startSidecar({ isPackaged, projectRoot, resourcesPath, userDataPath, port = null, env = process.env, onSpawn = null }) {
  const requestedPort = Number(port);
  const selectedPort = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535
    ? requestedPort
    : (await choosePort(Number(env.FETCHCV_API_PORT || PREFERRED_PORT))).port;
  const apiBase = `http://${HOST}:${selectedPort}`;

  fs.mkdirSync(path.join(userDataPath, "data"), { recursive: true });
  fs.mkdirSync(path.join(userDataPath, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(userDataPath, "workspace"), { recursive: true });
  const childEnv = {
    ...env,
    FETCHCV_DATABASE_URL: env.FETCHCV_DATABASE_URL || databaseUrl(userDataPath),
    FETCHCV_ARTIFACT_ROOT: env.FETCHCV_ARTIFACT_ROOT || path.join(userDataPath, "artifacts"),
    FETCHCV_WORKSPACE_ROOT: env.FETCHCV_WORKSPACE_ROOT || path.join(userDataPath, "workspace"),
    FETCHCV_SETTINGS_FILE: env.FETCHCV_SETTINGS_FILE || path.join(userDataPath, "settings", "settings.json"),
    FETCHCV_XHS_CREDENTIAL_FILE: env.FETCHCV_XHS_CREDENTIAL_FILE || path.join(userDataPath, "settings", "xiaohongshu-session.bin"),
    FETCHCV_ALLOWED_ORIGINS: env.FETCHCV_ALLOWED_ORIGINS || "null,http://127.0.0.1:4173",
    // Electron owns the Pi Agent loop. The Python sidecar is the persistence,
    // policy and tool execution plane only; starting its legacy model worker
    // would create a second, behaviorally different production loop.
    FETCHCV_DISABLE_TASK_WORKER: "1",
    PYTHONUNBUFFERED: "1",
  };
  let command;
  let args;
  let cwd;
  if (isPackaged) {
    command = path.join(resourcesPath, "sidecar", process.platform === "win32" ? "fetchcv-api.exe" : "fetchcv-api");
    args = ["--host", HOST, "--port", String(selectedPort)];
    cwd = path.dirname(command);
  } else {
    command = process.env.FETCHCV_PYTHON || path.join(projectRoot, "backend", ".venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
    args = ["-m", "uvicorn", "applyos_api.main:app", "--app-dir", "backend", "--host", HOST, "--port", String(selectedPort)];
    cwd = projectRoot;
  }
  const child = spawn(command, args, { cwd, env: childEnv, windowsHide: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  const launched = { apiBase, child, ownsProcess: true, port: selectedPort, ready: false };
  onSpawn?.(launched);
  child.stdout?.on("data", (chunk) => process.env.FETCHCV_SIDECAR_LOG === "1" && console.log(`[api] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.env.FETCHCV_SIDECAR_LOG === "1" && console.error(`[api] ${chunk}`));
  await waitForHealth(apiBase, child);
  return { ...launched, ready: true };
}

export function stopSidecar(sidecar) {
  const child = sidecar?.child;
  if (!sidecar?.ownsProcess || !child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}
