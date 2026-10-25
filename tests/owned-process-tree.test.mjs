import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { ownedProcessOptions, stopOwnedProcessTree } from "../scripts/owned-process-tree.mjs";

test("forced launcher cleanup stops its child tree and leaves a separate process alive", { timeout: 20000 }, async () => {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const sibling = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { env, stdio: "ignore", windowsHide: true, ...ownedProcessOptions });
  const child = spawn(process.execPath, ["-e", `
    const {spawn}=require('node:child_process');
    const descendant=spawn(process.execPath,['-e','process.send({ready:true});setInterval(()=>{},1000)'],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
    descendant.once('message',()=>process.send({descendant:descendant.pid}));
    setInterval(()=>{},1000);
  `], { env, stdio: ["ignore", "ignore", "inherit", "ipc"], windowsHide: true, ...ownedProcessOptions });
  let descendantPid, cleanupError;
  try {
    const [message] = await once(child, "message", { signal: AbortSignal.timeout(5000) });
    descendantPid = message.descendant;
    assert.equal(process.kill(descendantPid, 0), true);
    await stopOwnedProcessTree(child);
    const deadline = Date.now() + 3000;
    let descendantAlive = true;
    while (descendantAlive && Date.now() < deadline) {
      try { process.kill(descendantPid, 0); }
      catch (error) { if (error.code === "ESRCH") descendantAlive = false; else throw error; }
      if (descendantAlive) await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(descendantAlive, false, "descendant should exit with the owned tree");
    descendantPid = undefined;
    assert.equal(process.kill(sibling.pid, 0), true, "a separate process must survive");
    await stopOwnedProcessTree(child); // Already-exited PIDs must never be targeted again.
    assert.equal(process.kill(sibling.pid, 0), true);
  } finally {
    await stopOwnedProcessTree(child);
    // If the assertion exposes a tree-cleanup failure, clean up only our fixture.
    if (descendantPid) { try { process.kill(descendantPid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") cleanupError = error; } }
    await stopOwnedProcessTree(sibling);
  }
  assert.ifError(cleanupError);
});
