import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendRoot = path.join(projectRoot, "backend");
const isWindows = process.platform === "win32";
const python = process.env.FETCHCV_PYTHON || path.join(backendRoot, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");
const child = spawn(python, process.argv.slice(2), { cwd: projectRoot, env: process.env, stdio: "inherit" });
child.on("error", (error) => {
  console.error(`Unable to run Python at ${python}: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
