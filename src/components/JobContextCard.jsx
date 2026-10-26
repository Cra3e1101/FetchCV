import { JOB_CONTEXT_BASIS, JOB_CONTEXT_FIELDS, RECRUITMENT_TYPES, normalizeJobContext, staleJobResults, updateJobContextField } from "../lib/job-description";
import "./JobContextCard.css";

function ContextEvidence({ field }) {
  if (!field.source_quote) return null;
  const label = field.basis === "user_confirmed" ? "查看原文对照" : field.basis === "inferred" ? "查看推断依据" : "查看原文依据";
  return <details className="job-context-evidence"><summary>{label}{field.source_span && <span> · 位置 {field.source_span[0]}–{field.source_span[1]}</span>}</summary><blockquote>{field.source_quote}</blockquote></details>;
}

export function JobContextEditor({ value, body, onChange, disabled = false }) {
  const context = normalizeJobContext(value, body);
  const change = (key, next) => onChange(updateJobContextField(context, key, next, body));
  return <fieldset className="job-context-editor" disabled={disabled}>
    <legend>确认岗位语境</legend>
    <div className="job-context-fields">{JOB_CONTEXT_FIELDS.map(({ key, label, placeholder }) => {
      const field = context.fields[key];
      return <div className="job-context-field" key={key}>
        <label><span>{label}{field.value && <small className={`job-context-basis basis-${field.basis}`}>{JOB_CONTEXT_BASIS[field.basis]}</small>}</span>{key === "recruitment_type"
          ? <select aria-label={label} value={field.value || ""} onChange={event => change(key, event.target.value)}><option value="">未知</option>{Object.entries(RECRUITMENT_TYPES).map(([code, title]) => <option value={code} key={code}>{title}</option>)}</select>
          : <input aria-label={label} value={field.value || ""} placeholder={placeholder} maxLength={key === "published_at" ? 80 : 160} onChange={event => change(key, event.target.value)} />}</label>
        {field.value && field.basis !== "user_confirmed" && <button className="job-context-confirm" type="button" onClick={() => change(key, field.value)} aria-label={`确认${label}`}>确认此项</button>}
        <ContextEvidence field={field} />
      </div>;
    })}</div>
  </fieldset>;
}

export function JobContextSummary({ job, onEdit, disabled = false }) {
  const context = normalizeJobContext(job?.context_json, job?.jd_raw);
  const provenance = job?.jd_provenance;
  return <details className="job-context-summary">
    <summary><span>岗位语境</span>{RECRUITMENT_TYPES[context.fields.recruitment_type.value] && <span>{RECRUITMENT_TYPES[context.fields.recruitment_type.value]}</span>}</summary>
    <dl>{JOB_CONTEXT_FIELDS.map(({ key, label }) => {
      const field = context.fields[key];
      return <div key={key}><dt>{label}</dt><dd><span>{(key === "recruitment_type" ? RECRUITMENT_TYPES[field.value] : field.value) || "未知"}</span><small className={`job-context-basis basis-${field.basis}`}>{JOB_CONTEXT_BASIS[field.basis]}</small><ContextEvidence field={field} /></dd></div>;
    })}</dl>
    {provenance?.source_url && <p className="job-context-source">来源：<a href={provenance.source_url} target="_blank" rel="noreferrer">{provenance.source_url}</a></p>}
    {provenance?.fetched_at && <p className="job-context-source">网页抓取时间：{provenance.fetched_at}（与 JD 发布日期分别记录）</p>}
    {onEdit && <button type="button" disabled={disabled} onClick={onEdit}>编辑岗位与语境</button>}
  </details>;
}

export function JobInputStaleNotice({ detail }) {
  const results = staleJobResults(detail);
  if (!results.length) return null;
  return <aside className="job-input-stale" role="status" aria-label="岗位结果过期提示"><strong>旧结果已过期</strong>JD 正文或岗位语境已改变，{results.join("、")}的岗位相关性需重新分析或复核。已确认的个人事实仍按原证据核验。</aside>;
}
