import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useAgentMotion } from "./motion";
import "./ActivityIndicator.css";

// A single visible indicator owns continuous motion across the workbench.
// Real runtime state still belongs to the caller; this only controls playback.
const candidates = new Map();
const subscribers = new Set();
let owner = null;
function updateOwner() {
  let next = null;
  let highest = -Infinity;
  for (const [id, priority] of candidates) {
    if (priority > highest) { next = id; highest = priority; }
  }
  if (owner === next) return;
  owner = next;
  subscribers.forEach(notify => notify());
}
function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}
const getOwner = () => owner;
const noOwner = () => null;

export function ActivityIndicator({ active = true, priority = 20, label = "正在处理" }) {
  const id = useId();
  const ref = useRef(null);
  const { reducedMotion } = useAgentMotion();
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const currentOwner = useSyncExternalStore(subscribe, getOwner, noOwner);
  useEffect(() => {
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0);
    });
    if (observer) observer.observe(ref.current);
    else setVisible(true);
    const visibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (active && visible && pageVisible && !reducedMotion) candidates.set(id, priority);
    else candidates.delete(id);
    updateOwner();
    return () => { candidates.delete(id); updateOwner(); };
  }, [active, id, pageVisible, priority, reducedMotion, visible]);
  const playing = active && visible && pageVisible && !reducedMotion && currentOwner === id;
  return <span ref={ref} className="activity-indicator" role="img" aria-label={label} data-motion-active={playing}>
    <i /><i /><i />
  </span>;
}
