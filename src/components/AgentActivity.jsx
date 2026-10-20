import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Brain, Check, ChevronDown, Circle, Copy, FileText, Image as ImageIcon,
  Search, Sparkles, Wrench,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { compactProcessingEvents, formatProcessingDuration, mergeProcessingEvent } from "../lib/processing";

// activity-fold.html toggleBody, with cancellable completion callbacks so a
// second click reverses the current transition instead of leaving a stale hide.
function toggleBody(body, open) {
  const height = body.hidden ? 0 : body.getBoundingClientRect().height;
  body.hidden = false;
  body.style.height = `${height}px`;
  void body.offsetHeight;
  body.style.height = open ? `${body.scrollHeight}px` : "0px";
  const finish = () => {
    body.style.height = open ? "auto" : "0px";
    body.hidden = !open;
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finish();
    return undefined;
  }
  const end = (event) => {
    if (event.target === body && event.propertyName === "height") finish();
  };
  body.addEventListener("transitionend", end);
  // transitionend is absent when both heights are zero or the ancestor hides.
  const timer = window.setTimeout(finish, 350);
  return () => {
    body.removeEventListener("transitionend", end);
    window.clearTimeout(timer);
  };
}

function FoldBody({ open, id, children }) {
  const ref = useRef(null);
  const initial = useRef(true);
  useLayoutEffect(() => {
    const body = ref.current;
    if (initial.current) {
      initial.current = false;
      body.hidden = !open;
      body.style.height = open ? "auto" : "0px";
      return undefined;
    }
    return toggleBody(body, open);
  }, [open]);
  return <div ref={ref} id={id} className="fold-body" aria-hidden={!open} inert={!open ? "" : undefined}>{children}</div>;
}

function FoldHeader({ label, open, onToggle, bodyId, className = "", disabled = false }) {
  const handleClick = (event) => { event.stopPropagation(); if (!disabled) onToggle(); };
  return <div className="group/activity-header replica-activity-header" onClick={handleClick}>
    <button type="button" className={`fold-toggle ${className}`} aria-label={label} aria-expanded={disabled ? undefined : open} aria-controls={disabled ? undefined : bodyId} disabled={disabled} onClick={handleClick} />
    <span className="inline-flex min-w-0 gap-1.5 replica-activity-label"><Wrench size={16} /><span>{label}</span></span>
    {!disabled && <span className="fold-chev pointer-events-none relative flex"><ChevronDown size={16} /></span>}
  </div>;
}

export function ToolReceipt({ receipts = [] }) {
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const bodyId = useId();
  const completed = receipts.filter((item) => item.status === "completed");
  const failed = receipts.filter((item) => item.status === "failed").length;
  const label = completed.length === receipts.length ? "调用了工具" : failed ? `工具调用 · ${failed} 项失败` : "工具调用";
  const toggleGroup = () => {
    setOpen(value => !value);
    setExpandedIds(new Set());
  };
  if (!receipts.length) return null;
  return <section className="agent-tool-receipt fold-group rp-actgroup" data-open={open}>
    <div className="outline-none"><div className="min-w-0 text-size-chat relative overflow-visible py-0"><div className="flex min-w-0 flex-col">
      <FoldHeader className="tool-group-toggle" label={label} open={open} onToggle={toggleGroup} bodyId={bodyId} />
    </div></div></div>
    <FoldBody open={open} id={bodyId}><div className="fold-command-list">{receipts.map((item) => {
      const key = item.tool_call_id || `${item.tool_name}-${item.summary}`;
      return <ReceiptDetail key={key} item={item} open={open && expandedIds.has(key)} onToggle={() => setExpandedIds(previous => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      })} />;
    })}</div></FoldBody>
  </section>;
}

function ReceiptDetail({ item, open, onToggle }) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  const bodyId = useId();
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const status = item.requires_user_action ? "等待确认" : ({completed:"成功",failed:"失败",cancelled:"已中断",interrupted:"已中断",running:"运行中",active:"运行中",pending:"等待中",paused:"已暂停"}[item.status] || "状态未知");
  const label = `${item.status === "completed" ? "已运行" : status} ${item.tool_name || "工具"}`;
  return <article className={`fold-command-row tool-receipt-detail outline-none ${item.status || "unknown"}`} data-open={open}>
    <div className="min-w-0 text-size-chat relative overflow-visible py-0"><div className="flex min-w-0 flex-col relative overflow-clip">
      <FoldHeader className="tool-detail-toggle" label={label} open={open} onToggle={onToggle} bodyId={bodyId} />
      <FoldBody open={open} id={bodyId}><div data-testid="exec-shell-body"><div className="fold-output-spacing flex flex-col gap-2 pt-2 pb-1">
        <div className="tool-output-card group flex flex-col overflow-hidden rounded-lg border border-strong bg-secondary-soft-alpha">
          <header><span>工具结果</span>{item.summary && <button type="button" aria-label="复制工具结果" onClick={async () => {
            try {
              await navigator.clipboard.writeText(item.summary);
              setCopied(true);
              window.clearTimeout(copyTimer.current);
              copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
            } catch { setCopied(false); }
          }}>{copied ? <Check size={12} /> : <Copy size={12} />}</button>}</header>
          <div className="fold-output-content px-2 pt-2"><pre className="m-0 p-0 font-code text-size-chat-sm text-codex-description">{item.summary || "此工具未返回可展示的摘要"}</pre></div>
          {!!item.artifacts?.length && <small>已登记 {item.artifacts.length} 项可追溯记录</small>}
          <footer>{item.status === "completed" && <Check size={12} />}<span>{status}</span></footer>
        </div>
      </div></div></FoldBody>
    </div></div>
  </article>;
}

const activityLabels = {
  chat: "正在处理你的问题",
  job: "正在理解岗位",
  strategy: "正在形成简历策略",
  review: "正在应用已确认修改",
  resume: "正在准备简历",
};

const toolLabels = {
  validate_run_input: "核对岗位与资料",
  analyze_job: "理解岗位要求",
  match_candidate_experiences: "匹配完整经历",
  generate_resume_strategy: "制定简历策略",
  propose_resume_rewrites: "形成改写建议",
  apply_approved_resume_changes: "应用已确认修改",
  validate_resume: "核验简历事实",
  build_portfolio_preview: "整理作品材料",
  run_consistency_checks: "执行一致性检查",
  finalize_publish_ready: "准备可导出版本",
  inspect_job_context: "读取岗位工作区",
  web_search: "搜索公开网页",
  web_read: "读取网页内容",
};

function eventFromStep(step) {
  const toolName = step.tool_calls?.[0]?.tool_name;
  const eventLabels = {
    task_queued: "任务已加入队列", task_started: "Agent 已开始执行", model_turn: "模型正在决定下一步",
    tool: toolName ? (toolLabels[toolName] || `调用工具 · ${toolName}`) : "正在调用工具", tool_rejected: "工具调用未执行",
    task_paused: "任务已暂停", task_completed: "任务已完成", task_failed: "任务运行失败",
    message_queued: "消息已加入队列", message_completed: "排队消息已处理",
  };
  return {
    id: step.id,
    kind: step.event_type === "tool" ? "tool" : step.event_type?.startsWith("task_") ? "control" : "system",
    sequence: step.sequence,
    run_id: step.run_id,
    label: eventLabels[step.event_type] || step.stage || "运行步骤",
    detail: step.error || (toolName ? `已通过 ToolGateway 记录 ${toolName} 的输入、权限和结果。` : step.reason),
    status: ["running", "queued", "active"].includes(step.status) ? "active" : step.status || "unknown",
  };
}

function ActivityIcon({ label, size = 16 }) {
  const text = String(label || "");
  const Icon = /图像|图片/.test(text) ? ImageIcon
    : /搜索|查找|检索/.test(text) ? Search
      : /工具|命令|运行|执行/.test(text) ? Wrench
        : /文件|读取|简历|岗位|上下文/.test(text) ? FileText
          : /模型|响应|生成|推理/.test(text) ? Brain
            : Sparkles;
  return <Icon size={size} strokeWidth={1.8} />;
}

function ActivityLine({ item, detail = false }) {
  const active = item.status === "active";
  const reduceMotion = useReducedMotion();
  return <motion.div layout={reduceMotion ? false : "position"} initial={reduceMotion ? false : { opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={reduceMotion ? { duration: 0 } : { duration: .2, ease: [.23, 1, .32, 1] }} className={`activity-line ${active ? "active" : item.status || "unknown"}`}>
    <span className="activity-line-icon">
      {detail ? (active ? <span className="activity-wave" aria-label="正在处理"><i /><i /><i /><i /></span> : item.status === "completed" ? <Check size={12} /> : <Circle size={12} />) : <ActivityIcon label={item.label} />}
    </span>
    <span className="activity-line-copy"><strong>{item.label}</strong></span>
    {["failed", "paused", "cancelled"].includes(item.status) && <span className="activity-line-state">{{failed:"失败",paused:"已暂停",cancelled:"已中断"}[item.status]}</span>}
  </motion.div>;
}

export function ProcessingDisclosure({ status = "completed", startedAt, durationMs, events = [], defaultExpanded = false, contextKind = "conversation" }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAll, setShowAll] = useState(false);
  const [elapsed, setElapsed] = useState(() => durationMs ?? Math.max(0, Date.now() - Number(startedAt || Date.now())));
  const running = status === "running";
  const wasRunning = useRef(running);
  const keepExpanded = useRef(false);
  useEffect(() => {
    const previous = wasRunning.current;
    wasRunning.current = running;
    if (running && !previous) {
      keepExpanded.current = false;
      setExpanded(true);
    }
    if (!running && previous) {
      const timer = window.setTimeout(() => {
        if (!keepExpanded.current) setExpanded(false);
      }, 520);
      setShowAll(false);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [running]);
  useEffect(() => {
    if (!running) {
      setElapsed(Number(durationMs || 0));
      return undefined;
    }
    const update = () => setElapsed(Math.max(0, Date.now() - Number(startedAt || Date.now())));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [durationMs, running, startedAt]);
  const compactedEvents = useMemo(() => compactProcessingEvents(events, contextKind), [contextKind, events]);
  if (!compactedEvents.length && !running && !(durationMs > 0) && status === "completed") return null;
  const current = [...compactedEvents].reverse().find((item) => item.status === "active") || compactedEvents.at(-1);
  const hiddenCount = !showAll ? Math.max(0, compactedEvents.length - 4) : 0;
  const visibleEvents = hiddenCount ? compactedEvents.slice(-4) : compactedEvents;
  const toggleExpanded = () => {
    const next = !expanded;
    if (!running) keepExpanded.current = next;
    setExpanded(next);
  };
  const hasDetails = compactedEvents.length > 0;
  const summary = running ? "正在处理" : status === "failed" ? "运行失败" : ["cancelled", "interrupted", "paused"].includes(status) ? "已中断" : "处理记录";
  return <section className={`processing-disclosure fold-group ${running ? "running" : status} rp-actgroup`} data-open={expanded} aria-busy={running}>
    {!running && durationMs > 0 && <div className="outline-none"><div className="min-w-0 text-size-chat relative overflow-visible py-0"><div className="processing-elapsed text-size-chat text-secondary">用时 {formatProcessingDuration(durationMs)}</div></div></div>}
    {(hasDetails || running || status !== "completed") && <>
    <div className="outline-none"><div className="min-w-0 text-size-chat"><div className="flex min-w-0 flex-col"><div className="group/activity-header">
    <button type="button" className="processing-summary _summary_1qt3f_2 text-text/40 font-sans text-codex-description" onClick={hasDetails ? toggleExpanded : undefined} disabled={!hasDetails} aria-expanded={hasDetails ? expanded : undefined}>
      <span className="inline-flex min-w-0 gap-1.5"><strong>{running ? current?.label || summary : summary}</strong>{running && <time>{formatProcessingDuration(elapsed)}</time>}</span>
      {hasDetails && <ChevronDown size={16} />}
    </button></div></div></div></div>
    <FoldBody open={hasDetails && expanded}><div className="processing-detail" aria-live="polite" aria-atomic="false">
      {hiddenCount > 0 && <button type="button" className="processing-older" onClick={() => setShowAll(true)}>展开此前 {hiddenCount} 个阶段</button>}
      <AnimatePresence initial={false}>{visibleEvents.map((item) => <ActivityLine key={item.id} item={item} detail />)}</AnimatePresence>
    </div></FoldBody>
    </>}
  </section>;
}

export function AgentActivity({ activity, task, steps = [] }) {
  const recentSteps = useMemo(() => steps
    .filter((item) => item.event_type === "stage" || item.event_type === "agent" || item.event_type === "model_turn" || item.event_type === "tool" || item.event_type?.startsWith("task_") || item.tool_calls?.length)
    .slice(-12), [steps]);
  const taskRunning = ["queued", "running"].includes(task?.status);
  if (!activity && !taskRunning && (!task || !recentSteps.length)) return null;

  const title = activity?.label || activityLabels[activity?.kind] || "Agent 正在处理";
  const taskTrace = task?.result_json?.checkpoint?.processing_trace
    || task?.result_json?.processing_trace
    || [];
  const detailEvents = activity?.kind === "chat"
    ? (activity.events || [])
    : [...recentSteps.map(eventFromStep), ...taskTrace]
      .reduce((events, event) => mergeProcessingEvent(events, event), []);
  const events = detailEvents.length ? detailEvents : [{ id: "current", label: title, detail: "正在等待新的处理记录。", status: "active" }];

  const startedAt = activity?.startedAt || (task?.started_at ? Date.parse(task.started_at) : Date.parse(task?.created_at || "")) || 0;
  const completedAt = task?.completed_at ? Date.parse(task.completed_at) : 0;
  const durationMs = completedAt && startedAt ? Math.max(1, completedAt - startedAt) : undefined;
  return <motion.section className="agent-activity" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .18 }}>
    <ProcessingDisclosure status={activity || taskRunning ? "running" : task?.status || "completed"} startedAt={startedAt} durationMs={durationMs} events={events} defaultExpanded={Boolean(activity || taskRunning)} contextKind={activity?.taskKind || "conversation"} />
  </motion.section>;
}
