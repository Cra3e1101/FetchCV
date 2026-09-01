from __future__ import annotations

import base64
import hashlib
from html import escape as escape_html
from io import BytesIO
import re
import shutil
from copy import deepcopy
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from sqlalchemy import select

from applyos_domain.database import Database
from applyos_domain.enums import AssetStatus, FactSourceType
from applyos_domain.models import Candidate, Experience, Fact, MaterialAsset, ResumeVersion
from applyos_domain.paths import artifact_root
from applyos_harness.versioning import canonical_hash
from applyos_agent.config import AgentSettings
from applyos_agent.runtime import AgentRuntime

from .ai_parser import parse_resume_with_model, redact_resume_text


SECTION_NAMES = {
    "教育背景": "education",
    "教育经历": "education",
    "实习经验": "experience",
    "实习经历": "experience",
    "工作经验": "experience",
    "工作经历": "experience",
    "项目经验": "project",
    "项目经历": "project",
    "工作技能": "skill",
    "专业技能": "skill",
    "技能特长": "skill",
    "校园经历": "campus",
    "获奖经历": "award",
    "荣誉奖项": "award",
    "自我评价": "summary",
    "Education": "education",
    "Experience": "experience",
    "Work Experience": "experience",
    "Projects": "project",
    "Project Experience": "project",
    "Skills": "skill",
    "Awards": "award",
    "Summary": "summary",
}

PDF_IMPORT_SCHEMA_VERSION = 3

SECTION_DEFAULT_TITLES = {
    "education": "教育背景",
    "experience": "实习经历",
    "project": "项目经历",
    "skill": "专业技能",
    "campus": "校园经历",
    "award": "荣誉奖项",
    "summary": "自我评价",
}


def _clean(value: str) -> str:
    value = re.sub(r"[\ue000-\uf8ff]", "", value)
    value = value.replace("　", " ").replace("•", "·")
    return re.sub(r"[ \t]+", " ", value).strip()


def _header_field(header: str, label: str) -> str:
    compact = re.sub(r"\s+", "", header)
    labels = "年龄|性别|政治面貌|电话|邮箱|到岗情况|出生年月|所在地|城市"
    match = re.search(rf"{re.escape(label)}[：:]([^：:]*?)(?=(?:{labels})[：:]|$)", compact)
    return _clean(match.group(1)) if match else ""


def _extract_profile(header: str, filename: str) -> dict[str, str]:
    lines = [_clean(line) for line in header.splitlines() if _clean(line)]
    fallback_name = re.split(r"[-_—]", Path(filename).stem)[0].strip()
    name = next((line for line in lines if re.fullmatch(r"[\u4e00-\u9fff·]{2,12}", line)), fallback_name)
    email_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", header, re.IGNORECASE)
    phone_match = re.search(r"(?<!\d)(1[3-9]\d)[- ]?(\d{4})[- ]?(\d{4})(?!\d)", header)
    title_match = re.search(r"(?:职位|岗位|求职意向|目标岗位)\s*[：:]\s*([^\n]+)", header)
    return {
        "name": name,
        "email": email_match.group(0) if email_match else "",
        "phone": phone_match.group(0).replace(" ", "-") if phone_match else "",
        "title": _clean(title_match.group(1)) if title_match else "",
        "age": _header_field(header, "年龄").replace("岁", "").strip(),
        "gender": _header_field(header, "性别"),
        "political": _header_field(header, "政治面貌"),
        "arrival": _header_field(header, "到岗情况"),
    }


def _extract_photo_data_uri(source: Path) -> tuple[str, tuple[int, int] | None]:
    """Keep the original portrait in the editor snapshot when the PDF has one."""
    try:
        reader = PdfReader(source)
        candidates = []
        for page in reader.pages:
            for image in getattr(page, "images", []):
                width, height = image.image.size
                if width >= 80 and height >= 80:
                    candidates.append((width * height, width / max(height, 1), image.image))
        portrait = next((item for item in sorted(candidates, reverse=True) if item[1] <= 1.15), None)
        selected = portrait or (sorted(candidates, reverse=True)[0] if candidates else None)
        if selected is None:
            return "", None
        _, _, image = selected
        buffer = BytesIO()
        image.convert("RGB").save(buffer, format="JPEG", quality=95, optimize=True)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}", image.size
    except (AttributeError, OSError, ValueError, TypeError):
        return "", None


def _extract_bold_phrases(source: Path) -> list[str]:
    """Read short Bold font runs so imported rich text keeps source emphasis."""
    phrases: list[str] = []
    try:
        reader = PdfReader(source)
        for page in reader.pages:
            def visitor(text: str, _cm: list[float], _tm: list[float], font_dict: dict | None, _font_size: float) -> None:
                base_font = str((font_dict or {}).get("/BaseFont") or "")
                value = _clean(text).strip()
                if "bold" in base_font.lower() and len(value) >= 2 and value not in phrases:
                    phrases.append(value)
            page.extract_text(visitor_text=visitor)
    except (AttributeError, OSError, ValueError, TypeError):
        return []
    return phrases


def _bold_markup(text: str, phrases: list[str]) -> str:
    """Wrap source Bold runs without making imported text executable HTML."""
    value = str(text or "")
    candidates: list[tuple[int, int]] = []
    for phrase in sorted({str(item).strip() for item in phrases if str(item).strip()}, key=len, reverse=True):
        start = value.find(phrase)
        while start >= 0:
            candidates.append((start, start + len(phrase)))
            start = value.find(phrase, start + len(phrase))
    occupied = [False] * len(value)
    selected: list[tuple[int, int]] = []
    for start, end in candidates:
        if any(occupied[start:end]):
            continue
        for index in range(start, end):
            occupied[index] = True
        selected.append((start, end))
    if not selected:
        return escape_html(value).replace("\n", "<br>")
    selected.sort()
    chunks: list[str] = []
    cursor = 0
    for start, end in selected:
        chunks.append(escape_html(value[cursor:start]))
        chunks.append(f"<strong>{escape_html(value[start:end])}</strong>")
        cursor = end
    chunks.append(escape_html(value[cursor:]))
    return "".join(chunks).replace("\n", "<br>")


def _split_sections(text: str) -> tuple[str, list[dict[str, Any]]]:
    matches = []
    for title, key in SECTION_NAMES.items():
        match = re.search(rf"(?m)^\s*{re.escape(title)}\s*$", text)
        if match:
            matches.append((match.start(), match.end(), title, key))
    matches.sort()
    header = text[: matches[0][0]] if matches else text
    sections: list[dict[str, Any]] = []
    for index, (_, end, title, key) in enumerate(matches):
        next_start = matches[index + 1][0] if index + 1 < len(matches) else len(text)
        body = text[end:next_start].strip()
        entries = _section_entries(body)
        sections.append({"title": title, "key": key, "body": body, "entries": entries})
    return header, sections


def _section_entries(body: str) -> list[str]:
    lines = [_clean(line) for line in body.splitlines()]
    entries: list[str] = []
    current: list[str] = []
    for line in lines:
        if not line:
            continue
        starts_entry = bool(re.match(r"^(?:19|20)\d{2}\s*[-/.年]", line))
        if starts_entry and current:
            entries.append("\n".join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        entries.append("\n".join(current))
    return [re.sub(r"^·\s*", "", item).strip() for item in entries if len(item.strip()) >= 4]


def _date_range(text: str) -> tuple[str, str]:
    values = re.findall(r"((?:19|20)\d{2})\s*[-/.年]\s*(\d{1,2})", text)
    normalized = [f"{year}-{int(month):02d}" for year, month in values[:2]]
    ongoing = bool(re.search(r"至今|现在|present", text, re.IGNORECASE))
    return (normalized[0] if normalized else "", normalized[1] if len(normalized) > 1 else "至今" if ongoing and normalized else "")


def _time_range_fields(start: str, end: str) -> dict[str, Any]:
    current = bool(re.search(r"至今|现在|当前|present", str(end or ""), re.IGNORECASE))
    return {"start": start or "", "end": "" if current else end or "", "current": current}


def _normalize_editor_snapshot(snapshot: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Upgrade legacy editor fields without replacing user-authored body text."""
    result = deepcopy(snapshot or {})
    changed = False
    for section in result.get("sections") or []:
        section_id = str(section.get("id") or "")
        for item in section.get("items") or []:
            fields = item.setdefault("fields", {})
            raw_range = fields.get("timeRange")
            if isinstance(raw_range, dict):
                start = str(raw_range.get("start") or "")
                end = "至今" if raw_range.get("current") else str(raw_range.get("end") or "")
            else:
                start, end = _date_range(str(raw_range or item.get("metaLeft") or ""))
            normalized_range = _time_range_fields(start, end)
            if raw_range != normalized_range:
                fields["timeRange"] = normalized_range
                changed = True

            body = str(item.get("body") or "")
            if section_id == "education":
                major = str(fields.get("major") or "")
                gpa_source = " ".join([major, str(fields.get("gpa") or ""), str(item.get("metaRight") or ""), body[:240]])
                gpa_match = re.search(r"GPA\s*[：:]?\s*([0-9.]+\s*/\s*[0-9.]+)", gpa_source, re.IGNORECASE)
                clean_major = re.sub(r"\s*GPA\s*[：:]?\s*[0-9.]+\s*/\s*[0-9.]+", "", major, flags=re.IGNORECASE).strip()
                if clean_major != major:
                    fields["major"] = clean_major
                    changed = True
                if gpa_match:
                    gpa = re.sub(r"\s+", "", gpa_match.group(1))
                    if fields.get("gpa") != gpa:
                        fields["gpa"] = gpa
                        changed = True
                fields.setdefault("degree", "")
            elif section_id == "project":
                project_name = str(fields.get("projectName") or "").strip()
                if project_name and not str(fields.get("role") or "").strip():
                    award_match = re.search(
                        r"\s+((?:[\u4e00-\u9fffA-Za-z0-9·]+(?:杯|大赛|竞赛|挑战赛))(?:国|省|市|校)?[一二三四五123])$",
                        project_name,
                    )
                    if award_match:
                        fields["projectName"] = project_name[: award_match.start()].strip()
                        fields["role"] = award_match.group(1).strip()
                        changed = True

            # Older Agent drafts copied the complete source fact into body,
            # duplicating the date and structured heading already rendered above.
            if not re.search(r"<[^>]+>", body) and re.match(r"^(?:19|20)\d{2}\s*[-/.年]", body.strip()):
                markers = {
                    "education": r"(?:荣誉奖励|主修课程|研究方向|学术成果)",
                    "internship": r"(?:参与|负责|使用|基于|通过|完成|协助|搭建|构建|主导|支持)",
                    "project": r"(?:项目描述|项目职责|负责|参与|基于|使用|构建|完成)",
                }
                marker = re.search(markers.get(section_id, r"$^"), body)
                if marker and marker.start() > 0:
                    item["body"] = body[marker.start():].lstrip(" ·•-—–")
                    changed = True
    return result, changed


def _snapshot_item_key(section_id: str, item: dict[str, Any], index: int) -> str:
    fields = item.get("fields") or {}
    preferred = {
        "education": ["school", "major"],
        "internship": ["company"],
        "project": ["projectName"],
        "skills": [],
        "awards": ["awardName"],
    }.get(section_id, [])
    value = " ".join(str(fields.get(key) or "") for key in preferred).strip()
    if not value:
        value = str(item.get("metaRight") or "").strip()
    normalized = re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", value.lower())
    return normalized or f"{section_id}:{index}"


def _rebase_job_snapshot(base_snapshot: dict[str, Any], job_snapshot: dict[str, Any]) -> dict[str, Any]:
    """Restore the source PDF structure while preserving accepted body edits."""
    base, _ = _normalize_editor_snapshot(base_snapshot)
    job, _ = _normalize_editor_snapshot(job_snapshot)
    result = deepcopy(base)
    # Identity/contact fields are job-independent and the imported base resume
    # is authoritative. Legacy editor defaults must never leak into a job copy.
    result["profile"] = deepcopy(base.get("profile") or {})
    job_sections = {str(section.get("id") or ""): section for section in job.get("sections") or []}
    for section in result.get("sections") or []:
        section_id = str(section.get("id") or "")
        job_section = job_sections.get(section_id)
        if not job_section:
            continue
        candidates = {
            _snapshot_item_key(section_id, item, index): item
            for index, item in enumerate(job_section.get("items") or [])
        }
        for index, item in enumerate(section.get("items") or []):
            key = _snapshot_item_key(section_id, item, index)
            matched = candidates.get(key)
            if matched is None:
                continue
            body = str(matched.get("body") or "").strip()
            if body:
                item["body"] = matched["body"]
            if matched.get("richStyle"):
                item["richStyle"] = deepcopy(matched["richStyle"])
    return result


def _without_date_prefix(text: str) -> str:
    return re.sub(
        r"^(?:19|20)\d{2}\s*[-/.年]\s*\d{1,2}(?:\s*月)?\s*(?:[-~—–至到]+\s*(?:(?:19|20)\d{2}\s*[-/.年]\s*\d{1,2}(?:\s*月)?|至今|现在))?\s*",
        "",
        text,
    ).strip(" -—–·")


def _experience_record(section: dict[str, Any], entry: str, index: int) -> dict[str, Any]:
    raw_lines = [_clean(line) for line in entry.splitlines() if _clean(line)]
    lines = [re.sub(r"^[·•]\s*", "", line) for line in raw_lines]
    first = lines[0] if lines else entry
    headline = _without_date_prefix(first) or section["title"]
    start_date, end_date = _date_range(first)
    organization_match = re.search(
        r"([\u4e00-\u9fffA-Za-z0-9·（）()&\-]{2,40}(?:大学|学院|公司|集团|科技|研究院|实验室|中心|银行|证券|平台))",
        headline,
    )
    organization = organization_match.group(1) if organization_match else ""
    role = headline.replace(organization, "", 1).strip(" -—–·") if organization else ""
    bullets: list[str] = []
    for raw_line, line in zip(raw_lines[1:], lines[1:]):
        starts_bullet = bool(re.match(r"^[·•]", raw_line))
        if not starts_bullet and not bullets and section["key"] in {"skill", "summary"}:
            headline = f"{headline}{line}"
        elif starts_bullet or not bullets:
            bullets.append(line)
        else:
            # PDF text extraction often wraps one semantic bullet across several
            # visual lines. Keep it as one experience statement for review/editing.
            bullets[-1] = f"{bullets[-1]}{line}"
    title = organization or headline[:80] or f"{section['title']} {index + 1}"
    if section["key"] == "project":
        # The source template places competition results in the right-most
        # project field. Keep the project name and award separate so the
        # embedded editor can reproduce that three-column header.
        award_match = re.search(
            r"\s+((?:[\u4e00-\u9fffA-Za-z0-9·]+(?:杯|大赛|竞赛|挑战赛))(?:国|省|市|校)?[一二三四五123])$",
            headline,
        )
        if award_match:
            title = headline[: award_match.start()].strip()
            role = award_match.group(1).strip()
        else:
            title, role = headline[:120], role
        organization = ""
    elif section["key"] == "skill":
        title, organization, role = section["title"], "", ""
    elif section["key"] == "award":
        title, organization, role = headline[:120], "", ""
    return {
        "kind": section["key"],
        "section": section["title"],
        "title": title,
        "organization": organization,
        "role": role,
        "start_date": start_date,
        "end_date": end_date,
        "summary": "\n".join(([headline] if section["key"] in {"skill", "summary"} else []) + bullets).strip() or headline,
        "details": {"headline": headline, "bullets": bullets, "raw_text": entry},
        "content": " ".join(lines),
    }


def _ai_experience_records(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        kind = str(item.get("kind") or "project")
        section = {
            "key": kind,
            "title": str(item.get("section_title") or SECTION_DEFAULT_TITLES.get(kind) or "其他经历"),
        }
        record = _experience_record(section, str(item.get("source_text") or ""), index)
        fields = item.get("fields") or {}
        for target, source in (
            ("start_date", "start_date"),
            ("end_date", "end_date"),
            ("title", "title"),
            ("organization", "organization"),
            ("role", "role"),
        ):
            if str(fields.get(source) or "").strip():
                record[target] = str(fields[source]).strip()
        record["kind"] = kind
        record["section"] = section["title"]
        record["details"] = {
            **record["details"],
            "recognition": "ai_enhanced",
            "confidence": float(item.get("confidence") or 0),
            "warnings": list(item.get("warnings") or []),
        }
        records.append(record)
    return records


def _record_evidence_key(item: dict[str, Any]) -> str:
    raw = str((item.get("details") or {}).get("raw_text") or item.get("content") or "")
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", raw.lower())


def _merge_ai_with_local(ai_records: list[dict[str, Any]], local_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep locally extracted entries that the model did not account for."""
    merged = list(ai_records)
    ai_keys = [_record_evidence_key(item) for item in ai_records]
    for local in local_records:
        local_key = _record_evidence_key(local)
        represented = any(
            min(len(local_key), len(ai_key)) >= 12 and (local_key in ai_key or ai_key in local_key)
            for ai_key in ai_keys
        )
        if not represented:
            merged.append(local)
    return merged


def _section_summaries(experiences: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    for item in experiences:
        key = str(item.get("kind") or "project")
        title = str(item.get("section") or SECTION_DEFAULT_TITLES.get(key) or "其他经历")
        identity = (key, title)
        if identity not in seen:
            summary = {"title": title, "key": key, "entry_count": 0}
            summaries.append(summary)
            seen[identity] = summary
        seen[identity]["entry_count"] += 1
    return summaries


def _editor_snapshot(profile: dict[str, str], experiences: list[dict[str, Any]], photo: str = "", bold_phrases: list[str] | None = None) -> dict[str, Any]:
    section_map = {
        "education": ("education", "教育背景"),
        "experience": ("internship", "实习经验"),
        "skill": ("skills", "工作技能"),
        "project": ("project", "项目经验"),
        "campus": ("campus", "校园经历"),
        "award": ("awards", "竞赛获奖"),
        "summary": ("self", "自我评价"),
    }
    sections = []
    for kind, (section_id, title) in section_map.items():
        items = []
        for index, item in enumerate(value for value in experiences if value["kind"] == kind):
            date_text = " ~ ".join(part for part in [item["start_date"], item["end_date"]] if part)
            right = "  ".join(part for part in [item["organization"], item["role"]] if part) or item["title"]
            fields = {"timeRange": _time_range_fields(item["start_date"], item["end_date"])}
            if kind == "education":
                education_text = item["role"]
                gpa_match = re.search(r"GPA\s*[：:]?\s*([0-9.]+\s*/\s*[0-9.]+)", education_text, re.IGNORECASE)
                fields.update({
                    "school": item["organization"] or item["title"],
                    "major": re.sub(r"\s*GPA\s*[：:]?\s*[0-9.]+\s*/\s*[0-9.]+", "", education_text, flags=re.IGNORECASE).strip(),
                    "gpa": re.sub(r"\s+", "", gpa_match.group(1)) if gpa_match else "",
                })
            elif kind == "experience":
                fields.update({"company": item["organization"] or item["title"], "role": item["role"]})
            elif kind == "project":
                fields.update({"projectName": item["title"], "role": item["role"]})
            items.append({
                "id": f"{section_id}-item-{index + 1}",
                "metaLeft": date_text,
                "metaRight": right,
                "body": _bold_markup(item["summary"], bold_phrases or []),
                "fields": fields,
            })
        if items:
            source_title = next((str(value.get("section") or "").strip() for value in experiences if value["kind"] == kind and value.get("section")), "")
            sections.append({"id": section_id, "tab": source_title or title, "title": source_title or title, "visible": True, "builtin": section_id in {"education", "internship", "skills", "project", "awards", "self"}, "items": items})
    return {
        "schema": 6,
        "profile": {
            "name": profile.get("name", ""), "gender": profile.get("gender", ""), "age": profile.get("age", ""),
            "phone": profile.get("phone", ""), "email": profile.get("email", ""), "political": profile.get("political", ""),
            "arrival": profile.get("arrival", ""), "workYears": "", "location": "", "showPhoto": bool(photo), "photo": photo,
            "photoFileName": "原简历证件照.jpg" if photo else "", "custom": [],
        },
        "sections": sections,
        "template": "classic",
        "settings": {
            "margin": 18, "spacing": 7, "lineHeight": 150, "fontSize": 14,
            "fontFamily": "'Microsoft YaHei', 'PingFang SC', sans-serif", "nameSize": 28,
            "infoColumns": 2, "basicHeight": 132, "titleStyle": "block", "fitScale": 1, "verticalFillGap": 0,
            "customAccent": "#2e5577", "customAccent2": "#3f6688", "customStage": "#eef1f5",
        },
    }


class PdfResumeImporter:
    _preview_cache: dict[tuple[str, ...], dict[str, Any]] = {}

    def __init__(
        self,
        database: Database,
        *,
        settings: AgentSettings | None = None,
        runtime: AgentRuntime | None = None,
    ):
        self.database = database
        self.settings = settings or AgentSettings.from_env()
        self.runtime = runtime

    def preview(self, source_path: str | Path, *, ai_enhanced: bool = True) -> dict[str, Any]:
        path = Path(source_path).expanduser().resolve(strict=True)
        if path.suffix.lower() != ".pdf" or not path.is_file():
            raise ValueError("请选择有效的 PDF 简历")
        raw = path.read_bytes()
        if len(raw) > 20 * 1024 * 1024:
            raise ValueError("PDF 简历不能超过 20MB")
        sha256 = hashlib.sha256(raw).hexdigest()
        cache_key = (
            str(path),
            sha256,
            str(ai_enhanced),
            self.settings.runtime.value,
            self.settings.provider_name,
            self.settings.provider_protocol,
            self.settings.provider_base_url,
            self.settings.model,
        )
        if cache_key in self._preview_cache:
            return deepcopy(self._preview_cache[cache_key])
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError("暂不支持有密码的 PDF")
        pages = [page.extract_text(extraction_mode="layout") or "" for page in reader.pages]
        text = "\n".join(pages).strip()
        if len(_clean(text)) < 80:
            raise ValueError("没有检测到可提取文字；扫描版 PDF 请先执行 OCR")
        header, sections = _split_sections(text)
        profile = _extract_profile(header, path.name)
        if not profile["title"]:
            experience = next((item for item in sections if item["key"] == "experience" and item["entries"]), None)
            if experience:
                title_match = re.search(r"[-–—]([^\-–—\n]{2,30})$", experience["entries"][0])
                if title_match:
                    profile["title"] = _clean(title_match.group(1))
        local_experiences = [
            _experience_record(section, entry, index)
            for section in sections
            for index, entry in enumerate(section["entries"])
        ]
        redacted = redact_resume_text(text, profile)
        outbound_text = redacted.text[:30000]
        ai_result = parse_resume_with_model(
            text,
            profile,
            settings=self.settings,
            runtime=self.runtime,
        ) if ai_enhanced else None
        ai_experiences = _ai_experience_records(ai_result.items) if ai_result and ai_result.used else []
        experiences = _merge_ai_with_local(ai_experiences, local_experiences) if ai_experiences else local_experiences
        section_summaries = _section_summaries(experiences) if ai_experiences else [
            {"title": item["title"], "key": item["key"], "entry_count": len(item["entries"])} for item in sections
        ]
        facts = [
            {"category": item["kind"], "section": item["section"], "content": item["content"]}
            for item in experiences
        ]
        result = {
            "source_path": str(path),
            "filename": path.name,
            "source_sha256": sha256,
            "size_bytes": len(raw),
            "page_count": len(reader.pages),
            "text_length": len(text),
            "profile": profile,
            "sections": section_summaries,
            "experiences": experiences,
            "facts": facts,
            "text_preview": text[:6000],
            "outbound_preview": outbound_text[:6000],
            "outbound_text_length": len(outbound_text),
            "outbound_truncated": len(redacted.text) > len(outbound_text),
            "recognition_mode": "ai_enhanced" if ai_experiences else "local",
            "provider": ai_result.provider if ai_result and ai_result.used else "",
            "model": ai_result.model if ai_result and ai_result.used else "",
            "redacted_fields": ai_result.redacted_fields if ai_result else redacted.categories,
            "warnings": ai_result.warnings if ai_result else [],
        }
        self._preview_cache[cache_key] = deepcopy(result)
        while len(self._preview_cache) > 12:
            self._preview_cache.pop(next(iter(self._preview_cache)))
        return result

    def import_file(
        self,
        source_path: str | Path,
        *,
        candidate_id: str | None = None,
        candidate_name: str | None = None,
        candidate_title: str | None = None,
        ai_enhanced: bool = True,
        reviewed_preview: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        preview = self.preview(source_path, ai_enhanced=ai_enhanced)
        if reviewed_preview is not None:
            preview = self._apply_reviewed_preview(preview, reviewed_preview)
        source = Path(preview["source_path"])
        profile = preview["profile"]
        with self.database.session() as session:
            candidate = session.get(Candidate, candidate_id) if candidate_id else None
            if candidate_id and candidate is None:
                raise ValueError("候选人不存在")
            if candidate is None and profile.get("email"):
                candidate = session.scalar(select(Candidate).where(Candidate.email == profile["email"]))
            if candidate is None:
                name = (candidate_name or profile.get("name") or "未命名候选人").strip()
                candidate = Candidate(name=name)
                session.add(candidate)
                session.flush()
            candidate.name = (candidate_name or candidate.name or profile.get("name") or "未命名候选人").strip()
            candidate.title = (candidate_title or candidate.title or profile.get("title") or "").strip() or None
            candidate.email = candidate.email or profile.get("email") or None
            candidate.phone = candidate.phone or profile.get("phone") or None

            source_key = f"pdf:{preview['source_sha256']}"
            existing = session.scalar(select(ResumeVersion).where(ResumeVersion.legacy_id == source_key))
            if existing is not None:
                self._repair_existing_snapshot(existing, preview, source)
                return {"candidate_id": existing.candidate_id, "resume_id": existing.id, "facts_created": 0, "duplicate": True, "preview": preview}

            destination_dir = artifact_root() / "resumes" / "imported"
            destination_dir.mkdir(parents=True, exist_ok=True)
            destination = destination_dir / f"{preview['source_sha256'][:20]}.pdf"
            shutil.copy2(source, destination)
            material = MaterialAsset(
                candidate_id=candidate.id,
                kind="resume_pdf",
                name=preview["filename"],
                source_path=str(destination),
                mime_type="application/pdf",
                metadata_json={
                    "sha256": preview["source_sha256"],
                    "page_count": preview["page_count"],
                    "size_bytes": preview["size_bytes"],
                },
            )
            session.add(material)
            session.flush()
            content = {
                "profile": {**profile, "name": candidate.name, "title": candidate.title or "", "photo": ""},
                "sections": preview["sections"],
                "raw_text": preview["text_preview"],
                "source_asset_id": material.id,
                "source": {"type": "pdf", "filename": preview["filename"], "sha256": preview["source_sha256"], "page_count": preview["page_count"]},
                "source_pdf_fidelity": True,
                "pdf_import_schema_version": PDF_IMPORT_SCHEMA_VERSION,
            }
            photo, _ = _extract_photo_data_uri(source)
            bold_phrases = _extract_bold_phrases(source)
            content["profile"]["photo"] = photo
            content["editor_snapshot"] = _editor_snapshot({**profile, "name": candidate.name}, preview["experiences"], photo=photo, bold_phrases=bold_phrases)
            resume = ResumeVersion(
                legacy_id=source_key,
                candidate_id=candidate.id,
                name=f"{candidate.name}的基础简历",
                status=AssetStatus.DRAFT,
                content_json=content,
                pdf_path=str(destination),
                content_hash=canonical_hash(content),
            )
            session.add(resume)
            session.flush()

            created = 0
            source_reference = f"{destination}#sha256={preview['source_sha256']}"
            for index, item in enumerate(preview["experiences"]):
                experience = Experience(
                    candidate_id=candidate.id,
                    source_asset_id=material.id,
                    kind=item["kind"],
                    title=item["title"],
                    organization=item["organization"] or None,
                    role=item["role"] or None,
                    start_date=item["start_date"] or None,
                    end_date=item["end_date"] or None,
                    summary=item["summary"] or None,
                    details_json=item["details"],
                    tags=[],
                    sort_order=index,
                )
                session.add(experience)
                session.flush()
                fact = Fact(
                    candidate_id=candidate.id,
                    subject_type="experience",
                    subject_id=experience.id,
                    category=item["kind"],
                    content=item["content"],
                    normalized_value={"section_title": item["section"], "experience_id": experience.id},
                    source_type=FactSourceType.DOCUMENT_IMPORT,
                    source_reference=source_reference,
                    legacy_source_key=f"{source_key}:fact:{index}",
                    verified=False,
                )
                session.add(fact)
                session.flush()
                experience.fact_ids = [fact.id]
                created += 1
            session.flush()
            return {"candidate_id": candidate.id, "resume_id": resume.id, "facts_created": created, "duplicate": False, "preview": preview}

    @staticmethod
    def _apply_reviewed_preview(base: dict[str, Any], reviewed: dict[str, Any]) -> dict[str, Any]:
        """Apply only user-reviewable fields while retaining source evidence."""

        if not isinstance(reviewed, dict):
            raise ValueError("简历核对结果格式无效")
        source_sha = str(reviewed.get("source_sha256") or base["source_sha256"])
        if source_sha != base["source_sha256"]:
            raise ValueError("简历核对结果与当前 PDF 不匹配")
        raw_items = reviewed.get("experiences")
        if not isinstance(raw_items, list) or len(raw_items) > 200:
            raise ValueError("简历经历核对结果无效")
        allowed_kinds = {"education", "experience", "project", "skill", "award", "summary", "campus", "research", "other"}
        clean_items = []
        for index, raw in enumerate(raw_items):
            if not isinstance(raw, dict):
                raise ValueError("简历经历条目格式无效")
            original = (base.get("experiences") or [])
            source_index = raw.get("_source_index", index)
            source_index = source_index if isinstance(source_index, int) and 0 <= source_index < len(original) else index
            evidence = original[source_index].get("details", {}) if source_index < len(original) else {}
            kind = str(raw.get("kind") or "other")[:40]
            if kind not in allowed_kinds:
                kind = "other"
            section = str(raw.get("section") or SECTION_DEFAULT_TITLES.get(kind) or "其他经历").strip()[:120]
            fields = {
                key: str(raw.get(key) or "").strip()[:limit]
                for key, limit in {
                    "title": 240,
                    "organization": 240,
                    "role": 240,
                    "start_date": 80,
                    "end_date": 80,
                    "summary": 8000,
                }.items()
            }
            content = " ".join(item for item in (fields["title"], fields["organization"], fields["role"], fields["summary"]) if item)
            if not content:
                continue
            clean_items.append({
                "kind": kind,
                "section": section,
                **fields,
                "details": {
                    **evidence,
                    "review_status": "uncertain" if raw.get("review_status") == "uncertain" else "confirmed",
                    "user_reviewed": True,
                },
                "content": content[:10000],
            })
        result = deepcopy(base)
        profile_override = reviewed.get("profile") if isinstance(reviewed.get("profile"), dict) else {}
        result["profile"] = {
            **base["profile"],
            **{
                key: str(profile_override.get(key) or base["profile"].get(key) or "").strip()[:limit]
                for key, limit in {"name": 160, "title": 240, "email": 320, "phone": 80}.items()
            },
        }
        result["experiences"] = clean_items
        result["sections"] = _section_summaries(clean_items)
        result["facts"] = [{"category": item["kind"], "section": item["section"], "content": item["content"]} for item in clean_items]
        result["warnings"] = [*(base.get("warnings") or []), "已采用用户在导入核对页确认的字段修正。"]
        return result

    @staticmethod
    def _repair_existing_snapshot(resume: ResumeVersion, preview: dict[str, Any], source: Path) -> None:
        content = deepcopy(resume.content_json or {})
        source_profile = preview.get("profile") or {}
        photo, _ = _extract_photo_data_uri(source)
        bold_phrases = _extract_bold_phrases(source)
        name = str(source_profile.get("name") or (content.get("profile") or {}).get("name") or "未命名候选人")
        # This key represents the untouched PDF source. Rebuild its canonical
        # editor snapshot on duplicate import so older, lossy snapshots gain
        # the same field separation and portrait handling as new imports.
        content["profile"] = {**source_profile, "name": name, "photo": photo}
        content["sections"] = preview.get("sections") or content.get("sections") or []
        content["raw_text"] = preview.get("text_preview") or content.get("raw_text") or ""
        content["editor_snapshot"] = _editor_snapshot({**source_profile, "name": name}, preview.get("experiences") or [], photo=photo, bold_phrases=bold_phrases)
        content["source_pdf_fidelity"] = True
        content["editor_source"] = "resume-editor-prototype"
        content["pdf_import_schema_version"] = PDF_IMPORT_SCHEMA_VERSION
        resume.content_json = content
        resume.content_hash = canonical_hash(content)

    def repair_imported_snapshots(self) -> int:
        """Repair legacy PDF snapshots in packaged desktop databases."""
        repaired = 0
        with self.database.session() as session:
            base_resumes = list(
                session.scalars(
                    select(ResumeVersion).where(
                        ResumeVersion.job_id.is_(None),
                        ResumeVersion.legacy_id.like("pdf:%"),
                    )
                ).all()
            )
            for resume in base_resumes:
                content = resume.content_json or {}
                if int(content.get("pdf_import_schema_version") or 0) >= PDF_IMPORT_SCHEMA_VERSION:
                    continue
                # A manually saved base resume is user-authored; migrate its
                # field shape below but do not rebuild it from the source PDF.
                if content.get("editor_source") == "resume-editor-prototype":
                    continue
                material = session.get(MaterialAsset, content.get("source_asset_id")) if content.get("source_asset_id") else None
                source = Path(material.source_path).expanduser() if material and material.source_path else None
                if source and source.is_file():
                    preview = self.preview(source)
                    self._repair_existing_snapshot(resume, preview, source)
                    repaired += 1

            base_by_candidate = {
                resume.candidate_id: resume
                for resume in session.scalars(
                    select(ResumeVersion)
                    .where(ResumeVersion.job_id.is_(None))
                    .order_by(ResumeVersion.updated_at.desc())
                ).all()
                if isinstance((resume.content_json or {}).get("editor_snapshot"), dict)
            }
            for resume in session.scalars(select(ResumeVersion).where(ResumeVersion.job_id.is_not(None))).all():
                content = deepcopy(resume.content_json or {})
                if int(content.get("pdf_import_schema_version") or 0) >= PDF_IMPORT_SCHEMA_VERSION:
                    continue
                base = base_by_candidate.get(resume.candidate_id)
                base_snapshot = (base.content_json or {}).get("editor_snapshot") if base else None
                job_snapshot = content.get("editor_snapshot")
                if not isinstance(base_snapshot, dict) or not isinstance(job_snapshot, dict):
                    continue
                content["editor_snapshot"] = _rebase_job_snapshot(base_snapshot, job_snapshot)
                content["pdf_import_schema_version"] = PDF_IMPORT_SCHEMA_VERSION
                resume.content_json = content
                resume.parent_version_id = resume.parent_version_id or base.id
                resume.content_hash = canonical_hash(content)
                repaired += 1

            for resume in session.scalars(select(ResumeVersion)).all():
                content = deepcopy(resume.content_json or {})
                snapshot = content.get("editor_snapshot")
                if not isinstance(snapshot, dict):
                    continue
                normalized, changed = _normalize_editor_snapshot(snapshot)
                if not changed:
                    continue
                content["editor_snapshot"] = normalized
                content["pdf_import_schema_version"] = PDF_IMPORT_SCHEMA_VERSION
                resume.content_json = content
                resume.content_hash = canonical_hash(content)
                repaired += 1
            session.flush()
        return repaired
