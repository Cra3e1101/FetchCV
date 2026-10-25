import assert from "node:assert/strict";
import test from "node:test";
import { createChatScrollFollower, isChatNearBottom, resolveChatScrollTop } from "../src/lib/chat-scroll.js";

test("only follows new messages while the reader is near the bottom", () => {
  assert.equal(isChatNearBottom({ scrollHeight: 1000, scrollTop: 504, clientHeight: 400 }), true);
  assert.equal(isChatNearBottom({ scrollHeight: 1000, scrollTop: 420, clientHeight: 400 }), false);
});

test("restores and clamps a saved conversation position", () => {
  assert.equal(resolveChatScrollTop(undefined, 1200, 400), 800);
  assert.equal(resolveChatScrollTop(275, 1200, 400), 275);
  assert.equal(resolveChatScrollTop(900, 700, 400), 300);
});

function scrollFixture() {
  let time = 0;
  let nextFrame = 0;
  const frames = new Map();
  const writes = [];
  const element = {
    scrollHeight: 1200,
    clientHeight: 400,
    scrollTop: 0,
    scrollTo(options) {
      writes.push(options);
      this.scrollTop = Math.round(Math.min(options.top, this.scrollHeight - this.clientHeight));
    },
  };
  const follower = createChatScrollFollower(element, {
    requestFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelFrame(id) { frames.delete(id); },
    now: () => time,
  });
  const step = (elapsed = 16) => {
    time += elapsed;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(time));
  };
  return { element, follower, frames, writes, step };
}

test("streaming growth retargets one continuous animation and settles on the live bottom", () => {
  const { element, follower, frames, writes, step } = scrollFixture();
  follower.follow();
  for (let index = 0; index < 12; index += 1) {
    step();
    const before = element.scrollTop;
    element.scrollHeight += 24;
    follower.follow();
    follower.follow();
    assert.equal(frames.size, 1);
    assert.equal(element.scrollTop, before, "retargeting does not snap or restart the current frame");
  }
  for (let index = 0; index < 80 && follower.isRunning; index += 1) step();
  assert.equal(element.scrollTop, element.scrollHeight - element.clientHeight);
  assert.equal(follower.isRunning, false);
  assert.equal(frames.size, 0);
  assert.ok(writes.every((write) => write.behavior === "instant"));
  assert.ok(writes.every((write, index) => !index || write.top >= writes[index - 1].top));
});

test("interrupting or leaving a conversation cancels pending motion until explicitly resumed", () => {
  const { element, follower, frames, writes, step } = scrollFixture();
  follower.follow();
  step();
  follower.stop();
  const stoppedAt = element.scrollTop;
  const writeCount = writes.length;
  element.scrollHeight += 200;
  step(500);
  assert.equal(element.scrollTop, stoppedAt);
  assert.equal(writes.length, writeCount);
  assert.equal(frames.size, 0);
  assert.equal(follower.isRunning, false);
  element.scrollTop = 20;
  follower.follow();
  step();
  assert.ok(element.scrollTop > 20);
  assert.ok(element.scrollTop < stoppedAt + 200, "resumes from the reader's actual position");
});

test("reduced motion jumps immediately and cancels any earlier animation", () => {
  const { element, follower, frames, step } = scrollFixture();
  follower.follow();
  step();
  follower.follow({ immediate: true });
  assert.equal(element.scrollTop, 800);
  assert.equal(follower.isRunning, false);
  assert.equal(frames.size, 0);
  element.scrollHeight += 100;
  follower.follow({ immediate: true });
  assert.equal(element.scrollTop, 900);
});

test("following has consistent timing across display refresh rates", () => {
  const at60Hz = scrollFixture();
  const at120Hz = scrollFixture();
  at60Hz.follower.follow();
  at120Hz.follower.follow();
  for (let index = 0; index < 20; index += 1) at60Hz.step(1000 / 60);
  for (let index = 0; index < 40; index += 1) at120Hz.step(1000 / 120);
  assert.ok(Math.abs(at60Hz.element.scrollTop - at120Hz.element.scrollTop) <= 1);
});

test("content shrinking during a follow clamps and settles without a stale destination", () => {
  const { element, follower, frames, step } = scrollFixture();
  follower.follow();
  step(64);
  element.scrollHeight = 500;
  step();
  assert.equal(element.scrollTop, 100);
  assert.equal(follower.isRunning, false);
  assert.equal(frames.size, 0);
});
