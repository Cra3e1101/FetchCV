import assert from "node:assert/strict";
import test from "node:test";
import { createChatScrollFollower, createChatScrollPinning, isChatNearBottom, resolveChatScrollTop } from "../src/lib/chat-scroll.js";

test("only follows new messages while the reader is near the bottom", () => {
  assert.equal(isChatNearBottom({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 }), true);
  assert.equal(isChatNearBottom({ scrollHeight: 1000, scrollTop: 559, clientHeight: 400 }), false);
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

function pinningFixture() {
  let time = 0;
  let nextId = 0;
  const timers = new Map();
  const frames = new Map();
  const states = [];
  const writes = [];
  const positions = [];
  const element = {
    scrollHeight: 1200, clientHeight: 400, scrollTop: 800, isConnected: true,
    scrollTo({ top }) { this.scrollTop = Math.round(Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight))); writes.push(this.scrollTop); },
  };
  const pinning = createChatScrollPinning(element, {
    now: () => time,
    setTimer(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: time + delay }); return id; },
    clearTimer(id) { timers.delete(id); },
    requestFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
    reducedMotion: () => false,
    onStateChange: state => states.push(state),
    onPositionChange: state => positions.push(state),
  });
  const step = (elapsed = 16) => {
    time += elapsed;
    for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.callback(); }
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(time));
  };
  return { element, pinning, states, positions, writes, frames, timers, step };
}

test("pinned stream growth aligns immediately without a repeated smooth animation", () => {
  const { element, pinning, states, frames } = pinningFixture();
  for (let i = 0; i < 10; i += 1) {
    element.scrollHeight += 60;
    pinning.sync();
    pinning.handleScroll();
    assert.equal(element.scrollTop, element.scrollHeight - element.clientHeight);
  }
  assert.equal(frames.size, 0);
  assert.deepEqual(states, [{ isPinned: true, showJumpControl: false }]);
});

test("tiny upward input wins a same-frame stream update and stays paused after cooldown", () => {
  const { element, pinning, states, step } = pinningFixture();
  pinning.sync(); // A no-op write must not swallow the next real scroll.
  pinning.markUserInput();
  element.scrollTop -= 24;
  element.scrollHeight += 80;
  pinning.sync();
  pinning.handleScroll();
  step(300);
  element.scrollHeight += 100;
  pinning.sync();
  assert.equal(element.scrollTop, 776);
  assert.deepEqual(states.at(-1), { isPinned: false, showJumpControl: true });
});

test("downward return uses the 40px tolerance and catches growth at the end of cooldown", () => {
  const { element, pinning, states, timers, step } = pinningFixture();
  pinning.markUserInput();
  element.scrollTop = 300;
  pinning.handleScroll();
  pinning.markUserInput(true);
  element.scrollTop = 765;
  pinning.handleScroll();
  element.scrollHeight += 90;
  pinning.sync();
  assert.equal(element.scrollTop, 765);
  assert.equal(timers.size, 1);
  step(149);
  assert.equal(element.scrollTop, 765);
  step(1);
  assert.equal(element.scrollTop, 890);
  assert.deepEqual(states.at(-1), { isPinned: true, showJumpControl: false });
});

test("downward input at the bottom never permanently disables streaming follow", () => {
  const { element, pinning, step } = pinningFixture();
  pinning.markUserInput(true);
  element.scrollHeight += 120;
  pinning.sync();
  assert.equal(element.scrollTop, 800);
  step(150);
  assert.equal(element.scrollTop, 920);
});

test("explicit return follows a growing destination and can be interrupted", () => {
  const { element, pinning, states, frames, step } = pinningFixture();
  pinning.markUserInput();
  element.scrollTop = 200;
  pinning.handleScroll();
  pinning.scrollToBottom();
  step();
  element.scrollHeight += 200;
  pinning.sync();
  assert.equal(frames.size, 1);
  assert.deepEqual(states.at(-1), { isPinned: true, showJumpControl: false });
  step();
  pinning.markUserInput();
  element.scrollTop -= 10;
  pinning.handleScroll();
  const paused = element.scrollTop;
  step(500);
  assert.equal(element.scrollTop, paused);
  assert.equal(frames.size, 0);
  pinning.scrollToBottom();
  for (let i = 0; i < 100 && frames.size; i += 1) step();
  assert.equal(element.scrollTop, 1000);
});

test("scrollbar drag owns the viewport until release and disposal cancels trailing work", () => {
  const { element, pinning, timers, writes, step } = pinningFixture();
  pinning.startDrag();
  element.scrollTop = 500;
  pinning.handleScroll();
  element.scrollTop = 780;
  pinning.handleScroll();
  element.scrollHeight += 10;
  pinning.sync();
  step(200);
  assert.equal(element.scrollTop, 780);
  pinning.endDrag();
  assert.equal(timers.size, 1);
  pinning.dispose();
  const count = writes.length;
  step(300);
  assert.equal(writes.length, count);
  assert.equal(timers.size, 0);
});

test("cleanup retains the recorded reading position after React replaces the transcript", () => {
  const { element, pinning, positions } = pinningFixture();
  pinning.markUserInput();
  element.scrollTop = 450;
  pinning.handleScroll();
  element.scrollHeight = 400;
  element.scrollTop = 0;
  pinning.dispose();
  assert.deepEqual(positions.at(-1), { scrollTop: 450, isPinned: false });
});
