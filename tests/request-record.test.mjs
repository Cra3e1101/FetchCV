import assert from "node:assert/strict";
import test from "node:test";
import { prepareRequestRecord } from "../electron/pi/request-record.mjs";
import { assertToolPairs, trimToolResult } from "../electron/pi/context-policy.mjs";
import {assembleContext} from '../electron/pi/context-budget.mjs';

test("request record reconstructs the redacted payload and rejects explicit overflow", () => {
  const options = { model: { id: "fixture", provider: "local", contextWindow: 8192, maxTokens: 1024 }, privacy: { mode: "redacted_remote", literals: ["synthetic-key"] }, tools: [], sequence: 1 };
  const original = { messages: [{ role: "user", content: "hello synthetic-key person@example.com" }], api_key: "synthetic-key" };
  const prepared = prepareRequestRecord(original, options);
  assert.deepEqual(prepared.payload, prepared.record.payload);
  assert.equal(JSON.stringify(prepared).includes("synthetic-key"), false);
  assert.equal(JSON.stringify(prepared).includes("person@example.com"), false);
  assert.equal(original.api_key, "synthetic-key");
  assert.throws(() => prepareRequestRecord({ messages: ["x".repeat(8192)] }, options), { code: "context_overflow" });
});
test("large tool payloads remain valid JSON and call/result groups remain complete", async () => {
  const trimmed = trimToolResult({ text: '中"\\'.repeat(5000) }, 2000, { receiptId: "receipt" });
  assert.ok(trimmed.length <= 2000);
  assert.equal(JSON.parse(trimmed).reference.receiptId, "receipt");
  const messages = [{ role: "assistant", content: [{ type: "toolCall", id: "c1" }, { type: "toolCall", id: "c2" }] },
    { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "x".repeat(5000) }] },
    { role: "toolResult", toolCallId: "c2", content: [{ type: "text", text: "y".repeat(5000) }] }];
  const compacted = assembleContext(messages,{model:{contextWindow:8192,maxTokens:1024},tools:[],systemPrompt:'',protectedFrom:0}).messages;
  assertToolPairs(compacted);
  assert.ok(JSON.parse(compacted[1].content[0].text).truncated);
  assert.equal(compacted[2].content[0].text,'y'.repeat(5000));
  assert.throws(() => assertToolPairs(messages.slice(0, 2)), { code: "invalid_tool_group" });
  assert.throws(() => assertToolPairs(messages.slice(1)), { code: "invalid_tool_group" });
});
test("provider-required internal reasoning is not persisted or misrepresented as reconstructable", () => {
  const prepared = prepareRequestRecord({ messages: [{ role: "assistant", reasoning_content: "private intermediate", content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "answer" }] }] },
    { model: { contextWindow: 8192, maxTokens: 1024 }, privacy: {}, tools: [], sequence: 1 });
  assert.equal(JSON.stringify(prepared.record).includes("private intermediate"), false);
  assert.equal(JSON.stringify(prepared.record).includes('"hidden"'), false);
  assert.equal(prepared.record.reconstruction, "unavailable_internal_reasoning_excluded");
  assert.ok(prepared.record.exclusions.length >= 2);
  assert.equal(prepared.payload.messages[0].reasoning_content, "private intermediate");
});
