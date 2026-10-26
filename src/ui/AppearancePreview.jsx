import "./AppearancePreview.css";

// Decorative miniatures of the same workspace: fixed theme palettes, or live
// interface colors with different row spacing for the density comparison.
export function AppearancePreview({ theme, density }) {
  const compact = density === "compact";
  return <svg className="appearance-preview" data-preview-theme={theme} data-preview-density={density} viewBox="0 0 160 96" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <rect width="160" height="96" fill="var(--preview-surface)" />
    <path d="M0 0h39v96H0z" fill="var(--preview-sidebar)" />
    <path d="M39 0v96M39 15h121" stroke="var(--preview-line)" />
    <g fill="var(--preview-ink)" opacity=".48">
      <rect x="7" y="8" width="15" height="3" rx="1.5" />
      <rect x="46" y="6" width="27" height="3" rx="1.5" />
      <circle cx="146" cy="7.5" r="1.5" /><circle cx="152" cy="7.5" r="1.5" />
    </g>
    <rect x="5" y="21" width="29" height={compact ? 9 : 13} rx="3" fill="var(--preview-selection)" />
    {[0, 1, 2, 3].map((row) => <rect key={row} x="9" y={25 + row * (compact ? 12 : 16)} width={row % 2 ? 17 : 21} height="3" rx="1.5" fill="var(--preview-ink)" opacity={row ? ".2" : ".6"} />)}
    {density ? <g>
      {Array.from({ length: compact ? 5 : 3 }, (_, row) => <g key={row} transform={`translate(49 ${23 + row * (compact ? 12 : 21)})`}>
        <rect width="7" height="7" rx="2" fill="var(--preview-ink)" opacity=".2" />
        <rect x="12" y="1" width={row % 2 ? 60 : 78} height="3" rx="1.5" fill="var(--preview-ink)" opacity=".48" />
        <rect x="12" y="6" width={row % 2 ? 40 : 54} height="2" rx="1" fill="var(--preview-ink)" opacity=".15" />
      </g>)}
    </g> : <g>
      <rect x="94" y="24" width="55" height="13" rx="6.5" fill="var(--preview-selection)" />
      <rect x="103" y="29" width="35" height="3" rx="1.5" fill="var(--preview-ink)" opacity=".4" />
      <circle cx="51" cy="47" r="3" fill="var(--preview-accent)" />
      <g fill="var(--preview-ink)" opacity=".35">
        <rect x="59" y="45" width="81" height="3" rx="1.5" />
        <rect x="59" y="52" width="66" height="3" rx="1.5" />
        <rect x="59" y="59" width="73" height="3" rx="1.5" />
      </g>
      <rect x="48" y="73" width="102" height="16" rx="6" fill="var(--preview-surface)" stroke="var(--preview-line)" />
      <path d="M54 81h5m-2.5-2.5v5" stroke="var(--preview-ink)" opacity=".4" />
      <circle cx="141" cy="81" r="4" fill="var(--preview-accent)" />
    </g>}
  </svg>;
}
