const stageLabels = {
  created: "准备任务", input_validating: "核对输入", jd_analyzing: "理解岗位",
  facts_matching: "匹配经历", awaiting_fact_review: "确认经历", strategy_generating: "制定简历策略",
  draft_generating: "生成改写建议", awaiting_user_review: "审阅改写", approved_changes_applying: "应用修改",
  fact_validating: "核验事实", portfolio_building: "组织作品材料", consistency_checking: "一致性检查",
  awaiting_publish_approval: "最终检查", ready_to_publish: "简历处理已完成", published: "已记录投递",
  frozen: "已记录投递", failed: "运行失败", blocked: "需要处理", cancelled: "本轮已取消",
};

export function deriveJobProgress({ detail, runtime, runtimeState, task, needsEvidenceCount = 0, toolApprovalCount = 0 }) {
  const run = detail.run;
  const stage = run?.current_stage;
  const approvals = detail.approvals || [];
  const taskRunning = ["queued", "running"].includes(task?.status);
  const active = Boolean(taskRunning || runtimeState?.active);
  const facts = detail.facts || [];
  const verifiedFacts = facts.filter(fact => fact.verified).length;
  const proposals = detail.proposals || [];
  const pendingFactReview = approvals.some(item => item.action_type === "confirm_relevant_facts" && item.status === "pending");
  const pendingRewrite = approvals.some(item => item.action_type === "apply_resume_changes" && item.status === "pending");
  const unknownInvocation = (detail.tool_invocations || []).some(item => item.status === "outcome_unknown");
  const resumeUnverified = detail.resumes?.length > 0 && detail.resumes[0]?.content_json?.verification_status !== "verified";
  const staleProfile = detail.profile?.business_context?.analysis_status === "stale";
  const staleBrief = detail.interview_briefs?.[0]?.metadata_json?.analysis_status === "stale";
  const staleProposals = proposals.filter(item => item.job_relevance?.analysis_status === "stale").length;
  const staleResume = detail.resumes?.[0]?.job_relevance?.analysis_status === "stale";
  const results = [
    detail.profile && { key: "profile", label: "岗位重点", value: staleProfile ? "旧结果已过期" : "已形成", action: "profile" },
    verifiedFacts > 0 && { key: "facts", label: "已确认个人事实", value: `${verifiedFacts} 条` },
    proposals.length > 0 && { key: "proposals", label: "改写建议", value: `${proposals.length} 条${staleProposals ? ` · ${staleProposals} 条岗位相关性已过期` : ""}`, action: "review" },
    detail.resumes?.length > 0 && { key: "resume", label: "岗位简历草稿", value: `${staleResume ? "岗位相关性已过期 · " : ""}${resumeUnverified ? "未核验" : "已保存 · 导出前复验"}`, action: "resume" },
  ].filter(Boolean);
  const missing = [
    !detail.job?.jd_raw?.trim() && "还没有完整岗位描述",
    !detail.base_resumes?.length && "还没有基础简历",
    !verifiedFacts && "还没有已确认的个人事实",
    pendingFactReview && "本次采用的经历组合待确认",
    needsEvidenceCount > 0 && `${needsEvidenceCount} 条改写待补证，当前不能直接采用`,
    resumeUnverified && "岗位简历正文或事实版本仍需核验",
    (staleProfile || staleBrief) && "JD 正文或语境已改变，旧岗位分析或面试简报需重新生成",
  ].filter(Boolean);

  let action;
  if (unknownInvocation) action = { key: "recovery", label: "核对未完成操作", detail: "先核对上次操作的实际结果，再决定是否继续。" };
  else if (toolApprovalCount) action = { key: "approval", label: "审阅待授权操作", detail: "Agent 正在等待你的操作授权。" };
  else if (staleProfile && !active) action = !runtime?.configured && !runtime?.allow_mock_runtime
    ? { key: "settings", label: "连接模型后重新分析", detail: "旧结果已过期；连接模型后按当前 JD 与语境重新分析。" }
    : { key: "restart", label: "重新分析当前岗位", detail: "旧岗位分析或简报已过期；按当前正文与语境开始新一轮，改写仍需确认。" };
  else if (staleBrief && !active) action = { key: "interview", label: "查看并更新面试简报", detail: "旧面试简报已过期；打开面试页，按当前 JD 与语境重新调研。" };
  else if (pendingFactReview || stage === "awaiting_fact_review") action = { key: "facts", label: "确认本次经历", detail: "选择本次简历要表达的经历，再继续生成策略。" };
  else if (pendingRewrite || stage === "awaiting_user_review") action = {
    key: "review", label: needsEvidenceCount ? "处理待补证" : "审阅改写建议",
    detail: needsEvidenceCount ? "查看支持原句和补证追问；可以保留原文，或补充本人事实后重新规划。" : "逐条核对原文、改写和事实证据，确认后再应用。",
  };
  else if (active) action = { key: "waiting", label: "正在处理，请稍候", detail: runtimeState?.detail || "当前任务还在执行，结果会随实际进度更新。", disabled: true };
  else if (task?.status === "paused") action = { key: "resumeTask", label: "继续当前任务", detail: "从最近保存的检查点继续。" };
  else if (stage === "awaiting_publish_approval") action = { key: "publish", label: "进入导出检查", detail: "确认当前版本后，打开简历检查与导出。" };
  else if (["ready_to_publish", "published", "frozen"].includes(stage)) action = { key: "resume", label: "打开岗位简历", detail: "检查当前版本；导出时仍会复验个人事实和版本。" };
  else if (needsEvidenceCount) action = { key: "evidence", label: "处理待补证", detail: "先查看缺少的支持，再补充本人材料或重新规划。" };
  else if (["failed", "blocked"].includes(stage) || task?.status === "failed") action = { key: "retry", label: "从中断处重试", detail: "已保留本轮材料；检查当前错误后可以继续。" };
  else if (stage === "cancelled" || task?.status === "cancelled") action = { key: "restart", label: "创建新一轮规划", detail: "保留已有材料，基于同一个岗位开始新一轮。" };
  else if (!runtime?.configured && !runtime?.allow_mock_runtime) action = { key: "settings", label: "连接模型后分析", detail: "先连接你选择的模型，再分析岗位与个人经历。" };
  else if (!run) action = { key: "start", label: "分析这个岗位", detail: "读取 JD、形成岗位重点，再由你确认本次经历。", disabled: !detail.job?.jd_raw?.trim() };
  else action = { key: "restart", label: "重新规划当前岗位", detail: "已有材料会保留，新的改写仍需逐条确认。" };

  const executionLabel = unknownInvocation ? "等待操作核对"
    : toolApprovalCount || pendingFactReview || pendingRewrite || ["awaiting_fact_review", "awaiting_user_review", "awaiting_publish_approval"].includes(stage) ? "等待你的确认"
      : active ? "本轮正在执行" : task?.status === "paused" ? "本轮已暂停"
        : stage === "cancelled" || task?.status === "cancelled" ? "本轮已取消"
          : ["failed", "blocked"].includes(stage) || task?.status === "failed" ? "本轮已中断"
            : ["ready_to_publish", "published", "frozen"].includes(stage) || task?.status === "completed" ? "本轮执行已结束"
              : run || task ? "本轮等待继续" : "尚未开始分析";
  let notice = "";
  if (["failed", "blocked"].includes(stage) && run?.error) {
    try { notice = JSON.parse(run.error).message || ""; }
    catch { notice = String(run.error); }
  }
  return { stage: stageLabels[stage] || (run ? stage || run.status : "等待分析岗位"), executionLabel, results, missing, action, active, notice };
}
