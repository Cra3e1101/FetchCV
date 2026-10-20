import {useLayoutEffect, useRef} from "react";

// Freeze the current pixel height before changing the target. This also makes
// interrupted transitions reversible; display:none is applied only at the end.
export function AnimatedCollapse({open, children, className="", id}) {
  const ref = useRef(null);
  const initial = useRef(true);
  useLayoutEffect(()=>{
    const element=ref.current;
    if(initial.current){initial.current=false;element.style.height=open?"auto":"0px";element.hidden=!open;return;}
    const height=element.hidden?0:element.getBoundingClientRect().height;
    element.hidden=false;
    element.style.height=`${height}px`;
    void element.offsetHeight;
    element.style.height=open?`${element.scrollHeight}px`:"0px";
    const finish=()=>{element.style.height=open?"auto":"0px";element.hidden=!open;};
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){finish();return;}
    const end=event=>{if(event.target===element&&event.propertyName==="height")finish();};
    element.addEventListener("transitionend",end);
    const timer=window.setTimeout(finish,350);
    return()=>{element.removeEventListener("transitionend",end);window.clearTimeout(timer);};
  },[open]);
  return <div ref={ref} id={id} className={`ui-collapse ${className}`} aria-hidden={!open} inert={!open?"":undefined}>{children}</div>;
}
