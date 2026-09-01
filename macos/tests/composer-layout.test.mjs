import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "src/components/AgentWorkspace.jsx"), "utf8");
const effortSource = fs.readFileSync(path.join(root, "src/components/AgentEffortControl.jsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const electronMain = fs.readFileSync(path.join(root, "electron/main.mjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron/preload.cjs"), "utf8");

test("composer exposes real task actions in a left and right control layout", () => {
  const composer = source.slice(source.indexOf("function Composer"), source.indexOf("function ExperienceSelector"));
  assert.match(composer, /className="composer-foot-left"/);
  assert.match(composer, /className="composer-foot-right"/);
  assert.match(composer, /aria-label="添加文件"[\s\S]*?onClick=\{addAttachments\}/);
  assert.match(composer, /aria-label="查看关键操作确认规则"/);
  assert.match(composer, /role="dialog" aria-label="关键操作确认规则"/);
  assert.match(composer, /<ArrowUp size=\{18\}/);
  assert.ok(composer.indexOf("composer-foot-left") < composer.indexOf("composer-model-wrap"));
  assert.match(app, /onAddMaterial=\{importWorkspaceMaterials\}/);
  assert.match(composer, /attachmentPaths/);
  assert.doesNotMatch(composer, /Enter 发送/);
});

test("composer file picker accepts arbitrary files into the isolated workspace", () => {
  assert.match(preload, /importWorkspaceFiles/);
  assert.match(electronMain, /dialog:import-workspace-files/);
  assert.match(electronMain, /properties:\s*\["openFile",\s*"multiSelections"\]/);
  assert.doesNotMatch(electronMain.slice(electronMain.indexOf('dialog:import-workspace-files'), electronMain.indexOf('dialog:select-legacy-workspace')), /filters:/);
  assert.match(app, /api\.createMaterial/);
});

test("composer controls remain compact, circular and inside the writing surface", () => {
  assert.match(css, /\.agent-composer-v2 > \.composer-foot\s*\{[\s\S]*?justify-content:\s*space-between/);
  assert.match(css, /\.agent-composer-v2 \.composer-add\s*\{[\s\S]*?border-radius:\s*50%/);
  assert.match(css, /\.agent-composer-v2 \.composer-send\s*\{[\s\S]*?border-radius:\s*50%/);
  assert.match(css, /\.composer-model-wrap\s*\{\s*position:\s*relative/);
  assert.match(css, /\.composer-model-wrap \.model-effort-popover\s*\{[\s\S]*?right:\s*0[\s\S]*?bottom:\s*calc\(100% \+ 6px\)/);
  assert.match(css, /\.model-effort-popover\s*\{[\s\S]*?width:\s*min\(262px/);
});

test("composer uses the five-level effort control and preserves backend thinking levels", () => {
  assert.match(source, /<AgentEffortControl[\s\S]*?value=\{agentEffort\}[\s\S]*?onChange=\{setAgentEffort\}/);
  assert.match(effortSource, /Mild[\s\S]*?Medium[\s\S]*?High[\s\S]*?Extreme[\s\S]*?Ultracode/);
  assert.match(effortSource, /apiLevel:\s*"fast"[\s\S]*?apiLevel:\s*"balanced"[\s\S]*?apiLevel:\s*"deep"/);
  assert.match(effortSource, /aria-label="推理强度"/);
  assert.doesNotMatch(source.slice(source.indexOf('role="dialog" aria-label="模型与推理设置"'), source.indexOf("<AgentEffortControl")), /<header>/);
});

test("composer occupies a bottom layout row instead of covering the transcript", () => {
  assert.match(css, /\.agent-workspace-v2 \.conversation-scroll-v2\s*\{[\s\S]*?padding-bottom:\s*0/);
  assert.match(css, /\.agent-workspace-v2 \.agent-composer-v2\s*\{[\s\S]*?position:\s*relative/);
  assert.match(css, /\.agent-workspace-v2 \.agent-composer-v2\s*\{[\s\S]*?flex:\s*0 0 auto/);
});
