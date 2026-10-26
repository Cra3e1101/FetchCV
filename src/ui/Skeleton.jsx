import { useEffect, useRef, useState } from "react";
import { useAgentMotion } from "./motion";
import "./Skeleton.css";

export function SkeletonGroup({ motion = "lockstep", label = "正在加载…", className = "", children }) {
  const ref = useRef(null);
  const { reducedMotion } = useAgentMotion();
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !globalThis.document?.hidden);
  useEffect(() => {
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0);
    });
    if (observer) observer.observe(ref.current);
    else setVisible(true);
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  return <div ref={ref} className={`skeleton-group ${className}`} data-motion={motion} data-motion-active={visible && pageVisible && !reducedMotion} role="status">
    <div className="skeleton-content" aria-hidden="true">{children}</div>
    <span className="skeleton-label">{label}</span>
  </div>;
}

export function Skeleton({ index = 0, className = "", style }) {
  return <span className={`skeleton-block ${className}`} style={{ ...style, "--cds-skel-i": index }} aria-hidden="true" />;
}

// Compact lists share one pulse; larger cards stagger their individual blocks.
export function ContentSkeleton({ layout = "list", label, className = "" }) {
  const card = layout === "card";
  return <SkeletonGroup motion={card ? "wave" : "lockstep"} label={label} className={`content-skeleton ${className}`}>
    {card ? <div className="skeleton-card">
      <div className="skeleton-card-heading">
        <Skeleton index={0} className="skeleton-avatar" />
        <div className="skeleton-lines"><Skeleton index={1} style={{ width: "48%" }} /><Skeleton index={2} style={{ width: "30%", height: 10 }} /></div>
      </div>
      <Skeleton index={3} className="skeleton-card-media" />
      <div className="skeleton-lines"><Skeleton index={4} /><Skeleton index={5} style={{ width: "88%" }} /><Skeleton index={6} style={{ width: "64%" }} /></div>
    </div> : <div className="skeleton-list">{[0, 1, 2].map(index => <div className="skeleton-row" key={index}>
      <Skeleton index={index * 3} className="skeleton-avatar" />
      <div className="skeleton-lines"><Skeleton index={index * 3 + 1} style={{ width: `${68 - index * 8}%` }} /><Skeleton index={index * 3 + 2} style={{ width: "40%", height: 10 }} /></div>
    </div>)}</div>}
  </SkeletonGroup>;
}
