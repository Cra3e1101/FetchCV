import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentEvent,
  latestActiveAgentEvent,
  mergeAgentEvent,
  updateAgentEvent,
} from "../shared/agent-events.mjs";

test("agent events keep stable identity and ordering across updates", () => {
  const first = createAgentEvent(
    { id: "tool-1", kind: "tool", label: "读取网页", status: "active" },
    { run_id: "run-1", thread_id: "job-1", turn_id: "turn-1", sequence: 2 },
  );
  const second = createAgentEvent(
    { id: "model-1", kind: "model", label: "分析请求", status: "completed" },
    { run_id: "run-1", thread_id: "job-1", turn_id: "turn-1", sequence: 1 },
  );
  const completed = updateAgentEvent(first, { status: "completed", detail: "已读取真实正文" });
  const merged = mergeAgentEvent(mergeAgentEvent([], first), second);
  const updated = mergeAgentEvent(merged, completed);

  assert.deepEqual(updated.map((item) => item.id), ["model-1", "tool-1"]);
  assert.equal(updated[1].sequence, 2);
  assert.equal(updated[1].revision, 2);
  assert.equal(updated[1].status, "completed");
  assert.equal(latestActiveAgentEvent(updated), null);
});

test("agent event protocol bounds public text and never requires hidden reasoning", () => {
  const event = createAgentEvent({
    id: "model",
    kind: "model",
    label: "模型正在推理",
    detail: "可验证行动摘要 ".repeat(300),
    status: "active",
  });
  assert.equal(event.protocol_version, 1);
  assert.ok(event.detail.length <= 1200);
  assert.equal(event.evidence_refs.length, 0);
});
