from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.models import Job, MaterialAsset
from applyos_harness.errors import HarnessError

from .client import WebClient, WebPage


JOB_CONTENT_MARKERS = (
    "岗位职责", "工作职责", "工作内容", "职位描述", "任职要求", "职位要求", "应聘要求",
    "岗位要求", "实习内容", "responsibilities", "qualifications", "requirements", "job description",
)


def looks_like_job_content(value: str) -> bool:
    text = " ".join(str(value or "").split()).casefold()
    if len(text) < 180:
        return False
    return any(marker.casefold() in text for marker in JOB_CONTENT_MARKERS) or len(text) >= 520


@dataclass
class ParsedJobPosting:
    source_url: str
    title: str
    company: str
    location: str
    description: str
    structured_data: bool
    date_posted: str = ""
    valid_through: str = ""
    content_sha256: str = ""
    page_title: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class _TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_starttag(self, tag: str, _attrs) -> None:
        if tag in {"br", "div", "li", "p", "section", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"div", "li", "p", "section", "tr"}:
            self.parts.append("\n")


def _plain_text(value: Any) -> str:
    if isinstance(value, list):
        return "\n".join(dict.fromkeys(text for text in (_plain_text(item) for item in value) if text))
    if isinstance(value, dict):
        return _plain_text(value.get("text") or value.get("name") or value.get("@value") or "")
    parser = _TextParser()
    parser.feed(str(value or ""))
    return "\n".join(line for line in (" ".join(item.split()) for item in "".join(parser.parts).replace("\r", "\n").split("\n")) if line).strip()


def _nodes(value: Any):
    if isinstance(value, list):
        for item in value:
            yield from _nodes(item)
    elif isinstance(value, dict):
        yield value
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in value:
                yield from _nodes(value[key])


def _type_is_job(value: Any) -> bool:
    types = value if isinstance(value, list) else [value]
    return any(str(item).casefold() == "jobposting" for item in types)


def _company(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or "").strip()
    return str(value or "").strip()


def _location(value: Any) -> str:
    values = value if isinstance(value, list) else [value]
    parts: list[str] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        address = item.get("address") if isinstance(item.get("address"), dict) else item
        location = " ".join(str(address.get(key) or "").strip() for key in ("addressLocality", "addressRegion", "addressCountry") if address.get(key))
        if location and location not in parts:
            parts.append(location)
    return " / ".join(parts)


class JobPostingImporter:
    def __init__(self, session: Session, *, web_client: WebClient | None = None):
        self.session = session
        self.web = web_client or WebClient()

    def preview(self, url: str, *, allow_insufficient: bool = False) -> ParsedJobPosting:
        page = self.web.read_page(url, max_chars=40000)
        return self.parse(page, allow_insufficient=allow_insufficient)

    def parse(self, page: WebPage, *, allow_insufficient: bool = False) -> ParsedJobPosting:
        posting: dict[str, Any] | None = None
        for raw in page.json_ld:
            try:
                value = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue
            posting = next((node for node in _nodes(value) if _type_is_job(node.get("@type"))), None)
            if posting:
                break
        if posting:
            body_parts = [posting.get("description"), posting.get("responsibilities"), posting.get("qualifications"), posting.get("skills")]
            description = "\n".join(dict.fromkeys(text for text in (_plain_text(item) for item in body_parts) if text))
            if not description:
                description = page.text
            title = _plain_text(posting.get("title") or posting.get("name"))
            company = _company(posting.get("hiringOrganization"))
            location = _location(posting.get("jobLocation"))
            date_posted = str(posting.get("datePosted") or "")[:40]
            valid_through = str(posting.get("validThrough") or "")[:40]
            structured = True
        else:
            description = page.text
            title = next(iter(page.headings), "") or re.split(r"\s[-|·]\s", page.title, maxsplit=1)[0].strip()
            company = ""
            location = ""
            date_posted = ""
            valid_through = ""
            structured = False
        description = description.strip()[:40000]
        if len(description) < 40 and not allow_insufficient:
            raise HarnessError("job_page_content_insufficient", "招聘页面没有提取到足够的岗位正文", details={"url": page.final_url})
        return ParsedJobPosting(
            source_url=page.final_url,
            title=title[:240],
            company=company[:240],
            location=location[:240],
            description=description,
            structured_data=structured,
            date_posted=date_posted,
            valid_through=valid_through,
            content_sha256=page.content_sha256,
            page_title=page.title[:500],
        )

    def import_into_job(self, job: Job, *, url: str | None = None, overwrite: bool = False) -> dict[str, Any]:
        source_url = str(url or job.source_url or "").strip()
        if not source_url:
            raise HarnessError("job_source_url_required", "岗位没有可导入的招聘页面 URL", run_id=None)
        parsed = self.preview(source_url)
        existing_jd = str(job.jd_raw or "").strip()
        if existing_jd and existing_jd != parsed.description and not overwrite:
            return {"imported": False, "conflict": True, "job_id": job.id, "posting": parsed.as_dict(), "material_id": None}
        placeholders = {"待导入", "待识别", "未命名公司", "未知公司", "新岗位"}
        if parsed.company and (not job.company.strip() or job.company.strip() in placeholders):
            job.company = parsed.company
        if parsed.title and (not job.role.strip() or job.role.strip() in placeholders):
            job.role = parsed.title
        if parsed.location and not (job.location or "").strip():
            job.location = parsed.location
        job.jd_raw = parsed.description
        job.source_type = "web_import"
        job.source_url = parsed.source_url
        material = self.session.scalar(
            select(MaterialAsset).where(
                MaterialAsset.candidate_id == job.candidate_id,
                MaterialAsset.kind == "job_posting_page",
                MaterialAsset.source_url == parsed.source_url,
            )
        )
        metadata = {
            "job_id": job.id,
            "content_sha256": parsed.content_sha256,
            "structured_data": parsed.structured_data,
            "page_title": parsed.page_title,
            "date_posted": parsed.date_posted,
            "valid_through": parsed.valid_through,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        if material is None:
            material = MaterialAsset(
                candidate_id=job.candidate_id,
                kind="job_posting_page",
                name=parsed.page_title or parsed.title or "招聘页面",
                source_url=parsed.source_url,
                mime_type="text/html",
                metadata_json=metadata,
            )
            self.session.add(material)
        else:
            material.name = parsed.page_title or parsed.title or material.name
            material.metadata_json = metadata
        self.session.flush()
        return {"imported": True, "conflict": False, "job_id": job.id, "posting": parsed.as_dict(), "material_id": material.id}
