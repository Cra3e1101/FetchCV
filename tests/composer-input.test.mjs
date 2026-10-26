import assert from "node:assert/strict";
import test from "node:test";
import { composerFileKey, createComposerCompositionGuard, getComposerTrigger, removeComposerTrigger, uniqueComposerFiles } from "../src/lib/composer-input.js";

test("triggers follow the caret, not the end of the message", () => {
  const value = "请参考 @resume 后面的说明保留";
  const caret = value.indexOf(" 后面");
  const trigger = getComposerTrigger(value, caret);
  assert.deepEqual(trigger, { kind: "file", query: "resume", start: 4, end: caret });
  assert.deepEqual(removeComposerTrigger(value, trigger), { value: "请参考  后面的说明保留", caret: 4 });
  assert.equal(getComposerTrigger(value, 0), null);
  assert.equal(getComposerTrigger(value, 4, caret), null);
});

test("email addresses, URLs and path separators do not trigger menus", () => {
  for (const value of ["user@example.com", "https://example.com", "D:\\docs\\resume.pdf", "请读 /docs/resume.pdf", "some/path", "`@file", `@${"a".repeat(1025)}`]) {
    assert.equal(getComposerTrigger(value), null, value);
  }
  assert.equal(getComposerTrigger("/简历").query, "简历");
  assert.equal(getComposerTrigger("文字，@简历").query, "简历");
});

test("Chinese punctuation stays in the draft after choosing a reference", () => {
  const value = "@简历.pdf，";
  const trigger = getComposerTrigger(value);
  assert.equal(trigger.query, "简历.pdf");
  assert.equal(removeComposerTrigger(value, trigger).value, "，");
});

test("editing inside a token replaces its suffix but preserves later prose", () => {
  for (const [value, caret, expected] of [["@Project.md，后文", 4, "，后文"], ["/resume 后文", 3, " 后文"], ["说明 @file.pdf 后文", 7, "说明  后文"]]) {
    const trigger = getComposerTrigger(value, caret);
    assert.equal(removeComposerTrigger(value, trigger).value, expected);
  }
});

test("workspace files deduplicate Windows path separators and case", () => {
  const files = uniqueComposerFiles([
    { name: "first.pdf", workspacePath: "C:\\workspace\\Resume.pdf" },
    { name: "second.pdf", workspacePath: "c:/workspace/resume.pdf" },
    { workspacePath: "C:/workspace/another.pdf" },
    { name: "missing path" },
  ]);
  assert.equal(files.length, 2);
  assert.equal(files[0].name, "first.pdf");
  assert.equal(files[1].name, "another.pdf");
  assert.equal(composerFileKey(files[0]), "c:/workspace/resume.pdf");
});

function key(overrides = {}) {
  return { key: "Enter", timeStamp: 100, prevented: false, preventDefault() { this.prevented = true; }, ...overrides };
}

test("composition and legacy keyCode guard also protect menu navigation", () => {
  const guard = createComposerCompositionGuard();
  guard.start();
  assert.equal(guard.ignoreKeyDown(key({ key: "ArrowDown" })), true);
  assert.equal(guard.ignoreKeyDown(key()), true);
  guard.end(100);
  for (const event of [key({ isComposing: true }), key({ keyCode: 229 }), key({ nativeEvent: { keyCode: 229 } }), key({ nativeEvent: { isComposing: true } })]) {
    assert.equal(guard.ignoreKeyDown(event), true);
  }
});

test("late commit Enter is consumed once, then intentional Enter works", () => {
  for (const [webkit, delay] of [[false, 20], [true, 400]]) {
    const guard = createComposerCompositionGuard(webkit);
    guard.start();
    guard.end(1000);
    const commit = key({ timeStamp: 1000 + delay });
    assert.equal(guard.ignoreKeyDown(commit), true);
    assert.equal(commit.prevented, true);
    assert.equal(guard.ignoreKeyDown(key({ timeStamp: 1001 + delay })), false);
  }
});

test("commit keyup releases the guard; expired composition never eats Enter", () => {
  const guard = createComposerCompositionGuard(true);
  guard.start();
  guard.end(1000);
  guard.keyUp(key());
  assert.equal(guard.ignoreKeyDown(key({ timeStamp: 1001 })), false);
  guard.end(2000);
  assert.equal(guard.ignoreKeyDown(key({ timeStamp: 2500 })), false);
  assert.equal(guard.ignoreKeyDown(key({ key: "a", timeStamp: 2001 })), false);
});
