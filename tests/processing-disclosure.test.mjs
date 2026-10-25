import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { chronologicalProcessingEvents, compactProcessingEvents, formatProcessingDuration, mergeProcessingEvent } from "../src/lib/processing.js";

const root = path.resolve(import.meta.dirname, "..");
const activitySource = fs.readFileSync(path.join(root, "src/components/AgentActivity.jsx"), "utf8");
const messageSource = fs.readFileSync(path.join(root, "src/components/AgentMessage.jsx"), "utf8");

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
  assert.match(compacted[0].detail, /2 次操作，其中 2 次完成/);
  assert.doesNotMatch(compacted[0].detail, /2 篇/);
  assert.doesNotMatch(JSON.stringify(compacted), /原始帖子正文|检查参数|继续调用/);
  assert.equal(compacted[1].label, "归纳面试问题与准备建议");
});

test("does not invent an expandable completion step when no tools were needed", () => {
  const compacted = compactProcessingEvents([
    { id: "model-1", label: "正在分析请求", detail: "内部判断", status: "completed" },
  ]);
  assert.deepEqual(compacted, []);
});

test("a successful operation does not hide failure or interruption in its group", () => {
  for (const status of ["failed", "paused", "cancelled", "pending"]) {
    const events = [
      {id:"one",kind:"tool",label:"读取文件",status:"completed"},
      {id:"two",kind:"tool",label:"读取文件",status},
    ];
    assert.equal(compactProcessingEvents(events)[0].status,status);
  }
});

test("assistant messages render a persistent collapsible processing disclosure", () => {
  assert.match(activitySource, /export function ProcessingDisclosure/);
  assert.match(activitySource, /正在处理/);
  assert.match(activitySource, /用时/);
  assert.match(activitySource, /aria-expanded=\{hasDetails \? expanded : undefined\}/);
  assert.match(messageSource, /metadata_json\?\.processing_trace/);
  assert.match(messageSource, /<ProcessingDisclosure status=\{processingStatus\}/);
});

test("processing uses the shared motion policy and a single activity indicator", () => {
  assert.match(activitySource, /useAgentMotion/);
  assert.match(activitySource, /<ActivityIndicator/);
  assert.match(activitySource, /layout=\{animation\.reducedMotion \? false : "position"\}/);
  assert.doesNotMatch(activitySource, /activity-wave/);
  assert.doesNotMatch(activitySource, /mode="popLayout"/);
});

test("conversation activity is driven by scenario-specific runtime events", () => {
  const agentSource = fs.readFileSync(path.join(root, "electron/pi-agent-runtime.mjs"), "utf8");
  const apiSource = fs.readFileSync(path.join(root, "backend/applyos_api/main.py"), "utf8");
  assert.match(agentSource, /model-turn-\$\{turnNumber\}/);
  assert.match(agentSource, /conciseToolDetail/);
  assert.doesNotMatch(apiSource, /update_processing\("scope", "理解问题"/);
  assert.doesNotMatch(apiSource, /update_processing\("context", "准备上下文"/);
});


test("timeline preserves interleaved tools and updates results without grouping", () => {
  const events = [
    {id:"tool-search1",sequence:1,kind:"tool",label:"搜索网页",status:"completed"},
    {id:"tool-read1",sequence:2,kind:"tool",label:"读取网页",status:"completed"},
    {id:"tool-search2",sequence:3,kind:"tool",label:"搜索网页",status:"active"},
  ];
  const receipts = [
    {tool_call_id:"search2",tool_name:"search_web",status:"running"},
    {tool_call_id:"search1",tool_name:"search_web",status:"completed"},
    {tool_call_id:"read1",tool_name:"read_web_page",status:"completed"},
  ];
  const timeline = chronologicalProcessingEvents([...events, {...events[2],status:"failed"}], receipts);
  assert.deepEqual(timeline.map(row=>row.id), ["tool-search1","tool-read1","tool-search2"]);
  assert.deepEqual(timeline.map(row=>row.receipt.tool_call_id), ["search1","read1","search2"]);
  assert.equal(timeline[2].status,"failed");
});
