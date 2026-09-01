import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.jsx");
const keyboard = read("src/lib/keyboard.js");
const composer = read("src/components/AgentWorkspace.jsx");
const electron = read("electron/main.mjs");
const editorStyles = read("public/resume-editor/styles.css");

test("all text controls have a shared select-all fallback", () => {
  assert.match(app, /installSelectAllShortcut\(\)/);
  assert.match(keyboard, /field\.select\(\)/);
  assert.match(keyboard, /contenteditable/);
  assert.match(electron, /key === "a"/);
  assert.match(electron, /selectNodeContents/);
});

test("composer keeps plain Enter for multiline input and sends with a modifier", () => {
  const textarea = composer.slice(composer.indexOf("<textarea ref={input}"), composer.indexOf("{modelError"));
  assert.match(textarea, /isComposing/);
  assert.match(textarea, /event\.metaKey \|\| event\.ctrlKey/);
  assert.doesNotMatch(textarea, /event\.key === "Enter" && !event\.shiftKey/);
});

test("resume editor only disables selection while dragging", () => {
  assert.match(editorStyles, /body\.dragging-section,[\s\S]*user-select: none !important/);
  assert.match(editorStyles, /\.settings-card input,[\s\S]*user-select: auto/);
});
