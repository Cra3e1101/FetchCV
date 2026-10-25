import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
// POSIX children need their own group so an interrupt cannot target our shell.
export const ownedProcessOptions = Object.freeze({ detached: process.platform !== "win32" });

/** Stop only a child we spawned, including its descendants. Callers use
 * ownedProcessOptions when spawning. Normal, already-completed exits are no-ops.
 */
export async function stopOwnedProcessTree(child, { timeoutMs = 5000 } = {}) {
  const alive = () => child?.pid && child.exitCode === null && child.signalCode === null;
  if (!alive()) return;
  let onExit;
  const exited = new Promise(resolve => { onExit = resolve; child.once("exit", onExit); });
  let timer;
  try {
    if (process.platform === "win32") {
      // Do not kill just Electron: its before-quit hook cannot run after a forced
      // stop, leaving Python and utility processes behind.
      try {
        await execute(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
          ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: timeoutMs });
      } catch (error) {
        if (alive()) throw new Error(`Failed to stop owned process tree ${child.pid}: ${error.message}`, { cause: error });
      }
    } else {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    if (!alive()) return;
    await Promise.race([exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Owned process ${child.pid} did not exit`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); child.removeListener("exit", onExit); }
}
