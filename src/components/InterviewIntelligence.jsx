import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import {
  ChevronRight, CircleAlert,
  Database, ExternalLink, FileText, Quote, RefreshCw,
  SearchCheck, ShieldCheck, Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ActivityIndicator } from "../ui/ActivityIndicator";
import { AnimatedCollapse } from "../ui/AnimatedCollapse";
import { motionTokens, useAgentMotion } from "../ui/motion";

function XiaohongshuConnection() {
  const [opened, setOpened] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  if (!window.appRuntime?.beginXiaohongshuLogin) return null;
  async function connect() {
    setPending(true);
    try {
      const result = opened ? await window.appRuntime.finishXiaohongshuLogin() : await window.appRuntime.beginXiaohongshuLogin();
      setOpened(!result.connected);
      setMessage(result.message || "请在独立窗口完成扫码，再点击「我已登录」。关闭窗口可取消，重新连接后可再次打开。");
    } catch (error) { setMessage(error.message || "登录窗口打开失败，请重试。"); }
    finally { setPending(false); }
  }
  return <div className="interview-public-mode"><ShieldCheck size={14} /><span>
    <strong>小红书登录会话仅保存在本机</strong>
    <small>登录后低频读取；遇到验证码或限流仍会停止。</small>
    <button type="button" disabled={pending} onClick={connect}>{pending ? "处理中…" : opened ? "我已登录，继续" : "连接小红书"}</button>
    {opened && <button type="button" disabled={pending} onClick={() => { setOpened(false); setMessage(""); }}>重新连接</button>}
    {message && <small role="status">{message}</small>}
  </span></div>;
}
import { formatInterviewSourceDate, sortInterviewSourcesNewest } from "../lib/interview-sources";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { matchingQuestionEvidence, readInterviewSourceHints } from "../lib/interview-evidence";
import { coverageLabel, SourceReaderDialog, sourceLabel, sourcePlatformLabel } from "./InterviewSourceReader";
import { buildJdPreparation, summarizeInterviewEvidence } from "../lib/interview-progress";
import "./InterviewIntelligence.css";

function SourceLink({ source, onOpen }) {
  const [opening, setOpening] = useState(false);
  if (!source) return null;
  const hints = readInterviewSourceHints(source);
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
      <button type="button" onClick={openOriginal} title={`打开${sourcePlatformLabel(source)}原帖：${sourceLabel(source)}`}>
        <span>
          <small>{sourcePlatformLabel(source)} · {coverageLabel(source)} · {formatInterviewSourceDate(source)}</small>
          <strong>{sourceLabel(source)}</strong>
          <small className="interview-source-hint-preview">{hints.preview}</small>
        </span>
        {opening ? <ActivityIndicator active priority={5} label="正在打开原帖" /> : <ExternalLink size={12} />}
      </button>
      <button type="button" className="snapshot" onClick={() => onOpen?.(source)} title="查看 FetchCV 本地备份"><FileText size={11} /></button>
    </article>
  );
}

function QuestionItem({ item, index, sourceById, onOpenSource }) {
  const { reducedMotion, transition, enter } = useAgentMotion();
  const [open, setOpen] = useState(index < 3);
  // The helper also requires the current source support to cover the stored
  // independentQuestionCount; deleted or re-captured sources cannot keep it.
  const independentCount = item.currentIndependentCount;
  const evidenceSources = (item.currentSupportingSourceIds || []).map((id) => sourceById.get(id)).filter(Boolean);
  return (
    <motion.article
      className="interview-question"
      initial={enter()}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transition("enter"), delay: reducedMotion ? 0 : Math.min(index, 2) * motionTokens.stagger / 1000 }}
    >
      <button className="interview-question-head" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="interview-question-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="interview-question-title">
          <small>{item.category || "综合"}</small>
          <strong>{item.question}</strong>
        </span>
        <span className={`interview-frequency ${independentCount >= 2 ? "recurring" : ""}`}>
          {independentCount >= 2 ? `${independentCount} 个独立来源` : independentCount === 1 ? "单一经验" : "独立性待核验"}
        </span>
        <motion.span className="disclosure-arrow" animate={{ rotate: open ? 90 : 0 }} transition={reducedMotion ? { duration: 0 } : transition("micro")}><ChevronRight size={14} /></motion.span>
      </button>
      <AnimatedCollapse open={open}>
          <div className="interview-question-body">
            <div><small>准备边界</small><p>练习解释思路与取舍；涉及个人经历时，只使用本人已确认的事实。可在下方打开原文核对问题上下文。</p></div>
            <footer>
              <span>来源依据</span>
              <div>
                {evidenceSources.length ? evidenceSources.map((source) => {
                  const evidence = matchingQuestionEvidence(source, item);
                  return (
                    <button className="interview-evidence-card" type="button" key={source.id} onClick={() => onOpenSource?.(source)}>
                      <span><Quote size={11} />{coverageLabel(source)}</span>
                      <strong>{sourceLabel(source)}</strong>
                      {evidence?.evidence_quote && <p>“{evidence.evidence_quote}”</p>}
                      <small>查看已保存原文 <ChevronRight size={11} /></small>
                    </button>
                  );
                }) : <p className="interview-evidence-empty">当前没有可用来源支持该问题。</p>}
              </div>
            </footer>
          </div>
      </AnimatedCollapse>
    </motion.article>
  );
}

function researchStatus(activity, waitingForApproval) {
  if (activity?.stopping) return { active: false, label: "正在停止生成" };
  if (activity?.finished) return { active: false, label: activity.failed ? "本轮调研失败" : "本轮调研已结束" };
  if (waitingForApproval) return { active: false, label: "等待你的确认" };
  return { active: true, label: activity?.label || "检索本地知识库与公开面经" };
}

function ResearchProgress({ activity, waitingForApproval }) {
  const { transition, enter, exit } = useAgentMotion();
  const present = useIsPresent();
  const state = researchStatus(activity, waitingForApproval);
  return (
    <motion.section className="interview-progress" initial={enter()} animate={{ opacity: 1, y: 0 }} exit={{ ...exit(), transition: transition("exit") }} transition={transition("enter")}>
      <span className="interview-progress-mark"><ActivityIndicator active={present && state.active} priority={20} label={state.label} /></span>
      <div><small>Agent 调研状态</small><strong className="interview-progress-label">{state.label}</strong><p>本轮执行状态与当前证据分别记录；已保存的来源会持续保留。</p></div>
    </motion.section>
  );
}

function ResearchOutcome({ summary, researching, canResearch, busy, onResearch, onOpenConversation, onPrepare }) {
  const { transition, enter } = useAgentMotion();
  return (
    <motion.section className="interview-outcome" aria-label="面试证据状态" initial={enter()} animate={{ opacity: 1, y: 0 }} transition={transition("enter")}>
      <header>
        <span className="interview-outcome-mark">{summary.reasons.some(reason => reason.key === "restricted") ? <CircleAlert size={16} /> : <SearchCheck size={16} />}</span>
        <div><small>{summary.run.label}</small><strong>{summary.evidence.label}</strong><p>{summary.gapText}</p></div>
      </header>
      <div className="interview-outcome-facts">
        <span>累计已保存正文 {summary.savedBodyCount} 篇</span>
        <span>已完成问题提取 {summary.extractedSourceCount} 篇</span>
        <span>支持当前问题 {summary.usableSourceCount} 篇</span>
        {summary.ocrPendingCount > 0 && <span>图片 OCR 待核对 {summary.ocrPendingCount} 篇</span>}
      </div>
      <div className="interview-outcome-facts interview-evidence-accounting" aria-label="来源分组核验">
        {summary.evidenceAccounting.metrics.map(metric => <span key={metric.key}>{metric.label} {metric.display}</span>)}
      </div>
      <p className="interview-round-accounting">{summary.evidenceAccounting.readinessText}</p>
      <p className="interview-round-accounting">{summary.currentRoundSavedLabel}</p>
      {!!summary.reasons.length && <div className="interview-research-reasons" aria-label="本轮调研原因">
        {summary.reasons.map(reason => <p key={reason.key} data-reason={reason.key}><strong>{reason.label}{reason.count !== null ? " · " + reason.count + (reason.key === "irrelevant" ? " 个候选" : " 次") : ""}</strong><span>{reason.detail}</span></p>)}
      </div>}
      {summary.unsupportedQuestionCount > 0 && <p className="interview-stale-note">旧简报中有 {summary.unsupportedQuestionCount} 个问题缺少当前来源支持，未作为准备成果展示。历史记录已经保留。</p>}
      <footer>
        {!summary.supportedQuestionCount && <button type="button" onClick={onPrepare}><FileText size={13} />按 JD 准备</button>}
        <button type="button" onClick={onOpenConversation}>补充原文或查看历史对话</button>
        <button type="button" disabled={busy || !canResearch} onClick={onResearch}><RefreshCw size={13} />{researching ? "正在调研" : "重新调研"}</button>
      </footer>
    </motion.section>
  );
}

function JdPreparation({ job, preparationRef }) {
  const items = buildJdPreparation(job);
  return <section className="interview-section interview-jd-preparation" aria-label="基于 JD 推导的准备建议" ref={preparationRef}>
    <header><div><small>JD</small><h3>基于 JD 推导的准备建议</h3></div><p>以下由岗位要求派生，可先开始练习；不代表目标公司的真实面试题或高频问题。</p></header>
    {items.length ? <div className="interview-advice">{items.map((item, index) => <article key={item.id}>
      <span>{String(index + 1).padStart(2, "0")}</span>
      <div><strong>{item.title}</strong><p>{item.action}</p><blockquote><small>JD 依据</small><p>{item.jdQuote}</p></blockquote></div>
    </article>)}</div> : <p className="interview-evidence-empty">补充岗位 JD 原文后，可按具体要求整理练习清单。</p>}
  </section>;
}

export function InterviewIntelligence({ detail, activity, busy, error, runtime, onResearch, onOpenConversation }) {
  const { transition, enter } = useAgentMotion();
  const [readerSource, setReaderSource] = useState(null);
  const [preparationElement, setPreparationElement] = useState(null);
  const summary = useMemo(() => summarizeInterviewEvidence(detail, { activity, busy, error }), [detail, activity, busy, error]);
  const brief = (detail.interview_briefs || [])[0];
  const canResearch = Boolean(runtime?.configured || runtime?.allow_mock_runtime);
  const researching = busy && activity?.kind === "chat" && activity?.taskKind === "interview_research";
  const waitingForApproval = (detail.approvals || []).some(item => item.status === "pending");
  const sourceById = useMemo(() => new Map(summary.sources.map(source => [source.id, source])), [summary.sources]);
  return (
    <div className="interview-scroll content-scroll">
      <div className="interview-page">
        <XiaohongshuConnection />
        <AnimatePresence>{researching && <ResearchProgress key="research-progress" activity={activity} waitingForApproval={waitingForApproval} />}</AnimatePresence>
        {summary.run.key === "idle" && !summary.savedBodyCount && <motion.header className="interview-brief-head" initial={enter()} animate={{ opacity: 1, y: 0 }} transition={transition("enter")}>
          <div><p className="eyebrow">INTERVIEW PREPARATION</p><h2>先从岗位要求开始准备</h2><p>可结合公开面经补充问题依据，也可直接按 JD 练习。</p></div>
          <button type="button" disabled={busy || !canResearch} onClick={onResearch}><Sparkles size={13} />开始面试调研</button>
        </motion.header>}
        <ResearchOutcome summary={summary} researching={researching} canResearch={canResearch} busy={busy} onResearch={onResearch} onOpenConversation={onOpenConversation} onPrepare={() => preparationElement?.scrollIntoView({ behavior: "smooth", block: "start" })} />
        {!canResearch && <p className="interview-empty-note"><CircleAlert size={12} />连接模型后可调研；下方 JD 准备建议可直接使用。</p>}
        {!!summary.questions.length && <>
          <header className="interview-brief-head">
            <div><p className="eyebrow">INTERVIEW BRIEF</p><h2>{brief?.company || detail.job?.company}{brief?.business_unit ? " · " + brief.business_unit : ""}</h2><p>{brief?.role || detail.job?.role}</p></div>
          </header>
          <section className="interview-summary">
            <p>以下问题保留了当前来源的逐题支持映射。面经提供定向练习依据，个人答案仍需本人事实支持。</p>
            <div><span><b>{summary.supportedQuestionCount}</b> 个有来源支持的问题</span>{summary.recurringQuestionCount > 0 && <span><b>{summary.recurringQuestionCount}</b> 个多源共性</span>}<span>证据有限</span></div>
          </section>
          <section className="interview-section">
            <header><div><small>01</small><h3>有来源支持的练习问题</h3></div><p>独立来源频次须有当前有效的支持记录；来源数量不能证明岗位覆盖。</p></header>
            <div className="interview-questions">{summary.questions.map((item, index) => <QuestionItem key={item.id || item.question} item={item} index={index} sourceById={sourceById} onOpenSource={setReaderSource} />)}</div>
          </section>
        </>}
        <JdPreparation job={detail.job} preparationRef={setPreparationElement} />
      </div>
      <AnimatePresence>{readerSource && <SourceReaderDialog source={readerSource} onClose={() => setReaderSource(null)} />}</AnimatePresence>
    </div>
  );
}

export function InterviewRail({ detail, activity, busy, runtime, onResearch }) {
  const [readerSource, setReaderSource] = useState(null);
  const summary = useMemo(() => summarizeInterviewEvidence(detail, { activity, busy }), [detail, activity, busy]);
  const sources = summary.sources;
  const recurring = summary.questions.filter(item => item.currentIndependentCount >= 2);
  const xhsSources = sortInterviewSourcesNewest(sources.filter(source => source.platform === "xiaohongshu"));
  const supplementalSources = sortInterviewSourcesNewest(sources.filter(source => source.platform !== "xiaohongshu"));
  const canResearch = Boolean(runtime?.configured || runtime?.allow_mock_runtime);
  return (
    <div className="interview-rail">
      <section className={"interview-rail-state " + (summary.run.active ? "researching" : "")}>
        <span>{summary.run.active ? <ActivityIndicator active priority={10} label={summary.run.label} /> : <SearchCheck size={14} />}</span>
        <div><small>{summary.run.label}</small><strong>{summary.evidence.label}</strong></div>
      </section>
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
        <p className="interview-evidence-status limited">证据有限，来源篇数不代表独立性或岗位覆盖。</p>
        <p>{summary.evidenceAccounting.readinessText}</p>
        <p>{summary.currentRoundSavedLabel}</p>
      </section>
      {!!recurring.length && <section className="interview-rail-common">
        <header><span>高频问题</span><small>{Math.min(recurring.length, 3)}</small></header>
        {recurring.slice(0, 3).map((item, index) => <div key={item.question + "-" + index}><span>{index + 1}</span><p>{item.question}</p></div>)}
      </section>}
      <section className="interview-rail-sources">
        <header><span>来源证据库</span><small>{sources.length}</small></header>
        {!!xhsSources.length && <div className="interview-source-group"><small>小红书来源 · {xhsSources.length}</small>{xhsSources.map(source => <SourceLink key={source.id} source={source} onOpen={setReaderSource} />)}</div>}
        {!!supplementalSources.length && <div className="interview-source-group supplemental"><small>牛客等补充来源 · {supplementalSources.length}</small>{supplementalSources.map(source => <SourceLink key={source.id} source={source} onOpen={setReaderSource} />)}</div>}
        {!sources.length && <p className="interview-rail-empty">尚无已保存来源。可先按 JD 准备，也可在对话中补充面经原文。</p>}
      </section>
      <section className="interview-access-policy">
        <header><ShieldCheck size={13} /><span>来源状态说明</span></header>
        <ul>
          <li><Database size={12} />已保存正文与已提取问题分别统计</li>
          <li><SearchCheck size={12} />原帖优先，快照备用</li>
          <li><CircleAlert size={12} />失效页不会进入简报；OCR 待核对单列</li>
        </ul>
        <small>来源摘要来自现有保存状态；完整正文与引文可在本地备份中查看。</small>
      </section>
      <button className="interview-rail-refresh" type="button" disabled={busy || !canResearch} onClick={onResearch}><RefreshCw size={13} />{sources.length ? "更新面试情报" : "开始面试调研"}</button>
      <AnimatePresence>{readerSource && <SourceReaderDialog source={readerSource} onClose={() => setReaderSource(null)} />}</AnimatePresence>
    </div>
  );
}
