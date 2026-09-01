import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.jsx");
const keyboard = read("src/lib/keyboard.js");
const composer = read("src/components/AgentWorkspace.jsx");
const message = read("src/components/AgentMessage.jsx");
const electron = read("electron/main.mjs");
const editorStyles = read("public/resume-editor/styles.css");

test("all text controls have a shared select-all fallback", () => {
  assert.match(app, /installSelectAllShortcut\(\)/);
  assert.match(keyboard, /field\.select\(\)/);
  assert.match(keyboard, /contenteditable/);
  assert.match(electron, /key === "a"/);
  assert.match(electron, /selectNodeContents/);
});

test("composer sends with Enter and keeps Shift+Enter for multiline input", () => {
  const textarea = composer.slice(composer.indexOf("<textarea ref={input}"), composer.indexOf("{modelError"));
  assert.match(textarea, /isComposing/);
  assert.match(textarea, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(textarea, /event\.preventDefault\(\)/);
});

test("resume editor only disables selection while dragging", () => {
  assert.match(editorStyles, /body\.dragging-section,[\s\S]*user-select: none !important/);
  assert.match(editorStyles, /\.settings-card input,[\s\S]*user-select: auto/);
});

test("selected assistant text can be quoted into the composer", () => {
  assert.match(message, /window\.getSelection\(\)/);
  assert.match(message, /selection-quote-action/);
  assert.match(composer, /className="composer-quote"/);
  assert.match(composer, /quote: submittedQuote/);
});
