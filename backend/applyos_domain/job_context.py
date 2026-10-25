"""Small, deterministic JD context and job-input dependency contract."""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import re

from sqlalchemy import select

CONTEXT_FIELDS = ("function", "sub_direction", "recruitment_type", "business_unit", "published_at")
CONTEXT_BASES = {"source", "inferred", "user_confirmed", "unknown"}
RECRUITMENT_TYPES = {"campus", "internship", "social"}
RECRUITMENT_LABELS = {"campus": ("campus", "校园招聘", "校招", "秋招", "春招", "应届生"),
                      "internship": ("internship", "实习", "实习生"),
                      "social": ("social", "experienced", "社会招聘", "社招")}


def body_hash(body: str | None) -> str:
    return sha256(str(body or "").encode("utf-8")).hexdigest()


def normalize_provenance(value: dict | None, body: str, source_url: str | None) -> dict:
    value = value if isinstance(value, dict) else {}
    digest = body_hash(body)
    warnings = [str(item)[:160] for item in value.get("warnings", [])[:30]] if isinstance(value.get("warnings"), list) else []
    previous = str(value.get("body_hash") or "")
    if previous and previous != digest:
        warnings.append("body_edited_since_fetch")
    result = {"status": str(value.get("status") or ("ok" if body else "insufficient_content"))[:40],
              "body_hash": digest, "source_url": str(source_url or ""),
              "adapter": str(value.get("adapter") or "manual")[:80],
              "adapter_version": str(value.get("adapter_version") or "jd-input-v1")[:80],
              "fetched_at": value.get("fetched_at"), "warnings": list(dict.fromkeys(warnings))}
    acquisition = str(value.get("acquisition_body_hash") or previous)
    if acquisition and acquisition != digest:
        result["acquisition_body_hash"] = acquisition[:64]
    return result


def normalize_context(value: dict | None, body: str = "") -> dict:
    """Never manufacture evidence for legacy or stale source fields.

    User confirmation is an explicit assertion, not a verified source quote.
    Source/inferred values require a verbatim location in the current JD.
    """
    fields = (value or {}).get("fields", {}) if isinstance(value, dict) else {}
    result = {"schema_version": 1, "fields": {}}
    for name in CONTEXT_FIELDS:
        item = fields.get(name, {}) if isinstance(fields, dict) else {}
        item = item if isinstance(item, dict) else {}
        text = str(item.get("value") or "").strip()[:240] or None
        basis = item.get("basis", "unknown")
        basis = basis if basis in CONTEXT_BASES else "unknown"
        quote = str(item.get("source_quote") or "")[:2000]
        span = None
        if basis in {"source", "inferred"}:
            start = body.find(quote) if quote else -1
            if start < 0:
                text, basis, quote = None, "unknown", ""
            else:
                span = [start, start + len(quote)]
        elif quote:
            start = body.find(quote)
            if start >= 0:
                span = [start, start + len(quote)]
            else:
                quote = ""
        if name == "recruitment_type" and text not in RECRUITMENT_TYPES:
            text = None
        if text and basis == "source":
            if name == "recruitment_type":
                supported = any(label.casefold() in quote.casefold() for label in RECRUITMENT_LABELS[text])
            else:
                supported = text.casefold() in quote.casefold()
            if not supported:
                text, basis, quote, span = None, "unknown", "", None
        if not text or basis == "unknown":
            text, basis, quote, span = None, "unknown", "", None
        result["fields"][name] = {"value": text, "basis": basis, "source_quote": quote, "source_span": span}
    return result


def source_context(body: str) -> dict:
    """Only explicit field labels; no whole-prose job-type guessing."""
    fields = {}
    labels = {"function": "职能|岗位职能", "sub_direction": "子方向|岗位方向|技术方向",
              "recruitment_type": "招聘类型|招聘类别", "business_unit": "部门|所属部门|业务部门|事业部",
              "published_at": "发布日期|发布时间|发布于"}
    for name, label in labels.items():
        match = re.search(r"(?:^|\n)\s*(?:" + label + r")[：:]\s*([^\n]{1,240})", body)
        if not match:
            continue
        value = match.group(1).strip()
        if name == "recruitment_type":
            value = {"校园招聘": "campus", "校招": "campus", "校招正式": "campus", "正式校招": "campus",
                     "实习": "internship", "实习生": "internship", "社会招聘": "social", "社招": "social"}.get(value, value)
        fields[name] = {"value": value, "basis": "source", "source_quote": match.group(0).strip()}
    return normalize_context({"fields": fields}, body)


def context_value(context: dict | None, field: str) -> str:
    fields = context.get("fields", {}) if isinstance(context, dict) else {}
    item = fields.get(field, {}) if isinstance(fields, dict) else {}
    return str(item.get("value") or "") if isinstance(item, dict) and item.get("basis") in CONTEXT_BASES - {"unknown"} else ""


def job_input_signature(job) -> str:
    values = {name: getattr(job, name, None) for name in ("company", "role", "location", "jd_raw", "source_url")}
    values["context_json"] = normalize_context(job.context_json, job.jd_raw or "")
    return body_hash(json.dumps(values, sort_keys=True, ensure_ascii=False))


def mark_job_analyses_stale(session, job, *, reason: str) -> None:
    """T3 only: existing job profile and interview brief depend on JD/context."""
    from .models import InterviewBrief, JobProfile, ResumeVersion, RewriteProposal
    job.input_revision = (job.input_revision or 1) + 1
    marker = {"analysis_status": "stale", "stale_reason": reason,
              "stale_at": datetime.now(timezone.utc).isoformat(), "current_input_revision": job.input_revision}
    profile = session.scalar(select(JobProfile).where(JobProfile.job_id == job.id))
    resume_ids = list(session.scalars(select(ResumeVersion.id).where(
        ResumeVersion.job_id == job.id, ResumeVersion.candidate_id == job.candidate_id)))
    proposal_ids = list(session.scalars(select(RewriteProposal.id).where(RewriteProposal.resume_version_id.in_(resume_ids)))) if resume_ids else []
    if profile is None and (resume_ids or proposal_ids):
        profile = JobProfile(job_id=job.id)
        session.add(profile)
    if profile is not None:
        previous_ids = (profile.business_context or {}).get("stale_related_artifacts", {})
        related = {"resume_ids": sorted(set(previous_ids.get("resume_ids", []) + resume_ids)),
                   "proposal_ids": sorted(set(previous_ids.get("proposal_ids", []) + proposal_ids))}
        profile.business_context = {**(profile.business_context or {}), **marker, "stale_related_artifacts": related}
    for brief in session.scalars(select(InterviewBrief).where(
            InterviewBrief.job_id == job.id, InterviewBrief.candidate_id == job.candidate_id)):
        brief.metadata_json = {**(brief.metadata_json or {}), **marker}


def current_analysis_marker(job, previous: dict | None = None) -> dict:
    result = {"analysis_status": "current", "input_revision": job.input_revision or 1,
              "jd_body_hash": body_hash(job.jd_raw), "context_json": normalize_context(job.context_json, job.jd_raw or "")}
    if previous and previous.get("stale_related_artifacts"):
        result["stale_related_artifacts"] = previous["stale_related_artifacts"]
    return result


def artifact_job_relevance(profile, artifact_id: str, kind: str, revision: int) -> dict:
    related = (profile.business_context or {}).get("stale_related_artifacts", {}) if profile else {}
    return {"analysis_status": "stale" if artifact_id in related.get(kind + "_ids", []) else "unknown",
            "stale_reason": "job_input_changed" if artifact_id in related.get(kind + "_ids", []) else None,
            "current_input_revision": revision or 1}
