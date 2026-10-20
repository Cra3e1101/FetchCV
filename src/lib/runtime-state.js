const TASK_RUNNING = new Set(["queued", "running"]);

function latestActiveEvent(activity) {
  return [...(activity?.events || [])].reverse().find((event) => event?.status === "active") || null;
}

export function resolveAgentRuntimeState({ activity, task, approvals = [], error = "" } = {}) {
  if (error) return { id: "error", label: "需要处理", detail: String(error), active: false, attention: true };
  const pendingApproval = approvals.some((item) => item?.status === "pending");
  if (pendingApproval) return { id: "awaiting_approval", label: "等待你的确认", detail: "Agent 已停在实际操作之前。", active: false, attention: true };
  if (task?.status === "paused") return { id: "paused", label: "任务已暂停", detail: "可以从最近检查点继续。", active: false, attention: true };
  if (task?.status === "cancelled") return { id: "cancelled", label: "任务已取消", detail: "本轮不会继续执行。", active: false, attention: false };
  if (task?.status === "failed") return { id: "error", label: "运行失败", detail: "可查看失败原因并从安全检查点重试。", active: false, attention: true };

  const activeEvent = latestActiveEvent(activity);
  if (activeEvent?.kind === "tool") return { id: "tool_running", label: activeEvent.label || "正在使用工具", detail: activeEvent.detail || "工具调用经过权限与审计边界。", active: true, attention: false };
  if (activity?.kind === "chat") {
    const streaming = Boolean(activeEvent) || /生成|形成|组织回答|模型/.test(activity.label || "");
    return {
      id: streaming ? "streaming" : "connecting",
      label: activity.label || (streaming ? "正在形成回答" : "正在连接模型"),
      detail: streaming ? "回答会随模型返回逐步显示。" : "正在等待当前模型开始返回。",
      active: true,
      attention: false,
    };
  }
  if (TASK_RUNNING.has(task?.status)) return {
    id: task.status === "queued" ? "queued" : "running",
    label: task.status === "queued" ? "等待执行" : (activeEvent?.label || activity?.label || "Agent 工作中"),
    detail: task.status === "queued" ? "任务已持久化，将由本地执行器领取。" : "当前动作来自真实运行事件。",
    active: true,
    attention: false,
  };
  if (activity) return { id: "connecting", label: activity.label || "正在准备", detail: "正在建立本轮运行上下文。", active: true, attention: false };
  return { id: "idle", label: "就绪", detail: "可以继续提问或处理岗位材料。", active: false, attention: false };
}
