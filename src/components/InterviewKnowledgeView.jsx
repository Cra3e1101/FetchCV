import { useEffect, useState } from "react";
import { BookOpenCheck, FileText, MessageCircleQuestion, Search, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { formatInterviewSourceDate, sortInterviewSourcesNewest } from "../lib/interview-sources";
import { InterviewSourceReader } from "./InterviewSourceReader";

export function InterviewKnowledgeView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.allInterviewKnowledge().then(setData).catch(e => setError(e.message));
  useEffect(() => { let live = true; api.allInterviewKnowledge().then(v => live && setData(v)).catch(e => live && setError(e.message)); return () => { live = false; }; }, []);
  const remove = async (kind, id) => {
    setBusy(true); setError("");
    try { await (kind === "source" ? api.deleteInterviewSource(id) : api.deleteInterviewBrief(id)); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const onDeleteInterviewSource = id => remove("source", id);
  const onDeleteInterviewBrief = id => remove("brief", id);
  const [selectedInterviewSource, setSelectedInterviewSource] = useState(null);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const { sources: interview_sources = [], briefs: interview_briefs = [] } = data || {};
  const tokens = knowledgeQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchesKnowledge = (item) => !tokens.length || tokens.every((token) => `${item.company || ""} ${item.business_unit || ""} ${item.role || ""} ${item.title || ""} ${item.summary || ""} ${(item.tags || []).join(" ")}`.toLowerCase().includes(token));
  const knowledge = { sources: sortInterviewSourcesNewest(interview_sources.filter(matchesKnowledge)), briefs: interview_briefs.filter(matchesKnowledge) };
  const requestDelete = async (kind, id) => {
    const key = `${kind}:${id}`;
    if (pendingDelete !== key) { setPendingDelete(key); return; }
    await (kind === "source" ? onDeleteInterviewSource?.(id) : onDeleteInterviewBrief?.(id));
    setPendingDelete(null);
  };
  return <main className="main-pane library-pane" aria-label="面试知识">
    <header className="task-header"><h1>面试知识</h1></header>
    {error && <div role="alert" className="dialog-error">{error}<button onClick={load}>重试</button></div>}
    {!data ? <p role="status">正在读取…</p> : <div className="content-scroll"><div className="library-content">
      <section className="library-section interview-library"><header><div><h3>面试知识</h3><p>已保存的面经与岗位简报。</p></div><span>{interview_sources.length}</span></header>
        <div className="knowledge-toolbar"><Search size={14} /><input value={knowledgeQuery} onChange={(event) => setKnowledgeQuery(event.target.value)} placeholder="搜索公司、业务线或岗位" aria-label="搜索面试知识库" />{knowledgeQuery && <button type="button" onClick={() => setKnowledgeQuery("")} aria-label="清空搜索"><X size={13} /></button>}</div>
        {!!knowledge.briefs.length && <div className="knowledge-briefs">{knowledge.briefs.map((brief) => <article key={brief.id}><span><BookOpenCheck size={16} /></span><div><small>岗位简报 · {brief.source_ids?.length || 0} 篇来源</small><strong>{brief.company}{brief.business_unit ? ` · ${brief.business_unit}` : ""}</strong><p>{brief.role}</p><em>{brief.summary}</em></div><button disabled={busy} className={pendingDelete === `brief:${brief.id}` ? "confirm-delete" : ""} onClick={() => requestDelete("brief", brief.id)} title={pendingDelete === `brief:${brief.id}` ? "再次点击确认删除" : "删除简报"}>{pendingDelete === `brief:${brief.id}` ? "确认" : <Trash2 size={13} />}</button></article>)}</div>}
        <div className="knowledge-sources">{knowledge.sources.map((source) => <article key={source.id}><span className="knowledge-source-mark"><MessageCircleQuestion size={15} /></span><div><small>{formatInterviewSourceDate(source)} · {source.company} · {source.role}</small><strong>{source.title || "小红书面试经验"}</strong><p>{source.summary || "已保存原文，等待整理。"}</p><footer><span>{source.extracted_questions?.length || 0} 个已验证问题</span><span>{source.status === "analyzed" ? "已分析" : "已读取"}</span></footer></div><button type="button" className="knowledge-source-open" onClick={() => openOriginalInterviewSource(source)} title="打开小红书原帖">查看原帖</button><button type="button" className="knowledge-source-snapshot" onClick={() => setSelectedInterviewSource(source)} title="查看 FetchCV 本地备份"><FileText size={12} /></button><button disabled={busy} className={pendingDelete === `source:${source.id}` ? "confirm-delete" : ""} onClick={() => requestDelete("source", source.id)} title={pendingDelete === `source:${source.id}` ? "再次点击确认删除" : "删除来源"}>{pendingDelete === `source:${source.id}` ? "确认" : <Trash2 size={13} />}</button></article>)}</div>
        {!knowledge.sources.length && !knowledge.briefs.length && <div className="knowledge-empty"><BookOpenCheck size={18} /><div><strong>{knowledgeQuery ? "没有匹配的面试知识" : "还没有保存面经"}</strong><p>{knowledgeQuery ? "尝试搜索更短的公司或岗位名称。" : "在岗位工作区打开“面试”进行调研，来源会保存在这里。"}</p></div></div>}
      </section>    </div></div>}
    <InterviewSourceReader source={selectedInterviewSource} onClose={() => setSelectedInterviewSource(null)} />
  </main>;
}
