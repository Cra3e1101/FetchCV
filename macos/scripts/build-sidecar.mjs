import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendRoot = path.join(projectRoot, "backend");
const isWindows = process.platform === "win32";
const python = process.env.FETCHCV_PYTHON || path.join(backendRoot, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");
const executableName = isWindows ? "fetchcv-api.exe" : "fetchcv-api";
const args = ["-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--name", "fetchcv-api", "--paths", backendRoot, "--collect-all", "claude_agent_sdk", "--collect-submodules", "mcp.client", "--collect-submodules", "mcp.shared", "--hidden-import", "mcp.types", "--collect-all", "reportlab", "--collect-submodules", "uvicorn", "--distpath", path.join(backendRoot, "dist"), "--workpath", path.join(backendRoot, "build", "pyinstaller"), "--specpath", path.join(backendRoot, "build"), path.join(backendRoot, "sidecar_entry.py")];
const env = {
  ...process.env,
  // Keep PyInstaller's binary cache inside the project build directory so
  // packaging is reproducible and never depends on stale user-level files.
  PYINSTALLER_CONFIG_DIR: process.env.PYINSTALLER_CONFIG_DIR || path.join(backendRoot, "build", "pyinstaller-cache"),
};
const child = spawn(python, args, { cwd: projectRoot, env, stdio: "inherit" });
child.on("error", (error) => {
  console.error(`Unable to build the sidecar with ${python}: ${error.message}`);
  console.error("Install backend dependencies first: python3 -m pip install -e 'backend[dev]'");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else {
    if (code === 0) console.log(path.join(backendRoot, "dist", "fetchcv-api", executableName));
    process.exitCode = code ?? 1;
  }
});
