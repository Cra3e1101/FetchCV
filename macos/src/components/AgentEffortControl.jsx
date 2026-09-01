import { AnimatePresence, motion } from "framer-motion";
import { HelpCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./AgentEffortControl.css";

export const AGENT_EFFORT_LEVELS = [
  { id: "quick", label: "快速", description: "直接回答，优先响应速度", apiLevel: "fast" },
  { id: "balanced", label: "均衡", description: "兼顾速度、依据与可执行性", apiLevel: "balanced" },
  { id: "deep", label: "深入", description: "比较方案并主动检查证据与风险", apiLevel: "deep" },
];

const STORAGE_KEY = "fetchcv.agent-effort";
const LEGACY_LEVELS = { light: "quick", thorough: "deep", max: "deep" };

function validLevel(value) {
  const migrated = LEGACY_LEVELS[value] || value;
  return AGENT_EFFORT_LEVELS.some((item) => item.id === migrated) ? migrated : "balanced";
}

export function getStoredAgentEffort() {
  try { return validLevel(window.localStorage.getItem(STORAGE_KEY)); } catch { return "balanced"; }
}

export function getAgentEffortApiLevel(value) {
  return AGENT_EFFORT_LEVELS.find((item) => item.id === validLevel(value))?.apiLevel || "balanced";
}

export function AgentEffortControl({ disabled = false, value = "balanced", onChange }) {
  const range = useRef(null);
  const selectedId = useRef(validLevel(value));
  const [level, setLevel] = useState(() => Math.max(0, AGENT_EFFORT_LEVELS.findIndex((item) => item.id === validLevel(value))));
  const [showHelp, setShowHelp] = useState(false);
  const active = AGENT_EFFORT_LEVELS[level];

  useEffect(() => {
    const next = Math.max(0, AGENT_EFFORT_LEVELS.findIndex((item) => item.id === validLevel(value)));
    if (selectedId.current === AGENT_EFFORT_LEVELS[next].id) return;
    selectedId.current = AGENT_EFFORT_LEVELS[next].id;
    setLevel(next);
    if (range.current) range.current.value = String(next);
  }, [value]);

  const update = (next) => {
    const index = Math.min(AGENT_EFFORT_LEVELS.length - 1, Math.max(0, Math.round(next)));
    const selected = AGENT_EFFORT_LEVELS[index];
    if (selected.id === selectedId.current) return;
    selectedId.current = selected.id;
    setLevel(index);
    try { window.localStorage.setItem(STORAGE_KEY, selected.id); } catch { /* storage can be unavailable */ }
    onChange?.(selected.id, selected.apiLevel);
  };

  return <section className="agent-effort-panel" aria-label="分析投入设置">
    <header>
      <div><small>分析投入</small><span className="effort-active-label"><AnimatePresence initial={false} mode="popLayout"><motion.strong key={active.id} initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} transition={{ duration: .16, ease: [0.16, 1, 0.3, 1] }}>{active.label}</motion.strong></AnimatePresence></span></div>
      <button type="button" className="effort-help" aria-label="分析投入说明" aria-expanded={showHelp} onClick={() => setShowHelp((current) => !current)}><HelpCircle size={15} /></button>
    </header>
    <AnimatePresence initial={false}>{showHelp && <motion.p className="effort-help-copy" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>仅影响下一条消息的分析投入，不会切换模型，也不会改变事实、权限或审批边界。</motion.p>}</AnimatePresence>
    <div className="effort-balance"><span>响应优先</span><span>证据优先</span></div>
    <div className="effort-track-shell" style={{ "--effort-position": `${(level / (AGENT_EFFORT_LEVELS.length - 1)) * 100}%` }}>
      <div className="effort-track-cells" aria-hidden="true">{AGENT_EFFORT_LEVELS.map((item, index) => <i key={item.id} className={index <= level ? "active" : ""} />)}</div>
      <input ref={range} type="range" min="0" max={AGENT_EFFORT_LEVELS.length - 1} step="1" value={level} disabled={disabled} onChange={(event) => update(Number(event.target.value))} aria-label="分析投入" aria-valuetext={`${active.label}：${active.description}`} />
    </div>
  </section>;
}
