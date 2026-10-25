import assert from "node:assert/strict";
import test from "node:test";
import { shareWorkspaceSnapshot } from "../src/lib/workspace-snapshot.js";

const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function workspace() {
  return {
    job: { id: "job-a", role: "数据分析" },
    messages: [
      { id: "a", role: "user", content: "完整问题", metadata_json: { quoted_text: "来源" } },
      { id: "b", role: "assistant", content: "完整回答\n\n| A | B |\n|---|---|\n| 1 | 2 |", metadata_json: { processing_trace: [{ id: "tool", status: "completed" }] } },
    ],
    interview_sources: [{ id: "source", title: "来源", metadata_json: { nested: { revision: 1 } } }],
    interview_briefs: [],
    resumes: [{ id: "resume", content_json: { sections: [{ title: "完整经历", items: ["第一项", "第二项"] }] } }],
    profile: null,
  };
}

test("an unchanged complete response keeps the snapshot and all render inputs", () => {
  const previous = freeze(workspace()), next = freeze(clone(previous));
  const result = shareWorkspaceSnapshot(previous, next);
  assert.strictEqual(result, previous);
  assert.deepEqual(result, next);
});

test("appended messages preserve existing render inputs without dropping content", () => {
  const previous = freeze(workspace()), next = clone(previous);
  next.messages.push({ id: "c", role: "assistant", content: "后台完成的新消息", metadata_json: {} });
  freeze(next);
  const result = shareWorkspaceSnapshot(previous, next);
  assert.deepEqual(result, next);
  assert.notStrictEqual(result.messages, previous.messages);
  assert.strictEqual(result.messages[0], previous.messages[0]);
  assert.strictEqual(result.messages[1], previous.messages[1]);
  assert.strictEqual(result.interview_sources, previous.interview_sources);
  assert.strictEqual(result.resumes, previous.resumes);
  assert.equal(previous.messages.length, 2);
});

test("message metadata, source revisions and removals always reach the new snapshot", () => {
  const previous = freeze(workspace()), next = clone(previous);
  next.messages[1].metadata_json.processing_trace[0].status = "failed";
  delete next.messages[0].metadata_json.quoted_text;
  next.interview_sources[0].metadata_json.nested.revision = 2;
  next.profile = { keywords: ["SQL"] };
  delete next.resumes;
  freeze(next);
  const result = shareWorkspaceSnapshot(previous, next);
  assert.deepEqual(result, next);
  assert.notStrictEqual(result.messages[1], previous.messages[1]);
  assert.notStrictEqual(result.interview_sources, previous.interview_sources);
  assert.strictEqual(result.job, previous.job);
  assert.strictEqual(result.interview_briefs, previous.interview_briefs);
  assert.equal(Object.hasOwn(result, "resumes"), false);
  assert.equal(Object.hasOwn(result.messages[0].metadata_json, "quoted_text"), false);
  assert.equal(previous.interview_sources[0].metadata_json.nested.revision, 1);
});

test("reordered, deleted and replaced array entries preserve exactly the incoming values", () => {
  const previous = freeze(workspace());
  for (const messages of [[], [previous.messages[1]], [...previous.messages].reverse(), [null, false, 0, "", [1, 2]]]) {
    const next = freeze({ ...clone(previous), messages: clone(messages) });
    assert.deepEqual(shareWorkspaceSnapshot(previous, next), next);
  }
});

test("new and removed JSON keys are distinct even for empty and prototype-like metadata", () => {
  const previous = freeze(JSON.parse('{"metadata":{"__proto__":{"safe":true},"constructor":"old"},"empty":{}}'));
  const next = freeze(JSON.parse('{"metadata":{"__proto__":{"safe":true},"constructor":"new"},"empty":[],"newKey":null}'));
  const result = shareWorkspaceSnapshot(previous, next);
  assert.deepEqual(result, next);
  assert.strictEqual(result.metadata.__proto__, previous.metadata.__proto__);
  assert.equal(Object.getPrototypeOf(result.metadata), Object.prototype);
  assert.equal(Object.hasOwn(result.metadata, "__proto__"), true);
  assert.equal(Object.prototype.safe, undefined);
});

test("only JSON branches are shared and primitive/type changes are retained", () => {
  for (const [previous, next] of [[null, {}], [{}, null], [[], {}], [{}, []], [1, "1"], [true, false], ["a", "b"], [0, -0]]) {
    assert.deepEqual(shareWorkspaceSnapshot(previous, next), next);
  }
  const previous = new Date(0), next = new Date(1);
  assert.strictEqual(shareWorkspaceSnapshot(previous, next), next);
});
