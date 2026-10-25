import "./AnimatedCollapse.css";

// Intrinsic grid sizing keeps streamed and nested content in normal layout.
// Semantic state changes immediately; CSS owns the interruptible transition.
export function AnimatedCollapse({ open, children, className = "", id }) {
  return <div id={id} className={`ui-collapse animated-collapse ${className}`} data-open={open} hidden={!open} aria-hidden={!open} inert={!open ? "" : undefined}>
    <div className="animated-collapse-content">{children}</div>
  </div>;
}
