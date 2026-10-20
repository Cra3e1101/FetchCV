import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendRoot = path.join(projectRoot, "backend");
const isWindows = process.platform === "win32";
const python = process.env.FETCHCV_PYTHON || path.join(backendRoot, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");
const child = spawn(python, ["-m", "uvicorn", "applyos_api.main:app", "--app-dir", backendRoot, "--host", "127.0.0.1", "--port", process.env.FETCHCV_API_PORT || "8766", ...process.argv.slice(2)], { cwd: projectRoot, env: process.env, stdio: "inherit" });
child.on("error", (error) => {
  console.error(`Unable to start Python backend at ${python}: ${error.message}`);
  console.error("Create the backend virtual environment first: python3 -m venv backend/.venv");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
