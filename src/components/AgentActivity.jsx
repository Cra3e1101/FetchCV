import { motion } from "framer-motion";
import "./AgentActivity.css";
import {
  Brain, Check, ChevronDown, Circle, Copy, FileText, Globe2, Image as ImageIcon,
  Search, Sparkles, Terminal, Wrench,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { chronologicalProcessingEvents, formatProcessingDuration, mergeProcessingEvent } from "../lib/processing";
import { AnimatedCollapse } from "../ui/AnimatedCollapse";
import { ActivityIndicator } from "../ui/ActivityIndicator";
import { useAgentMotion } from "../ui/motion";
import { receiptActivity } from "../../shared/tool-activity.mjs";
import "../ui/agent-links.css";

function FoldBody({ open, id, children }) {
  return <AnimatedCollapse open={open} id={id} className="fold-body rp-actbody">{children}</AnimatedCollapse>;
}

function FoldHeader({ label, open, onToggle, bodyId, className = "", disabled = false, icon: Icon = Wrench, activity }) {
  const handleClick = (event) => { event.stopPropagation(); if (!disabled && !event.target.closest('a')) onToggle(); };
  return <div className="group/activity-header replica-activity-header" onClick={handleClick}>
    <button type="button" className={`fold-toggle ${className}`} aria-label={label} aria-expanded={disabled ? undefined : open} aria-controls={disabled ? undefined : bodyId} disabled={disabled} onClick={handleClick} />
    <span className="inline-flex min-w-0 gap-1.5 replica-activity-label"><Icon size={16} aria-hidden="true" /><span>{label}</span></span>
    {activity && (activity.href
      ? <a className="tool-activity-target agent-link" href={activity.href} target="_blank" rel="noreferrer" title={activity.href}>{new URL(activity.href).hostname.replace(/^www\./, '')}</a>
      : <span className="tool-activity-target" title={activity.text}>{activity.kind === 'search' ? `“${activity.text}”` : activity.text}</span>)}
    {!disabled && <span className="fold-chev rp-rowchev pointer-events-none relative flex"><ChevronDown size={16} aria-hidden="true" /></span>}
  </div>;
}

export function ToolReceipt({ receipts = [], defaultExpanded = false, animate = false }) {
  const animation = useAgentMotion();
  const [open, setOpen] = useState(defaultExpanded);
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
  return <motion.section className="agent-tool-receipt fold-group rp-actgroup" data-open={open} initial={animate ? animation.enter() : false} animate={{ opacity: 1, y: 0 }} transition={animation.transition("enter")}>
    <div className="outline-none"><div className="min-w-0 text-size-chat relative overflow-visible py-0"><div className="flex min-w-0 flex-col">
      <FoldHeader className="tool-group-toggle" label={label} open={open} onToggle={toggleGroup} bodyId={bodyId} />
    </div></div></div>
    <FoldBody open={open} id={bodyId}><div className="fold-command-list">{receipts.map((item, index) => {
      const key = item.tool_call_id || `${item.tool_name}-${index}`;
      return <ReceiptDetail key={key} item={item} open={open && expandedIds.has(key)} onToggle={() => setExpandedIds(previous => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      })} />;
    })}</div></FoldBody>
  </motion.section>;
}

function ReceiptDetail({ item, open, onToggle }) {
  const [copied, setCopied] = useState(null);
  const copyTimer = useRef(null);
  const bodyId = useId();
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const status = item.requires_user_action ? "等待确认" : ({completed:"成功",completed_refresh_failed:"已执行，后续处理失败",failed:"失败",cancelled:"已中断",interrupted:"已中断",running:"运行中",active:"运行中",pending:"等待中",awaiting_approval:"等待确认",paused:"已暂停"}[item.status] || "状态未知");
  const succeeded = item.status === "completed" && !item.requires_user_action;
  const toolName = item.tool_name || "工具";
  const activity = receiptActivity(item);
  // Current receipts retain summaries, not shell arguments. Never invent a
  // command from a tool name or display a generic result as shell execution.
  const isShell = /^(exec_command|run_command|shell|bash|powershell)$/.test(toolName.split(/__|\./).at(-1))
    && typeof item.command === "string" && Boolean(item.command.trim());
  const command = isShell ? item.command : "";
  const output = isShell && typeof item.output === "string" ? item.output : item.summary || "";
  const label = `${succeeded ? "已运行" : status} ${command || toolLabels[toolName] || toolName}`;
  const copy = async (text, kind) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1500);
    } catch { setCopied(null); }
  };
  const toggleRow = (event) => {
    // Own the entire row hit target, excluding output selection/copy actions.
    if (event.target.closest("[data-receipt-output], button, a")) return;
    onToggle();
  };
  return <article className={`rp-cmdrow fold-command-row tool-receipt-detail outline-none ${item.status || "unknown"}`} data-open={open} onClick={toggleRow}>
    <div className="min-w-0 text-size-chat relative overflow-visible py-0"><div className="flex min-w-0 flex-col relative overflow-clip">
      <FoldHeader className="tool-detail-toggle" label={label} open={open} onToggle={onToggle} bodyId={bodyId} activity={activity} icon={isShell ? Terminal : activity?.kind === 'url' ? Globe2 : activity?.kind === 'search' ? Search : activity?.kind === 'file' ? FileText : Wrench} />
    </div></div>
      <FoldBody open={open} id={bodyId}><div data-testid="exec-shell-body" data-receipt-output><div className="fold-output-spacing flex flex-col gap-2 pt-2 pb-1">
        <div className={`tool-output-card ${isShell ? "shell-output-card" : ""} group flex flex-col overflow-hidden rounded-lg border border-strong bg-secondary-soft-alpha`}>
          <header><span>{isShell ? "Shell" : "工具结果"}</span>{output && <button type="button" aria-label="复制工具结果" onClick={() => copy(output, "output")}>
            {copied === "output" ? <Check size={12} /> : <Copy size={12} />}
          </button>}</header>
          {command && <div className="shell-command group/command">
            <span className="shell-command-prefix" aria-hidden="true">$</span><code className="shell-command-text font-code">{command}</code>
            <button type="button" className="shell-command-copy" aria-label="复制命令" onClick={() => copy(command, "command")}>
              {copied === "command" ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>}
          <div className="fold-output-content px-2 pt-2"><pre className="shell-output m-0 p-0 font-code text-size-chat-sm text-codex-description">{output || "此工具未返回可展示的摘要"}</pre></div>
          {!!item.artifacts?.length && <small>已登记 {item.artifacts.length} 项可追溯记录</small>}
          <footer className="shell-status"><span>{succeeded && <Check size={12} aria-hidden="true" />}{status}</span></footer>
        </div>
      </div></div></FoldBody>
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
  // These labels already exist in electron/pi-agent-runtime.mjs.
  search_web: "搜索网页",
  read_web_page: "读取网页",
  open_browser_page: "打开网页",
  read_browser_page: "读取当前网页",
  list_workspace_files: "查看工作区文件",
  read_workspace_file: "读取工作区文件",
  search_workspace_text: "搜索工作区",
  read_job_workspace_context: "读取岗位与简历上下文",
  search_interview_knowledge: "检索面试知识库",
  read_interview_source: "读取面经原文",
  discover_interview_sources: "发现面经来源",
  capture_interview_source: "读取面经原文",
  analyze_interview_source: "提取面试问题",
  build_interview_brief: "生成面试简报",
  activate_interview_research: "切换到面试调研",
  inspect_application_workspace: "读取求职工作区",
  prepare_job_review: "形成岗位理解与经历建议",
  prepare_resume_review: "生成简历策略与改写补丁",
  apply_and_verify_resume: "应用并验证简历新版本",
  finalize_resume_version: "完成简历版本",
  write_workspace_file: "写入工作区文件",
  move_workspace_file: "移动工作区文件",
  delete_workspace_file: "删除工作区文件",
  read_skill: "读取 Skill",
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
    kind: step.event_type === "tool" ? "tool" : step.event_type === "model_turn" ? "model" : step.event_type?.startsWith("task_") ? "control" : "system",
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

function ActivityLine({ item, detail = false, parentStatus, indicator = false, animateEntry = false }) {
  const animation = useAgentMotion();
  // Seen-event bookkeeping updates immediately; retain entry eligibility for
  // this mount so the CSS delay can finish without replaying historical rows.
  const [enterOnMount] = useState(animateEntry);
  const recordedActive = item.status === "active";
  const active = recordedActive && parentStatus === "running";
  const stopped = recordedActive && !active;
  const stateLabel = stopped
    ? parentStatus === "awaiting_approval" ? "等待确认" : parentStatus === "stopping" ? "停止中" : parentStatus === "paused" ? "已暂停" : ["cancelled", "interrupted"].includes(parentStatus) ? "已停止" : "已结束"
    : { failed: "失败", paused: "已暂停", cancelled: "已中断" }[item.status];
  const iconState = active && indicator ? "processing" : item.status === "completed" ? "completed" : "static";
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const transition = animation.transition("enter");
  return <motion.div layout={animation.reducedMotion ? false : "position"} initial={false} transition={{ layout: transition }} className={`activity-line ${active ? "active" : stopped ? "stopped" : item.status || "unknown"}${enterOnMount ? " agent-stagger-in" : ""}`} data-recorded-status={item.status}>
    <motion.span key={iconState} className="activity-line-icon" initial={mounted ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={animation.transition("micro")}>
      {detail ? (active && indicator ? <ActivityIndicator priority={item.id === "active-model-summary" ? 20 : 30} label="正在处理" /> : item.status === "completed" ? <Check size={12} /> : <Circle size={12} />) : <ActivityIcon label={item.label} />}
    </motion.span>
    <span className="activity-line-copy"><strong>{item.label}</strong></span>
    {stateLabel && <span className="activity-line-state">{stateLabel}</span>}
  </motion.div>;
}

export function ProcessingDisclosure({ status = "completed", startedAt, durationMs, events = [], receipts = [], defaultExpanded = false, currentLabel }) {
  const bodyId = useId();
  const historyId = useId();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [elapsed, setElapsed] = useState(() => durationMs ?? Math.max(0, Date.now() - Number(startedAt || Date.now())));
  const running = status === "running";
  const stopping = status === "stopping";
  const waiting = status === "awaiting_approval";
  const wasRunning = useRef(running || stopping || waiting);
  const keepExpanded = useRef(false);
  useEffect(() => {
    const previous = wasRunning.current;
    wasRunning.current = running || stopping || waiting;
    if (running && !previous) {
      keepExpanded.current = false;
      setExpanded(true);
    }
    if (!running && !stopping && !waiting && previous) {
      const timer = window.setTimeout(() => {
        if (!keepExpanded.current) setExpanded(false);
      }, 520);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [running, stopping, waiting]);
  useEffect(() => {
    if (stopping || waiting) return undefined;
    if (!running) {
      setElapsed(Number(durationMs || 0));
      return undefined;
    }
    const update = () => setElapsed(Math.max(0, Date.now() - Number(startedAt || Date.now())));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [durationMs, running, startedAt, stopping, waiting]);
  const compactedEvents = useMemo(() => chronologicalProcessingEvents(events, receipts), [events, receipts]);
  const [seenEvents, setSeenEvents] = useState(() => new Set(compactedEvents.map(item => item.id)));
  useEffect(() => {
    setSeenEvents(previous => {
      const added = compactedEvents.filter(item => !previous.has(item.id));
      return added.length ? new Set([...previous, ...added.map(item => item.id)]) : previous;
    });
  }, [compactedEvents]);
  if (!compactedEvents.length && !running && !(durationMs > 0) && status === "completed") return null;
  const activeEvent = [...compactedEvents].reverse().find((item) => item.status === "active");
  const current = activeEvent || compactedEvents.at(-1);
  const indicatorVariant = activeEvent?.kind === "tool" ? "running" : activeEvent?.kind === "model" ? "dots" : "breathe";
  // Keep the latest steps compact without hiding an open result or a pending
  // decision as new events arrive. The full chronology remains one click away.
  const recentEvents = compactedEvents.filter((item, index) => index >= compactedEvents.length - 4
    || expandedIds.has(item.id) || item.receipt?.requires_user_action || item.receipt?.status === 'awaiting_approval');
  const hiddenCount = compactedEvents.length - recentEvents.length;
  const visibleEvents = showHistory ? compactedEvents : recentEvents;
  const toggleExpanded = () => {
    const next = !expanded;
    if (!running) keepExpanded.current = next;
    setExpanded(next);
  };
  const hasDetails = compactedEvents.length > 0 || running || stopping || waiting || status !== "completed";
  const summary = waiting ? "等待你的确认" : stopping ? "正在停止生成" : running ? "正在处理" : status === "failed" ? "运行失败" : status === "paused" ? "已暂停" : ["cancelled", "interrupted"].includes(status) ? "已中断" : "处理记录";
  return <section className={`processing-disclosure fold-group ${status} rp-actgroup`} data-open={expanded} aria-busy={running || stopping}>
    <div className="outline-none"><div className="min-w-0 text-size-chat"><div className="flex min-w-0 flex-col"><div className="group/activity-header">
    <button type="button" className="processing-summary _summary_1qt3f_2 text-text/40 font-sans text-codex-description" onClick={hasDetails ? toggleExpanded : undefined} disabled={!hasDetails} aria-expanded={hasDetails ? expanded : undefined} aria-controls={hasDetails ? bodyId : undefined}>
      <span className="inline-flex min-w-0 gap-1.5">{running && <ActivityIndicator variant={indicatorVariant} priority={30} label="正在处理" />}<time>用时 {formatProcessingDuration(elapsed).replace("m", "分").replace("s", "秒")}</time></span>
      {hasDetails && <ChevronDown size={16} />}
    </button></div></div></div></div>
    <FoldBody open={hasDetails && expanded} id={bodyId}><div className="processing-detail" aria-live="polite" aria-atomic="false">
      {(running || stopping || waiting || status === "failed" || status === "cancelled") && <div className="processing-current" role="status"><span>{running ? currentLabel || current?.label || summary : summary}</span></div>}
      {hiddenCount > 0 && <button type="button" className="processing-history-toggle" aria-expanded={showHistory} aria-controls={historyId} onClick={() => setShowHistory(value => !value)}>
        <ChevronDown size={12} aria-hidden="true"/><span>{showHistory ? '收起较早记录' : `较早的 ${hiddenCount} 步`}</span>
      </button>}
      <div id={historyId} className="processing-events">{visibleEvents.map((item) => item.receipt
        ? <ReceiptDetail key={item.id} item={item.receipt} open={expandedIds.has(item.id)} onToggle={() => setExpandedIds(previous => {
          const next = new Set(previous);
          if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
          return next;
        })} />
        : <ActivityLine key={item.id} item={item} detail parentStatus={status} indicator={false} animateEntry={running && expanded && !seenEvents.has(item.id)} />)}</div>
    </div></FoldBody>
  </section>;
}

export function AgentActivity({ activity, task, steps = [], waitingForApproval = false }) {
  const animation = useAgentMotion();
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
  return <motion.section className="agent-activity" initial={animation.enter()} animate={{ opacity: 1, y: 0 }} transition={animation.transition("enter")}>
    <ProcessingDisclosure status={activity?.stopping ? "stopping" : activity?.finished ? activity.failed ? "failed" : "completed" : waitingForApproval ? "awaiting_approval" : activity || taskRunning ? "running" : task?.status || "completed"} startedAt={startedAt} durationMs={durationMs} events={events} defaultExpanded={Boolean(activity || taskRunning)} contextKind={activity?.taskKind || "conversation"} />
  </motion.section>;
}
