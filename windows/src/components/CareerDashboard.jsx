import { ArrowRight, ArrowUpRight, BookOpenCheck, BriefcaseBusiness, FileText, Plus, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { jobProgress, summarizeJobs } from "../lib/workspace-summary";
import "./CareerDashboard.css";

export function CareerDashboard({ jobs, user, hasProfile, runtime, onNew, onImport, onLibrary, onSelect, onSettings }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const summary = summarizeJobs(jobs);
  const visibleJobs = jobs.filter((job) => {
    const matches = `${job.company || ""} ${job.role || ""}`.toLowerCase().includes(query.trim().toLowerCase());
    return matches && (filter === "all" || jobProgress(job).key === filter);
  });
  return <main className="career-dashboard">
    <header className="career-topbar"><span>我的求职工作台</span><button onClick={onSettings} className="career-connection"><i className={runtime?.configured ? "connected" : ""} />{runtime?.configured ? "模型已连接" : "配置模型"}<ArrowUpRight size={13} /></button></header>
    <div className="career-content">
      <section className="career-hero">
        <div><p className="career-kicker">FETCHCV / CAREER WORKSPACE</p><h1>让下一份机会，<br /><em>更接近你。</em></h1><p className="career-intro">{hasProfile ? `${user?.name || "你好"}，从真实经历出发，准备每一次投递。` : "把你的经历、目标岗位和面试准备，放在同一张工作台上。"}</p><button className="primary-button" onClick={hasProfile ? onNew : onImport}><Plus size={16} />{hasProfile ? "添加目标岗位" : "导入第一份简历"}<ArrowRight size={16} /></button></div>
        <div className="career-note"><span className="career-note-index">YOUR NEXT CHAPTER</span><div className="career-note-mark" aria-hidden="true">↗</div><strong>经历有依据。<br />准备有方向。</strong><p><ShieldCheck size={14} />个人资料保存在本机</p></div>
      </section>
      <section className="career-metrics" aria-label="求职进度">
        {[[summary.total, "目标岗位"], [summary.preparing, "准备中的岗位"], [summary.review, "等待确认"], [summary.submitted, "已记录投递"]].map(([value, label]) => <div key={label}><strong>{String(value).padStart(2, "0")}</strong><span>{label}</span></div>)}
      </section>
      <section className="career-tools" aria-label="求职工具">
        <button onClick={hasProfile ? onLibrary : onImport}><span className="career-tool-icon"><FileText size={21} /></span><small>01 / RESUME</small><h2>简历制作</h2><p>整理真实经历，打磨有依据的岗位简历。</p><span className="career-tool-link">{hasProfile ? "打开个人资料库" : "导入基础简历"}<ArrowUpRight size={16} /></span></button>
        <button onClick={onNew}><span className="career-tool-icon"><BriefcaseBusiness size={21} /></span><small>02 / OPPORTUNITY</small><h2>岗位分析</h2><p>读懂 JD 要求，找到与你经历的连接点。</p><span className="career-tool-link">添加岗位开始分析<ArrowUpRight size={16} /></span></button>
        <button onClick={() => { setFilter("all"); setQuery(""); document.getElementById("career-projects")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }}><span className="career-tool-icon"><BookOpenCheck size={21} /></span><small>03 / INTERVIEW</small><h2>面经调研</h2><p>按目标岗位检索面经，追溯原帖与问题依据。</p><span className="career-tool-link">选择岗位准备面试<ArrowUpRight size={16} /></span></button>
      </section>
      <section className="career-projects" id="career-projects">
        <header><div><p className="career-kicker">OPPORTUNITIES</p><h2>每一个目标，都值得认真准备<span>{jobs.length}</span></h2></div><button className="text-button" onClick={onNew}><Plus size={15} />新增岗位</button></header>
        <div className="career-project-toolbar"><div className="career-filters" aria-label="筛选岗位">{[["all", "全部岗位"], ["review", "待我确认"], ["submitted", "已投递"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="career-search"><Search size={15} /><input aria-label="搜索工作台岗位" placeholder="搜索公司或岗位" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
        <div className="career-job-table">{visibleJobs.map((job) => { const progress = jobProgress(job); return <article className="career-job" key={job.id}><span className="career-company-avatar" aria-hidden="true">{(job.company || "岗").slice(0, 1)}</span><button className="career-job-title" onClick={() => onSelect(job.id, "conversation")}><strong>{job.role || "未命名岗位"}</strong><span>{job.company || "未命名公司"}</span></button><span className={`career-stage ${progress.key}`}><i />{progress.label}</span><button className="career-job-action" onClick={() => onSelect(job.id, "resume")} aria-label={`${job.company} ${job.role} 简历`}>简历</button><button className="career-job-action" onClick={() => onSelect(job.id, "interview")} aria-label={`${job.company} ${job.role} 面经`}>面经</button><button className="career-job-open" onClick={() => onSelect(job.id, "conversation")} aria-label={`打开 ${job.company} ${job.role}`}><ArrowRight size={17} /></button></article>; })}
          {!visibleJobs.length && <div className="career-empty"><BriefcaseBusiness size={25} /><h3>{jobs.length ? "没有符合条件的岗位" : "你的下一站，从这里开始"}</h3><p>{jobs.length ? "试试其他关键词，或切换到全部岗位。" : "添加一个目标岗位，把 JD 变成可执行的准备计划。"}</p><button className="secondary-button" onClick={jobs.length ? () => { setFilter("all"); setQuery(""); } : onNew}>{jobs.length ? "清除筛选" : "添加目标岗位"}<ArrowRight size={14} /></button></div>}
        </div>
      </section>
      <footer className="career-footer"><span>以真实经历为起点，以每一次机会为目标。</span><span>FetchCV · 本地优先</span></footer>
    </div>
  </main>;
}
