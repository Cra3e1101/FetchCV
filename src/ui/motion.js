import { useSyncExternalStore } from "react";
import "./native-motion.css";

// Shared CSS / Framer timings, adapted from Open Claude UI v2 §4.3:
// https://openclaudeui.com/docs/v2/04#43-响应时间与贝塞尔曲线
// Keep reading surfaces on small, non-overshooting tweens. The reference's
// drag-release and voice-button springs are specific to those interactions.
// https://github.com/Caho1/open-claude-ui/blob/main/code-examples/ClaudeMotionPresets.ts
// Durations are milliseconds; the existing semantic names keep callers aligned.
export const motionTokens = Object.freeze({
  press: 60, micro: 120, enter: 200, exit: 120, expand: 200, panel: 300,
  loop: 1400, stagger: 40, distance: 4, distanceSubtle: 2, pressScale: .98,
  easeEnter: [.165, .84, .44, 1], easeSnap: [.32, .72, 0, 1], easeExit: [.4, 0, 1, 1],
});

export const motionTransitions = Object.fromEntries(
  ["press", "micro", "enter", "exit", "expand", "panel"].map(name => [name, {
    type: "tween", duration: motionTokens[name] / 1000,
    ease: name === "exit" ? motionTokens.easeExit
      : name === "press" || name === "micro" ? motionTokens.easeSnap : motionTokens.easeEnter,
  }]),
);

export function applyMotionTokens(root = globalThis.document?.documentElement) {
  if (!root) return;
  for (const name of ["press", "micro", "enter", "exit", "expand", "panel", "loop", "stagger"]) {
    root.style.setProperty(`--motion-duration-${name}`, `${motionTokens[name]}ms`);
  }
  root.style.setProperty("--motion-ease-enter", `cubic-bezier(${motionTokens.easeEnter.join(",")})`);
  root.style.setProperty("--motion-ease-snap", `cubic-bezier(${motionTokens.easeSnap.join(",")})`);
  root.style.setProperty("--motion-ease-exit", `cubic-bezier(${motionTokens.easeExit.join(",")})`);
  root.style.setProperty("--motion-distance-sm", `${motionTokens.distance}px`);
  root.style.setProperty("--motion-press-scale", String(motionTokens.pressScale));
}
applyMotionTokens();

const media = typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribeMotion = callback => {
  media?.addEventListener("change", callback);
  return () => media?.removeEventListener("change", callback);
};
const readMotion = () => Boolean(media?.matches);
const serverMotion = () => true;

export function useAgentMotion() {
  const reducedMotion = useSyncExternalStore(subscribeMotion, readMotion, serverMotion);
  return {
    reducedMotion,
    transition: (name = "enter") => reducedMotion
      ? motionTransitions.micro : motionTransitions[name] || motionTransitions.enter,
    enter: (distance = motionTokens.distance) => reducedMotion
      ? { opacity: 0 } : { opacity: 0, y: Math.min(8, Math.max(0, distance)) },
    exit: (distance = motionTokens.distanceSubtle) => reducedMotion
      ? { opacity: 0 } : { opacity: 0, y: Math.min(8, Math.max(0, distance)) },
  };
}
