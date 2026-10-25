export function isChatNearBottom(element, threshold = 96) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
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
