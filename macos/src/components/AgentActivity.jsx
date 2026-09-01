import { AnimatePresence, motion } from "framer-motion";
import {
  Brain, Check, ChevronDown, Circle, FileText, Image as ImageIcon,
  Search, Sparkles, Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatProcessingDuration } from "../lib/processing";

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
    label: eventLabels[step.event_type] || step.stage || "运行步骤",
    detail: step.error || (toolName ? `已通过 ToolGateway 记录 ${toolName} 的输入、权限和结果。` : step.reason),
    status: step.status === "completed" ? "completed" : step.status === "failed" ? "failed" : "active",
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
  return <div className={`activity-line ${active ? "active" : item.status === "failed" ? "failed" : "completed"}`}>
    <span className="activity-line-icon">
      {detail ? (active ? <span className="activity-wave" aria-label="正在处理"><i /><i /><i /><i /></span> : item.status === "failed" ? <Circle size={10} /> : <Check size={11} />) : <ActivityIcon label={item.label} />}
    </span>
    <span className="activity-line-copy"><strong>{item.label}</strong>{item.detail && <span>{item.detail}</span>}</span>
  </div>;
}

export function ProcessingDisclosure({ status = "completed", startedAt, durationMs, events = [], defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [elapsed, setElapsed] = useState(() => durationMs ?? Math.max(0, Date.now() - Number(startedAt || Date.now())));
  const running = status === "running";
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
  if (!events.length && !running) return null;
  const current = [...events].reverse().find((item) => item.status === "active") || events.at(-1);
  return <section className={`processing-disclosure ${running ? "running" : "completed"}`}>
    <button type="button" className="processing-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span><strong>{running ? "思考中" : "已处理"}</strong><time>{formatProcessingDuration(elapsed)}</time></span>
      {!expanded && current?.label && <small>{current.label}</small>}
      <ChevronDown size={14} />
    </button>
    <AnimatePresence initial={false}>{expanded && <motion.div className="processing-detail" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .18 }}>
      {events.map((item) => <ActivityLine key={item.id} item={item} detail />)}
    </motion.div>}</AnimatePresence>
  </section>;
}

export function AgentActivity({ activity, task, steps = [] }) {
  const recentSteps = useMemo(() => steps
    .filter((item) => item.event_type === "stage" || item.event_type === "agent" || item.event_type === "model_turn" || item.event_type === "tool" || item.event_type?.startsWith("task_") || item.tool_calls?.length)
    .slice(-12), [steps]);
  const taskRunning = ["queued", "running"].includes(task?.status);
  if (!activity && !taskRunning && (!task || !recentSteps.length)) return null;

  const title = activity?.label || activityLabels[activity?.kind] || "Agent 正在处理";
  const detailEvents = activity?.kind === "chat"
    ? (activity.events || [])
    : recentSteps.map(eventFromStep);
  const events = detailEvents.length ? detailEvents : [{ id: "current", label: title, detail: "正在等待新的处理记录。", status: "active" }];

  const startedAt = activity?.startedAt || (task?.started_at ? Date.parse(task.started_at) : Date.parse(task?.created_at || "")) || 0;
  const completedAt = task?.completed_at ? Date.parse(task.completed_at) : 0;
  const durationMs = completedAt && startedAt ? Math.max(1, completedAt - startedAt) : undefined;
  return <motion.section className="agent-activity" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .18 }}>
    <ProcessingDisclosure status={activity || taskRunning ? "running" : "completed"} startedAt={startedAt} durationMs={durationMs} events={events} defaultExpanded={Boolean(activity || taskRunning)} />
  </motion.section>;
}
