from __future__ import annotations

from copy import deepcopy
import html
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.models import Candidate, Experience, Fact, Job, ResumeVersion


SECTION_META = {
    "education": ("education", "教育背景"),
    "experience": ("internship", "工作与实习"),
    "project": ("project", "项目经历"),
    "skill": ("skills", "专业技能"),
    "campus": ("campus", "校园经历"),
    "award": ("awards", "荣誉奖项"),
    "summary": ("self", "个人概述"),
}

DATA_TERMS = {"数据", "sql", "python", "分析", "统计", "模型", "tableau", "power bi", "可视化", "指标", "实验"}
PRODUCT_TERMS = {"产品", "需求", "用户", "原型", "迭代", "agent", "网站", "增长", "运营", "交互", "figma"}


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z][a-z0-9+#.-]{1,}|[\u4e00-\u9fff]{2,6}", text.lower()))


def _focus(job: Job) -> str:
    text = f"{job.role} {job.jd_raw or ''}".lower()
    data_score = sum(term in text for term in DATA_TERMS)
    product_score = sum(term in text for term in PRODUCT_TERMS)
    if data_score > product_score:
        return "data"
    if product_score > data_score:
        return "product"
    return "general"


def _strategy(job: Job, experiences: list[Experience], selected_experience_ids: set[str]) -> dict[str, Any]:
    focus = _focus(job)
    target_terms = DATA_TERMS if focus == "data" else PRODUCT_TERMS if focus == "product" else set()
    job_tokens = _tokens(f"{job.role} {job.jd_raw or ''}")
    items = []
    for experience in experiences:
        text = " ".join(part for part in [experience.title, experience.organization, experience.role, experience.summary] if part).lower()
        matched = sorted(token for token in job_tokens if token in text)[:8]
        focus_hits = sorted(term for term in target_terms if term in text)
        if experience.id in selected_experience_ids and (matched or focus_hits):
            tier = "core"
        elif experience.id in selected_experience_ids:
            tier = "supporting"
        elif experience.kind in {"education", "skill", "award"}:
            tier = "background"
        else:
            tier = "omit"
        items.append({"experience_id": experience.id, "tier": tier, "matched_terms": matched or focus_hits})
    positioning = {
        "data": "以数据分析与量化解决问题为主线，产品与 Agent 项目作为业务落地能力补充",
        "product": "以产品设计、需求判断与落地迭代为主线，数据能力作为决策优势补充",
        "general": "围绕岗位职责组织最相关的成果证据，同时保留可迁移能力",
    }[focus]
    return {
        "focus": focus,
        "positioning": positioning,
        "target_role": job.role,
        "experience_plan": items,
        "section_order": ["summary", "experience", "project", "education", "skill", "award"] if focus == "product" else ["summary", "education", "experience", "project", "skill", "award"],
        "strategy_source": "local_fallback",
    }


def _merge_strategy(local: dict[str, Any], override: dict[str, Any] | None) -> dict[str, Any]:
    """Apply model judgment without weakening fact-safe local constraints."""
    if not isinstance(override, dict):
        return local

    merged = {**local, "strategy_source": "model"}
    positioning = str(override.get("positioning") or "").strip()
    if positioning:
        merged["positioning"] = positioning

    aliases = {
        "internship": "experience",
        "internships": "experience",
        "work": "experience",
        "works": "experience",
        "projects": "project",
        "skills": "skill",
        "awards": "award",
    }
    known = set(SECTION_META)
    requested_order = []
    for raw in override.get("section_order") or []:
        section = aliases.get(str(raw).strip().lower(), str(raw).strip().lower())
        if section in known and section not in requested_order:
            requested_order.append(section)
    if requested_order:
        merged["section_order"] = requested_order + [item for item in local["section_order"] if item not in requested_order]

    for key in ("matches", "warnings"):
        if isinstance(override.get(key), list):
            merged[key] = deepcopy(override[key])
    return merged


def _date_text(item: Experience) -> str:
    return " ~ ".join(part for part in [item.start_date, item.end_date] if part)


def _section_item(item: Experience, body: str, index: int) -> dict[str, Any]:
    date_text = _date_text(item)
    right = "  ".join(part for part in [item.organization, item.role] if part) or item.title
    current = bool(re.search(r"至今|现在|当前|present", str(item.end_date or ""), re.IGNORECASE))
    fields: dict[str, Any] = {
        "timeRange": {"start": item.start_date or "", "end": "" if current else item.end_date or "", "current": current}
    }
    if item.kind == "education":
        fields.update({"school": item.organization or item.title, "major": item.role or ""})
    elif item.kind == "experience":
        fields.update({"company": item.organization or item.title, "role": item.role or ""})
    elif item.kind == "project":
        fields.update({"projectName": item.title, "role": item.role or ""})
    return {
        "id": f"{item.kind}-item-{index + 1}",
        "experienceId": item.id,
        "metaLeft": date_text,
        "metaRight": right,
        "body": body,
        "fields": fields,
    }


def _replace_fact_text(body: str, before: str, after: str) -> str:
    """Replace one fact block while preserving every unrelated line in the item.

    Imported PDF facts and editor bodies often differ only by line wrapping, so
    an exact string replacement is too brittle. Matching whitespace runs keeps
    the original line breaks for the surrounding content and avoids replacing
    the whole experience when only one bullet was accepted.
    """
    source = str(body or "")
    old = str(before or "").strip()
    new = str(after or "").strip()
    if not old or not new:
        return source
    if old == source.strip():
        return new
    if new.startswith(old):
        suffix = new[len(old):].strip()
        return f"{source.rstrip()}\n{suffix}" if suffix else source
    tokens = [token for token in re.split(r"\s+", old) if token]
    if not tokens:
        return source
    pattern = r"\s+".join(re.escape(token) for token in tokens)
    replaced, count = re.subn(pattern, new, source, count=1, flags=re.IGNORECASE)
    if count:
        return replaced

    # PDF-imported facts include date/company/role plus the item body, while
    # the editor stores those metadata fields separately. If the model keeps
    # that stable prefix, remove it and replace only this item's body.
    plain_body = html.unescape(re.sub(r"<[^>]+>", "", source))
    normalized_body = re.sub(r"\s+", " ", plain_body).strip()
    normalized_old = re.sub(r"\s+", " ", old).strip()
    normalized_new = re.sub(r"\s+", " ", new).strip()
    body_index = normalized_old.find(normalized_body) if normalized_body else -1
    if body_index >= 0:
        stable_prefix = normalized_old[:body_index].strip()
        if stable_prefix and normalized_new.startswith(stable_prefix):
            replacement_body = normalized_new[len(stable_prefix):].strip()
            if replacement_body:
                return replacement_body
    return source


def build_editor_snapshot(
    session: Session,
    *,
    candidate: Candidate,
    job: Job,
    facts: list[Fact],
    text_overrides: dict[str, str] | None = None,
    strategy_override: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    selected_fact_ids = {fact.id for fact in facts}
    selected_experience_ids = {
        str((fact.normalized_value or {}).get("experience_id") or fact.subject_id)
        for fact in facts
        if (fact.normalized_value or {}).get("experience_id") or fact.subject_type == "experience"
    }
    experiences = list(
        session.scalars(
            select(Experience)
            .where(Experience.candidate_id == candidate.id)
            .order_by(Experience.sort_order, Experience.created_at)
        ).all()
    )
    strategy = _merge_strategy(_strategy(job, experiences, selected_experience_ids), strategy_override)
    tier_by_id = {item["experience_id"]: item["tier"] for item in strategy["experience_plan"]}
    base = session.scalar(
        select(ResumeVersion)
        .where(ResumeVersion.candidate_id == candidate.id, ResumeVersion.job_id.is_(None))
        .order_by(ResumeVersion.updated_at.desc())
    )
    base_snapshot = deepcopy((base.content_json or {}).get("editor_snapshot") or {}) if base else {}
    overrides = text_overrides or {}
    facts_by_experience: dict[str, list[Fact]] = {}
    for fact in facts:
        experience_id = str((fact.normalized_value or {}).get("experience_id") or fact.subject_id or "")
        if experience_id:
            facts_by_experience.setdefault(experience_id, []).append(fact)

    # A job-specific resume is a revision of the imported resume, not a new
    # document assembled from whichever facts happened to match the JD. Keep
    # the original sections, item order, metadata and template intact, then
    # replace only bodies tied to accepted fact-level rewrites.
    section_kind_by_id = {section_id: kind for kind, (section_id, _title) in SECTION_META.items()}
    base_sections = deepcopy(base_snapshot.get("sections") or [])
    used_experience_ids: set[str] = set()
    experiences_by_kind: dict[str, list[Experience]] = {}
    for experience in experiences:
        experiences_by_kind.setdefault(experience.kind, []).append(experience)

    def match_experience(item: dict[str, Any], kind: str, index: int) -> Experience | None:
        explicit_id = str(item.get("experienceId") or item.get("experience_id") or "")
        if explicit_id:
            match = next((candidate for candidate in experiences if candidate.id == explicit_id), None)
            if match:
                return match
        candidates = [candidate for candidate in experiences_by_kind.get(kind, []) if candidate.id not in used_experience_ids]
        if not candidates:
            return None
        fields = item.get("fields") or {}
        date_text = str(item.get("metaLeft") or fields.get("timeRange") or "")
        right_text = str(item.get("metaRight") or "").lower()

        def score(candidate: Experience) -> int:
            candidate_date = _date_text(candidate)
            candidate_text = " ".join(part for part in [candidate.title, candidate.organization, candidate.role] if part).lower()
            value = 0
            if candidate_date and candidate_date in date_text:
                value += 4
            if candidate.organization and candidate.organization.lower() in right_text:
                value += 3
            if candidate.role and candidate.role.lower() in right_text:
                value += 2
            if candidate.title and candidate.title.lower() in right_text:
                value += 2
            if candidate_text and candidate_text in right_text:
                value += 1
            return value

        ranked = sorted(candidates, key=score, reverse=True)
        return ranked[0] if score(ranked[0]) > 0 else candidates[min(index, len(candidates) - 1)]

    if base_sections:
        for section in base_sections:
            kind = section_kind_by_id.get(str(section.get("id") or ""), str(section.get("id") or ""))
            for index, item in enumerate(section.get("items") or []):
                experience = match_experience(item, kind, index)
                if not experience:
                    continue
                used_experience_ids.add(experience.id)
                item["experienceId"] = experience.id
                for fact in facts_by_experience.get(experience.id, []):
                    replacement = overrides.get(fact.id, "").strip()
                    if replacement:
                        item["body"] = _replace_fact_text(item.get("body", ""), fact.content, replacement)

        # Facts added after the base PDF import can be appended to the matching
        # existing module without changing the imported module order.
        for experience in experiences:
            if experience.id in used_experience_ids or tier_by_id.get(experience.id) == "omit":
                continue
            replacements = [overrides[fact.id].strip() for fact in facts_by_experience.get(experience.id, []) if overrides.get(fact.id, "").strip()]
            if not replacements:
                continue
            kind = experience.kind
            section_id, title = SECTION_META.get(kind, (kind, kind))
            section = next((item for item in base_sections if item.get("id") == section_id), None)
            item = _section_item(experience, "\n".join(dict.fromkeys(replacements)), len(section.get("items", [])) if section else 0)
            if section:
                section.setdefault("items", []).append(item)
            else:
                base_sections.append({"id": section_id, "tab": title, "title": title, "visible": True, "builtin": section_id in {"internship", "education", "skills", "project", "awards", "self"}, "items": [item]})

    if base_sections:
        snapshot = {
            **base_snapshot,
            "schema": int(base_snapshot.get("schema") or 6),
            "profile": {
                **(base_snapshot.get("profile") or {}),
                "name": candidate.name,
                "phone": candidate.phone if candidate.phone is not None else (base_snapshot.get("profile") or {}).get("phone", ""),
                "email": candidate.email if candidate.email is not None else (base_snapshot.get("profile") or {}).get("email", ""),
                "location": candidate.location if candidate.location is not None else (base_snapshot.get("profile") or {}).get("location", ""),
            },
            "sections": base_sections,
        }
        snapshot.setdefault("template", "classic")
        snapshot.setdefault("settings", {})
        return snapshot, {**strategy, "selected_fact_ids": sorted(selected_fact_ids)}

    grouped: dict[str, list[dict[str, Any]]] = {}
    for experience in experiences:
        tier = tier_by_id.get(experience.id, "omit")
        if tier == "omit":
            continue
        source_facts = facts_by_experience.get(experience.id, [])
        body_parts = [overrides.get(fact.id, fact.content) for fact in source_facts]
        body = "\n".join(body_parts).strip() or (experience.summary or experience.title)
        grouped.setdefault(experience.kind, []).append(_section_item(experience, body, len(grouped.get(experience.kind, []))))

    section_order = strategy["section_order"]
    sections = []
    for kind in section_order:
        items = grouped.get(kind, [])
        if not items:
            continue
        section_id, title = SECTION_META.get(kind, (kind, kind))
        sections.append({
            "id": section_id,
            "tab": title,
            "title": title,
            "visible": True,
            "builtin": section_id in {"education", "internship", "skills", "project", "awards", "self"},
            "items": items,
        })
    if not sections and base_snapshot.get("sections"):
        sections = base_snapshot["sections"]

    snapshot = {
        **base_snapshot,
        "schema": 6,
        "profile": {
            **(base_snapshot.get("profile") or {}),
            "name": candidate.name,
            "phone": candidate.phone or "",
            "email": candidate.email or "",
            "location": candidate.location or "",
        },
        "sections": sections,
        "template": base_snapshot.get("template", "classic"),
        "settings": {
            "margin": 30, "spacing": 8, "lineHeight": 160, "fontSize": 15,
            "fontFamily": "'Microsoft YaHei', 'PingFang SC', sans-serif", "nameSize": 28,
            "customAccent": "#1f3b5c", "customAccent2": "#3f5f84", "customStage": "#eef1f5",
            **(base_snapshot.get("settings") or {}),
        },
    }
    return snapshot, {**strategy, "selected_fact_ids": sorted(selected_fact_ids)}
