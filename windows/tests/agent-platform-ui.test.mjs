import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const workspace = fs.readFileSync(path.join(root, "src/components/AgentWorkspace.jsx"), "utf8");
const activity = fs.readFileSync(path.join(root, "src/components/AgentActivity.jsx"), "utf8");
const settings = fs.readFileSync(path.join(root, "src/components/ModelSettingsDialog.jsx"), "utf8");
const api = fs.readFileSync(path.join(root, "src/lib/api.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

test("agent tasks use durable queue controls and follow real trace events", () => {
  assert.match(app, /api\.enqueueTask/);
  assert.match(app, /api\.followRunEvents/);
  assert.match(workspace, /onPauseTask/);
  assert.match(workspace, /onResumeTask/);
  assert.match(workspace, /onCancelTask/);
  assert.match(activity, /item\.event_type === "model_turn"/);
  assert.match(activity, /item\.event_type === "tool"/);
});

test("composer stays writable and queues messages while a task is active", () => {
  const composer = workspace.slice(workspace.indexOf("function Composer"), workspace.indexOf("function ExperienceSelector"));
  assert.doesNotMatch(composer, /<textarea[^>]*disabled=/);
  assert.doesNotMatch(composer, /Enter (发送|加入队列)/);
  assert.match(app, /api\.queueMessage/);
  assert.match(workspace, /detail\.queued_messages/);
});

test("skills and approved read-only MCP servers are manageable in settings", () => {
  assert.match(settings, /模型 API/);
  assert.match(settings, /权限与浏览器/);
  assert.match(settings, /MCP Servers/);
  assert.match(settings, /添加参数/);
  assert.match(settings, /环境变量传递/);
  assert.match(settings, /api\.reloadSkills/);
  assert.match(settings, /api\.approveMcpServer/);
  assert.match(settings, /filter\(\(tool\) => tool\.read_only\)/);
  assert.match(settings, /streamable_http/);
  assert.match(settings, /服务器 URL/);
  assert.match(workspace, /startsWith\("permission:"\)/);
  assert.match(api, /createMcpServer/);
  assert.match(api, /updateMcpServer/);
});

test("job rail exposes compact evidence checks instead of an opaque AI score", () => {
  assert.match(workspace, /function RunEvidence/);
  assert.match(workspace, /detail\.run_evaluation/);
  assert.match(workspace, /运行证据/);
  assert.doesNotMatch(workspace, /AI 评分/);
});

test("resume workspace remains reachable before a tailored version is generated", () => {
  assert.match(workspace, /const resume = jobResume \|\| detail\.base_resumes\?\.\[0\]/);
  assert.doesNotMatch(workspace, /<button disabled=\{!detail\.resumes\?\.length\} className=\{tab === "resume"/);
  assert.match(workspace, /岗位版尚未生成；这里明确展示资料库原简历/);
});

test("application rail presents explainable ATS coverage and grounded collateral", () => {
  assert.match(workspace, /岗位要求覆盖/);
  assert.match(workspace, /不预测招聘系统通过率/);
  assert.match(workspace, /support_status/);
  assert.match(workspace, /为什么这样判断/);
  assert.match(workspace, /selected\.jd_context/);
  assert.match(workspace, /selected\.resume_evidence/);
  assert.match(workspace, /打开简历核对上下文/);
  assert.match(workspace, /save_cover_letter_draft/);
  assert.match(workspace, /投递材料/);
});

test("desktop context rail can collapse and resize without hiding the task state", () => {
  assert.match(workspace, /fetchcv\.context-rail-collapsed/);
  assert.match(workspace, /fetchcv\.context-rail-width/);
  assert.match(workspace, /beginRailResize/);
  assert.match(workspace, /调整任务上下文宽度/);
  assert.match(workspace, /展开任务上下文/);
  assert.match(styles, /--context-rail-width/);
  assert.match(styles, /\.context-rail-resizer/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("streaming output is frame-batched and workspace status uses an explicit runtime state", () => {
  assert.match(app, /streamingBuffers/);
  assert.match(app, /requestAnimationFrame\(\(\) => flushStreamingDelta/);
  assert.match(workspace, /resolveAgentRuntimeState/);
  assert.match(workspace, /runtime-\$\{runtimeState\.id\}/);
});
