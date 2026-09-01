import { cn } from "../../lib/utils";

export function Badge({ tone = "neutral", className, children }) {
  const tones = {
    neutral: "bg-surface-card text-ink",
    coral: "bg-coral text-white",
    success: "bg-success/15 text-[#387644]",
    warning: "bg-[#f3dfbd] text-[#7c541c]",
    danger: "bg-danger/10 text-danger",
    dark: "bg-dark-elevated text-[#d3cfc6]",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}
