import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareDevelopmentRuntime } from "../scripts/dev-runtime.mjs";

test("development cache reuses unchanged code and rebuilds changed or incomplete runtime", async t => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "fetchcv-runtime-cache-"));
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  const workRoot = path.join(project, "work");
  await fs.mkdir(path.join(project, "electron"));
  await fs.mkdir(workRoot);
  const main = path.join(project, "electron", "main.mjs");
  const dependency = path.join(project, "electron", "helper.mjs");
  const preload = path.join(project, "electron", "preload.cjs");
  await fs.writeFile(main, "import './helper.mjs';");
  await fs.writeFile(dependency, "export const value = 1;");
  await fs.writeFile(preload, "// preload");
  await fs.writeFile(path.join(project, "package-lock.json"), "{}");
  let builds = 0;
  let editDuringBuild = false;
  const buildRuntime = async options => {
    builds++;
    assert.deepEqual(options.entryPoints, [main]);
    assert.equal(options.splitting, true);
    await fs.mkdir(path.join(options.outdir, "chunks"), { recursive: true });
    const outputs = [path.join(options.outdir, "main.mjs"), path.join(options.outdir, "chunks", "sdk.mjs")];
    for (const output of outputs) await fs.writeFile(output, `// build ${builds}`);
    if (editDuringBuild) {
      editDuringBuild = false;
      await fs.writeFile(dependency, "// saved after the compiler read this input");
    }
    return { metafile: { inputs: { [main]: {}, [dependency]: {} }, outputs: Object.fromEntries(outputs.map(file => [file, {}])) } };
  };
  let launches = 0;
  const prepare = () => prepareDevelopmentRuntime({ project, workRoot, outputDir: path.join(workRoot, `run-${++launches}`), buildRuntime });
  const first = await prepare();
  assert.equal(first.reused, false);
  assert.deepEqual(await prepare(), { ...first, reused: true });
  assert.equal(builds, 1);

  await fs.writeFile(dependency, "export const value = 200;");
  const changed = await prepare();
  assert.equal(changed.reused, false);
  assert.notEqual(changed.directory, first.directory);
  assert.equal(await fs.readFile(path.join(first.directory, "main.mjs"), "utf8"), "// build 1");
  assert.equal((await prepare()).reused, true);
  await fs.unlink(path.join(changed.directory, "chunks", "sdk.mjs"));
  assert.equal((await prepare()).reused, false);
  await fs.writeFile(preload, "// updated preload");
  const updated = await prepare();
  assert.equal(updated.reused, false);
  assert.equal(await fs.readFile(path.join(updated.directory, "preload.cjs"), "utf8"), "// updated preload");
  await fs.writeFile(path.join(project, "package-lock.json"), '{"version":2}');
  assert.equal((await prepare()).reused, false);
  await fs.writeFile(path.join(project, "electron", "new-resolution.mjs"), "// added module");
  assert.equal((await prepare()).reused, false);
  await fs.writeFile(path.join(workRoot, "runtime-cache.json"), "incomplete json");
  assert.equal((await prepare()).reused, false);
  await fs.writeFile(dependency, "// force a rebuild");
  editDuringBuild = true;
  assert.equal((await prepare()).reused, false);
  assert.equal((await prepare()).reused, false, "edits during a build must not cache stale compiled code");
  assert.equal((await prepare()).reused, true);
});
