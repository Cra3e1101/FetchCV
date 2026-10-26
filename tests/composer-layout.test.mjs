import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "src/components/AgentWorkspace.jsx"), "utf8");
const effortSource = fs.readFileSync(path.join(root, "src/components/AgentEffortControl.jsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const sourceCss = fs.readFileSync(path.join(root, "src/ui/replica-components.css"), "utf8");
const approvals = fs.readFileSync(path.join(root, "src/ui/ApprovalModeMenu.jsx"), "utf8");
const electronMain = fs.readFileSync(path.join(root, "electron/main.mjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron/preload.cjs"), "utf8");

test("composer exposes real task actions in a left and right control layout", () => {
  const composer = source.slice(source.indexOf("function Composer"), source.indexOf("function ExperienceSelector"));
  assert.match(composer, /className="rp-controls-start"/);
  assert.match(composer, /className="rp-controls-end"/);
  assert.match(composer, /<ComposerAddMenu[\s\S]*?onUpload=\{addAttachments\}/);
  assert.match(composer, /<ApprovalModeMenu/);
  assert.match(approvals, /api\.updatePermissionSettings/);
  assert.doesNotMatch(approvals, /id:"full"/);
  assert.match(composer, /<ArrowRight size=\{16\}/);
  assert.ok(composer.indexOf("rp-controls-start") < composer.indexOf("composer-model-wrap"));
  assert.match(app, /onAddMaterial=\{importWorkspaceMaterials\}/);
  assert.match(composer, /attachmentPaths/);
  assert.doesNotMatch(composer, /Enter 发送/);
});

test("composer file picker accepts arbitrary files into the isolated workspace", () => {
  assert.match(preload, /importWorkspaceFiles/);
  assert.match(electronMain, /dialog:import-workspace-files/);
  assert.match(electronMain, /properties:\s*\["openFile",\s*"multiSelections"\]/);
  assert.doesNotMatch(electronMain.slice(electronMain.indexOf('handle("dialog:import-workspace-files"'), electronMain.indexOf('handle("dialog:select-legacy-workspace"')), /filters:/);
  assert.match(app, /api\.createMaterial/);
});

test("source composer uses the replica surface and action geometry", () => {
  assert.match(sourceCss, /\.source-composer \.composer-send \{width:32px;height:32px;flex:0 0 32px/);
  assert.match(sourceCss, /\.source-composer \.composer-popover \{bottom:calc\(100% \+ 8px\)/);
  assert.doesNotMatch(source, /from ["'].*openbitfun/);
  assert.doesNotMatch(approvals, /from ["'].*openbitfun/);
});
test("composer uses three honest effort levels and preserves backend thinking levels", () => {
  assert.match(source, /<AgentEffortControl[\s\S]*?value=\{agentEffort\}[\s\S]*?onChange=\{setAgentEffort\}/);
  assert.match(effortSource, /快速[\s\S]*?均衡[\s\S]*?深入/);
  assert.doesNotMatch(effortSource, /Mild|Extreme|Ultracode/);
  assert.match(effortSource, /apiLevel:\s*"fast"[\s\S]*?apiLevel:\s*"balanced"[\s\S]*?apiLevel:\s*"deep"/);
  assert.match(effortSource, /aria-label="分析投入"/);
  assert.doesNotMatch(source.slice(source.indexOf('role="dialog" aria-label="模型与推理设置"'), source.indexOf("<AgentEffortControl")), /<header>/);
});

// Floating composer geometry and message clearance (including multiline text
// and attachments) are measured in conversation-replica.e2e.mjs. Searching the
// legacy styles.css declarations cannot verify the final CSS cascade.
