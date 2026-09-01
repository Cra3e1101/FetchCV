import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canBind, choosePort, findFreePort, isFetchCVHealthy, startSidecar, stopSidecar } from "../electron/sidecar.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("findFreePort returns a bindable loopback port", async () => {
  const port = await findFreePort();
  assert.equal(await canBind(port), true);
});

test("choosePort never reuses another healthy desktop process", async () => {
  const occupiedPort = await findFreePort();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "fetchcv-api" }));
  });
  await new Promise((resolve) => server.listen(occupiedPort, "127.0.0.1", resolve));
  try {
    const choice = await choosePort(occupiedPort);
    assert.notEqual(choice.port, occupiedPort);
    assert.equal(choice.reuse, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("development sidecar starts, becomes healthy, and stops", { timeout: 35000 }, async () => {
  const port = await findFreePort();
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "job-agent-sidecar-"));
  let spawned = null;
  const sidecar = await startSidecar({
    isPackaged: false,
    projectRoot,
    resourcesPath: projectRoot,
    userDataPath,
    port,
    onSpawn: (value) => { spawned = value; },
    env: { ...process.env, FETCHCV_API_PORT: String(port) },
  });
  assert.equal(spawned?.port, port);
  assert.equal(spawned?.ready, false);
  assert.equal(sidecar.ownsProcess, true);
  assert.equal(sidecar.ready, true);
  assert.equal(await isFetchCVHealthy(sidecar.apiBase), true);
  stopSidecar(sidecar);
  await new Promise((resolve) => sidecar.child.once("exit", resolve));
  assert.equal(await isFetchCVHealthy(sidecar.apiBase, 300), false);
});
