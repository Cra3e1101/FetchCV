import { useEffect, useLayoutEffect, useRef } from "react";
import { motion, useIsPresent } from "framer-motion";
import { useAgentMotion } from "./motion";
import "./SelectorPopover.css";

const itemsSelector = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';

// The native top layer keeps the surface out of clipping/transform ancestors,
// while preserving inherited theme tokens and the trigger's DOM tab order.
export function SelectorPopover({ anchorRef, returnFocusRef = anchorRef, onClose, width = 320, align = "start", focusKey, focusTarget, role = "menu", className = "", children, ...props }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  const present = useIsPresent();
  const { reducedMotion, transition } = useAgentMotion();
  useLayoutEffect(() => { closeRef.current = onClose; });

  useLayoutEffect(() => {
    const node = panel.current, anchor = anchorRef.current;
    if (!node || !anchor) return undefined;
    if (node.showPopover && !node.matches(":popover-open")) node.showPopover();
    let frame;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0, topEdge = viewport?.offsetTop || 0;
      const vw = viewport?.width || innerWidth, vh = viewport?.height || innerHeight;
      const gutter = 12, gap = 8;
      const panelWidth = Math.min(width, vw - gutter * 2);
      node.style.width = `${panelWidth}px`;
      const above = Math.max(0, rect.top - topEdge - gap - gutter);
      const below = Math.max(0, topEdge + vh - rect.bottom - gap - gutter);
      const side = above >= Math.min(node.scrollHeight, 260) || above >= below ? "top" : "bottom";
      node.style.maxHeight = `${Math.min(480, side === "top" ? above : below)}px`;
      const left = align === "end" ? rect.right - panelWidth : rect.left;
      node.style.left = `${Math.max(leftEdge + gutter, Math.min(left, leftEdge + vw - panelWidth - gutter))}px`;
      node.style.top = `${side === "top" ? Math.max(topEdge + gutter, rect.top - gap - node.offsetHeight) : rect.bottom + gap}px`;
      node.style.transformOrigin = `${align === "end" ? "right" : "left"} ${side === "top" ? "bottom" : "top"}`;
      node.style.visibility = "visible";
      node.dataset.side = side;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
    position();
    const observer = new ResizeObserver(schedule);
    observer.observe(node); observer.observe(anchor);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [anchorRef, align, width]);

  useLayoutEffect(() => {
    if (!present) return;
    const node = panel.current;
    const target = (focusTarget && node?.querySelector(focusTarget))
      || node?.querySelector('[aria-checked="true"]:not(:disabled)')
      || node?.querySelector('button:not(:disabled), input:not(:disabled)') || node;
    target?.focus({ preventScroll: true });
  }, [present, focusKey, focusTarget]);

  useEffect(() => {
    if (!present) return undefined;
    const outside = event => {
      if (!panel.current?.contains(event.target) && !anchorRef.current?.contains(event.target)) closeRef.current?.();
    };
    const escape = event => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation();
      closeRef.current?.(); returnFocusRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [present, anchorRef, returnFocusRef]);

  const navigate = event => {
    if (event.isComposing) return;
    if (event.key === "Tab" && role === "menu") {
      closeRef.current?.(); anchorRef.current?.focus({ preventScroll: true });
      return; // Native Tab continues from the trigger, rather than trapping focus.
    }
    const search = event.target.matches('input[type="search"]');
    if (event.target.matches("input, textarea, select") && !search) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || (search && ["Home", "End"].includes(event.key))) return;
    const items = [...panel.current.querySelectorAll(itemsSelector)];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : current < 0 ? (event.key === "ArrowUp" ? items.length - 1 : 0)
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus({ preventScroll: true }); items[next].scrollIntoView({ block: "nearest" });
  };

  return <motion.div {...props} ref={panel} popover="manual" role={role} tabIndex={-1}
    className={`selector-popover ${className}`} aria-hidden={!present || undefined} inert={!present ? "" : undefined}
    onKeyDown={navigate} style={{ visibility: "hidden", pointerEvents: present ? undefined : "none" }}
    initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, transition: transition("exit") }} transition={{ ...transition("enter"), duration: reducedMotion ? .12 : .15 }}>
    {children}
  </motion.div>;
}
