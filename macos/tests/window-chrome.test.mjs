import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const main = fs.readFileSync(path.join(root, "electron/main.mjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron/preload.cjs"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

test("macOS uses native traffic lights and Windows keeps custom controls", () => {
  assert.match(main, /const isMac = process\.platform === "darwin"/);
  assert.match(main, /titleBarStyle: "hiddenInset"/);
  assert.match(main, /trafficLightPosition: \{ x: 15, y: 12 \}/);
  assert.match(main, /: \{ frame: false \}/);
  assert.match(preload, /platform: process\.platform/);
  assert.match(app, /desktop && !isMac && <div className="window-actions">/);
  assert.match(css, /\.windowbar\.macos \.window-drag\s*\{\s*padding-left:\s*82px/);
});
