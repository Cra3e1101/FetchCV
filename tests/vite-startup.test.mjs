import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer, createLogger } from "vite";

test("development server skips generated files while source edits still invalidate modules", { timeout: 15000 }, async t => {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, "fetchcv-vite-startup-"));
  // Keep native esbuild outputs in the same writable workspace as the real
  // launcher. On Windows its installed executable may inherit a Low label.
  const cacheParent = path.resolve(import.meta.dirname, "../.m1-work/vite-startup-tests");
  await fs.mkdir(cacheParent, { recursive: true });
  const cacheDir = await fs.mkdtemp(path.join(cacheParent, "cache-"));
  let server;
  t.after(async () => {
    await server?.close();
    assert.equal(path.dirname(root), parent);
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, "src"));
  await fs.mkdir(path.join(root, "backend", "environment"), { recursive: true });
  await fs.writeFile(path.join(root, "index.html"), '<script type="module" src="/src/main.js"></script>');
  const source = path.join(root, "src", "main.js");
  await fs.writeFile(source, 'export const value = "before-edit"; if (import.meta.hot) import.meta.hot.accept();');
  await fs.writeFile(path.join(root, "backend", "environment", "noise.js"), "// not a renderer input");
  // A saved page must not expand the app's dependency scan.
  await fs.writeFile(path.join(root, "saved-page.html"), '<script type="module">import "missing-saved-page-dependency";</script>');
  const errors = [];
  const logger = createLogger("silent");
  logger.error = message => errors.push(message);
  server = await createServer({
    configFile: path.resolve(import.meta.dirname, "../vite.config.js"),
    root, customLogger: logger,
    cacheDir,
    server: { host: "127.0.0.1", port: 0, open: false },
  });
  const watcherReady = new Promise(resolve => server.watcher.once("ready", resolve));
  await server.listen();
  await watcherReady;
  const url = `http://127.0.0.1:${server.httpServer.address().port}/src/main.js`;
  const before = await fetch(url);
  assert.equal(before.status, 200);
  assert.match(await before.text(), /before-edit/);
  await server.environments.client.depsOptimizer?.scanProcessing;
  assert.deepEqual(errors, []);
  const backend = path.join(root, "backend").replaceAll("\\", "/");
  assert.equal(Object.keys(server.watcher.getWatched()).some(directory => directory.replaceAll("\\", "/").startsWith(backend)), false);
  const changed = new Promise(resolve => {
    const onChange = file => {
      if (path.resolve(file) !== source) return;
      server.watcher.off("change", onChange);
      resolve();
    };
    server.watcher.on("change", onChange);
  });
  await fs.writeFile(source, 'export const value = "after-edit"; if (import.meta.hot) import.meta.hot.accept();');
  await changed;
  const after = await fetch(url);
  assert.equal(after.status, 200);
  assert.match(await after.text(), /after-edit/);
});
