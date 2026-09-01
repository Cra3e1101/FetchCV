import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { compactProcessingEvents, formatProcessingDuration, mergeProcessingEvent } from "../src/lib/processing.js";

const root = path.resolve(import.meta.dirname, "..");
const activitySource = fs.readFileSync(path.join(root, "src/components/AgentActivity.jsx"), "utf8");
const messageSource = fs.readFileSync(path.join(root, "src/components/AgentMessage.jsx"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

test("formats processing time for short and multi-minute runs", () => {
  assert.equal(formatProcessingDuration(8_200), "8s");
  assert.equal(formatProcessingDuration(228_000), "3m 48s");
});

test("merges streamed processing events without duplicating stages", () => {
  const initial = [{ id: "model", label: "调用模型", status: "active" }];
  const result = mergeProcessingEvent(initial, { id: "model", detail: "模型已返回", status: "completed" });
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "调用模型");
  assert.equal(result[0].detail, "模型已返回");
  assert.equal(result[0].status, "completed");
  assert.equal(result[0].protocol_version, 1);
  assert.equal(mergeProcessingEvent(result, { id: "answer", label: "组织回答", status: "active" }).length, 2);
});

test("groups repeated interview reads and hides crawled content from processing UI", () => {
  const events = [
    { id: "model-1", label: "模型正在推理", detail: "让我先检查参数", status: "completed" },
    { id: "read-1", label: "读取面经原文", detail: "原始帖子正文一", status: "completed" },
    { id: "read-2", label: "读取面经原文", detail: "原始帖子正文二", status: "completed" },
    { id: "model-2", label: "正在核对工具结果", detail: "继续调用", status: "active" },
  ];
  const compacted = compactProcessingEvents(events, "interview_research");
  assert.equal(compacted.length, 2);
  assert.equal(compacted[0].label, "读取面经原文 · 2");
  assert.match(compacted[0].detail, /2 篇可核查面经/);
  assert.doesNotMatch(JSON.stringify(compacted), /原始帖子正文|检查参数|继续调用/);
  assert.equal(compacted[1].label, "归纳面试问题与准备建议");
});

test("keeps a compact completed summary when no tools were needed", () => {
  const compacted = compactProcessingEvents([
    { id: "model-1", label: "正在分析请求", detail: "内部判断", status: "completed" },
  ]);
  assert.deepEqual(compacted, [{
    id: "completed-model-summary",
    label: "回答已形成",
    detail: "已根据当前问题和可用上下文形成回答。",
    status: "completed",
  }]);
});

test("assistant messages render a persistent collapsible processing disclosure", () => {
  assert.match(activitySource, /export function ProcessingDisclosure/);
  assert.match(activitySource, /思考中/);
  assert.match(activitySource, /已处理/);
  assert.match(activitySource, /aria-expanded=\{expanded\}/);
  assert.match(messageSource, /metadata_json\?\.processing_trace/);
  assert.match(messageSource, /<ProcessingDisclosure status="completed"/);
});

test("the active operation uses a reduced-motion-safe left-to-right text flow", () => {
  assert.match(stylesSource, /@keyframes activity-text-flow/);
  assert.match(stylesSource, /\.processing-detail \.activity-line\.active \.activity-line-copy strong/);
  assert.match(stylesSource, /prefers-reduced-motion: reduce/);
  assert.match(activitySource, /layout=\{reduceMotion \? false : "position"\}/);
  assert.doesNotMatch(activitySource, /mode="popLayout"/);
});

test("conversation activity is driven by scenario-specific runtime events", () => {
  const agentSource = fs.readFileSync(path.join(root, "backend/applyos_agent/conversation_tools.py"), "utf8");
  const apiSource = fs.readFileSync(path.join(root, "backend/applyos_api/main.py"), "utf8");
  assert.match(agentSource, /plan_id = f"plan-\{iteration\}"/);
  assert.match(agentSource, /_tool_call_detail/);
  assert.doesNotMatch(apiSource, /update_processing\("scope", "理解问题"/);
  assert.doesNotMatch(apiSource, /update_processing\("context", "准备上下文"/);
});
