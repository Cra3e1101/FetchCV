import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { formatProcessingDuration, mergeProcessingEvent } from "../src/lib/processing.js";

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
  assert.deepEqual(result, [{ id: "model", label: "调用模型", detail: "模型已返回", status: "completed" }]);
  assert.equal(mergeProcessingEvent(result, { id: "answer", label: "组织回答", status: "active" }).length, 2);
});

test("assistant messages render a persistent collapsible processing disclosure", () => {
  assert.match(activitySource, /export function ProcessingDisclosure/);
  assert.match(activitySource, /思考中/);
  assert.match(activitySource, /已处理/);
  assert.match(activitySource, /aria-expanded=\{expanded\}/);
  assert.match(messageSource, /metadata_json\?\.processing_trace/);
  assert.match(messageSource, /<ProcessingDisclosure status="completed"/);
});
