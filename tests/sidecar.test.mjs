import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
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

for (const scenario of [
  { name: "development without a bundle leaves local XeLaTeX fallback available", packaged: false, existing: false, explicit: undefined, expected: "absent", requireBundled: "0" },
  { name: "development uses the existing default bundle", packaged: false, existing: true, explicit: undefined, expected: "default", requireBundled: "0" },
  { name: "development preserves an explicit bundle path even before it exists", packaged: false, existing: true, explicit: "custom", expected: "custom", requireBundled: "0" },
  { name: "development removes an empty path and retains an explicit bundle requirement", packaged: false, existing: false, explicit: "empty", expected: "absent", requireBundled: "1" },
  { name: "packaged apps require their resource bundle and ignore developer overrides", packaged: true, existing: false, explicit: "custom", expected: "resources", requireBundled: "1" },
]) {
  test(scenario.name, async t => {
    const scratch = path.join(projectRoot, ".tmp/sidecar-environment-tests");
    fs.mkdirSync(scratch, { recursive: true });
    const directory = fs.mkdtempSync(path.join(scratch, "instance-"));
    const isolatedProject = path.join(directory, "project");
    const resourcesPath = path.join(directory, "resources");
    const defaultRuntime = path.join(isolatedProject, "build/resume-runtime");
    const customRuntime = path.join(directory, "custom-runtime");
    if (scenario.existing) fs.mkdirSync(defaultRuntime, { recursive: true });
    let invocation;
    const child = Object.assign(new EventEmitter(), { exitCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
    const spawn = t.mock.method(childProcess, "spawn", (command, args, options) => {
      invocation = { command, args, options };
      return child;
    });
    syncBuiltinESMExports();
    t.after(() => { spawn.mock.restore(); syncBuiltinESMExports(); });
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      status: "ok", service: "fetchcv-api", instance_nonce: invocation.options.env.FETCHCV_INSTANCE_NONCE,
    }), { headers: { "content-type": "application/json" } }));
    const env = { FETCHCV_PYTHON: "synthetic-python", FETCHCV_XELATEX: "developer-xelatex",
      FETCHCV_REQUIRE_BUNDLED_LATEX: scenario.packaged ? "0" : scenario.requireBundled };
    if (scenario.explicit !== undefined) env.FETCHCV_LATEX_RUNTIME = scenario.explicit === "empty" ? "  " : customRuntime;
    const original = { ...env };
    const sidecar = await startSidecar({ isPackaged: scenario.packaged, projectRoot: isolatedProject,
      resourcesPath, userDataPath: path.join(directory, "profile"), port: 12345, env });
    const received = invocation.options.env;
    const expected = { default: defaultRuntime, custom: customRuntime, resources: path.join(resourcesPath, "resume-runtime") }[scenario.expected];
    if (scenario.expected === "absent") assert.equal(Object.hasOwn(received, "FETCHCV_LATEX_RUNTIME"), false);
    else assert.equal(received.FETCHCV_LATEX_RUNTIME, expected);
    assert.equal(received.FETCHCV_REQUIRE_BUNDLED_LATEX, scenario.requireBundled);
    assert.equal(received.FETCHCV_XELATEX, scenario.packaged ? undefined : "developer-xelatex");
    assert.equal(invocation.command, scenario.packaged ? path.join(resourcesPath, "sidecar", process.platform === "win32" ? "fetchcv-api.exe" : "fetchcv-api") : "synthetic-python");
    assert.equal(sidecar.ready, true);
    assert.deepEqual(env, original, "Choosing the child environment must not mutate its caller");
  });
}
