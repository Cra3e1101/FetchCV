import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronRuntime } from "./electron-runtime.mjs";
import { ownedProcessOptions, stopOwnedProcessTree } from "./owned-process-tree.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args[0] === "--help") {
  console.log("Usage: node scripts/run-electron.mjs [--electron ABSOLUTE_PATH] -- APP_OR_SCRIPT [arguments]\nSelects the same development runtime as desktop:dev and browser:check. Does not select or copy a user profile.");
} else {
  try {
    let executable;
    if (args[0] === "--electron") {
      args.shift(); executable = args.shift();
      if (!executable || executable.startsWith("--")) throw new Error("--electron requires an absolute executable path");
    }
    if (args[0] === "--") args.shift();
    if (!args.length || args[0].startsWith("--")) throw new Error("Specify an app or Electron script after --");
    const runtime = await resolveElectronRuntime({ projectRoot, executable });
    console.log(`Electron ${runtime.version} (${runtime.source}): ${runtime.executable}`);
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key.toUpperCase())) delete env[key];
    }
    const child = spawn(runtime.executable, args, { cwd: projectRoot, env, stdio: "inherit", windowsHide: true, ...ownedProcessOptions });
    let cleanup;
    let interruptedCode;
    let resolveInterrupt, rejectInterrupt;
    const interrupted = new Promise((resolve, reject) => { resolveInterrupt = resolve; rejectInterrupt = reject; });
    const stop = signal => {
      interruptedCode ||= signal === "SIGINT" ? 130 : 143;
      cleanup ||= stopOwnedProcessTree(child);
      cleanup.then(() => resolveInterrupt({ code: interruptedCode }), rejectInterrupt);
    };
    const onInterrupt = () => stop("SIGINT");
    const onTerminate = () => stop("SIGTERM");
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);
    try {
      const finished = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      const result = await Promise.race([finished, interrupted]);
      if (cleanup) await cleanup;
      process.exitCode = interruptedCode ?? result.code ?? (result.signal ? 1 : 0);
    } finally {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
    }
  } catch (error) {
    console.error(`Electron launch failed: ${error.message}`);
    process.exitCode = 1;
  }
}
