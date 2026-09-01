import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "build", "electron");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await build({
  entryPoints: [path.join(projectRoot, "electron", "main.mjs")],
  outfile: path.join(outputRoot, "main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron"],
  minify: true,
  treeShaking: true,
  sourcemap: false,
  legalComments: "none",
  banner: {
    js: "import { createRequire as __fetchcvCreateRequire } from 'node:module'; const require = __fetchcvCreateRequire(import.meta.url);",
  },
  logLevel: "info",
});

await cp(
  path.join(projectRoot, "electron", "preload.cjs"),
  path.join(outputRoot, "preload.cjs"),
);

console.log(outputRoot);
