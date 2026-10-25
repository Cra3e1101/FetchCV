import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, ChevronRight, ExternalLink, FileText, Search, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { buildKnowledgeGraph } from "../lib/interview-knowledge-graph.js";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { formatInterviewSourceDate, sortInterviewSourcesNewest } from "../lib/interview-sources";
import { InterviewKnowledgeGraph } from "./InterviewKnowledgeGraph";
import { InterviewSourceReader, sourcePlatformLabel } from "./InterviewSourceReader";
import "./InterviewKnowledgeView.css";

const SOURCE_PAGE_SIZE = 24;
const EMPTY_RECORDS = [];
const idKey = value => String(value);
const normalized = value => String(value || "").trim().toLocaleLowerCase();
const dateLabel = brief => {
  const value = brief.updated_at || brief.created_at;
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
};

function MatchText({ text, query }) {
  const value = String(text || "");
  const index = normalized(value).indexOf(normalized(query));
  if (!query.trim() || index < 0) return value;
  return <>{value.slice(0, index)}<mark>{value.slice(index, index + query.trim().length)}</mark>{value.slice(index + query.trim().length)}</>;
}

function QuestionList({ questions, sourceById, onRead }) {
  if (!questions?.length) return null;
  return <section className="ik-detail-section ik-questions"><h3>面试问题</h3>{questions.map((item, index) => {
    const question = typeof item === "string" ? { question: item } : item;
    if (!question?.question) return null;
    const references = (question.source_ids || []).map(id => sourceById.get(idKey(id))).filter(Boolean);
    return <article key={`${question.id || question.question}-${index}`}>
      <strong>{question.question}</strong>
      {question.evidence_quote && <blockquote>{question.evidence_quote}</blockquote>}
      {question.why_it_matters && <p>{question.why_it_matters}</p>}
      {question.preparation && <p>{question.preparation}</p>}
      {!!references.length && <div className="ik-question-sources">{references.map(source => <button type="button" key={source.id} onClick={() => onRead(source)} title={`查看本地备份：${source.title || "公开面经"}`}><FileText size={12} /><span>{source.title || "公开面经"}</span></button>)}</div>}
    </article>;
  })}</section>;
}

function SourceList({ sources, nodeBySourceId, onSelect, onRead }) {
  if (!sources.length) return null;
  return <section className="ik-detail-section ik-source-list"><h3>面经 <span>{sources.length}</span></h3>{sources.map(source => <article key={source.id}>
    <button type="button" className="ik-source-title" onClick={() => onSelect(nodeBySourceId.get(idKey(source.id))?.id)}><strong>{source.title || "公开面经"}</strong><small>{formatInterviewSourceDate(source)} · {sourcePlatformLabel(source)}</small></button>
    <button type="button" className="ik-icon-button" onClick={() => onRead(source)} aria-label={`查看本地备份：${source.title || "公开面经"}`} title="查看本地备份"><FileText size={14} /></button>
  </article>)}</section>;
}

export function InterviewKnowledgeView() {
  const [data, setData] = useState(null);
  const [searchData, setSearchData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [baseLoading, setBaseLoading] = useState(true);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedInterviewSource, setSelectedInterviewSource] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [selectedBriefId, setSelectedBriefId] = useState("");
  const [resultLimit, setResultLimit] = useState(SOURCE_PAGE_SIZE);
  const [showSearchResults, setShowSearchResults] = useState(true);
  const [openingSource, setOpeningSource] = useState(false);
  const load = () => setRefresh(value => value + 1);

  useEffect(() => {
    const changed = () => setRefresh(value => value + 1);
    window.addEventListener("fetchcv:interview-evidence-changed", changed);
    return () => window.removeEventListener("fetchcv:interview-evidence-changed", changed);
  }, []);
  useEffect(() => {
    let live = true;
    setBaseLoading(true);
    setError("");
    api.allInterviewKnowledge("")
      .then(value => { if (live) setData(value); })
      .catch(reason => { if (live) setError(reason.message || "未能读取面试知识"); })
      .finally(() => { if (live) setBaseLoading(false); });
    return () => { live = false; };
  }, [refresh]);
  useEffect(() => {
    let live = true;
    if (!knowledgeQuery.trim()) { setSearchData(null); setSearching(false); return undefined; }
    setSearching(true);
    const timer = setTimeout(() => {
      setError("");
      api.allInterviewKnowledge(knowledgeQuery)
        .then(value => { if (live) setSearchData({ ...value, query: knowledgeQuery }); })
        .catch(reason => { if (live) setError(reason.message || "搜索失败"); })
        .finally(() => { if (live) setSearching(false); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [knowledgeQuery, refresh]);

  const { sources: interview_sources = EMPTY_RECORDS, briefs: interview_briefs = EMPTY_RECORDS } = data || {};
  const knowledge = useMemo(() => buildKnowledgeGraph({ sources: interview_sources, briefs: interview_briefs }), [interview_sources, interview_briefs]);
  const nodeById = useMemo(() => new Map(knowledge.nodes.map(node => [node.id, node])), [knowledge]);
  const nodeBySourceId = useMemo(() => new Map(knowledge.nodes.filter(node => node.kind === "source").map(node => [idKey(node.source.id), node])), [knowledge]);
  const sourceById = useMemo(() => new Map(interview_sources.map(source => [idKey(source.id), source])), [interview_sources]);
  const selectedNode = nodeById.get(selectedId);
  const query = normalized(knowledgeQuery);
  const currentResults = searchData?.query === knowledgeQuery;
  const matches = useMemo(() => {
    if (!query) return [];
    const sourceIds = new Set(currentResults ? (searchData.sources || []).map(source => idKey(source.id)) : []);
    const briefIds = new Set(currentResults ? (searchData.briefs || []).map(brief => idKey(brief.id)) : []);
    return knowledge.nodes.filter(node => normalized(node.label).includes(query)
      || (node.kind === "role" && normalized(node.businessUnit).includes(query))
      || (node.kind === "source" && node.sourceIds.some(id => sourceIds.has(idKey(id))))
      || (node.kind === "role" && node.briefIds.some(id => briefIds.has(idKey(id)))));
  }, [knowledge, query, currentResults, searchData]);
  const highlightedIds = useMemo(() => {
    if (!query) return null;
    const ids = new Set(matches.map(node => node.id));
    // A full-text source hit also lights its recorded parent nodes.
    ["role-source", "company-role"].forEach(kind => knowledge.edges.filter(edge => edge.kind === kind).forEach(edge => {
      if (ids.has(edge.target)) ids.add(edge.source);
    }));
    return ids;
  }, [matches, knowledge, query]);
  const selectNode = id => {
    if (!id) return;
    setSelectedId(id);
    setSelectedBriefId("");
    setPendingDelete(null);
    setShowSearchResults(false);
  };
  const clearSelection = () => { setSelectedId(null); setPendingDelete(null); };
  useEffect(() => {
    if (data && selectedId && !nodeById.has(selectedId)) clearSelection();
  }, [data, nodeById, selectedId]);


  const remove = async (kind, id) => {
    setBusy(true); setError("");
    try {
      await (kind === "source" ? api.deleteInterviewSource(id) : api.deleteInterviewBrief(id));
      load();
      setPendingDelete(null);
    } catch (reason) { setError(reason.message || "删除失败"); }
    finally { setBusy(false); }
  };
  const onDeleteInterviewSource = id => remove("source", id);
  const onDeleteInterviewBrief = id => remove("brief", id);
  const requestDelete = (kind, id) => {
    const key = `${kind}:${id}`;
    if (pendingDelete !== key) { setPendingDelete(key); return; }
    if (kind === "source") onDeleteInterviewSource(id);
    else onDeleteInterviewBrief(id);
  };
  const openSource = async source => {
    setOpeningSource(true); setError("");
    try { await openOriginalInterviewSource(source); }
    catch (reason) { setError(reason.message || "未能打开原帖"); }
    finally { setOpeningSource(false); }
  };
  const selectedSources = selectedNode ? sortInterviewSourcesNewest(selectedNode.sourceIds.map(id => sourceById.get(idKey(id))).filter(Boolean)) : [];
  const roleChildren = selectedNode?.kind === "company" ? knowledge.edges.filter(edge => edge.kind === "company-role" && edge.source === selectedNode.id).map(edge => nodeById.get(edge.target)).filter(Boolean) : [];
  const parentRoles = selectedNode?.kind === "source" ? knowledge.edges.filter(edge => edge.kind === "role-source" && edge.target === selectedNode.id).map(edge => nodeById.get(edge.source)).filter(Boolean) : [];
  const briefs = selectedNode?.briefs || [];
  const brief = briefs.find(item => idKey(item.id) === selectedBriefId) || briefs[0];
  const source = selectedNode?.source;

  return <main className="main-pane library-pane knowledge-pane ik-pane" aria-label="面试知识" onKeyDown={event => { if (event.key === "Escape" && !selectedInterviewSource) { clearSelection(); setShowSearchResults(false); } }}>
    <header className="task-header ik-header"><h1>面试知识</h1>
      <div className="ik-search"><Search size={15} aria-hidden="true" /><input value={knowledgeQuery} onChange={event => { setKnowledgeQuery(event.target.value); clearSelection(); setResultLimit(SOURCE_PAGE_SIZE); setShowSearchResults(true); }} onFocus={() => setShowSearchResults(true)} placeholder="搜索公司、岗位或面经正文" maxLength={500} aria-label="搜索面试知识库" />{knowledgeQuery && <button type="button" onClick={() => { setKnowledgeQuery(""); clearSelection(); setShowSearchResults(true); }} aria-label="清空搜索"><X size={14} /></button>}</div>
    </header>
    {error && <div role="alert" className="ik-error"><span>{error}</span><button type="button" onClick={load}>重试</button><button type="button" onClick={() => setError("")} aria-label="关闭错误"><X size={13} /></button></div>}
    <div className={`ik-workspace${selectedNode ? " has-detail" : ""}`}>
      <div className="ik-map-area">
        <InterviewKnowledgeGraph nodes={knowledge.nodes} edges={knowledge.edges} selectedId={selectedId} highlightedIds={highlightedIds} onSelect={selectNode} onClear={clearSelection} loading={!data && baseLoading} error={error} onRetry={load} />
        {query && showSearchResults && <section className="ik-search-results ik-search-results-visible" aria-label="面试知识搜索结果">
          <header><strong>{searching ? "正在搜索…" : matches.length ? `${matches.length} 项匹配` : "没有匹配的面试知识"}</strong><button type="button" className="ik-icon-button" onClick={() => setShowSearchResults(false)} aria-label="收起搜索结果"><X size={14} /></button></header>
          <div className="ik-result-items">{matches.slice(0, resultLimit).map(node => <button type="button" className="ik-result-item" key={node.id} onClick={() => selectNode(node.id)}>
            <span className={`ik-result-dot ik-result-dot-${node.kind}`} /><span><strong><MatchText text={node.label} query={knowledgeQuery} /></strong>{node.kind !== "company" && <small>{[node.company, node.businessUnit, node.kind === "source" ? node.role : ""].filter(Boolean).join(" · ")}</small>}</span><ChevronRight size={13} />
          </button>)}</div>
          {matches.length > resultLimit && <button type="button" className="ik-more-results" onClick={() => setResultLimit(value => value + SOURCE_PAGE_SIZE)}>更多结果</button>}
        </section>}
      </div>
      {selectedNode && <aside className="ik-detail ik-detail-entering" aria-label="知识详情" key={selectedNode.id}>
        <header className="ik-detail-header"><div className="ik-detail-title-block">{selectedNode.kind !== "company" && <small>{[selectedNode.company, selectedNode.businessUnit].filter(Boolean).join(" / ")}</small>}<span className={`ik-kind-badge ik-kind-badge-${selectedNode.kind}`}>{{ company: "公司", role: "岗位", source: "面经" }[selectedNode.kind]}</span><h2>{selectedNode.label}</h2></div><button type="button" className="ik-icon-button" onClick={clearSelection} aria-label="关闭知识详情"><X size={17} /></button></header>
        <div className="ik-detail-scroll">
          {selectedNode.kind === "company" && <>
            {!!roleChildren.length && <section className="ik-detail-section ik-role-list"><h3>岗位</h3>{roleChildren.map(role => <button type="button" key={role.id} onClick={() => selectNode(role.id)}><span><strong>{role.label}</strong>{role.businessUnit && <small>{role.businessUnit}</small>}</span><ChevronRight size={14} /></button>)}</section>}
            <SourceList sources={selectedSources} nodeBySourceId={nodeBySourceId} onSelect={selectNode} onRead={setSelectedInterviewSource} />
          </>}
          {selectedNode.kind === "role" && <>
            {brief && <section className="ik-detail-section ik-brief"><div className="ik-brief-toolbar">{briefs.length > 1 ? <label><span className="ik-sr-only">简报版本</span><select aria-label="选择简报版本" value={idKey(brief.id)} onChange={event => { setSelectedBriefId(event.target.value); setPendingDelete(null); }}>{briefs.map((item, index) => <option key={item.id} value={idKey(item.id)}>{dateLabel(item) || `版本 ${briefs.length - index}`}{index === 0 ? " · 最新" : ""}</option>)}</select></label> : <h3>岗位简报</h3>}<button type="button" className={`ik-icon-button${pendingDelete === `brief:${brief.id}` ? " is-confirming" : ""}`} disabled={busy} onClick={() => requestDelete("brief", brief.id)} aria-label={pendingDelete === `brief:${brief.id}` ? "确认删除简报" : "删除简报"} title={pendingDelete === `brief:${brief.id}` ? "再次点击确认删除" : "删除当前简报"}>{pendingDelete === `brief:${brief.id}` ? "确认" : <Trash2 size={14} />}</button></div>{brief.summary && <p className="ik-summary">{brief.summary}</p>}</section>}
            <QuestionList questions={brief?.common_questions} sourceById={sourceById} onRead={setSelectedInterviewSource} />
            <SourceList sources={selectedSources} nodeBySourceId={nodeBySourceId} onSelect={selectNode} onRead={setSelectedInterviewSource} />
          </>}
          {source && <>
            <div className="ik-source-meta"><span>{sourcePlatformLabel(source)}</span><time>{formatInterviewSourceDate(source)}</time>{source.status === "ocr_pending" && <span className="ik-ocr-status">OCR 待核对</span>}</div>
            <div className="ik-source-actions"><button type="button" onClick={() => openSource(source)} disabled={openingSource}><ExternalLink size={13} />查看原帖</button><button type="button" onClick={() => setSelectedInterviewSource(source)}><FileText size={14} />查看本地备份</button><button type="button" className={`ik-icon-button${pendingDelete === `source:${source.id}` ? " is-confirming" : ""}`} disabled={busy} onClick={() => requestDelete("source", source.id)} aria-label={pendingDelete === `source:${source.id}` ? "确认删除来源" : "删除来源"} title={pendingDelete === `source:${source.id}` ? "再次点击确认删除" : "删除来源"}>{pendingDelete === `source:${source.id}` ? "确认" : <Trash2 size={14} />}</button></div>
            {source.summary && <p className="ik-summary">{source.summary}</p>}
            <QuestionList questions={source.extracted_questions} sourceById={sourceById} onRead={setSelectedInterviewSource} />
            {!!parentRoles.length && <section className="ik-detail-section ik-role-list"><h3>关联岗位</h3>{parentRoles.map(role => <button type="button" key={role.id} onClick={() => selectNode(role.id)}><span><strong>{role.label}</strong><small>{[role.company, role.businessUnit].filter(Boolean).join(" · ")}</small></span><ArrowLeft size={13} /></button>)}</section>}
            {!source.summary && !source.extracted_questions?.length && <button type="button" className="ik-read-source" onClick={() => setSelectedInterviewSource(source)}><FileText size={16} />打开已保存的正文<ChevronRight size={14} /></button>}
          </>}
          {!selectedSources.length && !brief && selectedNode.kind !== "source" && <p className="ik-detail-empty"><Building2 size={15} />暂无关联面经</p>}
        </div>
      </aside>}
    </div>
    <InterviewSourceReader source={selectedInterviewSource} onClose={() => setSelectedInterviewSource(null)} />
  </main>;
}
