import { useRef, useState } from "react";
import "./SegmentedControl.css";

// Each instance owns its indicator; no shared animation layout ID or DOM queries.
export function SegmentedControl({ tabs = [], value, defaultValue, onChange, disabled = false, variant = "pill", className = "", style, "aria-label": label }) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const buttons = useRef([]);
  const selectedValue = value === undefined ? internalValue : value;
  const selectedIndex = tabs.findIndex((tab) => tab.id === selectedValue);
  const firstEnabled = tabs.findIndex((tab) => !tab.disabled);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : Math.max(0, firstEnabled);
  const focusIndex = tabs[activeIndex]?.disabled ? firstEnabled : activeIndex;

  const select = (index) => {
    if (disabled || !tabs[index] || tabs[index].disabled || index === activeIndex) return;
    if (value === undefined) setInternalValue(tabs[index].id);
    onChange?.(tabs[index].id, index);
  };

  const navigate = (event, index) => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const enabled = tabs.map((tab, i) => tab.disabled ? -1 : i).filter((i) => i >= 0);
    if (!enabled.length) return;
    const position = enabled.indexOf(index);
    let next;
    if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled.at(-1);
    else if (event.key === "ArrowRight") next = enabled[(position + 1) % enabled.length];
    else if (event.key === "ArrowLeft") next = enabled[(position - 1 + enabled.length) % enabled.length];
    else return;
    event.preventDefault();
    buttons.current[next]?.focus();
    select(next);
  };

  if (!tabs.length) return null;

  return <div className={`segmented-control ${className}`} data-segmented="" data-variant={variant} role="group" aria-label={label} aria-disabled={disabled || undefined} style={style}>
    <div className="segmented-control-track" data-count={tabs.length} data-collapse-labels={tabs.every((tab) => Boolean(tab.icon))}>
      <span className="segmented-control-indicator" aria-hidden="true" style={{
        left: `calc(1px + ${activeIndex} * (100% - 2px) / ${tabs.length})`,
        width: `calc((100% - 2px) / ${tabs.length})`,
      }} />
      {tabs.map((tab, index) => <button
        key={tab.id}
        ref={(node) => { buttons.current[index] = node; }}
        type="button"
        className={`segmented-control-item${index === activeIndex ? " active" : ""}`}
        aria-label={tab.label}
        aria-pressed={index === activeIndex}
        title={tab.description ? `${tab.label}：${tab.description}` : tab.label}
        disabled={disabled || tab.disabled}
        tabIndex={!disabled && index === focusIndex ? 0 : -1}
        onClick={() => select(index)}
        onKeyDown={(event) => navigate(event, index)}
      >
        {tab.preview && <span className="segmented-control-preview" aria-hidden="true">{tab.preview}</span>}
        {tab.icon && <span className="segmented-control-icon" aria-hidden="true">{tab.icon}</span>}
        <span className="segmented-control-label">{tab.label}</span>
      </button>)}
    </div>
  </div>;
}
