import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
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
  const scratch=path.join(projectRoot,".m1-work","sidecar-tests");fs.mkdirSync(scratch,{recursive:true});
  const userDataPath = fs.mkdtempSync(path.join(scratch, "instance-"));
  let spawned = null;
  const sidecar = await startSidecar({
    isPackaged: false,
    projectRoot,
    resourcesPath: projectRoot,
    userDataPath,
    port,
    onSpawn: (value) => { spawned = value; },
    env: { ...process.env, FETCHCV_API_PORT: String(port), FETCHCV_PYTHON:path.join(projectRoot,"backend",".venv-m1","Scripts","python.exe"),
      FETCHCV_DATABASE_URL:`sqlite:///${path.join(userDataPath,"data","test.db").replaceAll("\\","/")}`, FETCHCV_ARTIFACT_ROOT:path.join(userDataPath,"artifacts"), FETCHCV_WORKSPACE_ROOT:path.join(userDataPath,"workspace"),FETCHCV_SETTINGS_FILE:path.join(userDataPath,"settings.json"),FETCHCV_CONTROL_TOKEN:"synthetic-sidecar-test-only",PYTHONDONTWRITEBYTECODE:"1" },
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


test('health readiness rejects another sidecar instance on the same port',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({status:'ok',service:'fetchcv-api',instance_nonce:'other'}),{headers:{'content-type':'application/json'}}));
 assert.equal(await isFetchCVHealthy('http://127.0.0.1:1',100,'expected'),false);
 assert.equal(await isFetchCVHealthy('http://127.0.0.1:1',100,'other'),true);
});
