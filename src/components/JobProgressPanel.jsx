import { ArrowRight, BriefcaseBusiness, ChevronDown, CircleAlert } from "lucide-react";
import { deriveJobProgress } from "../lib/job-progress";
import { ActivityIndicator } from "../ui/ActivityIndicator";
import "./JobProgressPanel.css";

export function JobStartPanel({ hasProfile, onAnalyze }) {
  return <section className="job-start-panel" aria-label="开始岗位分析">
    <BriefcaseBusiness size={25} aria-hidden="true" />
    <h2>从一个目标岗位开始准备</h2>
    <p>读懂 JD，确认自己的经历，审阅有事实依据的改写。</p>
    <button type="button" className="primary-button" onClick={onAnalyze}>分析一个岗位<ArrowRight size={15} /></button>
    {!hasProfile && <small>首次使用需要先导入本人的基础简历，再添加岗位。</small>}
    <span className="job-start-chat-note">也可以在下方继续聊天</span>
  </section>;
}

export function JobProgressPanel({ detail, runtime, runtimeState, task, busy, needsEvidenceCount, toolApprovalCount, evidenceSummary, contextCard, onAction, inlineFactReview = false }) {
  const progress = deriveJobProgress({ detail, runtime, runtimeState, task, needsEvidenceCount, toolApprovalCount });
  const selectingFacts = inlineFactReview && progress.action.key === "facts";
  const missing = [...progress.missing.filter(item => !selectingFacts || item !== "本次采用的经历组合待确认"), ...(evidenceSummary?.missing ? [evidenceSummary.missing] : [])];
  const safeWhileBusy = ["facts", "review", "evidence", "recovery", "approval", "resume", "settings"].includes(progress.action.key);
  return <section className="job-progress-panel" aria-label="岗位进度">
    {!selectingFacts && <div className="job-progress-heading" title={progress.executionLabel}><strong>{runtimeState?.id === "stopping" ? runtimeState.label : progress.stage}</strong>{progress.active && runtimeState?.id !== "stopping" && <ActivityIndicator active={runtimeState?.active ?? progress.active} variant="breathe" priority={10} className="job-progress-indicator" label={progress.executionLabel} />}</div>}
    {progress.notice && <p className="job-progress-notice" role="status">{progress.notice}</p>}
    {!selectingFacts && progress.action.key !== "waiting" && <div className="job-progress-next"><button type="button" className="primary-button" disabled={progress.action.disabled || (busy && !safeWhileBusy)} onClick={() => onAction(progress.action.key)}>{progress.action.label}<ArrowRight size={14} /></button></div>}
    <details className="job-progress-details">
      <summary>岗位详情<ChevronDown size={14} aria-hidden="true" /></summary>
      <div className="job-progress-summary">
        {!!progress.results.length && <ul className="job-progress-results" aria-label="已保存的结果">{progress.results.map(item => <li key={item.key}>{item.action ? <button type="button" onClick={() => onAction(item.action)}><span>{item.label}</span><b>{item.value}</b><ArrowRight size={11} /></button> : <><span>{item.label}</span><b>{item.value}</b></>}</li>)}</ul>}
        {!!missing.length && <ul className="job-progress-gaps" aria-label="待补充材料">{missing.map(item => <li key={item}><CircleAlert size={13} aria-hidden="true" /><span>{item}</span></li>)}</ul>}
        {evidenceSummary?.result && <p className="job-progress-source-result">{evidenceSummary.result}</p>}
        {evidenceSummary?.status && <p className="job-progress-evidence-status">{evidenceSummary.status}</p>}
      </div>
      {contextCard}
    </details>
  </section>;
}
