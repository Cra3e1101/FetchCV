import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { resolveElectronRuntime } from "../scripts/electron-runtime.mjs";

test("Electron selection is explicit, consistent and fail-closed", async t => {
  const base = path.resolve(".m1-work", "runtime-selection-tests");
  await fs.mkdir(base, { recursive: true });
  const projectRoot = await fs.mkdtemp(path.join(base, "case-"));
  // Keep the small fixture for inspection; it contains no executable code or user data.
  const dependency = path.join(projectRoot, "node_modules", "electron");
  await fs.mkdir(path.join(dependency, "dist"), { recursive: true });
  await fs.writeFile(path.join(dependency, "package.json"), JSON.stringify({ version: "43.1.1" }));
  await fs.writeFile(path.join(dependency, "path.txt"), "electron.exe");
  async function runtime(directory, version = "43.1.1") {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "electron.exe"), "test fixture only");
    await fs.writeFile(path.join(directory, "version"), version);
    return path.join(directory, "electron.exe");
  }
  const installed = await runtime(path.join(dependency, "dist"));
  const local = await runtime(path.join(projectRoot, "local-runtime"));
  const envPath = await runtime(path.join(projectRoot, "env-runtime"));
  const explicit = await runtime(path.join(projectRoot, "explicit-runtime"));
  const config = path.join(projectRoot, ".m1-work", "desktop-dev-local.json");
  await fs.mkdir(path.dirname(config));
  const resolve = options => resolveElectronRuntime({ projectRoot, env: {}, ...options });
  await t.test("dependency is used only without overrides or config", async () => {
    assert.deepEqual(await resolve(), { executable: installed, source: "dependency", version: "43.1.1" });
  });
  await fs.writeFile(config, JSON.stringify({ electron: local, userData: "NEVER_READ_THIS_PROFILE" }));
  await t.test("local config selects only executable and metadata", async () => {
    assert.deepEqual(await resolve(), { executable: local, source: "local-config", version: "43.1.1", configPath: config });
  });
  await t.test("explicit overrides environment, which overrides local config", async () => {
    assert.equal((await resolve({ env: { FETCHCV_ELECTRON_PATH: envPath } })).executable, envPath);
    assert.equal((await resolve({ executable: explicit, env: { FETCHCV_ELECTRON_PATH: envPath } })).executable, explicit);
  });
  await t.test("bad explicit or environment selection cannot silently fall back", async () => {
    await assert.rejects(resolve({ executable: path.join(projectRoot, "missing.exe") }), /no fallback/);
    await assert.rejects(resolve({ executable: "electron.exe" }), /absolute/);
    await assert.rejects(resolve({ env: { FETCHCV_ELECTRON_PATH: "" } }), /absolute/);
  });
  await t.test("stale local runtime and version drift fail before launch", async () => {
    await fs.writeFile(config, JSON.stringify({ electron: path.join(projectRoot, "removed.exe") }));
    await assert.rejects(resolve(), /no fallback/);
    await fs.writeFile(config, JSON.stringify({ electron: local }));
    await fs.writeFile(path.join(path.dirname(local), "version"), "42.0.0");
    await assert.rejects(resolve(), /version mismatch/);
    await fs.writeFile(path.join(path.dirname(local), "version"), "43.1.1");
  });
  await t.test("packaged applications cannot swallow a diagnostic entrypoint", async () => {
    await fs.mkdir(path.join(path.dirname(local), "resources"));
    await fs.writeFile(path.join(path.dirname(local), "resources", "app.asar"), "fixture");
    await assert.rejects(resolve(), /packaged application/);
  });
  await t.test("malformed or incomplete config is actionable, explicit override still works", async () => {
    await fs.writeFile(config, "{broken");
    await assert.rejects(resolve(), /Invalid Electron runtime config/);
    assert.equal((await resolve({ executable: explicit })).executable, explicit);
    await fs.writeFile(config, "{}");
    await assert.rejects(resolve(), /Missing electron field/);
  });
});
