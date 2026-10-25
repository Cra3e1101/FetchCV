import fs from "node:fs/promises";
import path from "node:path";

async function readJson(file) {
  return JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
}

/** Select a development Electron executable, never a packaged FetchCV app.
 * The local config supplies only an executable; no user profile is inherited.
 * A broken explicit selection is an error, not permission to try a different runtime.
 */
export async function resolveElectronRuntime({ projectRoot, executable, env = process.env }) {
  if (!projectRoot || !path.isAbsolute(projectRoot)) throw new Error("Electron projectRoot must be absolute");
  const dependencyRoot = path.join(projectRoot, "node_modules", "electron");
  const expectedVersion = (await readJson(path.join(dependencyRoot, "package.json"))).version;
  const configPath = path.join(projectRoot, ".m1-work", "desktop-dev-local.json");
  let selected = executable;
  let source = "explicit";
  if (selected === undefined) {
    selected = env.FETCHCV_ELECTRON_PATH;
    source = "environment";
  }
  if (selected === undefined) {
    let config;
    try { config = await readJson(configPath); }
    catch (error) {
      if (error.code !== "ENOENT") throw new Error(`Invalid Electron runtime config ${configPath}: ${error.message}`);
    }
    if (config !== undefined) {
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`Invalid Electron runtime config: ${configPath}`);
      selected = config.electron;
      source = "local-config";
      if (selected === undefined) throw new Error(`Missing electron field in ${configPath}; specify an absolute runtime path or remove the stale config`);
    } else {
      const relative = (await fs.readFile(path.join(dependencyRoot, "path.txt"), "utf8")).trim();
      const dist = path.join(dependencyRoot, "dist");
      selected = path.resolve(dist, relative);
      if (!relative || path.isAbsolute(relative) || path.relative(dist, selected).startsWith("..")) throw new Error("Invalid installed Electron path.txt");
      source = "dependency";
    }
  }
  if (typeof selected !== "string" || !path.isAbsolute(selected)) {
    throw new Error(`Electron runtime (${source}) must be an absolute executable path`);
  }
  selected = path.normalize(selected);
  try {
    if (!(await fs.stat(selected)).isFile()) throw new Error("not a file");
  } catch (error) {
    throw new Error(`Electron runtime (${source}) unavailable: ${selected} (${error.message}). Update the selection; no fallback was launched.`);
  }
  // On macOS the executable is nested inside Electron.app/Contents/MacOS.
  const runtimeRoot = selected.includes(`${path.sep}Electron.app${path.sep}`)
    ? selected.slice(0, selected.indexOf(`${path.sep}Electron.app${path.sep}`))
    : path.dirname(selected);
  for (const entry of ["app.asar", "app"]) {
    try {
      await fs.access(path.join(runtimeRoot, "resources", entry));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    throw new Error(`Selected executable is a packaged application, not a development Electron runtime: ${selected}`);
  }
  let version;
  try { version = (await fs.readFile(path.join(runtimeRoot, "version"), "utf8")).trim().replace(/^v/, ""); }
  catch (error) { throw new Error(`Cannot verify Electron runtime version (${source}): ${error.message}`); }
  if (version !== expectedVersion) {
    throw new Error(`Electron version mismatch (${source}): selected ${version}, installed dependency ${expectedVersion}. Refresh the runtime selection before launching.`);
  }
  return { executable: selected, source, version, ...(source === "local-config" ? { configPath } : {}) };
}
