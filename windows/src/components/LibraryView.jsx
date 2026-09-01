import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight, Award, BookOpenCheck, BriefcaseBusiness, FileArchive, FileText, FolderGit2,
  Globe2, GraduationCap, Layers3, MessageCircleQuestion, Plus, Search, Trash2, Upload, UserRound, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { openOriginalInterviewSource } from "../lib/interview-source-actions";
import { formatInterviewSourceDate, sortInterviewSourcesNewest } from "../lib/interview-sources";
import { InterviewSourceReader } from "./InterviewSourceReader";

const categoryNames = {
  experience: "工作与实习", project: "项目经历", education: "教育背景",
  skill: "专业技能", campus: "校园经历", award: "荣誉奖项", summary: "个人概述",
};

const categoryIcons = {
  experience: BriefcaseBusiness,
  project: Layers3,
  education: GraduationCap,
  skill: FileArchive,
  campus: GraduationCap,
  award: Award,
  summary: UserRound,
};

const materialLabel = {
  resume_pdf: "基础简历",
  portfolio: "作品集",
  website: "网站 / 应用",
  repository: "代码仓库",
  certificate: "证书附件",
  case_study: "案例材料",
  attachment: "本地资料",
};

function experienceLines(item) {
  const bullets = item.details_json?.bullets || [];
  const headline = String(item.details_json?.headline || "").trim();
  if (["skill", "summary"].includes(item.kind) && headline) return [headline, ...bullets];
  return bullets.length ? bullets : [item.summary].filter(Boolean);
}

function ExperienceCard({ item, onOpen }) {
  const Icon = categoryIcons[item.kind] || Layers3;
  const date = [item.start_date, item.end_date].filter(Boolean).join(" — ");
  const lines = experienceLines(item);
  return <article className="experience-card">
    <header>
      <span className="experience-icon"><Icon size={16} /></span>
      <div><small>{categoryNames[item.kind] || "其他经历"}</small><strong>{item.organization || item.title}</strong></div>
      {date && <time>{date}</time>}
    </header>
    {item.role && item.role !== item.title && <p className="experience-role">{item.role}</p>}
    <div className="experience-lines">{lines.slice(0, 3).map((line, index) => <p key={`${item.id}-${index}`}>{line}</p>)}</div>
    <footer><span>{item.fact_ids?.length || 0} 条可验证事实</span><button type="button" onClick={() => onOpen(item)}>查看完整经历 <ArrowUpRight size={12} /></button></footer>
  </article>;
}

function ExperienceDetailDialog({ item, onClose }) {
  useEffect(() => {
    if (!item) return undefined;
    const close = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [item, onClose]);
  if (!item) return null;
  const lines = experienceLines(item);
  const date = [item.start_date, item.end_date].filter(Boolean).join(" — ");
  return <motion.div className="experience-detail-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.section role="dialog" aria-modal="true" aria-labelledby="experience-detail-title" className="experience-detail-dialog" initial={{ opacity: 0, y: 8, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: .99 }}>
      <header><span>{categoryNames[item.kind] || "完整经历"}</span><button type="button" onClick={onClose} aria-label="关闭经历详情"><X size={16} /></button></header>
      <div className="experience-detail-body"><p>{date || "未填写时间"}</p><h2 id="experience-detail-title">{item.organization || item.title}</h2>{item.role && item.role !== item.title && <h3>{item.role}</h3>}<div>{lines.map((line, index) => <p key={`${item.id}-detail-${index}`}>{line}</p>)}</div>{!!item.tags?.length && <footer>{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</footer>}</div>
    </motion.section>
  </motion.div>;
}

export function LibraryView({ library, busy, onImportResume, onAddMaterial, onNewJob, onDeleteInterviewSource, onDeleteInterviewBrief }) {
  const [selectedExperience, setSelectedExperience] = useState(null);
  const [selectedInterviewSource, setSelectedInterviewSource] = useState(null);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const { candidate, resumes = [], experiences = [], materials = [], interview_sources = [], interview_briefs = [] } = library || {};
  const tokens = knowledgeQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchesKnowledge = (item) => !tokens.length || tokens.every((token) => `${item.company || ""} ${item.business_unit || ""} ${item.role || ""} ${item.title || ""} ${item.summary || ""} ${(item.tags || []).join(" ")}`.toLowerCase().includes(token));
  const knowledge = { sources: sortInterviewSourcesNewest(interview_sources.filter(matchesKnowledge)), briefs: interview_briefs.filter(matchesKnowledge) };
  if (!library) return <main className="main-pane library-loading"><div className="library-skeleton"><i /><i /><i /></div></main>;
  const grouped = experiences.reduce((result, item) => { (result[item.kind] ||= []).push(item); return result; }, {});
  const requestDelete = async (kind, id) => {
    const key = `${kind}:${id}`;
    if (pendingDelete !== key) { setPendingDelete(key); return; }
    await (kind === "source" ? onDeleteInterviewSource?.(id) : onDeleteInterviewBrief?.(id));
    setPendingDelete(null);
  };
  return <main className="main-pane library-pane">
    <header className="task-header library-header"><div><span>个人资料库</span><h1>{candidate.name}</h1></div><div className="library-header-actions"><button className="text-button" disabled={busy} onClick={onImportResume}><FileText size={14} />导入基础简历</button><button className="secondary-button" disabled={busy} onClick={onAddMaterial}><Upload size={15} />添加资料文件</button></div></header>
    <div className="content-scroll"><motion.div className="library-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <section className="profile-hero"><span className="profile-avatar"><UserRound size={23} /></span><div><p className="eyebrow">YOUR SOURCE MATERIAL</p><h2>{candidate.name}</h2><p>{candidate.title || "尚未设置目标方向"}{candidate.email ? ` · ${candidate.email}` : ""}</p></div><button className="primary-button" onClick={onNewJob}><Plus size={15} />新建目标岗位</button></section>

      <section className="library-section interview-library"><header><div><h3>面试知识</h3><p>Agent 已读取并验证的公开面经会沉淀在本机，可被后续相近岗位直接检索复用。</p></div><span>{interview_sources.length}</span></header>
        <div className="knowledge-toolbar"><Search size={14} /><input value={knowledgeQuery} onChange={(event) => setKnowledgeQuery(event.target.value)} placeholder="搜索公司、业务线或岗位" aria-label="搜索面试知识库" />{knowledgeQuery && <button type="button" onClick={() => setKnowledgeQuery("")} aria-label="清空搜索"><X size={13} /></button>}</div>
        {!!knowledge.briefs.length && <div className="knowledge-briefs">{knowledge.briefs.map((brief) => <article key={brief.id}><span><BookOpenCheck size={16} /></span><div><small>岗位简报 · {brief.source_ids?.length || 0} 篇来源</small><strong>{brief.company}{brief.business_unit ? ` · ${brief.business_unit}` : ""}</strong><p>{brief.role}</p><em>{brief.summary}</em></div><button disabled={busy} className={pendingDelete === `brief:${brief.id}` ? "confirm-delete" : ""} onClick={() => requestDelete("brief", brief.id)} title={pendingDelete === `brief:${brief.id}` ? "再次点击确认删除" : "删除简报"}>{pendingDelete === `brief:${brief.id}` ? "确认" : <Trash2 size={13} />}</button></article>)}</div>}
        <div className="knowledge-sources">{knowledge.sources.map((source) => <article key={source.id}><span className="knowledge-source-mark"><MessageCircleQuestion size={15} /></span><div><small>{formatInterviewSourceDate(source)} · {source.company} · {source.role}</small><strong>{source.title || "小红书面试经验"}</strong><p>{source.summary || "已保存原文，等待整理。"}</p><footer><span>{source.extracted_questions?.length || 0} 个已验证问题</span><span>{source.status === "analyzed" ? "已分析" : "已读取"}</span></footer></div><button type="button" className="knowledge-source-open" onClick={() => openOriginalInterviewSource(source)} title="打开小红书原帖">查看原帖</button><button type="button" className="knowledge-source-snapshot" onClick={() => setSelectedInterviewSource(source)} title="查看 FetchCV 本地备份"><FileText size={12} /></button><button disabled={busy} className={pendingDelete === `source:${source.id}` ? "confirm-delete" : ""} onClick={() => requestDelete("source", source.id)} title={pendingDelete === `source:${source.id}` ? "再次点击确认删除" : "删除来源"}>{pendingDelete === `source:${source.id}` ? "确认" : <Trash2 size={13} />}</button></article>)}</div>
        {!knowledge.sources.length && !knowledge.briefs.length && <div className="knowledge-empty"><BookOpenCheck size={18} /><div><strong>{knowledgeQuery ? "没有匹配的面试知识" : "还没有保存面经"}</strong><p>{knowledgeQuery ? "尝试搜索更短的公司或岗位名称。" : "完成某个岗位的简历优化后，在岗位工作区打开“面试”开始调研。"}</p></div></div>}
      </section>

      <section className="library-section"><header><div><h3>资料来源</h3><p>简历、作品集、网站、代码仓库与证书都可以成为 Agent 的证据来源。</p></div><span>{materials.length || resumes.length}</span></header>
        <div className="material-grid">
          {materials.map((material) => {
            const Icon = material.kind === "website" ? Globe2 : material.kind === "repository" ? FolderGit2 : FileText;
            return <article className="material-card" key={material.id}><span><Icon size={18} /></span><div><small>{materialLabel[material.kind] || "资料"}</small><strong>{material.name}</strong><p>{material.metadata_json?.page_count ? `${material.metadata_json.page_count} 页 · ` : ""}{material.status === "ready" ? "可用" : material.status}</p></div>{material.source_url && <a href={material.source_url} target="_blank" rel="noreferrer"><ArrowUpRight size={14} /></a>}</article>;
          })}
          {!materials.length && resumes.map((resume) => <article className="material-card" key={resume.id}><span><FileText size={18} /></span><div><small>基础简历</small><strong>{resume.name}</strong><p>{resume.content_json?.source?.filename || "导入简历"}</p></div>{resume.pdf_path && <a href={api.assetUrl(`/api/resumes/${resume.id}/pdf`)} target="_blank" rel="noreferrer"><ArrowUpRight size={14} /></a>}</article>)}
          <button className="material-add" onClick={onAddMaterial}><Plus size={17} /><span><strong>添加资料文件</strong><small>作品集、演示文稿、图片、文档或项目附件</small></span></button>
        </div>
      </section>

      <section className="library-section"><header><div><h3>完整经历</h3><p>学校、时间、角色、成果和关联荣誉保存在同一张经历卡中。</p></div><span>{experiences.length}</span></header>
        <div className="experience-groups">
          {Object.entries(grouped).map(([kind, items]) => <section className="experience-group" key={kind}><div className="experience-group-title"><strong>{categoryNames[kind] || "其他经历"}</strong><span>{items.length}</span></div><div className="experience-grid">{items.map((item) => <ExperienceCard item={item} onOpen={setSelectedExperience} key={item.id} />)}</div></section>)}
          {!experiences.length && <div className="library-zero"><BriefcaseBusiness size={20} /><strong>正在建立完整经历结构</strong><p>重新打开资料库后，旧的事实条目会自动迁移为完整经历。</p></div>}
        </div>
      </section>
    </motion.div></div>
    <AnimatePresence>{selectedExperience && <ExperienceDetailDialog item={selectedExperience} onClose={() => setSelectedExperience(null)} />}</AnimatePresence>
    <InterviewSourceReader source={selectedInterviewSource} onClose={() => setSelectedInterviewSource(null)} />
  </main>;
}

export function LibraryRail({ library }) {
  if (!library) return <aside className="context-rail onboarding-rail">
    <div className="rail-head"><span>开始使用</span></div>
    <section className="context-section">
      <div className="section-title"><span>推荐顺序</span><small>约 2 分钟</small></div>
      <ol className="onboarding-steps">
        <li><b>1</b><span><strong>导入基础简历</strong><small>先建立完整教育、实习与项目经历</small></span></li>
        <li><b>2</b><span><strong>补充作品材料</strong><small>网站、仓库和作品集按需添加</small></span></li>
        <li><b>3</b><span><strong>创建目标岗位</strong><small>粘贴 JD 后再由 Agent 定向组织</small></span></li>
      </ol>
    </section>
    <section className="context-section gate-section"><div className="section-title"><span>本地优先</span></div><p>资料默认保存在本机。只有启用外部模型并运行任务时，相关 JD 与经历才会发送给所选 API。</p></section>
  </aside>;
  const { candidate, resumes = [], facts = [], experiences = [], materials = [], interview_sources = [], interview_briefs = [] } = library;
  const verified = facts.filter((item) => item.verified).length;
  return <aside className="context-rail"><div className="rail-head"><span>资料摘要</span></div><section className="context-section"><div className="section-title"><span>个人信息</span></div><div className="library-meta"><strong>{candidate.name}</strong><p>{candidate.title || "未设置方向"}</p><small>{candidate.phone || "未识别电话"}</small><small>{candidate.email || "未识别邮箱"}</small></div></section><section className="context-section"><div className="section-title"><span>资料完整度</span><small>{experiences.length ? "可开始" : "待补充"}</small></div><div className="metric-list"><div><span>资料来源</span><b>{materials.length || resumes.length}</b></div><div><span>完整经历</span><b>{experiences.length}</b></div><div><span>底层事实</span><b>{facts.length}</b></div><div><span>已验证</span><b>{verified}</b></div></div></section><section className="context-section"><div className="section-title"><span>面试知识</span><small>{interview_sources.length ? "可复用" : "待积累"}</small></div><div className="metric-list"><div><span>公开面经</span><b>{interview_sources.length}</b></div><div><span>岗位简报</span><b>{interview_briefs.length}</b></div></div></section><section className="context-section gate-section"><div className="section-title"><span>使用原则</span></div><p>Agent 以完整经历规划内容，以原子事实校验真实性。导入资料不会自动进入某份岗位简历。</p></section></aside>;
}
