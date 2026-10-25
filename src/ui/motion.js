import { useSyncExternalStore } from "react";

// The single source for both CSS and Framer Motion. Durations are milliseconds.
export const motionTokens = Object.freeze({
  micro: 140, enter: 200, exit: 140, expand: 220, panel: 280,
  loop: 1400, stagger: 40, distance: 4, distanceSubtle: 2, pressScale: .98,
  easeEnter: [.2, .8, .2, 1], easeExit: [.4, 0, 1, 1],
});

export const motionTransitions = Object.fromEntries(
  ["micro", "enter", "exit", "expand", "panel"].map(name => [name, {
    type: "tween", duration: motionTokens[name] / 1000,
    ease: name === "exit" ? motionTokens.easeExit : motionTokens.easeEnter,
  }]),
);

export function applyMotionTokens(root = globalThis.document?.documentElement) {
  if (!root) return;
  for (const name of ["micro", "enter", "exit", "expand", "panel", "loop", "stagger"]) {
    root.style.setProperty(`--motion-duration-${name}`, `${motionTokens[name]}ms`);
  }
  root.style.setProperty("--motion-ease-enter", `cubic-bezier(${motionTokens.easeEnter.join(",")})`);
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
