import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [process.env.FETCHCV_PYTHON, ...[".venv-m1", ".venv"].map(name => path.join(root, "backend", name, "Scripts", "python.exe"))].filter(Boolean);
const python = candidates.find(candidate => fs.existsSync(candidate)) || "python";
const child = spawn(python, [path.join(root, "scripts", "prepare-resume-runtime.py"), ...process.argv.slice(2)], {
  cwd: root, env: process.env, stdio: "inherit", windowsHide: true,
});
child.on("error", error => { console.error(`Unable to prepare the offline resume runtime: ${error.message}`); process.exitCode = 1; });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
