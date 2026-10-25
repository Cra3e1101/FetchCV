from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import re
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.models import Job, MaterialAsset
from applyos_domain.job_context import body_hash, source_context, normalize_context, job_input_signature, mark_job_analyses_stale
from applyos_harness.errors import HarnessError

from .client import WebClient, WebPage


JOB_CONTENT_MARKERS = (
    "岗位职责", "工作职责", "工作内容", "职位描述", "任职要求", "职位要求", "应聘要求",
    "岗位要求", "实习内容", "responsibilities", "qualifications", "requirements", "job description",
)


def _is_timeout(error: Exception) -> bool:
    return isinstance(error, TimeoutError) or "timeout" in str(getattr(error, "code", "")).casefold() or \
        "timeout" in str(getattr(error, "details", {}).get("error_type", "")).casefold()


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
    status: str = "ok"
    adapter: str = "static"
    adapter_version: str = "jd-fetch-v1"
    fetched_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    warnings: list[str] = field(default_factory=list)

    def __post_init__(self):
        self.description = self.description.strip()[:40000]
        self.content_sha256 = body_hash(self.description)

    @property
    def body(self) -> str:
        return self.description

    @property
    def body_hash(self) -> str:
        return self.content_sha256

    def provenance(self) -> dict[str, Any]:
        return {name: getattr(self, name) for name in
                ("status", "body_hash", "source_url", "adapter", "adapter_version", "fetched_at", "warnings")}

    def as_dict(self) -> dict[str, Any]:
        return {**asdict(self), "body": self.body, "body_hash": self.body_hash,
                "raw_text": self.body, "raw_chars": len(self.body),
                "context_json": source_context(self.body), "jd_provenance": self.provenance(),
                "confidence": 0.8 if self.structured_data else 0.2}


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
    def __init__(self, session: Session | None, *, web_client: WebClient | None = None,
                 firecrawl_client=None, browser_client=None):
        self.session = session
        self.web = web_client or WebClient()
        from .firecrawl import FirecrawlClient
        from applyos_agent.browser_tools import BrowserBridgeClient
        self.firecrawl = firecrawl_client if firecrawl_client is not None else FirecrawlClient(web_client=self.web)
        self.browser = browser_client if browser_client is not None else BrowserBridgeClient(web_client=self.web)

    def preview(self, url: str, *, allow_insufficient: bool = False) -> ParsedJobPosting:
        # A single typed fetch/parse chain is shared by UI preview and Agent
        # import. Preview itself does not add/update any database row.
        del allow_insufficient  # compatibility: status now carries insufficiency
        posting = ParsedJobPosting(WebClient.redact_url(url), "", "", "", "", False,
                                   status="insufficient_content")
        warnings = []
        timed_out = False
        read_failed = False
        access_required = False
        try:
            page = self.web.read_page(url, max_chars=40000)
            posting = self.parse(page, allow_insufficient=True)
            if not looks_like_job_content(posting.body):
                detail = self._public_ats_detail(page)
                if detail is not None:
                    posting = detail
                    posting.adapter = "public-ats"
        except (HarnessError, TimeoutError) as exc:
            code = getattr(exc, "code", "web_timeout")
            timed_out = _is_timeout(exc)
            read_failed = True
            error_details = getattr(exc, "details", {})
            access_required = error_details.get("status_code", error_details.get("status")) in {401, 403}
            warnings.append("static:" + code)
            if any(token in code for token in ("denied", "invalid_url", "insecure")):
                posting.status = "error"
                posting.warnings = warnings
                return posting
        if self.firecrawl.configured and not looks_like_job_content(posting.body):
            try:
                crawled = self.firecrawl.scrape(url)
                text = str(crawled.text or "").strip()[:40000]
                if looks_like_job_content(text) and len(text) > len(posting.body):
                    posting = ParsedJobPosting(WebClient.redact_url(crawled.source_url or posting.source_url),
                        str(crawled.title or posting.title)[:240], posting.company, posting.location,
                        text, False, page_title=str(crawled.title or posting.page_title)[:500], adapter="firecrawl")
                else:
                    warnings.append("firecrawl:insufficient_content")
            except (HarnessError, TimeoutError) as exc:
                code = getattr(exc, "code", "web_timeout")
                timed_out = timed_out or _is_timeout(exc)
                warnings.append("firecrawl:" + code)
        if self.browser.configured and (len(posting.body) < 1200 or not looks_like_job_content(posting.body)):
            try:
                state = self.browser.open(url)
                if state.get("login_required"):
                    # Keep a usable earlier body; a login wall cannot replace it.
                    warnings.append("browser:requires_user_action")
                    access_required = True
                    if not looks_like_job_content(posting.body):
                        posting.status = "requires_user_action"
                else:
                    text = str(state.get("text") or "").strip()[:40000]
                    if looks_like_job_content(text) and (len(text) > len(posting.body) or not looks_like_job_content(posting.body)):
                        posting = ParsedJobPosting(WebClient.redact_url(str(state.get("url") or posting.source_url)),
                            str(state.get("title") or posting.title)[:240], posting.company, posting.location,
                            text, False, page_title=str(state.get("title") or posting.page_title)[:500], adapter="controlled-browser")
                    else:
                        warnings.append("browser:insufficient_content")
            except (HarnessError, TimeoutError) as exc:
                code = getattr(exc, "code", "web_timeout")
                timed_out = timed_out or _is_timeout(exc)
                warnings.append("browser:" + code)
        if "#" in url and "#" not in posting.source_url:
            posting.source_url = WebClient.redact_url(url)
        posting.source_url = WebClient.redact_url(posting.source_url)
        if posting.status != "requires_user_action":
            usable = looks_like_job_content(posting.body) or (posting.structured_data and len(posting.body) >= 40)
            posting.status = "ok" if usable else "requires_user_action" if access_required else "timeout" if timed_out and not posting.body else "error" if read_failed and not posting.body else "insufficient_content"
        if posting.date_posted and posting.date_posted not in posting.body:
            warnings.append("published_at:structured_metadata_not_in_body")
        if posting.status == "insufficient_content":
            warnings.append("job_page_content_insufficient")
        posting.warnings = list(dict.fromkeys(warnings))
        posting.content_sha256 = body_hash(posting.body)
        return posting

    def _public_ats_detail(self, page: WebPage) -> ParsedJobPosting | None:
        parts = urlsplit(page.final_url)
        host = parts.hostname or ''
        supported = host == 'jobs.bytedance.com' or host.endswith('.jobs.feishu.cn') or host.endswith('.jobs.f.mioffice.cn')
        match = re.fullmatch(r'/campus/(?:m/)?position/(\d+)/detail/?', parts.path)
        if not supported or not match:
            return None
        job_id = match[1]
        endpoint = f'https://{host}/api/v1/job/posts/{job_id}?portal_type=2'
        api = self.web.read_page(endpoint, max_chars=50000)
        if api.truncated or api.content_type != 'application/json' or urlsplit(api.final_url).hostname != host:
            return None
        try:
            document = json.loads(api.text)
            detail = (document.get('data') or {}).get('job_post_detail') or {}
            if document.get('code') != 0 or str(detail.get('id')) != job_id:
                return None
            title = _plain_text(detail.get('title'))
            description = '职位描述\n' + _plain_text(detail.get('description')) + '\n\n职位要求\n' + _plain_text(detail.get('requirement'))
            if not title or not looks_like_job_content(description):
                return None
            date = detail.get('publish_time')
            posted = datetime.fromtimestamp(float(date) / 1000, timezone.utc).isoformat() if date else ''
            return ParsedJobPosting(source_url=page.final_url, title=title[:240], company='',
                location='、'.join(_plain_text(x.get('name')) for x in detail.get('city_list',[]) if isinstance(x,dict)),
                description=description[:40000], structured_data=True, date_posted=posted,
                content_sha256=api.content_sha256, page_title=page.title)
        except (ValueError, TypeError, AttributeError, OverflowError, OSError):
            return None

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
        if parsed.status != "ok":
            return {"imported": False, "conflict": False, "job_id": job.id,
                    "posting": parsed.as_dict(), "material_id": None}
        existing_jd = str(job.jd_raw or "").strip()
        if existing_jd and existing_jd != parsed.description and not overwrite:
            return {"imported": False, "conflict": True, "job_id": job.id, "posting": parsed.as_dict(), "material_id": None}
        placeholders = {"待导入", "待识别", "未命名公司", "未知公司", "新岗位"}
        previous_input = job_input_signature(job)
        if parsed.company and (not job.company.strip() or job.company.strip() in placeholders):
            job.company = parsed.company
        if parsed.title and (not job.role.strip() or job.role.strip() in placeholders):
            job.role = parsed.title
        if parsed.location and not (job.location or "").strip():
            job.location = parsed.location
        job.jd_raw = parsed.description
        previous_context = normalize_context(job.context_json, parsed.body)
        acquired_context = source_context(parsed.body)
        job.context_json = {"schema_version": 1, "fields": {name:
            previous_context["fields"][name] if previous_context["fields"][name]["basis"] == "user_confirmed" else item
            for name, item in acquired_context["fields"].items()}}
        job.jd_provenance = parsed.provenance()
        job.source_type = "web_import"
        job.source_url = parsed.source_url
        if previous_input != job_input_signature(job):
            mark_job_analyses_stale(self.session, job, reason="jd_import_changed")
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
            "fetched_at": parsed.fetched_at,
            "jd_provenance": parsed.provenance(),
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
