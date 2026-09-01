import assert from "node:assert/strict";
import test from "node:test";
import { isChatNearBottom, resolveChatScrollTop } from "../src/lib/chat-scroll.js";

test("only follows new messages while the reader is near the bottom", () => {
  assert.equal(isChatNearBottom({ scrollHeight: 1000, scrollTop: 504, clientHeight: 400 }), true);
  assert.equal(isChatNearBottom({ scrollHeight: 1000, scrollTop: 420, clientHeight: 400 }), false);
});

test("restores and clamps a saved conversation position", () => {
  assert.equal(resolveChatScrollTop(undefined, 1200, 400), 800);
  assert.equal(resolveChatScrollTop(275, 1200, 400), 275);
  assert.equal(resolveChatScrollTop(900, 700, 400), 300);
});
