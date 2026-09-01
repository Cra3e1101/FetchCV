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
