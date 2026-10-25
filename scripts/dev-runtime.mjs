import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const banner = "import {createRequire as __fetchcvCreateRequire} from 'node:module'; const require=__fetchcvCreateRequire(import.meta.url);";

async function stamps(files) {
  return Promise.all(files.map(async file => {
    const stat = await fs.stat(file, { bigint: true });
    return [file, `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`];
  }));
}

// Each successful build lives in its original run directory. A later launch
// may reuse it, but never overwrites code that another running app is using.
export async function prepareDevelopmentRuntime({ project, workRoot, outputDir, buildRuntime }) {
  const options = {
    absWorkingDir: project,
    entryPoints: [path.join(project, "electron", "main.mjs")],
    outdir: outputDir,
    outExtension: { ".js": ".mjs" },
    bundle: true, splitting: true, platform: "node", format: "esm", target: "node22",
    external: ["electron"], banner: { js: banner }, metafile: true,
  };
  // This launcher always uses the legacy desktop; FETCHCV_V2_STORAGE_ROOT is
  // removed from its child environment. Building storage-worker here is wasted.
  const key = createHash("sha256").update(JSON.stringify({ ...options, outdir: null, version: 1 })).digest("hex");
  const cacheFile = path.join(workRoot, "runtime-cache.json");
  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    if (cached.key === key && cached.inputs.length && cached.outputs.length) {
      const current = await stamps([...cached.inputs, ...cached.outputs].map(([file]) => file));
      if (JSON.stringify(current) === JSON.stringify([...cached.inputs, ...cached.outputs])) {
        return { directory: cached.directory, reused: true };
      }
    }
  } catch { /* Missing/stale/partial caches are rebuilt from current sources. */ }

  const build = buildRuntime || (await import("esbuild")).build;
  const buildStarted = BigInt(Math.floor((performance.timeOrigin + performance.now()) * 1e6));
  const result = await build(options);
  const preload = path.join(project, "electron", "preload.cjs");
  await fs.copyFile(preload, path.join(outputDir, "preload.cjs"));
  const dependencies = new Set([preload, import.meta.filename]);
  for (const file of Object.keys(result.metafile.inputs)) dependencies.add(path.resolve(project, file));
  // Track resolver directories and package metadata too: additions, removals,
  // reinstalling dependencies or changing exports must invalidate the cache.
  const directories = new Set();
  for (const file of dependencies) {
    let directory = path.dirname(file);
    while (directory !== project && directory.startsWith(project + path.sep)) {
      directories.add(directory);
      directory = path.dirname(directory);
    }
  }
  await Promise.all([...directories].map(async directory => {
    dependencies.add(directory);
    const manifest = path.join(directory, "package.json");
    if (await fs.stat(manifest).catch(() => null)) dependencies.add(manifest);
  }));
  for (const name of ["package.json", "package-lock.json", "node_modules/.package-lock.json"]) {
    const file = path.join(project, name);
    if (await fs.stat(file).catch(() => null)) dependencies.add(file);
  }
  const outputs = [...Object.keys(result.metafile.outputs).map(file => path.resolve(project, file)), path.join(outputDir, "preload.cjs")];
  const cached = { key, directory: outputDir, inputs: await stamps([...dependencies].sort()), outputs: await stamps(outputs.sort()) };
  // A save while esbuild is reading can pair older compiled code with newer
  // stamps. Don't publish that result as reusable; rebuild on the next launch.
  const changedDuringBuild = cached.inputs.some(([, stamp]) => {
    const [, modified, changed] = stamp.split(":");
    return BigInt(modified) >= buildStarted || BigInt(changed) >= buildStarted;
  });
  if (changedDuringBuild) return { directory: outputDir, reused: false };
  const temporary = `${cacheFile}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(cached));
    await fs.rename(temporary, cacheFile);
  } catch {
    // A cache is optional; a successfully built app should still open.
    await fs.unlink(temporary).catch(() => {});
  }
  return { directory: outputDir, reused: false };
}
