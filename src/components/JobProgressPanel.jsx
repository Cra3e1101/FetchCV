import { ArrowRight, BriefcaseBusiness, CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { deriveJobProgress } from "../lib/job-progress";
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

export function JobProgressPanel({ detail, runtime, runtimeState, task, busy, needsEvidenceCount, toolApprovalCount, evidenceSummary, contextCard, onAction }) {
  const progress = deriveJobProgress({ detail, runtime, runtimeState, task, needsEvidenceCount, toolApprovalCount });
  const missing = [...progress.missing, ...(evidenceSummary?.missing ? [evidenceSummary.missing] : [])];
  const safeWhileBusy = ["facts", "review", "evidence", "recovery", "approval", "resume", "settings"].includes(progress.action.key);
  return <section className="job-progress-panel" aria-label="岗位进度">
    <div className="job-progress-heading"><div><small>当前阶段</small><strong>{progress.stage}</strong></div><span>{progress.active ? <LoaderCircle size={12} className="spin" /> : <i />}{progress.executionLabel}</span></div>
    <div className="job-progress-summary">
      <div><h2><CheckCircle2 size={13} />已有结果</h2>{progress.results.length ? <ul>{progress.results.map(item => <li key={item.key}>{item.action ? <button type="button" onClick={() => onAction(item.action)}>{item.label}<span>{item.value}</span><ArrowRight size={11} /></button> : <><span>{item.label}</span><b>{item.value}</b></>}</li>)}</ul> : <p>{detail.job?.jd_raw?.trim() ? "已保存岗位 JD，等待形成岗位判断。" : "项目已建立，待补充岗位 JD。"}</p>}{evidenceSummary?.result && <p className="job-progress-source-result">{evidenceSummary.result}</p>}</div>
      <div><h2><CircleAlert size={13} />还缺什么</h2>{missing.length ? <ul>{missing.map(item => <li key={item}>{item}</li>)}</ul> : <p>当前没有待处理的材料缺口；导出时仍会重新核验。</p>}</div>
    </div>
    {evidenceSummary?.status && <p className="job-progress-evidence-status">{evidenceSummary.status}</p>}
    {progress.notice && <p className="job-progress-notice" role="status">{progress.notice}</p>}
    <div className="job-progress-next"><div><small>下一步</small><p>{progress.action.detail}</p></div><button type="button" className="primary-button" disabled={progress.action.disabled || (busy && !safeWhileBusy)} onClick={() => onAction(progress.action.key)}>{progress.action.label}<ArrowRight size={14} /></button></div>
    {contextCard}
  </section>;
}
