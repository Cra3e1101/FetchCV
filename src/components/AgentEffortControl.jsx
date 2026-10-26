import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, HelpCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnimatedCollapse } from "../ui/AnimatedCollapse";
import { motionTokens, useAgentMotion } from "../ui/motion";
import "./AgentEffortControl.css";

export const AGENT_EFFORT_LEVELS = [
  { id: "quick", label: "快速", englishLabel: "Low", description: "直接回答，优先响应速度", apiLevel: "fast" },
  { id: "balanced", label: "均衡", englishLabel: "Medium", description: "兼顾速度、依据与可执行性", apiLevel: "balanced" },
  { id: "deep", label: "深入", englishLabel: "High", description: "比较方案并主动检查证据与风险", apiLevel: "deep" },
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

export function AgentEffortControl({ disabled = false, value = "balanced", onChange, model, onModelMenu }) {
  const { transition, enter, exit } = useAgentMotion();
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
      <span className="effort-control-spacer" aria-hidden="true" />
      <button type="button" className="effort-model-menu" aria-label="打开模型选择" onClick={onModelMenu}><span className="effort-active-label"><AnimatePresence initial={false}><motion.strong key={active.id} initial={enter(motionTokens.distanceSubtle)} animate={{ opacity: 1, y: 0 }} exit={{ ...exit(), transition: transition("exit") }} transition={transition("micro")}>{active.englishLabel}</motion.strong></AnimatePresence></span><span className="effort-model-name">{model}<ChevronDown size={12}/></span></button>
      <button type="button" className="effort-help" aria-label="分析投入说明" aria-expanded={showHelp} onClick={() => setShowHelp((current) => !current)}><HelpCircle size={15} /></button>
    </header>
    <AnimatedCollapse open={showHelp}><p className="effort-help-copy">仅影响下一条消息的分析投入，不会切换模型，也不会改变事实、权限或审批边界。</p></AnimatedCollapse>
    <div className="effort-track-shell" style={{ "--effort-position": `${(level / (AGENT_EFFORT_LEVELS.length - 1)) * 100}%` }}>
      <div className="effort-track-cells" aria-hidden="true">{AGENT_EFFORT_LEVELS.map((item, index) => <i key={item.id} className={index <= level ? "active" : ""} />)}</div>
      <input ref={range} type="range" min="0" max={AGENT_EFFORT_LEVELS.length - 1} step="1" value={level} disabled={disabled} onChange={(event) => update(Number(event.target.value))} aria-label="分析投入" aria-valuetext={`${active.label}：${active.description}`} />
    </div>
    <p className="effort-description" aria-live="polite"><strong>{active.label}</strong> · {active.description}</p>
  </section>;
}
