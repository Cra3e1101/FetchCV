import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight, Award, BriefcaseBusiness, Download, FileArchive, FileText, FolderGit2,
  Globe2, GraduationCap, Layers3, Plus, Upload, UserRound, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ContentSkeleton } from "../ui/Skeleton";
import "./LibraryView.css";

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
  resume_doc: "基础简历",
  resume_docx: "基础简历",
  resume_tex: "基础简历",
  resume_json: "基础简历",
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
      <div><strong title={item.organization || item.title}>{item.organization || item.title}</strong></div>
      {date && <time>{date}</time>}
    </header>
    {item.role && item.role !== item.title && <p className="experience-role">{item.role}</p>}
    <div className="experience-lines">{lines.slice(0, 3).map((line, index) => <p key={`${item.id}-${index}`}>{line}</p>)}</div>
    <footer><button type="button" onClick={() => onOpen(item)} aria-label={`查看 ${item.organization || item.title} 经历`}>查看详情 <ArrowUpRight size={12} /></button></footer>
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
      <div className="experience-detail-body">{date && <p>{date}</p>}<h2 id="experience-detail-title">{item.organization || item.title}</h2>{item.role && item.role !== item.title && <h3>{item.role}</h3>}<div>{lines.map((line, index) => <p key={`${item.id}-detail-${index}`}>{line}</p>)}</div>{!!item.tags?.length && <footer>{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</footer>}</div>
    </motion.section>
  </motion.div>;
}

export function LibraryView({ library, busy, onImportResume, onAddMaterial, onNewJob }) {
  const [selectedExperience, setSelectedExperience] = useState(null);
  const { candidate, resumes = [], experiences = [], materials = [] } = library || {};
  if (!library) return <main className="main-pane library-loading"><ContentSkeleton className="library-skeleton" label="正在读取资料库…" /></main>;
  const grouped = experiences.reduce((result, item) => { (result[item.kind] ||= []).push(item); return result; }, {});
  const resumeBySource = new Map(resumes.filter((resume) => resume.content_json?.source_asset_id).map((resume) => [resume.content_json.source_asset_id, resume]));
  return <main className="main-pane library-pane" aria-label="个人资料库">
    <header className="task-header library-header"><h1>个人资料库</h1><div className="library-header-actions"><button className="text-button" disabled={busy} onClick={onImportResume}><FileText size={14} />导入简历</button><button className="secondary-button" disabled={busy} onClick={onAddMaterial}><Upload size={15} />添加资料</button></div></header>
    <div className="content-scroll"><motion.div className="library-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <section className="profile-hero"><span className="profile-avatar"><UserRound size={23} /></span><div><h2>{candidate.name}</h2>{candidate.title && <p>{candidate.title}</p>}{(candidate.phone || candidate.email) && <p className="profile-contact">{[candidate.phone, candidate.email].filter(Boolean).join(" · ")}</p>}</div><button className="primary-button" onClick={onNewJob}><Plus size={15} />新建岗位</button></section>



      <section className="library-section"><header><h3>资料</h3><span>{materials.length || resumes.length}</span></header>
        <div className="material-grid">
          {materials.map((material) => {
            const Icon = material.kind === "website" ? Globe2 : material.kind === "repository" ? FolderGit2 : FileText;
            const meta = [materialLabel[material.kind] || "资料", material.metadata_json?.page_count ? `${material.metadata_json.page_count} 页` : "", material.status !== "ready" ? material.status : ""].filter(Boolean).join(" · ");
            const sourceResume = resumeBySource.get(material.id);
            return <article className="material-card" key={material.id}><span><Icon size={18} /></span><div><strong title={material.name}>{material.name}</strong><small>{meta}</small></div>{sourceResume ? <a href={api.assetUrl(`/api/resumes/${encodeURIComponent(sourceResume.id)}/source`)} target="_blank" rel="noreferrer" title="下载原件" aria-label={`下载原件 ${material.name}`}><Download size={14} /></a> : material.source_url && <a href={material.source_url} target="_blank" rel="noreferrer" aria-label={`打开 ${material.name}`}><ArrowUpRight size={14} /></a>}</article>;
          })}
          {!materials.length && resumes.map((resume) => {
            const hasSource = Boolean(resume.content_json?.source_asset_id);
            const hasVerifiedPdf = resume.content_json?.verification_status === "verified" && resume.pdf_path && resume.content_json?.pdf_sha256;
            const artifactUrl = hasSource ? `/api/resumes/${encodeURIComponent(resume.id)}/source` : hasVerifiedPdf ? `/api/resumes/${encodeURIComponent(resume.id)}/pdf` : "";
            return <article className="material-card" key={resume.id}><span><FileText size={18} /></span><div><strong title={resume.name}>{resume.name}</strong><small>基础简历{resume.content_json?.source?.filename && resume.content_json.source.filename !== resume.name ? ` · ${resume.content_json.source.filename}` : ""}</small></div>{artifactUrl && <a href={api.assetUrl(artifactUrl)} target="_blank" rel="noreferrer" aria-label={hasSource ? `下载原件 ${resume.name}` : `打开 ${resume.name}`} title={hasSource ? "下载原件" : "打开 PDF"}>{hasSource ? <Download size={14} /> : <ArrowUpRight size={14} />}</a>}</article>;
          })}
          <button className="material-add" disabled={busy} onClick={onAddMaterial}><Plus size={17} /><strong>添加资料</strong></button>
        </div>
      </section>

      <section className="library-section"><header><h3>经历</h3><span>{experiences.length}</span></header>
        <div className="experience-groups">
          {Object.entries(grouped).map(([kind, items]) => <section className="experience-group" key={kind}><div className="experience-group-title"><strong>{categoryNames[kind] || "其他经历"}</strong><span>{items.length}</span></div><div className="experience-grid">{items.map((item) => <ExperienceCard item={item} onOpen={setSelectedExperience} key={item.id} />)}</div></section>)}
          {!experiences.length && <div className="library-zero"><BriefcaseBusiness size={20} /><strong>还没有经历</strong><button type="button" className="text-button" disabled={busy} onClick={onImportResume}>导入简历</button></div>}
        </div>
      </section>
    </motion.div></div>
    <AnimatePresence>{selectedExperience && <ExperienceDetailDialog item={selectedExperience} onClose={() => setSelectedExperience(null)} />}</AnimatePresence>
  </main>;
}

export function LibraryRail({ library }) {
  if (!library) return <aside className="context-rail onboarding-rail">
    <div className="rail-head"><span>开始使用</span></div>
    <section className="context-section">
      <ol className="onboarding-steps">
        <li><b>1</b><strong>导入简历</strong></li>
        <li><b>2</b><strong>添加资料</strong></li>
        <li><b>3</b><strong>新建岗位</strong></li>
      </ol>
    </section>
    <section className="context-section gate-section"><div className="section-title"><span>本地优先</span></div><p>资料默认保存在本机。只有启用外部模型并运行任务时，相关 JD 与经历才会发送给所选 API。</p></section>
  </aside>;
  const { resumes = [], facts = [], experiences = [], materials = [] } = library;
  const verified = facts.filter((item) => item.verified).length;
  return <aside className="context-rail library-rail"><div className="rail-head"><span>资料概览</span></div><section className="context-section"><div className="metric-list"><div><span>资料</span><b>{materials.length || resumes.length}</b></div><div><span>经历</span><b>{experiences.length}</b></div><div><span>已验证事实</span><b>{verified} / {facts.length}</b></div></div></section></aside>;
}
