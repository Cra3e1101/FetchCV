const reviewStages = new Set(["awaiting_fact_review", "awaiting_user_review", "awaiting_publish_approval", "ready_to_publish"]);
const stoppedStages = new Set(["failed", "blocked", "cancelled"]);

export function jobProgress(job) {
  const stage = job.latest_run?.current_stage;
  if (stage === "frozen") return { key: "submitted", label: "已记录投递", action: "查看投递版本" };
  if (stage === "published") return { key: "ready", label: "已导出", action: "准备面试" };
  if (reviewStages.has(stage)) return { key: "review", label: "等待你确认", action: "审核建议" };
  if (stoppedStages.has(stage)) return { key: "stopped", label: stage === "cancelled" ? "已取消" : "需要处理", action: "查看任务" };
  if (stage) return { key: "active", label: "准备中", action: "继续准备" };
  return { key: "new", label: "尚未开始", action: "分析岗位" };
}

export function summarizeJobs(jobs = []) {
  return jobs.reduce((summary, job) => {
    const { key } = jobProgress(job);
    summary.total += 1;
    if (key === "review") summary.review += 1;
    if (key === "submitted") summary.submitted += 1;
    if (!["submitted", "stopped"].includes(key)) summary.preparing += 1;
    return summary;
  }, { total: 0, review: 0, submitted: 0, preparing: 0 });
}
