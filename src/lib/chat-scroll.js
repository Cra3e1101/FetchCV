export function isChatNearBottom(element, threshold = 96) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

export function resolveChatScrollTop(savedScrollTop, scrollHeight, clientHeight) {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  if (!Number.isFinite(savedScrollTop)) return maximum;
  return Math.min(Math.max(0, savedScrollTop), maximum);
}
