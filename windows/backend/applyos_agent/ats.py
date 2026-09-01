"""Deterministic, explainable ATS readiness checks.

The result is a coverage index, never a promise that a third-party ATS will
accept or rank a resume. Every point is derived from persisted JD, resume and
quality-gate data and is returned with the matching evidence.
"""

from __future__ import annotations

import math
import re
from hashlib import sha256
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.enums import QualityStatus
from applyos_domain.models import AgentRun, Job, JobProfile, QualityReport, ResumeVersion


ASCII_TERM = re.compile(r"[a-z][a-z0-9+#.\-/]{1,}", re.IGNORECASE)
CJK_CHUNK = re.compile(r"[\u4e00-\u9fff]{2,}")
COMMON_BIGRAMS = {
    "负责", "相关", "工作", "能力", "要求", "以及", "进行", "具备", "良好", "优秀",
    "能够", "以上", "岗位", "专业", "优先", "熟悉", "经验", "参与", "协助", "完成",
}


def _flatten_strings(value: Any) -> list[str]:
    if isinstance(value, dict):
        return [part for child in value.values() for part in _flatten_strings(child)]
    if isinstance(value, list):
        return [part for child in value for part in _flatten_strings(child)]
    if isinstance(value, str):
        return [value]
    return []


def _normalized(value: str) -> str:
    return re.sub(r"\s+", "", value or "").lower()


def _signal_terms(value: str) -> list[str]:
    terms = {item.lower().strip(".-/") for item in ASCII_TERM.findall(value or "") if len(item.strip(".-/")) >= 2}
    for chunk in CJK_CHUNK.findall(value or ""):
        if len(chunk) <= 8 and chunk not in COMMON_BIGRAMS:
            terms.add(chunk)
        for index in range(max(0, len(chunk) - 1)):
            term = chunk[index:index + 2]
            if term not in COMMON_BIGRAMS:
                terms.add(term)
    return sorted(terms, key=lambda item: (-len(item), item))


def _requirement_match(requirement: str, resume_text: str, keywords: list[str]) -> tuple[bool, list[str]]:
    normalized_resume = _normalized(resume_text)
    explicit = [item for item in keywords if _normalized(item) and _normalized(item) in _normalized(requirement)]
    explicit_hits = [item for item in explicit if _normalized(item) in normalized_resume]
    if explicit:
        required_explicit_hits = max(1, math.ceil(len(explicit) * 0.6))
        return len(explicit_hits) >= required_explicit_hits, explicit_hits[:5]

    terms = _signal_terms(requirement)
    hits = [item for item in terms if _normalized(item) in normalized_resume]
    if not terms:
        return False, []
    required_hits = max(1, min(3, math.ceil(len(terms) * 0.22)))
    return len(hits) >= required_hits, hits[:5]


def _requirement_identity(requirement: str) -> str:
    digest = sha256(_normalized(requirement).encode("utf-8")).hexdigest()[:16]
    return f"req_{digest}"


SECTION_LABELS = {
    "education": "教育经历",
    "internship": "实习经历",
    "experience": "工作经历",
    "project": "项目经历",
    "skills": "技能",
    "skill": "技能",
    "awards": "荣誉奖项",
}


def _jd_context(source: str, offset: int, length: int) -> dict[str, str] | None:
    if offset < 0:
        return None
    before_start = max(0, offset - 54)
    after_end = min(len(source), offset + length + 72)
    return {
        "before": source[before_start:offset].strip(),
        "match": source[offset:offset + length].strip(),
        "after": source[offset + length:after_end].strip(),
    }


def _resume_evidence_locations(snapshot: dict[str, Any], terms: list[str]) -> list[dict[str, Any]]:
    """Return local, inspectable resume locations for matched requirement terms."""
    if not terms:
        return []
    locations: list[dict[str, Any]] = []
    sections = snapshot.get("sections") if isinstance(snapshot, dict) else []
    for section_index, section in enumerate(sections or []):
        if not isinstance(section, dict):
            continue
        section_id = str(section.get("id") or section.get("key") or f"section-{section_index + 1}")
        section_label = str(section.get("title") or SECTION_LABELS.get(section_id, section_id))
        for item_index, item in enumerate(section.get("items") or []):
            if not isinstance(item, dict):
                continue
            item_text = " · ".join(part.strip() for part in _flatten_strings(item) if part.strip())
            normalized_item = _normalized(item_text)
            matched_terms = [term for term in terms if _normalized(term) in normalized_item]
            if not matched_terms:
                continue
            fields = item.get("fields") if isinstance(item.get("fields"), dict) else {}
            item_label = next(
                (
                    str(value).strip()
                    for value in (
                        fields.get("organization"),
                        fields.get("company"),
                        fields.get("school"),
                        fields.get("title"),
                        fields.get("role"),
                        item.get("title"),
                    )
                    if str(value or "").strip()
                ),
                f"第 {item_index + 1} 条",
            )
            body = str(item.get("body") or "").strip()
            snippet = re.sub(r"\s+", " ", body or item_text).strip()
            if len(snippet) > 180:
                snippet = f"{snippet[:177].rstrip()}…"
            locations.append({
                "section_id": section_id,
                "section_label": section_label,
                "item_id": str(item.get("id") or f"{section_id}-{item_index + 1}"),
                "item_label": item_label,
                "snippet": snippet,
                "matched_terms": matched_terms[:5],
            })
            if len(locations) >= 4:
                return locations
    return locations


class AtsReadinessEvaluator:
    def __init__(self, session: Session):
        self.session = session

    def evaluate(self, *, job: Job, run: AgentRun | None, resume: ResumeVersion | None) -> dict[str, Any]:
        profile = self.session.scalar(select(JobProfile).where(JobProfile.job_id == job.id))
        if resume is None or profile is None:
            return {
                "status": "not_ready",
                "coverage_percent": None,
                "summary": "完成岗位理解并生成岗位简历后可检查 ATS 文本覆盖。",
                "requirements": [],
                "keywords": [],
                "document_checks": [],
                "gaps": [],
                "disclaimer": "这是可解释的材料覆盖度，不是第三方 ATS 通过概率。",
            }

        resume_text = "\n".join(_flatten_strings(resume.content_json or {}))
        keyword_rows = [
            {"text": keyword, "matched": _normalized(keyword) in _normalized(resume_text)}
            for keyword in list(dict.fromkeys(profile.keywords or []))
            if str(keyword).strip()
        ]
        requirement_rows = []
        jd_source = job.jd_raw or ""
        snapshot = (resume.content_json or {}).get("editor_snapshot") or {}
        for requirement in list(dict.fromkeys(profile.hard_requirements or [])):
            matched, evidence = _requirement_match(requirement, resume_text, profile.keywords or [])
            source_offset = jd_source.find(requirement)
            requirement_rows.append({
                "requirement_id": _requirement_identity(requirement),
                "text": requirement,
                "source_offset": source_offset if source_offset >= 0 else None,
                "source_length": len(requirement) if source_offset >= 0 else None,
                "matched": matched,
                "evidence": evidence,
                "jd_context": _jd_context(jd_source, source_offset, len(requirement)),
                "resume_evidence": _resume_evidence_locations(snapshot, evidence),
                "support_status": "supported" if matched else ("partial" if evidence else "unsupported"),
            })

        reports = [] if run is None else list(
            self.session.scalars(select(QualityReport).where(QualityReport.run_id == run.id)).all()
        )
        sections = snapshot.get("sections") if isinstance(snapshot, dict) else []
        document_checks = [
            {"code": "text_layer", "label": "存在可检索文本", "passed": len(_normalized(resume_text)) >= 120},
            {"code": "section_structure", "label": "包含标准分区结构", "passed": isinstance(sections, list) and len(sections) >= 3},
            {
                "code": "quality_gate",
                "label": "事实与一致性门禁通过",
                "passed": any(item.status == QualityStatus.PASSED for item in reports)
                and not any(item.status == QualityStatus.BLOCKED for item in reports),
            },
        ]

        hard_rate = (
            sum(1 for item in requirement_rows if item["matched"]) / len(requirement_rows)
            if requirement_rows else 1.0
        )
        keyword_rate = (
            sum(1 for item in keyword_rows if item["matched"]) / len(keyword_rows)
            if keyword_rows else 1.0
        )
        document_rate = sum(1 for item in document_checks if item["passed"]) / len(document_checks)
        coverage_percent = round((hard_rate * 0.55 + keyword_rate * 0.30 + document_rate * 0.15) * 100)
        gaps = [item["text"] for item in requirement_rows if not item["matched"]]
        gaps.extend(item["text"] for item in keyword_rows if not item["matched"])
        status = "ready" if coverage_percent >= 80 and not gaps[:1] else "review" if coverage_percent >= 60 else "attention"
        return {
            "status": status,
            "coverage_percent": coverage_percent,
            "summary": (
                "关键要求与文本结构基本齐备。" if status == "ready"
                else "仍有岗位要求需要在不新增事实的前提下补强表达。" if status == "review"
                else "当前版本存在明显的岗位文本覆盖缺口。"
            ),
            "requirements": requirement_rows,
            "keywords": keyword_rows,
            "document_checks": document_checks,
            "gaps": list(dict.fromkeys(gaps))[:8],
            "disclaimer": "该数值仅表示 JD、简历文本与确定性文档检查的覆盖度，不代表任何招聘系统的通过概率或排名。",
        }
