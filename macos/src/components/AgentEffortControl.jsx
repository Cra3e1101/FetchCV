import { AnimatePresence, motion } from "framer-motion";
import { HelpCircle } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import "./AgentEffortControl.css";

export const AGENT_EFFORT_LEVELS = [
  { id: "quick", label: "Mild", description: "直接回答，优先响应速度", apiLevel: "fast" },
  { id: "light", label: "Medium", description: "快速梳理，并补充少量依据", apiLevel: "fast" },
  { id: "balanced", label: "High", description: "兼顾速度、依据与可执行性", apiLevel: "balanced" },
  { id: "thorough", label: "Extreme", description: "比较不同方案并主动检查风险", apiLevel: "deep" },
  { id: "max", label: "Ultracode", description: "用于复杂岗位判断与最终材料复核", apiLevel: "deep" },
];

const STORAGE_KEY = "fetchcv.agent-effort";
const PIXEL_COLUMNS = 61;
const PIXEL_ROWS = 6;
const TRAIL_START = 1 / 5;

const EFFORT_PIXELS = Array.from({ length: PIXEL_COLUMNS * PIXEL_ROWS }, (_, index) => {
  const column = index % PIXEL_COLUMNS;
  const row = Math.floor(index / PIXEL_COLUMNS);
  const progress = column / (PIXEL_COLUMNS - 1);
  const colorProgress = Math.min(1, Math.max(0, (progress - TRAIL_START) / (1 - TRAIL_START)));
  const randomSeed = Math.sin((column + 1) * 12.9898 + (row + 1) * 78.233) * 43758.5453;
  const random = randomSeed - Math.floor(randomSeed);
  const toneSeedRaw = Math.sin((column + 1) * 27.619 + (row + 1) * 11.173) * 24634.6345;
  const toneSeed = toneSeedRaw - Math.floor(toneSeedRaw);
  const rowProgress = row / (PIXEL_ROWS - 1);
  const centerWeight = 1 - Math.abs(rowProgress * 2 - 1);
  const blank = progress < TRAIL_START;
  const gradient = Math.pow(colorProgress, 0.86);
  const tailPhase = Math.min(1, colorProgress / 0.18);
  const tailEnvelope = tailPhase * tailPhase * (3 - 2 * tailPhase);
  const hue = 10 + gradient * 8 + (toneSeed - 0.5) * (1.4 - gradient * 0.6);
  const saturation = 74 - gradient * 12 + centerWeight * 2.5 + (toneSeed - 0.5) * 3;
  const verticalOffset = (1 - centerWeight) * (4.5 - gradient * 2.5) - centerWeight * (2 - gradient);
  const lightness = 40 + gradient * 34 + verticalOffset + (toneSeed - 0.5) * (5 - gradient * 2);
  const particleOpacity = Math.min(1, (0.08 + tailEnvelope * 0.92) * (0.94 + centerWeight * 0.06));
  return {
    key: index,
    blank,
    style: {
      "--particle-opacity": particleOpacity.toFixed(3),
      "--particle-dim-opacity": Math.max(0.035, particleOpacity - (0.045 + (1 - colorProgress) * 0.025)).toFixed(3),
      "--particle-color": `hsl(${hue.toFixed(1)} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}%)`,
      "--particle-glow": `${(0.35 + gradient * 0.85).toFixed(2)}px`,
      "--particle-flow-delay": `${(-(colorProgress * 2.05 + row * 0.0225)).toFixed(3)}s`,
      "--particle-delay": `${Math.round((1 - colorProgress) * 1050 + random * 150 + row * 8)}ms`,
      "--particle-fly-x": `${(4 + random * 7).toFixed(1)}px`,
      "--particle-flicker": `${(0.38 + random * 0.35).toFixed(3)}`,
    },
  };
});

const EffortPixelTrail = memo(function EffortPixelTrail() {
  return <div className="effort-particles" aria-hidden="true">
    {EFFORT_PIXELS.map((particle) => <i className={particle.blank ? "blank" : undefined} key={particle.key} style={particle.style} />)}
  </div>;
});

function validLevel(value) {
  return AGENT_EFFORT_LEVELS.some((item) => item.id === value) ? value : "balanced";
}

export function getStoredAgentEffort() {
  try { return validLevel(window.localStorage.getItem(STORAGE_KEY)); } catch { return "balanced"; }
}

export function getAgentEffortApiLevel(value) {
  return AGENT_EFFORT_LEVELS.find((item) => item.id === validLevel(value))?.apiLevel || "balanced";
}

export function AgentEffortControl({ disabled = false, value = "balanced", onChange }) {
  const track = useRef(null);
  const range = useRef(null);
  const snapFrame = useRef(null);
  const selectedId = useRef(validLevel(value));
  const ultraTimer = useRef(null);
  const [level, setLevel] = useState(() => Math.max(0, AGENT_EFFORT_LEVELS.findIndex((item) => item.id === validLevel(value))));
  const [showHelp, setShowHelp] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [ultraEntering, setUltraEntering] = useState(false);
  const active = AGENT_EFFORT_LEVELS[level];

  useEffect(() => {
    const next = Math.max(0, AGENT_EFFORT_LEVELS.findIndex((item) => item.id === validLevel(value)));
    if (selectedId.current === AGENT_EFFORT_LEVELS[next].id) return;
    selectedId.current = AGENT_EFFORT_LEVELS[next].id;
    setLevel(next);
    if (range.current) range.current.value = String(next);
    track.current?.style.setProperty("--effort-position", `${(next / (AGENT_EFFORT_LEVELS.length - 1)) * 100}%`);
  }, [value]);

  useEffect(() => () => {
    window.clearTimeout(ultraTimer.current);
    window.cancelAnimationFrame(snapFrame.current);
  }, []);

  const update = (next) => {
    const clamped = Math.min(AGENT_EFFORT_LEVELS.length - 1, Math.max(0, next));
    track.current?.style.setProperty("--effort-position", `${(clamped / (AGENT_EFFORT_LEVELS.length - 1)) * 100}%`);
    const selected = AGENT_EFFORT_LEVELS[Math.round(clamped)];
    if (selected.id === selectedId.current) return;
    selectedId.current = selected.id;
    setLevel(Math.round(clamped));
    window.clearTimeout(ultraTimer.current);
    const enteringUltracode = selected.id === "max";
    setUltraEntering(enteringUltracode);
    if (enteringUltracode) ultraTimer.current = window.setTimeout(() => setUltraEntering(false), 1750);
    try { window.localStorage.setItem(STORAGE_KEY, selected.id); } catch { /* storage can be unavailable in preview sandboxes */ }
    onChange?.(selected.id, selected.apiLevel);
  };

  const stopSnap = () => {
    window.cancelAnimationFrame(snapFrame.current);
    snapFrame.current = null;
  };

  const snapToNearestLevel = () => {
    setDragging(false);
    stopSnap();
    const start = Number(range.current?.value ?? level);
    const destination = Math.round(start);
    if (Math.abs(destination - start) < 0.001) { update(destination); return; }
    const startedAt = performance.now();
    const settle = (now) => {
      const elapsed = Math.min(1, (now - startedAt) / 180);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      const next = start + (destination - start) * eased;
      if (range.current) range.current.value = String(next);
      update(next);
      if (elapsed < 1) snapFrame.current = window.requestAnimationFrame(settle);
      else snapFrame.current = null;
    };
    snapFrame.current = window.requestAnimationFrame(settle);
  };

  const handleKeyboard = (event) => {
    const current = Math.round(Number(range.current?.value ?? level));
    let destination = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") destination = Math.min(4, current + 1);
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") destination = Math.max(0, current - 1);
    if (event.key === "Home") destination = 0;
    if (event.key === "End") destination = 4;
    if (destination === null) return;
    event.preventDefault();
    stopSnap();
    if (range.current) range.current.value = String(destination);
    update(destination);
  };

  return <section className={`agent-effort-panel ${level === 4 ? "max" : ""} ${ultraEntering ? "ultra-entering" : ""} ${dragging ? "dragging" : ""}`} aria-label="推理强度设置">
    <header>
      <div><small>Effort</small><span className="effort-active-label"><AnimatePresence initial={false} mode="popLayout"><motion.strong key={active.id} initial={{ opacity: 0, y: 1, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -1, filter: "blur(3px)" }} transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}>{active.label}</motion.strong></AnimatePresence></span></div>
      <button type="button" className="effort-help" aria-label="推理程度说明" aria-expanded={showHelp} onClick={() => setShowHelp((current) => !current)}><HelpCircle size={15} /></button>
    </header>
    <AnimatePresence initial={false}>{showHelp && <motion.p className="effort-help-copy" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>该设置随下一条消息发送，控制分析投入，不会切换模型或改变事实边界。</motion.p>}</AnimatePresence>
    <div className="effort-balance"><span>Faster</span><span>Smarter</span></div>
    <div ref={track} className="effort-track-shell" style={{ "--effort-position": `${(level / (AGENT_EFFORT_LEVELS.length - 1)) * 100}%` }}>
      <div className="effort-track-fill" />
      <EffortPixelTrail />
      <div className="effort-ticks" aria-hidden="true">{AGENT_EFFORT_LEVELS.map((item, index) => <i key={item.id} className={index <= level ? "passed" : ""} />)}</div>
      <input ref={range} type="range" min="0" max={AGENT_EFFORT_LEVELS.length - 1} step="0.01" defaultValue={level} disabled={disabled} onChange={(event) => update(Number(event.target.value))} onPointerDown={() => { stopSnap(); setDragging(true); }} onPointerUp={snapToNearestLevel} onPointerCancel={snapToNearestLevel} onBlur={snapToNearestLevel} onKeyDown={handleKeyboard} aria-label="推理强度" aria-valuetext={`${active.label}：${active.description}`} />
    </div>
  </section>;
}
