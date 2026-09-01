import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpenCheck, ChevronDown, ChevronRight, CircleAlert,
  Database, ExternalLink, FileText, LoaderCircle, MessageCircleQuestion, Quote, RefreshCw,
  SearchCheck, ShieldCheck, Sparkles,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { formatInterviewSourceDate, sortInterviewSourcesNewest } from "../lib/interview-sources";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { sanitizeAssistantContent } from "../lib/model-protocol";
import { coverageLabel, SourceReaderDialog, sourceLabel, sourcePlatformLabel } from "./InterviewSourceReader";
import {
  findLatestInterviewResearchResult,
  hasUnansweredInterviewResearchRequest,
  resolveInterviewResearchState,
} from "../lib/interview-research";

const AgentMarkdown = lazy(() => import("./AgentMarkdown"));

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
      <button type="button" onClick={openOriginal} title={`打开${sourcePlatformLabel(source)}原帖：${sourceLabel(source)}`}>
        <span>
          <small>{sourcePlatformLabel(source)} · {coverageLabel(source)} · {formatInterviewSourceDate(source)}</small>
          <strong>{sourceLabel(source)}</strong>
        </span>
        {opening ? <LoaderCircle className="spin" size={12} /> : <ExternalLink size={12} />}
      </button>
      <button type="button" className="snapshot" onClick={() => onOpen?.(source)} title="查看 FetchCV 本地备份"><FileText size={11} /></button>
    </article>
  );
}

function matchingEvidence(source, item) {
  const target = String(item?.question || "").replace(/\s+/g, "");
  const questions = source?.extracted_questions || source?.questions || [];
  return questions.find((question) => {
    const candidate = String(question?.question || "").replace(/\s+/g, "");
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  }) || null;
}

function QuestionItem({ item, index, sourceById, onOpenSource }) {
  const [open, setOpen] = useState(index < 3);
  const evidenceSources = (item.source_ids || []).map((id) => sourceById.get(id)).filter(Boolean);
  return (
    <motion.article
      className="interview-question"
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.035, 0.18), duration: 0.2 }}
    >
      <button className="interview-question-head" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="interview-question-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="interview-question-title">
          <small>{item.category || "综合"}</small>
          <strong>{item.question}</strong>
        </span>
        <span className={`interview-frequency ${item.confidence === "recurring" ? "recurring" : ""}`}>
          {item.frequency >= 2 ? `${item.frequency} 篇提及` : "单一经验"}
        </span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="interview-question-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {item.why_it_matters && <div><small>为什么可能会问</small><p>{item.why_it_matters}</p></div>}
            {item.preparation && <div><small>准备建议</small><p>{item.preparation}</p></div>}
            {!item.why_it_matters && !item.preparation && <div><small>问题依据</small><p>该问题来自已读取面经的归纳；可在下方打开本地原文核对上下文。</p></div>}
            <footer>
              <span>来源依据</span>
              <div>
                {evidenceSources.length ? evidenceSources.map((source) => {
                  const evidence = matchingEvidence(source, item);
                  return (
                    <button className="interview-evidence-card" type="button" key={source.id} onClick={() => onOpenSource?.(source)}>
                      <span><Quote size={11} />{coverageLabel(source)}</span>
                      <strong>{sourceLabel(source)}</strong>
                      {evidence?.evidence_quote && <p>“{evidence.evidence_quote}”</p>}
                      <small>查看已保存原文 <ChevronRight size={11} /></small>
                    </button>
                  );
                }) : <p className="interview-evidence-empty">旧简报尚未保存逐条来源映射；更新调研后会补全原文依据。</p>}
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function ResearchProgress({ activity }) {
  return (
    <motion.section className="interview-progress" layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <span className="interview-progress-mark"><Sparkles size={15} /></span>
      <div>
        <small>Agent 正在调研</small>
        <strong className="interview-progress-label">{activity?.label || "检索本地知识库与公开面经"}</strong>
        <p>当前只显示正在进行的动作；抓取日志、来源和校验状态统一收纳在右侧。</p>
      </div>
    </motion.section>
  );
}

function ResearchOutcome({ message, state, sourceCount, researching, canResearch, busy, onResearch, onOpenConversation }) {
  const [expanded, setExpanded] = useState(false);
  const content = sanitizeAssistantContent(message?.content || "");
  const toolCount = Number(message?.metadata_json?.runtime?.evidence?.tool_count || 0);
  const duration = Math.max(0, Math.round(Number(message?.metadata_json?.processing_duration_ms || 0) / 1000));
  const title = state === "sources_saved" ? "已保存来源，等待生成面试简报" : "本轮调研已完成";
  const description = state === "completed_without_brief"
    ? "暂未形成可核查的共性问题，结论与下一步建议已经保留。"
    : "已有调研结果，但还没有形成结构化面试简报。";

  return (
    <motion.section className={`interview-outcome ${researching ? "previous" : ""}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <header>
        <span className="interview-outcome-mark"><SearchCheck size={16} /></span>
        <div><small>{researching ? "上一次调研" : "调研结果"}</small><strong>{title}</strong><p>{description}</p></div>
        <button className="interview-outcome-toggle" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? "收起" : "查看结论"}{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      </header>
      <div className="interview-outcome-facts">
        {toolCount > 0 && <span>{toolCount} 次工具调用</span>}
        <span>{sourceCount} 篇已验证面经已保存</span>
        {duration > 0 && <span>用时 {duration} 秒</span>}
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div className="interview-outcome-report" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="interview-outcome-markdown">
              <Suspense fallback={<p>{content}</p>}><AgentMarkdown content={content} /></Suspense>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <footer>
        <button type="button" onClick={onOpenConversation}>在对话中继续</button>
        <button type="button" disabled={busy || !canResearch} onClick={onResearch}><RefreshCw size={13} />重新调研</button>
      </footer>
    </motion.section>
  );
}

function ResearchFailure({ error, canResearch, busy, onResearch }) {
  return (
    <motion.section className="interview-outcome error" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <header>
        <span className="interview-outcome-mark"><CircleAlert size={16} /></span>
        <div><small>调研中断</small><strong>本轮没有完成</strong><p>{error}</p></div>
      </header>
      <footer><button type="button" disabled={busy || !canResearch} onClick={onResearch}><RefreshCw size={13} />重试调研</button></footer>
    </motion.section>
  );
}

export function InterviewIntelligence({ detail, activity, busy, error, runtime, onResearch, onOpenConversation }) {
  const [readerSource, setReaderSource] = useState(null);
  const briefs = detail.interview_briefs || [];
  const brief = briefs[0];
  const researchResult = useMemo(() => findLatestInterviewResearchResult(detail.messages || []), [detail.messages]);
  const failedResearch = Boolean(error && hasUnansweredInterviewResearchRequest(detail.messages || []));
  const researchState = resolveInterviewResearchState({ briefs, sources: detail.interview_sources || [], result: researchResult });
  const recurringCount = (brief?.common_questions || []).filter((item) => item.frequency >= 2).length;
  const canResearch = Boolean(runtime?.configured || runtime?.allow_mock_runtime);
  const researching = busy && activity?.kind === "chat" && activity?.taskKind === "interview_research";
  const sourceById = useMemo(
    () => new Map((detail.interview_sources || []).map((source) => [source.id, source])),
    [detail.interview_sources],
  );

  if (!brief && !researching && !researchResult && !failedResearch) {
    return (
      <div className="interview-empty-wrap">
        <motion.section className="interview-empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <span className="interview-empty-mark"><BookOpenCheck size={22} /></span>
          <p className="eyebrow">INTERVIEW INTELLIGENCE</p>
          <h2>从真实面经，准备下一轮</h2>
          <p>Agent 先复用本地知识库，完整检索小红书主来源，再读取牛客等公开原文进行交叉验证。</p>
          <div className="interview-empty-flow">
            <span><SearchCheck size={14} />检索知识库</span><i />
            <span><ExternalLink size={14} />验证多站点原帖</span><i />
            <span><MessageCircleQuestion size={14} />归纳共性问题</span>
          </div>
          <div className="interview-public-mode"><ShieldCheck size={14} /><span><strong>原帖优先，快照备用</strong><small>失效页不会进入简报；遇到验证码或访问限制会立即停止。</small></span></div>
          <button className="interview-primary" disabled={busy || !canResearch} onClick={onResearch}><Sparkles size={15} />开始面试调研</button>
          {!canResearch && <small className="interview-empty-note"><CircleAlert size={12} />请先在设置中连接模型</small>}
        </motion.section>
      </div>
    );
  }

  return (
    <div className="interview-scroll content-scroll">
      <div className="interview-page">
        <AnimatePresence mode="popLayout">{researching && <ResearchProgress key="research-progress" activity={activity} />}</AnimatePresence>
        {!brief && researchResult && (
          <ResearchOutcome
            message={researchResult}
            state={researchState}
            sourceCount={(detail.interview_sources || []).length}
            researching={researching}
            canResearch={canResearch}
            busy={busy}
            onResearch={onResearch}
            onOpenConversation={onOpenConversation}
          />
        )}
        {!brief && !researchResult && !researching && failedResearch && <ResearchFailure error={error} canResearch={canResearch} busy={busy} onResearch={onResearch} />}
        {brief && (
          <>
            <header className="interview-brief-head">
              <div><p className="eyebrow">INTERVIEW BRIEF</p><h2>{brief.company}{brief.business_unit ? ` · ${brief.business_unit}` : ""}</h2><p>{brief.role}</p></div>
              <button type="button" disabled={busy || !canResearch} onClick={onResearch}><RefreshCw size={13} />更新调研</button>
            </header>
            <section className="interview-summary">
              <p>{brief.summary}</p>
              <div>
                <span><b>{(brief.common_questions || []).length}</b> 个问题</span>
                <span><b>{recurringCount}</b> 个多源共性</span>
              </div>
            </section>
            <section className="interview-section">
              <header><div><small>01</small><h3>可能被问到什么</h3></div><p>优先展示多篇面经共同出现的问题，单一经验会明确标记。</p></header>
              <div className="interview-questions">
                {(brief.common_questions || []).map((item, index) => <QuestionItem key={`${item.question}-${index}`} item={item} index={index} sourceById={sourceById} onOpenSource={setReaderSource} />)}
              </div>
            </section>
            {!!brief.recommendations?.length && (
              <section className="interview-section">
                <header><div><small>02</small><h3>针对这份岗位的准备</h3></div><p>结合岗位要求、简历事实和已核验面经形成行动建议。</p></header>
                <div className="interview-advice">
                  {brief.recommendations.map((item, index) => (
                    <article key={`${item.title}-${index}`}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div><strong>{item.title}</strong><p>{item.action}</p>{item.rationale && <small>{item.rationale}</small>}</div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <AnimatePresence>{readerSource && <SourceReaderDialog source={readerSource} onClose={() => setReaderSource(null)} />}</AnimatePresence>
    </div>
  );
}

export function InterviewRail({ detail, activity, busy, runtime, onResearch }) {
  const [readerSource, setReaderSource] = useState(null);
  const brief = (detail.interview_briefs || [])[0];
  const sources = useMemo(() => {
    const all = detail.interview_sources || [];
    if (!brief?.source_ids?.length) return all;
    const ids = new Set(brief.source_ids);
    return all.filter((source) => ids.has(source.id));
  }, [brief, detail.interview_sources]);
  const questions = brief?.common_questions || [];
  const recurring = questions.filter((item) => item.frequency >= 2);
  const xhsSources = sortInterviewSourcesNewest(sources.filter((source) => source.platform === "xiaohongshu"));
  const supplementalSources = sortInterviewSourcesNewest(sources.filter((source) => source.platform !== "xiaohongshu"));
  const sameBusinessSources = xhsSources.filter((source) => source.metadata_json?.coverage_scope === "same_business_role");
  const companyRoleSources = xhsSources.filter((source) => source.metadata_json?.coverage_scope !== "same_business_role");
  const verified = sources.filter((source) => source.status === "analyzed" || source.verified || source.content_verified || source.questions?.length).length;
  const evidenceStatus = brief?.metadata_json?.evidence_status || (sources.length >= 4 && xhsSources.length ? "sufficient" : "limited");
  const canResearch = Boolean(runtime?.configured || runtime?.allow_mock_runtime);
  const researching = busy && activity?.kind === "chat" && activity?.taskKind === "interview_research";

  return (
    <div className="interview-rail">
      <section className={`interview-rail-state ${researching ? "researching" : ""}`}>
        <span>{researching ? <Sparkles size={14} /> : <SearchCheck size={14} />}</span>
        <div><small>{researching ? "正在调研" : brief ? "情报已就绪" : "等待开始"}</small><strong>{researching ? activity?.label || "读取公开来源" : brief ? "面试准备简报" : "暂无面试情报"}</strong></div>
      </section>

      <section className="interview-rail-metrics">
        <header><span>本轮结果</span></header>
        <div>
          <article><b>{xhsSources.length}</b><small>小红书主来源</small></article>
          <article><b>{supplementalSources.length}</b><small>社区补充</small></article>
          <article><b>{verified}</b><small>正文核验</small></article>
        </div>
        {brief && <p className={`interview-evidence-status ${evidenceStatus}`}>{evidenceStatus === "sufficient" ? "已达到多源交叉验证门槛" : "证据有限，结论仅供定向准备"}</p>}
      </section>

      {!!recurring.length && (
        <section className="interview-rail-common">
          <header><span>高频问题</span><small>{Math.min(recurring.length, 3)}</small></header>
          {recurring.slice(0, 3).map((item, index) => (
            <div key={`${item.question}-${index}`}><span>{index + 1}</span><p>{item.question}</p></div>
          ))}
        </section>
      )}

      <section className="interview-rail-sources">
        <header><span>来源证据库</span><small>{sources.length}</small></header>
        {xhsSources.length ? (
          <>
            {!!sameBusinessSources.length && <div className="interview-source-group"><small>同事业部同岗 · {sameBusinessSources.length}</small>{sameBusinessSources.map((source) => <SourceLink key={source.id || source.source_url} source={source} onOpen={setReaderSource} />)}</div>}
            {!!companyRoleSources.length && <div className="interview-source-group"><small>公司同岗 / 未注明事业部 · {companyRoleSources.length}</small>{companyRoleSources.map((source) => <SourceLink key={source.id || source.source_url} source={source} onOpen={setReaderSource} />)}</div>}
          </>
        ) : <p className="interview-rail-empty">读取到小红书正文并通过引用校验后，本地快照会出现在这里。</p>}
        {!!supplementalSources.length && (
          <div className="interview-source-group supplemental">
            <small>牛客等补充来源 · {supplementalSources.length}</small>
            {supplementalSources.map((source) => <SourceLink key={source.id || source.source_url} source={source} onOpen={setReaderSource} />)}
          </div>
        )}
      </section>

      <section className="interview-access-policy">
        <header><ShieldCheck size={13} /><span>来源校验策略</span></header>
        <ul>
          <li><Database size={12} />本地知识库与缓存优先</li>
          <li><SearchCheck size={12} />小红书检索到耗尽，再补充牛客等站点</li>
          <li><CircleAlert size={12} />失效、登录、验证码页面不进入简报</li>
        </ul>
        <small>不设固定帖子数；只读访问仍会限速，并在平台访问保护触发时停止。</small>
      </section>

      <button className="interview-rail-refresh" type="button" disabled={busy || !canResearch} onClick={onResearch}>
        <RefreshCw size={13} />{brief ? "更新面试情报" : "开始面试调研"}
      </button>
      <AnimatePresence>{readerSource && <SourceReaderDialog source={readerSource} onClose={() => setReaderSource(null)} />}</AnimatePresence>
    </div>
  );
}
