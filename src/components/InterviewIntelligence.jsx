import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight, BookOpen, Check, ChevronRight, CircleAlert,
  ExternalLink, FileText, Plus, Quote, RefreshCw,
  SearchCheck, ShieldCheck,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { ActivityIndicator } from "../ui/ActivityIndicator";
import { AnimatedCollapse } from "../ui/AnimatedCollapse";
import { useAgentMotion } from "../ui/motion";
import { formatInterviewSourceDate, sortInterviewSourcesNewest } from "../lib/interview-sources";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { matchingQuestionEvidence } from "../lib/interview-evidence";
import { coverageLabel, SourceReaderDialog, sourceLabel, sourcePlatformLabel } from "./InterviewSourceReader";
import { buildJdPreparation, summarizeInterviewEvidence } from "../lib/interview-progress";
import "./InterviewIntelligence.css";

function XiaohongshuConnection() {
  const [opened, setOpened] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  if (!window.appRuntime?.beginXiaohongshuLogin) return null;
  async function connect() {
    setPending(true);
    try {
      const result = opened ? await window.appRuntime.finishXiaohongshuLogin() : await window.appRuntime.beginXiaohongshuLogin();
      setOpened(!result.connected);
      setConnected(Boolean(result.connected));
      setMessage(result.connected ? "" : result.message || "请在打开的窗口扫码，完成后点击「我已登录」。");
    } catch (error) { setMessage(error.message || "登录窗口打开失败，请重试。"); }
    finally { setPending(false); }
  }
  return <div className="interview-connection">
    <button className="interview-text-button" type="button" disabled={pending || connected} onClick={connect} title="登录会话仅保存在本机；遇到验证码或限流时停止读取。">
      {connected ? <Check size={14} /> : <ShieldCheck size={14} />}{pending ? "连接中…" : connected ? "小红书已连接" : opened ? "我已登录，继续" : "连接小红书"}
    </button>
    {opened && <button className="interview-text-button" type="button" disabled={pending} onClick={() => { setOpened(false); setMessage(""); }}>重新连接</button>}
    {message && <p role="status">{message}</p>}
  </div>;
}
function SourceLink({ source, onOpen }) {
  const [opening, setOpening] = useState(false);
  if (!source) return null;
  const openOriginal = async () => {
    setOpening(true);
    try {
      await openOriginalInterviewSource(source);
    } finally {
      setOpening(false);
    }
  };
  return (
    <article className="interview-rail-source">
      <button type="button" onClick={openOriginal} disabled={opening} title={`打开${sourcePlatformLabel(source)}原帖：${sourceLabel(source)}`}>
        <span>
          <small>{sourcePlatformLabel(source)} · {coverageLabel(source)} · {formatInterviewSourceDate(source)}</small>
          <strong>{sourceLabel(source)}</strong>
        </span>
        {opening ? <ActivityIndicator active priority={5} label="正在打开原帖" /> : <ExternalLink size={12} />}
      </button>
      <button type="button" className="snapshot" onClick={() => onOpen?.(source)} aria-label={`查看本地备份：${sourceLabel(source)}`} title="查看本地备份"><FileText size={14} /></button>
    </article>
  );
}

function QuestionItem({ item, index, sourceById, onOpenSource }) {
  const { reducedMotion, transition } = useAgentMotion();
  const [open, setOpen] = useState(index === 0);
  // The helper also requires the current source support to cover the stored
  // independentQuestionCount; deleted or re-captured sources cannot keep it.
  const independentCount = item.currentIndependentCount;
  const evidenceSources = (item.currentSupportingSourceIds || []).map((id) => sourceById.get(id)).filter(Boolean);
  return (
    <article className="interview-question agent-stagger-in">
      <button className="interview-question-head" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="interview-question-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="interview-question-title">
          <strong>{item.question}</strong>
        </span>
        <span className={`interview-frequency agent-pill-pop ${independentCount >= 2 ? "recurring" : ""}`}>
          {independentCount >= 2 ? `${independentCount} 个独立来源` : independentCount === 1 ? "单一经验" : "独立性待核验"}
        </span>
        <motion.span className="disclosure-arrow" animate={{ rotate: open ? 90 : 0 }} transition={reducedMotion ? { duration: 0 } : transition("micro")}><ChevronRight size={14} /></motion.span>
      </button>
      <AnimatedCollapse open={open}>
          <div className="interview-question-body">
            <footer>
              <div>
                {evidenceSources.length ? evidenceSources.map((source) => {
                  const evidence = matchingQuestionEvidence(source, item);
                  return (
                    <button className="interview-evidence-card" type="button" key={source.id} onClick={() => onOpenSource?.(source)}>
                      <span><Quote size={12} />{sourcePlatformLabel(source)}</span>
                      <strong>{sourceLabel(source)}</strong>
                      {evidence?.evidence_quote && <p>“{evidence.evidence_quote}”</p>}
                      <small>查看原文 <ChevronRight size={12} /></small>
                    </button>
                  );
                }) : <p className="interview-evidence-empty">当前没有可用来源支持该问题。</p>}
              </div>
            </footer>
          </div>
      </AnimatedCollapse>
    </article>
  );
}

function outcomeLabel(summary, waitingForApproval) {
  if (waitingForApproval) return "有操作等待确认";
  if (summary.run.active || ["failed", "paused"].includes(summary.run.key)) return summary.run.label;
  if (summary.staleBrief) return "岗位已更新，面经问题待重新调研";
  if (summary.supportedQuestionCount) return `${summary.supportedQuestionCount} 道面经问题有原文依据`;
  if (summary.savedBodyCount) return `已保存 ${summary.savedBodyCount} 篇原文，暂未形成可用问题`;
  return summary.run.key === "idle" ? "尚未开始面试调研" : "本轮暂无可用面经问题";
}

function ResearchOutcome({ summary, waitingForApproval, onOpenConversation }) {
  return <section className="interview-outcome" aria-label="面试证据状态">
    <details className="interview-research-details">
      <summary>
        <span className="interview-status-icon">{summary.run.active && !waitingForApproval
          ? <ActivityIndicator active priority={20} label={summary.run.label} />
          : waitingForApproval || summary.staleBrief || ["failed", "paused"].includes(summary.run.key) || summary.reasons.some(reason => reason.key === "restricted")
            ? <CircleAlert size={16} /> : <SearchCheck size={16} />}</span>
        <span className="interview-status-label" role="status">{outcomeLabel(summary, waitingForApproval)}</span>
        <span className="interview-details-trigger">调研记录<ChevronRight size={13} /></span>
      </summary>
      <div className="interview-research-detail-body">
        <header><strong>{summary.run.label}</strong><span>{summary.evidence.label}</span></header>
        <div className="interview-outcome-facts">
          <span>累计已保存正文 {summary.savedBodyCount} 篇</span>
          <span>已完成问题提取 {summary.extractedSourceCount} 篇</span>
          <span>支持当前问题 {summary.usableSourceCount} 篇</span>
          {summary.ocrPendingCount > 0 && <span>图片 OCR 待核对 {summary.ocrPendingCount} 篇</span>}
        </div>
        <div className="interview-outcome-facts interview-evidence-accounting" aria-label="来源分组核验">
          {summary.evidenceAccounting.metrics.map(metric => <span key={metric.key}>{metric.label} {metric.display}</span>)}
        </div>
        <p>{summary.evidenceAccounting.readinessText}</p>
        <p>{summary.currentRoundSavedLabel}</p>
        {!!summary.reasons.length && <div className="interview-research-reasons" aria-label="本轮调研原因">
          {summary.reasons.map(reason => <p key={reason.key} data-reason={reason.key}><strong>{reason.label}{reason.count !== null ? " · " + reason.count + (reason.key === "irrelevant" ? " 个候选" : " 次") : ""}</strong><span>{reason.detail}</span></p>)}
        </div>}
        {summary.unsupportedQuestionCount > 0 && <p>旧简报中 {summary.unsupportedQuestionCount} 个问题缺少当前来源支持，暂不展示。历史记录已经保留。</p>}
        <button className="interview-text-button" type="button" onClick={onOpenConversation} aria-label="补充原文或查看历史对话">查看调研对话<ArrowUpRight size={13} /></button>
      </div>
    </details>
    {waitingForApproval && <button className="interview-approval-link interview-text-button" type="button" onClick={onOpenConversation}>前往确认<ArrowUpRight size={14} /></button>}
  </section>;
}

function JdPreparation({ job, onEditJob }) {
  const items = buildJdPreparation(job);
  return <section className="interview-section interview-jd-preparation" aria-label="基于 JD 推导的准备建议">
    <header><div><h3>按 JD 准备</h3><span className="interview-section-count">{items.length}</span></div><p>岗位要求推导 · 非真实面试题</p></header>
    {items.length ? <div className="interview-practice-list">{items.map((item, index) => <details className="interview-practice-item" key={item.id} open={index === 0}>
      <summary><span className="interview-practice-number">{String(index + 1).padStart(2, "0")}</span><strong>{item.title}</strong><ChevronRight size={15} /></summary>
      <div className="interview-practice-body"><p>{item.action}</p><blockquote><small>JD 依据</small><p>{item.jdQuote}</p></blockquote></div>
    </details>)}</div> : <div className="interview-no-jd"><FileText size={22} /><p>添加岗位 JD，生成针对性练习。</p><button className="interview-secondary" type="button" onClick={onEditJob}>补充岗位 JD<ArrowUpRight size={14} /></button></div>}
  </section>;
}

function SourceCollection({ sources, onOpen }) {
  const xhsSources = sortInterviewSourcesNewest(sources.filter(source => source.platform === "xiaohongshu"));
  const supplementalSources = sortInterviewSourcesNewest(sources.filter(source => source.platform !== "xiaohongshu"));
  return <>
    {!!xhsSources.length && <div className="interview-source-group"><small>小红书 · {xhsSources.length}</small>{xhsSources.map(source => <SourceLink key={source.id} source={source} onOpen={onOpen} />)}</div>}
    {!!supplementalSources.length && <div className="interview-source-group supplemental"><small>牛客等补充来源 · {supplementalSources.length}</small>{supplementalSources.map(source => <SourceLink key={source.id} source={source} onOpen={onOpen} />)}</div>}
  </>;
}

// Remount per job so a source dialog or selected tab cannot leak across jobs.
export function InterviewIntelligence(props) {
  return <InterviewWorkspace key={props.detail.job?.id} {...props} />;
}

function InterviewWorkspace({ detail, activity, busy, error, runtime, waitingForApproval = false, onResearch, onOpenConversation, onEditJob }) {
  const [readerSource, setReaderSource] = useState(null);
  const [view, setView] = useState("preparation");
  const tabId = useId();
  const summary = useMemo(() => summarizeInterviewEvidence(detail, { activity, busy, error }), [detail, activity, busy, error]);
  const canResearch = Boolean(runtime?.configured || runtime?.allow_mock_runtime);
  const researching = summary.run.active;
  const onSupplement = detail.job?.jd_raw?.trim() ? onOpenConversation : onEditJob;
  const sourceById = useMemo(() => new Map(summary.sources.map(source => [source.id, source])), [summary.sources]);
  const selectTab = event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "preparation" : event.key === "End" ? "sources" : view === "preparation" ? "sources" : "preparation";
    setView(next);
    event.currentTarget.querySelector(`[data-view="${next}"]`)?.focus();
  };
  return (
    <div className="interview-scroll content-scroll interview-workspace">
      <div className="interview-layout">
      <div className="interview-page">
        <header className="interview-workspace-header">
          <h2>面试准备</h2>
          <div className="interview-workspace-actions">
            <button className="interview-secondary" type="button" onClick={onSupplement}><Plus size={15} />补充材料</button>
            <button className="interview-primary" type="button" disabled={busy || researching || waitingForApproval || !canResearch} onClick={onResearch} title={!canResearch ? "连接模型后可调研" : undefined}>
              <RefreshCw size={14} />{researching ? "正在调研" : summary.run.key === "idle" ? "调研面经" : "重新调研"}
            </button>
          </div>
        </header>
        <div className="interview-workspace-tabs" role="tablist" aria-label="面试内容" onKeyDown={selectTab}>
          {[{ key: "preparation", label: "准备清单" }, { key: "sources", label: "面经来源", count: summary.sources.length }].map(tab => <button key={tab.key} type="button" role="tab" data-view={tab.key} id={`${tabId}-${tab.key}-tab`} aria-controls={`${tabId}-${tab.key}`} aria-selected={view === tab.key} tabIndex={view === tab.key ? 0 : -1} onClick={() => setView(tab.key)}>{tab.label}{tab.count !== undefined && <span>{tab.count}</span>}</button>)}
        </div>
        <ResearchOutcome summary={summary} waitingForApproval={waitingForApproval} onOpenConversation={onOpenConversation} />
        {!canResearch && <p className="interview-model-note">连接模型后可调研，JD 练习可直接使用。</p>}
        <div role="tabpanel" id={`${tabId}-preparation`} aria-labelledby={`${tabId}-preparation-tab`} hidden={view !== "preparation"} tabIndex={0}>
          {!!summary.questions.length && <section className="interview-section interview-practice-questions" aria-label="有来源支持的练习问题">
            <header><div><h3>面经问题</h3><span className="interview-section-count">{summary.supportedQuestionCount}</span></div><p>{summary.evidence.key === "independence_pending" ? "来源独立性待核验" : "证据有限 · 按本人经历作答"}</p></header>
            <div className="interview-questions">{summary.questions.map((item, index) => <QuestionItem key={item.id || item.question} item={item} index={index} sourceById={sourceById} onOpenSource={setReaderSource} />)}</div>
          </section>}
          <JdPreparation job={detail.job} onEditJob={onEditJob} />
        </div>
        <div role="tabpanel" id={`${tabId}-sources`} aria-labelledby={`${tabId}-sources-tab`} hidden={view !== "sources"} tabIndex={0}>
          <div className="interview-sources-toolbar"><span>{summary.savedBodyCount} 篇已保存正文{summary.ocrPendingCount > 0 ? ` · ${summary.ocrPendingCount} 篇 OCR 待核对` : ""}</span><XiaohongshuConnection /></div>
          {summary.sources.length ? <div className="interview-source-library"><SourceCollection sources={summary.sources} onOpen={setReaderSource} /></div> : <div className="interview-no-sources"><BookOpen size={26} /><h3>还没有面经来源</h3><button className="interview-secondary" type="button" onClick={onSupplement}><Plus size={14} />补充面经原文</button></div>}
        </div>
      </div>
      </div>
      <AnimatePresence>{readerSource && <SourceReaderDialog source={readerSource} onClose={() => setReaderSource(null)} />}</AnimatePresence>
    </div>
  );
}

export function InterviewRail({ detail, activity, busy }) {
  const [readerSource, setReaderSource] = useState(null);
  const summary = useMemo(() => summarizeInterviewEvidence(detail, { activity, busy }), [detail, activity, busy]);
  const sources = summary.sources;
  const recurring = summary.questions.filter(item => item.currentIndependentCount >= 2);
  return (
    <div className="interview-rail interview-rail-compact">
      <section className="interview-rail-sources">
        <header><span>来源证据库</span><small>{sources.length}</small></header>
        <SourceCollection sources={sources} onOpen={setReaderSource} />
        {!sources.length && <p className="interview-rail-empty">尚无已保存来源</p>}
      </section>
      {!!recurring.length && <section className="interview-rail-common">
        <header><span>高频问题</span><small>{Math.min(recurring.length, 3)}</small></header>
        {recurring.slice(0, 3).map((item, index) => <div key={item.question + "-" + index}><span>{index + 1}</span><p>{item.question}</p></div>)}
      </section>}
      <details className="interview-rail-audit">
        <summary>来源核验<ChevronRight size={13} /></summary>
        <section className="interview-rail-metrics">
          <header><span>当前岗位累计</span></header>
          <div>
            <article><b>{summary.savedBodyCount}</b><small>已保存正文</small></article>
            <article><b>{summary.extractedSourceCount}</b><small>已提取问题</small></article>
            <article><b>{summary.usableSourceCount}</b><small>支持当前问题</small></article>
          </div>
          <div className="interview-rail-accounting" aria-label="来源分组核验">
            {summary.evidenceAccounting.metrics.map(metric => <article key={metric.key}><b>{metric.count ?? metric.display}</b><small>{metric.label}</small></article>)}
          </div>
          {summary.ocrPendingCount > 0 && <p>图片 OCR 待核对：{summary.ocrPendingCount} 篇</p>}
          <p>证据有限，来源篇数不代表独立性或岗位覆盖。</p>
          <p>{summary.evidenceAccounting.readinessText}</p>
          <p>{summary.currentRoundSavedLabel}</p>
          <p>原帖优先，快照备用。失效页不会进入简报。</p>
        </section>
      </details>
      <AnimatePresence>{readerSource && <SourceReaderDialog source={readerSource} onClose={() => setReaderSource(null)} />}</AnimatePresence>
    </div>
  );
}
