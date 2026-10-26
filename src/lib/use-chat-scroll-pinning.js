import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createChatScrollPinning, resolveChatScrollTop } from "./chat-scroll";
import { useAgentMotion } from "../ui/motion";

export function useChatScrollPinning({ scrollKey, positions, enabled = true }) {
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const controllerRef = useRef(null);
  const [showJumpControl, setShowJumpControl] = useState(false);
  const { reducedMotion } = useAgentMotion();

  useLayoutEffect(() => {
    const node = containerRef.current;
    const content = contentRef.current;
    if (!enabled || !node || !content) return undefined;
    const saved = positions.get(scrollKey);
    // A pinned session returns to its live bottom; a paused session retains its
    // reading position even if more tokens arrived while it was out of view.
    node.scrollTo({ top: resolveChatScrollTop(saved?.isPinned ? undefined : saved?.scrollTop, node.scrollHeight, node.clientHeight), behavior: "instant" });
    const controller = createChatScrollPinning(node, {
      initialPinned: saved?.isPinned,
      onStateChange: state => setShowJumpControl(state.showJumpControl),
      onPositionChange: state => positions.set(scrollKey, state),
    });
    controllerRef.current = controller;
    let touchY = null;
    const scroll = () => controller.handleScroll();
    const wheel = event => {
      if (!event.ctrlKey && event.deltaY !== 0) controller.markUserInput(event.deltaY > 0);
    };
    const touchStart = event => { touchY = event.touches[0]?.clientY ?? null; };
    const touchMove = event => {
      const next = event.touches[0]?.clientY;
      if (next !== undefined && touchY !== null && next !== touchY) controller.markUserInput(next < touchY);
      touchY = next ?? null;
    };
    const touchEnd = () => { touchY = null; };
    const keyDown = event => {
      if (event.defaultPrevented || event.target.closest("input, textarea, select, button, a, [contenteditable]:not([contenteditable='false']), [role='slider']")) return;
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) controller.markUserInput();
      if (["ArrowDown", "PageDown", "End"].includes(event.key) || (event.key === " " && !event.shiftKey)) controller.markUserInput(true);
    };
    const pointerDown = event => {
      if (event.target !== node || event.button !== 0) return;
      const left = node.getBoundingClientRect().left + node.clientLeft;
      if (event.clientX < left || event.clientX >= left + node.clientWidth) controller.startDrag();
    };
    const pointerUp = () => controller.endDrag();
    const listeners = { scroll, wheel, touchstart: touchStart, touchmove: touchMove, touchend: touchEnd, touchcancel: touchEnd, keydown: keyDown, pointerdown: pointerDown };
    for (const [name, handler] of Object.entries(listeners)) node.addEventListener(name, handler, { passive: true });
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(controller.sync);
    observer?.observe(node);
    observer?.observe(content);
    controller.sync();
    return () => {
      observer?.disconnect();
      for (const [name, handler] of Object.entries(listeners)) node.removeEventListener(name, handler);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [enabled, scrollKey, positions]);

  useLayoutEffect(() => {
    if (reducedMotion) controllerRef.current?.sync();
  }, [reducedMotion]);

  const scrollToBottom = useCallback(() => controllerRef.current?.scrollToBottom(), []);
  return { containerRef, contentRef, showJumpControl: enabled && showJumpControl, scrollToBottom };
}
