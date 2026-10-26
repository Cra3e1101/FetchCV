export function isChatNearBottom(element, threshold = 40) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

// Pin streaming updates instantly; reserve animation for an explicit jump.
// Input and pin state live outside React so a token arriving in the same frame
// as an upward gesture cannot steal the reader's position.
export function createChatScrollPinning(element, {
  initialPinned = isChatNearBottom(element),
  now = () => performance.now(),
  setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (timer) => window.clearTimeout(timer),
  requestFrame,
  cancelFrame,
  reducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches),
  onStateChange = () => {},
  onPositionChange = () => {},
} = {}) {
  let pinned = initialPinned;
  let lastPosition = element.scrollTop;
  let lastInputAt = -Infinity;
  let cooldown = null;
  let dragging = false;
  let disposed = false;
  let previousState;
  const publish = () => {
    const state = { isPinned: pinned, showJumpControl: !pinned && !isChatNearBottom(element, 2) };
    onPositionChange({ scrollTop: element.scrollTop, isPinned: pinned });
    if (!previousState || state.isPinned !== previousState.isPinned || state.showJumpControl !== previousState.showJumpControl) {
      previousState = state;
      onStateChange(state);
    }
  };
  const follower = createChatScrollFollower(element, {
    now, requestFrame, cancelFrame,
    onPositionChange(position) { lastPosition = position; publish(); },
  });
  const cancelCooldown = () => {
    if (cooldown !== null) clearTimer(cooldown);
    cooldown = null;
  };
  const sync = () => {
    if (disposed) return;
    publish();
    if (!pinned || dragging) return;
    const remaining = 150 - (now() - lastInputAt);
    if (remaining > 0) {
      cancelCooldown();
      cooldown = setTimer(() => { cooldown = null; sync(); }, remaining);
      return;
    }
    // A manual jump already tracks the live bottom, even if it grows mid-jump.
    if (!follower.isRunning || reducedMotion()) follower.follow({ immediate: true });
  };
  const markUserInput = (movingDown = false) => {
    follower.stop();
    cancelCooldown();
    lastInputAt = now();
    pinned = movingDown && isChatNearBottom(element);
    sync();
  };
  publish();
  return {
    sync,
    markUserInput,
    handleScroll() {
      const position = element.scrollTop;
      const delta = position - lastPosition;
      lastPosition = position;
      // Writes from the follower have already updated lastPosition. Only an
      // actual reader movement can release or restore the pin here.
      if (delta < -0.5) {
        follower.stop();
        pinned = pinned && isChatNearBottom(element, 2);
      } else if (delta > 0.5 && !follower.isRunning) {
        pinned = isChatNearBottom(element);
      }
      sync();
    },
    startDrag() { dragging = true; markUserInput(); },
    endDrag() {
      if (!dragging) return;
      dragging = false;
      markUserInput(isChatNearBottom(element));
    },
    scrollToBottom({ smooth = true } = {}) {
      if (disposed) return;
      cancelCooldown();
      lastInputAt = -Infinity;
      pinned = true;
      publish();
      follower.follow({ immediate: !smooth || reducedMotion() });
    },
    dispose() {
      disposed = true;
      follower.stop();
      cancelCooldown();
      // Keep the position already published by writes/scroll events. React may
      // have replaced the transcript (clamping scrollTop) before this cleanup.
    },
  };
}

export function resolveChatScrollTop(savedScrollTop, scrollHeight, clientHeight) {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  if (!Number.isFinite(savedScrollTop)) return maximum;
  return Math.min(Math.max(0, savedScrollTop), maximum);
}

// One animation follows the live bottom edge. Streaming and disclosure resizes
// change its destination without restarting the easing on every update.
export function createChatScrollFollower(element, {
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (frame) => window.cancelAnimationFrame(frame),
  now = () => performance.now(),
  onPositionChange = () => {},
} = {}) {
  let frame = null;
  let position = element.scrollTop;
  let previousTime = 0;
  const bottom = () => Math.max(0, element.scrollHeight - element.clientHeight);
  const stop = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };
  const advance = (time) => {
    frame = null;
    const target = bottom();
    // Elapsed time keeps the same feel at 60/120 Hz; cap gaps after a hidden tab.
    const elapsed = Math.max(0, Math.min(time - previousTime, 64));
    previousTime = time;
    position = Math.min(position, target);
    position += (target - position) * (1 - Math.exp(-elapsed / 80));
    if (target - position <= 0.75) position = target;
    // Explicit instant writes prevent CSS scroll-behavior from starting a second
    // browser animation. Keep fractional progress even when scrollTop is rounded.
    element.scrollTo({ top: position, behavior: "instant" });
    onPositionChange(element.scrollTop);
    if (position !== target) frame = requestFrame(advance);
  };
  return {
    get isRunning() { return frame !== null; },
    follow({ immediate = false } = {}) {
      if (immediate) {
        stop();
        element.scrollTo({ top: bottom(), behavior: "instant" });
        onPositionChange(element.scrollTop);
      } else if (frame === null) {
        position = element.scrollTop;
        previousTime = now();
        frame = requestFrame(advance);
      }
    },
    stop,
  };
}
