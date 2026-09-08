from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
import re
from typing import Any, Literal
import time
from urllib.parse import quote, urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from applyos_domain.models import InterviewBrief, InterviewSource, Job
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.state_machine import PipelineStage
from integrations.web import FirecrawlClient, WebClient, WebSearchResult
from integrations.web.nowcoder import canonical_nowcoder_url

from .browser_tools import BrowserBridgeClient
from .tools import PipelineToolResult


PRIMARY_INTERVIEW_PLATFORM = "xiaohongshu"
INTERVIEW_SOURCE_MINIMUM = 4
SUPPLEMENTAL_INTERVIEW_PLATFORMS = {"nowcoder", "zhihu", "csdn"}


class InterviewToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SearchInterviewKnowledgeInput(InterviewToolInput):
    company: str = Field(min_length=1, max_length=240)
    role: str = Field(min_length=1, max_length=240)
    business_unit: str = Field(default="", max_length=240)
    query: str = Field(default="", max_length=500)
    max_results: int | None = Field(
        default=None,
        ge=1,
        le=200,
        description="可选的用户指定上限；省略时返回全部相关知识，不使用固定条数截断。",
    )


class DiscoverInterviewSourcesInput(InterviewToolInput):
    company: str = Field(min_length=1, max_length=240)
    role: str = Field(min_length=1, max_length=240)
    business_unit: str = Field(default="", max_length=240)
    query_terms: list[str] = Field(default_factory=list, max_length=12)
    platforms: list[Literal["xiaohongshu", "nowcoder", "zhihu", "csdn"]] = Field(
        default_factory=lambda: ["xiaohongshu", "nowcoder", "zhihu", "csdn"], min_length=1,
        description="可指定只检索牛客：['nowcoder']。默认检索所有支持的平台。",
    )
    nowcoder_start_page: int = Field(default=1, ge=1, le=100)
    nowcoder_query: str = Field(default="", max_length=500, description="续查时原样传入 nowcoder_continuations 中的 query，避免重复扩展关键词。")
    nowcoder_page_limit: int = Field(default=3, ge=1, le=10, description="每组牛客关键词本轮最多读取的页数；未完成时返回 continuation，不代表来源耗尽。")
    max_results: int | None = Field(
        default=None,
        ge=1,
        le=200,
        description="已弃用的兼容字段；来源发现不会再按固定总条数截断。",
    )


class CaptureInterviewSourceInput(InterviewToolInput):
    url: str = Field(min_length=8, max_length=4096)
    company: str = Field(default="", max_length=240)
    role: str = Field(default="", max_length=240)
    business_unit: str = Field(default="", max_length=240)


class InterviewQuestionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=2, max_length=1000)
    category: str = Field(default="综合", max_length=120)
    round: str = Field(default="未注明", max_length=120)
    evidence_quote: str = Field(min_length=2, max_length=1200)


class AnalyzeInterviewSourceInput(InterviewToolInput):
    source_id: str = Field(min_length=1, max_length=80)
    summary: str = Field(min_length=2, max_length=5000)
    questions: list[InterviewQuestionInput] = Field(default_factory=list, max_length=40)
    tags: list[str] = Field(default_factory=list, max_length=30)


class CollectInterviewOcrInput(InterviewToolInput):
    source_id: str = Field(min_length=1, max_length=80)


class CommonInterviewQuestionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=2, max_length=1000)
    category: str = Field(default="综合", max_length=120)
    source_ids: list[str] = Field(min_length=1, max_length=200)
    why_it_matters: str = Field(
        min_length=2,
        max_length=2000,
        description="结合当前岗位说明面试官为什么会用这道题判断候选人。",
    )
    preparation: str = Field(
        min_length=2,
        max_length=3000,
        description="给候选人的可执行准备方法，不得只复述题目。",
    )


class InterviewRecommendationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=240)
    action: str = Field(min_length=2, max_length=3000)
    rationale: str = Field(default="", max_length=2000)


class BuildInterviewBriefInput(InterviewToolInput):
    company: str = Field(min_length=1, max_length=240)
    role: str = Field(min_length=1, max_length=240)
    business_unit: str = Field(default="", max_length=240)
    summary: str = Field(min_length=2, max_length=8000)
    source_ids: list[str] = Field(min_length=1, max_length=200)
    common_questions: list[CommonInterviewQuestionInput] = Field(default_factory=list, max_length=40)
    recommendations: list[InterviewRecommendationInput] = Field(default_factory=list, max_length=30)
    query_terms: list[str] = Field(default_factory=list, max_length=30)


def _result(
    context: ToolContext,
    summary: str,
    *,
    data: dict[str, Any] | None = None,
    artifacts: list[str] | None = None,
    requires_user_action: bool = False,
) -> PipelineToolResult:
    return PipelineToolResult(
        stage=context.run.current_stage or PipelineStage.CREATED.value,
        status=context.run.status.value,
        summary=summary,
        artifacts=artifacts or [],
        requires_user_action=requires_user_action,
        approval_action="complete_browser_login" if requires_user_action else None,
        data=data or {},
    )


def _normalized(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _xiaohongshu_note_timestamp(value: str) -> int:
    try:
        match = re.search(r"/(?:explore|discovery/item)/([a-f0-9]{24})(?:/|$)", urlsplit(str(value or "")).path, re.I)
        if not match:
            return 0
        timestamp = int(match.group(1)[:8], 16)
        year = datetime.fromtimestamp(timestamp, timezone.utc).year
        return timestamp if 2013 <= year <= 2100 else 0
    except (TypeError, ValueError, OSError, OverflowError):
        return 0


def _xiaohongshu_note_published_at(value: str) -> str:
    timestamp = _xiaohongshu_note_timestamp(value)
    if not timestamp:
        return ""
    return datetime.fromtimestamp(timestamp, timezone(timedelta(hours=8))).isoformat()


def _is_xiaohongshu_url(value: str) -> bool:
    host = (urlsplit(value).hostname or "").casefold()
    return host == "xhslink.com" or host.endswith(".xhslink.com") or host == "xiaohongshu.com" or host.endswith(".xiaohongshu.com")


def _is_xiaohongshu_note_url(value: str) -> bool:
    parsed = urlsplit(value)
    host = (parsed.hostname or "").casefold()
    return (
        (host == "xiaohongshu.com" or host.endswith(".xiaohongshu.com"))
        and bool(re.match(r"^/(?:discovery/item|explore)/[^/?#]+/?$", parsed.path))
    )


def _is_xiaohongshu_note_candidate(value: str) -> bool:
    parsed = urlsplit(value)
    host = (parsed.hostname or "").casefold()
    if host == "xhslink.com" or host.endswith(".xhslink.com"):
        return parsed.path not in {"", "/"}
    return _is_xiaohongshu_note_url(value)


def _interview_platform(value: str) -> str:
    host = (urlsplit(str(value or "")).hostname or "").casefold()
    if host == "xhslink.com" or host.endswith(".xhslink.com") or host == "xiaohongshu.com" or host.endswith(".xiaohongshu.com"):
        return PRIMARY_INTERVIEW_PLATFORM
    if host == "nowcoder.com" or host.endswith(".nowcoder.com"):
        return "nowcoder"
    if host == "zhihu.com" or host.endswith(".zhihu.com"):
        return "zhihu"
    if host == "csdn.net" or host.endswith(".csdn.net"):
        return "csdn"
    return ""


def _is_supported_interview_candidate(value: str) -> bool:
    platform = _interview_platform(value)
    if platform == PRIMARY_INTERVIEW_PLATFORM:
        return _is_xiaohongshu_note_candidate(value)
    parsed = urlsplit(value)
    if platform == "nowcoder":
        return bool(canonical_nowcoder_url(value))
    if platform == "zhihu":
        return bool(re.search(r"/(?:question|p|pin|zvideo)/", parsed.path, re.I))
    if platform == "csdn":
        return bool(re.search(r"/article/details/\d+", parsed.path, re.I))
    return False


def _normalized_xiaohongshu_url(value: str) -> str:
    """Public share copy often uses HTTP even though the working redirect is HTTPS."""
    raw = _normalized(value)
    parsed = urlsplit(raw)
    host = (parsed.hostname or "").casefold()
    if parsed.scheme.casefold() == "http" and (host == "xhslink.com" or host.endswith(".xhslink.com")):
        return parsed._replace(scheme="https").geturl()
    return raw


def _canonical_xiaohongshu_url(web: WebClient, value: str) -> str:
    redacted = web.redact_url(value)
    parsed = urlsplit(redacted)
    host = (parsed.hostname or "").casefold()
    if (host == "xiaohongshu.com" or host.endswith(".xiaohongshu.com")) and re.match(r"^/(?:discovery/item|explore)/[^/]+", parsed.path):
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    return redacted


def _canonical_interview_url(web: WebClient, value: str) -> str:
    if _interview_platform(value) == PRIMARY_INTERVIEW_PLATFORM:
        return _canonical_xiaohongshu_url(web, value)
    redacted = web.redact_url(value)
    parsed = urlsplit(redacted)
    if _interview_platform(redacted) == "nowcoder":
        return canonical_nowcoder_url(redacted) or redacted
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


def _source_timestamp(source: InterviewSource) -> int:
    published = _normalized(source.published_at or "")
    if published:
        try:
            return int(datetime.fromisoformat(published.replace("Z", "+00:00")).timestamp())
        except (TypeError, ValueError, OSError, OverflowError):
            pass
    return _xiaohongshu_note_timestamp(source.source_url)


def _role_search_variants(role: str, supplied: list[str] | None = None) -> list[str]:
    exact = _normalized(role)
    variants: list[str] = []
    parts = [_normalized(item) for item in re.split(r"[-—–|/·（()]", exact) if _normalized(item)]
    # In titles such as “两轮车事业部-策略运营”, the final segment is the
    # functional role. Search it before the organization-only prefix so the
    # small anonymous-browser budget is spent on the more relevant phrase.
    if len(parts) > 1:
        variants.extend([parts[-1], exact, parts[0]])
    else:
        variants.append(exact)
    variants.extend(_normalized(item) for item in (supplied or []))
    compact = re.sub(r"\s+", "", parts[-1] if parts else exact)
    if "产品" in compact:
        if "AI" in compact.upper() or "人工智能" in compact:
            variants.extend(["AI产品经理实习生", "AI产品经理"])
        variants.extend(["产品经理实习生", "产品实习生"])
    if "策略运营" in compact:
        variants.extend(["策略运营", "运营策略"])
    elif "运营策略" in compact:
        variants.extend(["运营策略", "策略运营"])
    return list(dict.fromkeys(item for item in variants if len(item) >= 2))[:8]


def _xiaohongshu_search_phrases(company: str, business_unit: str, role: str, supplied: list[str] | None = None) -> list[str]:
    company_exact = _normalized(company)
    company_short = re.sub(r"(?:出行|科技|集团|有限公司)$", "", company_exact).strip() or company_exact
    role_variants = _role_search_variants(role, supplied)
    functional_role = role_variants[0] if role_variants else _normalized(role)
    business = _normalized(business_unit)
    if not business:
        role_parts = [_normalized(item) for item in re.split(r"[-—–|/·（()]", _normalized(role)) if _normalized(item)]
        business = role_parts[0] if len(role_parts) > 1 else ""
    business_short = business.replace("事业部", "").strip()
    business_aliases = [business_short] if business_short else []
    if "两轮车" in f"{business} {role}":
        business_aliases.extend(["两轮车", "青桔"])

    exact_phrases = [
        f"{company_short} {business_aliases[0] if business_aliases else business} {functional_role} 面经",
        f"{company_short} 青桔 {functional_role} 面经" if "青桔" in business_aliases else "",
    ]
    if business and len(role_variants) > 1:
        exact_phrases.append(f"{company_short} {business_aliases[0] if business_aliases else business} {role_variants[1]} 面经")
    company_role_phrases = [
        f"{company_short} {functional_role} 面经",
        *[f"{company_short} {variant} 面经" for variant in role_variants[1:4]],
        *[f"{company_short} {_normalized(item)} 面经" for item in (supplied or [])],
    ]
    return list(dict.fromkeys(
        _normalized(item)
        for item in [*exact_phrases, *company_role_phrases]
        if _normalized(item)
    ))[:8]


def _xiaohongshu_search_plan(company: str, business_unit: str, role: str, supplied: list[str] | None = None) -> list[dict[str, str]]:
    phrases = _xiaohongshu_search_phrases(company, business_unit, role, supplied)
    business = _normalized(business_unit)
    if not business:
        parts = [_normalized(item) for item in re.split(r"[-—–|/·（()]", _normalized(role)) if _normalized(item)]
        business = parts[0] if len(parts) > 1 else ""
    business_markers = [business, business.replace("事业部", "").strip()]
    if "两轮车" in f"{business} {role}":
        business_markers.extend(["两轮车", "青桔"])
    plan = []
    for phrase in phrases:
        tier = "same_business_role" if any(marker and marker in phrase for marker in business_markers) else "company_role"
        plan.append({"query": phrase, "tier": tier})
    # Exact business-unit coverage is deliberately exhausted first. The
    # remaining searches broaden to the same role elsewhere in the company or
    # posts that do not name a business unit.
    return sorted(plan, key=lambda item: 0 if item["tier"] == "same_business_role" else 1)


def _coverage_scope(business_unit: str, role: str, title: str, text: str) -> str:
    business = _normalized(business_unit)
    if not business:
        role_parts = [
            _normalized(item)
            for item in re.split(r"[-—–|/·（()]", _normalized(role))
            if _normalized(item)
        ]
        organization_parts = [
            item for item in role_parts
            if any(marker in item for marker in ("事业部", "业务", "电商", "两轮车", "青桔", "抖音", "TikTok"))
        ]
        business = organization_parts[0] if organization_parts else ""
    if not business:
        return "company_role"
    haystack = _normalized(f"{title} {text}").casefold()
    markers = [business, business.replace("事业部", "").strip()]
    if "两轮车" in f"{business} {role}":
        markers.extend(["两轮车", "青桔"])
    return "same_business_role" if any(marker and marker.casefold() in haystack for marker in markers) else "company_role"


_INTERVIEW_SIGNALS = (
    "面经", "面试", "一面", "二面", "三面", "终面", "hr面", "面试官", "复盘", "追问",
    "自我介绍", "群面", "case", "简历深挖", "反问", "录用通知", "面试问题",
    "凉经", "offer", "已oc", "面试录音",
)

_DISCOVERY_NEGATIVE_SIGNALS = (
    "求问", "求面经", "有无面经", "招聘", "招继任", "急招", "招实习生",
    "工作强度", "实习日记", "入职日记", "意向通知", "offer帮选", "期待你的加入",
)


def _candidate_relevance(
    company: str,
    business_unit: str,
    role: str,
    title: str,
    snippet: str = "",
) -> bool:
    """Reject loosely related search cards before expensive page capture.

    Xiaohongshu search can return hundreds of company-wide recruiting and
    internship cards for one precise role query. This gate has no count cap:
    every candidate is considered, but only cards whose visible title/snippet
    contains an interview signal, the requested function, and a company or
    business-line marker proceed to reading.
    """

    haystack = _normalized(f"{title} {snippet}").casefold()
    if not haystack or any(marker.casefold() in haystack for marker in _DISCOVERY_NEGATIVE_SIGNALS):
        return False
    if not any(marker.casefold() in haystack for marker in _INTERVIEW_SIGNALS):
        return False

    company_exact = _normalized(company).casefold()
    company_short = re.sub(r"(?:出行|科技|集团|有限公司)$", "", company_exact).strip()
    brand_aliases = {
        "字节跳动": ["字节", "抖音", "bytedance", "tiktok"],
        "阿里巴巴": ["阿里"],
        "滴滴出行": ["滴滴", "青桔"],
        "小红书": ["xhs"],
    }
    company_markers = [
        item.casefold()
        for item in (company_exact, company_short, *brand_aliases.get(company_exact, []))
        if len(item) >= 2
    ]

    role_exact = _normalized(role)
    role_parts = [
        _normalized(item)
        for item in re.split(r"[-—–|/·（()]", role_exact)
        if _normalized(item)
    ]
    business = _normalized(business_unit)
    if not business and len(role_parts) > 1:
        organization_parts = [
            item for item in role_parts
            if any(marker in item for marker in ("事业部", "业务", "电商", "两轮车", "青桔", "抖音", "TikTok"))
        ]
        business = organization_parts[0] if organization_parts else ""
    business_markers = [business, business.replace("事业部", "").strip()]
    if "两轮车" in f"{business} {role_exact}":
        business_markers.extend(["两轮车", "青桔"])
    if "抖音" in f"{business} {role_exact}":
        business_markers.append("抖音")
    business_markers = [item.casefold() for item in business_markers if len(item) >= 2]

    role_haystack = re.sub(r"\s+", "", haystack)
    compact_role = re.sub(r"\s+", "", role_exact).casefold()
    if "策略运营" in compact_role or "运营策略" in compact_role:
        function_match = (
            "策略运营" in role_haystack
            or "运营策略" in role_haystack
            or ("策略" in role_haystack and "运营" in role_haystack)
        )
    elif "数据分析" in compact_role or "数据科学" in compact_role:
        function_match = any(marker in role_haystack for marker in ("数据分析", "数据科学", "数分", "商业分析"))
    elif "ai产品" in compact_role or "人工智能产品" in compact_role:
        function_match = any(marker in role_haystack for marker in ("ai产品", "人工智能产品", "产品经理"))
    elif "产品" in compact_role:
        function_match = "产品" in role_haystack
    elif "运营" in compact_role:
        function_match = "运营" in role_haystack
    else:
        functional_parts = [
            item.casefold()
            for item in role_parts
            if not any(marker in item for marker in ("事业部", "业务", "电商", "两轮车", "青桔", "抖音"))
        ]
        function_match = any(len(item) >= 2 and item in haystack for item in functional_parts)

    scope_match = any(item in haystack for item in company_markers) or any(
        item in haystack for item in business_markers
    )
    return bool(function_match and scope_match)


def _interview_content_score(title: str, text: str) -> int:
    haystack = _normalized(f"{title} {text}").casefold()
    score = sum(2 for marker in _INTERVIEW_SIGNALS if marker.casefold() in haystack)
    if "小红书" in haystack:
        score += 1
    if len(haystack) >= 180:
        score += 1
    if len(haystack) >= 500:
        score += 1
    if any(marker in haystack for marker in ("sql刷题", "课程目录", "软件下载", "隐私政策", "社区公约")):
        score -= 3
    return score


def _usable_interview_content(title: str, text: str, *, trusted_note: bool = False) -> bool:
    normalized = _normalized(text)
    blocked_page = _normalized(f"{title} {normalized}").casefold()
    if any(marker in blocked_page for marker in (
        "你访问的页面不见了",
        "当前笔记暂时无法浏览",
        "页面不存在",
        "error_msg=",
        "redirectpath=",
        "扫码登录",
        "登录后查看",
    )):
        return False
    if len(normalized) < 120:
        return False
    return trusted_note or _interview_content_score(title, normalized) >= 3


def _source_payload(source: InterviewSource, *, include_text: bool = False) -> dict[str, Any]:
    payload = {
        "id": source.id,
        "job_id": source.job_id,
        "platform": source.platform,
        "company": source.company,
        "business_unit": source.business_unit,
        "role": source.role,
        "title": source.title,
        "source_url": source.source_url,
        "author": source.author,
        "published_at": source.published_at or _xiaohongshu_note_published_at(source.source_url),
        "summary": source.summary,
        "questions": source.extracted_questions,
        "tags": source.tags,
        "status": source.status,
        "metadata_json": source.metadata_json or {},
        "created_at": source.created_at.isoformat(),
        "updated_at": source.updated_at.isoformat(),
    }
    if include_text:
        payload["raw_text"] = source.raw_text
    else:
        payload["text_preview"] = source.raw_text[:800]
    return payload


def register_interview_tools(
    gateway: ToolGateway,
    *,
    web_client: WebClient | None = None,
    firecrawl_client: FirecrawlClient | None = None,
    browser_client: BrowserBridgeClient | None = None,
    xhs_connector: Any | None = None,
) -> ToolGateway:
    web = web_client or WebClient()
    firecrawl = firecrawl_client or FirecrawlClient(web_client=web)
    browser = browser_client or BrowserBridgeClient(web_client=web)
    # Kept as a compatibility-only keyword for older callers. Account-bound
    # Xiaohongshu sessions are intentionally not used by the interview tools.
    del xhs_connector
    stages = set(PipelineStage) - {PipelineStage.FROZEN, PipelineStage.CANCELLED, PipelineStage.FAILED, PipelineStage.BLOCKED}

    def search_knowledge(context: ToolContext, payload: SearchInterviewKnowledgeInput) -> PipelineToolResult:
        rows = list(context.session.scalars(
            select(InterviewSource).where(
                InterviewSource.candidate_id == context.run.candidate_id,
            )
        ).all())
        needles = [item.casefold() for item in [payload.company, payload.role, payload.business_unit, payload.query] if _normalized(item)]

        def score(item: InterviewSource) -> int:
            searchable = " ".join([
                item.company, item.role, item.business_unit or "", item.title, item.summary,
                " ".join(item.tags or []),
                " ".join(str(question.get("question") or "") for question in (item.extracted_questions or [])),
            ]).casefold()
            if not _candidate_relevance(payload.company, payload.business_unit, payload.role,
                                        f"{item.company} {item.role} {item.title}", "面经"):
                return 0
            total = sum(3 if needle in {item.company.casefold(), item.role.casefold()} else 1 for needle in needles if needle in searchable)
            if item.status == "analyzed":
                total += 1
            return total

        ranked = sorted(
            ((score(item), item) for item in rows),
            key=lambda pair: (pair[0], _source_timestamp(pair[1]), pair[1].updated_at),
            reverse=True,
        )
        matches = [item for item_score, item in ranked if item_score > 0]
        if payload.max_results is not None:
            matches = matches[:payload.max_results]
        analyzed = [item for item in matches if item.status == "analyzed" and item.extracted_questions]
        nowcoder_count = sum(1 for item in analyzed if item.platform == "nowcoder")
        ready_for_brief = len(analyzed) >= INTERVIEW_SOURCE_MINIMUM and nowcoder_count > 0
        return _result(
            context,
            (
                f"已检索本地面试知识库，找到 {len(matches)} 篇相关来源，其中 {len(analyzed)} 篇已完成正文与引文核验。"
                + (
                    "已有足够证据，请直接聚类这些来源的问题并调用 build_interview_brief；不要重新抓取，也不要用进度说明结束任务。"
                    if ready_for_brief
                    else "本地证据不足，请继续发现并读取小红书主来源，再补充牛客等公开面经来源。"
                )
            ),
            artifacts=[f"interview_source:{item.id}" for item in matches],
            data={
                "sources": [_source_payload(item) for item in matches],
                "total_library_sources": len(rows),
                "analyzed_source_count": len(analyzed),
                "nowcoder_source_count": nowcoder_count,
                "needs_nowcoder_discovery": nowcoder_count == 0,
                "ready_source_ids": [item.id for item in analyzed],
                "ready_for_brief": ready_for_brief,
                "required_next_action": "build_interview_brief" if ready_for_brief else "discover_interview_sources",
            },
        )

    def discover_sources(context: ToolContext, payload: DiscoverInterviewSourcesInput) -> PipelineToolResult:
        platforms = set(payload.platforms)
        scope = " ".join(_normalized(item) for item in [payload.company, payload.business_unit] if _normalized(item))
        role_variants = _role_search_variants(payload.role, payload.query_terms)
        site_search_plan = _xiaohongshu_search_plan(
            payload.company,
            payload.business_unit,
            payload.role,
            payload.query_terms,
        )
        site_search_phrases = [item["query"] for item in site_search_plan]
        queries: list[str] = []
        for role_term in role_variants if PRIMARY_INTERVIEW_PLATFORM in platforms else []:
            queries.extend([
                f"site:xiaohongshu.com {scope} {role_term} 面经",
                f"{scope} {role_term} 面经 小红书",
                f"{scope} {role_term} 面试经验 小红书",
                f"site:xhslink.com {scope} {role_term} 面经",
            ])
        queries = list(dict.fromkeys(_normalized(item) for item in queries if _normalized(item)))[:16]
        found: list[WebSearchResult] = []
        seen: set[str] = set()
        providers: list[str] = []
        public_access_stopped = False
        public_access_reason = ""
        public_access_detail = ""
        attempted_site_searches: list[str] = []
        candidate_access_grants = 0
        observed_search_paths: list[str] = []
        account_session_used = False
        rejected_irrelevant_count = 0

        result_scopes: dict[str, str] = {}
        result_platforms: dict[str, str] = {}
        # Older clients used max_results as a total cap (usually 10). That
        # prematurely stopped Xiaohongshu discovery and prevented supplemental
        # communities from being searched. Keep accepting the field for wire
        # compatibility, but never truncate the combined discovery set by it.
        result_limit = None
        scope_limits: dict[str, int] | None = None
        scope_counts = {"same_business_role": 0, "company_role": 0}

        def at_result_limit() -> bool:
            return result_limit is not None and len(found) >= result_limit

        def append_result(
            item: WebSearchResult,
            *,
            platform: str,
            coverage_scope: str,
        ) -> bool:
            nonlocal rejected_irrelevant_count
            if not _candidate_relevance(
                payload.company,
                payload.business_unit,
                payload.role,
                item.title,
                item.snippet,
            ):
                rejected_irrelevant_count += 1
                return False
            canonical = _canonical_interview_url(web, item.url)
            if canonical in seen or not _is_supported_interview_candidate(canonical):
                return False
            if scope_limits is not None and scope_counts[coverage_scope] >= scope_limits[coverage_scope]:
                return False
            seen.add(canonical)
            found.append(WebSearchResult(title=item.title, url=canonical, snippet=item.snippet))
            result_scopes[canonical] = coverage_scope
            result_platforms[canonical] = platform
            scope_counts[coverage_scope] += 1
            return True

        # Xiaohongshu's own search response is the primary discovery surface:
        # it returns real note IDs plus short-lived access grants that make the
        # subsequent hidden read reliable. Search the exact business-unit role
        # first, then broaden to the same role across the company.
        if browser.configured and PRIMARY_INTERVIEW_PLATFORM in platforms:
            for search_entry in site_search_plan[:2]:
                search_phrase = search_entry["query"]
                if not search_phrase or search_phrase in attempted_site_searches:
                    continue
                attempted_site_searches.append(search_phrase)
                # Xiaohongshu canonicalizes the search route to a trailing
                # slash. Request that form directly: the non-slash route may
                # answer with an HTTP downgrade redirect, which the isolated
                # browser intentionally blocks.
                search_url = f"https://www.xiaohongshu.com/search_result/?keyword={quote(search_phrase)}&source=web_search_result_notes"
                try:
                    state = browser.open(search_url)
                except HarnessError as exc:
                    public_access_reason = exc.code
                    public_access_detail = exc.message
                    if exc.code in {"xiaohongshu_public_access_cooldown", "xiaohongshu_public_access_limit", "browser_busy", "browser_bridge_failed"}:
                        public_access_stopped = True
                        break
                    continue
                candidates = state.get("candidates") or []
                account_session_used = account_session_used or bool(state.get("account_session"))
                candidate_access_grants += max(0, int(state.get("candidate_access_grants") or 0))
                observed_search_paths.extend(str(item) for item in (state.get("observed_search_paths") or []))
                for item in candidates:
                    url = web.redact_url(str(item.get("url") or "")) if isinstance(item, dict) else ""
                    append_result(
                        WebSearchResult(title=str(item.get("title") or url)[:500], url=url),
                        platform=PRIMARY_INTERVIEW_PLATFORM,
                        coverage_scope=_coverage_scope(
                            payload.business_unit,
                            payload.role,
                            str(item.get("title") or ""),
                            "",
                        ),
                    )
                    if at_result_limit():
                        break
                if candidates:
                    providers.append("xiaohongshu-session-browser" if state.get("account_session") else "xiaohongshu-anonymous-browser")
                if state.get("login_required") or state.get("cooldown_until"):
                    # Public cards can render before a login overlay appears.
                    # Keep those candidate URLs for later strict capture, but
                    # stop further browsing and never attempt to authenticate.
                    public_access_stopped = True
                    public_access_reason = str(state.get("user_action") or ("xiaohongshu_public_access_cooldown" if state.get("cooldown_until") else "login_required"))
                    break
                if state.get("discovery_exhausted") is False:
                    public_access_reason = str(state.get("discovery_stop_reason") or "page_budget")
                    break
                if at_result_limit():
                    break

        # Public search is a URL-discovery fallback only. Its snippets never
        # become evidence, and every returned note still has to pass capture.
        if not at_result_limit():
            for query in queries:
                results: list[WebSearchResult] = []
                if firecrawl.configured:
                    try:
                        results = firecrawl.search(query, max_results=8)
                        if results:
                            providers.append("firecrawl-public-search")
                    except HarnessError:
                        results = []
                if not results:
                    try:
                        results = web.search(query, max_results=8)
                        if results:
                            providers.append("public-search")
                    except HarnessError:
                        results = []
                for item in results:
                    canonical = _canonical_xiaohongshu_url(web, item.url)
                    append_result(
                        WebSearchResult(title=item.title, url=canonical, snippet=item.snippet),
                        platform=PRIMARY_INTERVIEW_PLATFORM,
                        coverage_scope=_coverage_scope(
                            payload.business_unit,
                            payload.role,
                            item.title,
                            item.snippet,
                        ),
                    )
                    if at_result_limit():
                        break
                if at_result_limit():
                    break

        # Xiaohongshu remains the primary corpus. Once its own search and
        # public URL discovery are exhausted, add independently readable
        # interview reports from specialist communities for corroboration.
        supplemental_queries: list[str] = []
        for role_term in role_variants:
            supplemental_queries.extend([
                f"site:nowcoder.com/discuss {scope} {role_term} 面经",
                f"site:nowcoder.com {scope} {role_term} 面试经验",
                f"site:zhihu.com {scope} {role_term} 面经",
                f"site:blog.csdn.net {scope} {role_term} 面经",
            ])
        supplemental_queries = list(dict.fromkeys(
            _normalized(item) for item in supplemental_queries if _normalized(item)
        ))
        attempted_supplemental_searches: list[str] = []
        attempted_nowcoder_searches: list[str] = []
        nowcoder_pages: list[dict[str, Any]] = []
        nowcoder_continuations: list[dict[str, Any]] = []
        nowcoder_stop_reason = ""
        direct_nowcoder_count = 0
        if not at_result_limit():
            company_search = re.sub(r"(?:出行|科技|集团|有限公司)$", "", _normalized(payload.company)).strip() or _normalized(payload.company)
            nowcoder_terms = list(dict.fromkeys(
                [f"{scope} {role_variants[0]} 面经"]
                + [f"{company_search} {term} 面经" for term in role_variants]
            )) if "nowcoder" in platforms else []
            if payload.nowcoder_query and "nowcoder" in platforms:
                nowcoder_terms = [_normalized(payload.nowcoder_query)]
            deadline = time.monotonic() + 60
            last_request_at = 0.0
            for term in nowcoder_terms:
                normalized_term = _normalized(term)
                if nowcoder_stop_reason:
                    nowcoder_continuations.append({"query": normalized_term, "page": payload.nowcoder_start_page})
                    continue
                attempted_nowcoder_searches.append(normalized_term)
                next_url = f"https://www.nowcoder.com/search/all?query={quote(normalized_term)}&type=all&page={payload.nowcoder_start_page}"
                page_fingerprints: set[tuple[str, ...]] = set()
                for offset in range(payload.nowcoder_page_limit):
                    requested_page = payload.nowcoder_start_page + offset
                    if time.monotonic() >= deadline:
                        nowcoder_stop_reason = "time_budget"
                        nowcoder_continuations.append({"query": normalized_term, "page": requested_page})
                        break
                    try:
                        pause = 0.6 - (time.monotonic() - last_request_at)
                        if pause > 0:
                            time.sleep(pause)
                        last_request_at = time.monotonic()
                        page = web.read_page(next_url, max_chars=50000)
                    except HarnessError as exc:
                        nowcoder_pages.append({"query": normalized_term, "page": requested_page, "status": exc.code})
                        nowcoder_continuations.append({"query": normalized_term, "page": requested_page})
                        nowcoder_stop_reason = "request_failed"
                        break
                    site = page.site_metadata or {}
                    if any(marker in page.text[:1500] for marker in ["安全验证", "请输入验证码", "访问过于频繁", "访问异常"]):
                        nowcoder_stop_reason = "access_protection"
                        nowcoder_pages.append({"query": normalized_term, "page": requested_page, "status": nowcoder_stop_reason})
                        break
                    fingerprint = tuple(sorted({canonical_nowcoder_url(str(item.get("url") or "")) for item in page.links} - {""}))
                    if fingerprint and fingerprint in page_fingerprints:
                        nowcoder_pages.append({"query": normalized_term, "page": requested_page, "status": "repeated_page"})
                        nowcoder_continuations.append({"query": normalized_term, "page": requested_page})
                        break
                    page_fingerprints.add(fingerprint)
                    added_this_page = 0
                    for item in page.links:
                        item_url = str(item.get("url") or "")
                        if not canonical_nowcoder_url(item_url):
                            continue
                        title = str(item.get("title") or item_url)[:500]
                        snippet = str(item.get("snippet") or "")
                        if append_result(WebSearchResult(title=title, url=item_url, snippet=snippet), platform="nowcoder",
                                         coverage_scope=_coverage_scope(payload.business_unit, payload.role, title, snippet)):
                            added_this_page += 1
                            direct_nowcoder_count += 1
                    nowcoder_pages.append({"query": normalized_term, "page": requested_page, "status": "read", "candidate_count": added_this_page})
                    if added_this_page:
                        providers.append("nowcoder-site-search")
                    next_url = site.get("next_url") or ""
                    if not next_url:
                        if site.get("extraction") == "unrecognized":
                            nowcoder_pages[-1]["status"] = "unrecognized_page"
                            nowcoder_continuations.append({"query": normalized_term, "page": requested_page})
                        break
                    if offset == payload.nowcoder_page_limit - 1:
                        nowcoder_continuations.append({"query": normalized_term, "page": requested_page + 1})

            for query in supplemental_queries:
                if not any(f"site:{domain}" in query for platform, domain in [("nowcoder", "nowcoder.com"), ("zhihu", "zhihu.com"), ("csdn", "blog.csdn.net")] if platform in platforms):
                    continue
                attempted_supplemental_searches.append(query)
                results: list[WebSearchResult] = []
                if firecrawl.configured:
                    try:
                        results = firecrawl.search(query, max_results=8)
                        if results:
                            providers.append("firecrawl-supplemental-search")
                    except HarnessError:
                        results = []
                if not results:
                    try:
                        results = web.search(query, max_results=8)
                        if results:
                            providers.append("public-supplemental-search")
                    except HarnessError:
                        results = []
                for item in results:
                    platform = _interview_platform(item.url)
                    if platform not in SUPPLEMENTAL_INTERVIEW_PLATFORMS or platform not in platforms:
                        continue
                    append_result(
                        item,
                        platform=platform,
                        coverage_scope=_coverage_scope(
                            payload.business_unit,
                            payload.role,
                            item.title,
                            item.snippet,
                        ),
                    )
                    if at_result_limit():
                        break
                if at_result_limit():
                    break

        found.sort(
            key=lambda item: (
                1 if result_platforms.get(item.url) == PRIMARY_INTERVIEW_PLATFORM else 0,
                1 if result_scopes.get(item.url) == "same_business_role" else 0,
                _xiaohongshu_note_timestamp(item.url),
            ),
            reverse=True,
        )
        grouped_results = [
            {
                "title": item.title,
                "url": item.url,
                "platform": result_platforms.get(item.url, _interview_platform(item.url)),
                "scope": result_scopes.get(item.url, "company_role"),
                "published_at": _xiaohongshu_note_published_at(item.url),
            }
            for item in found
        ]
        xhs_count = sum(1 for item in found if result_platforms.get(item.url) == PRIMARY_INTERVIEW_PLATFORM)
        supplemental_count = len(found) - xhs_count
        return _result(
            context,
            (
                f"本轮发现 {xhs_count} 个小红书候选来源，以及 "
                f"{supplemental_count} 个牛客等补充来源；每个链接仍需读取正文并通过有效性校验。"
                if found
                else "本轮检索暂未取回可直接读取的公开面经链接；这不代表公开渠道不存在相关内容，应继续扩展岗位称谓或读取用户提供的分享链接。"
            ),
            artifacts=[f"url:{item.url}" for item in found],
            data={
                "company": payload.company,
                "business_unit": payload.business_unit,
                "role": payload.role,
                "role_variants": role_variants,
                "queries": queries,
                "site_searches": attempted_site_searches,
                "supplemental_searches": attempted_supplemental_searches,
                "nowcoder_site_searches": attempted_nowcoder_searches,
                "nowcoder_pages": nowcoder_pages,
                "nowcoder_continuations": nowcoder_continuations,
                "nowcoder_stop_reason": nowcoder_stop_reason,
                "requested_platforms": payload.platforms,
                "nowcoder_site_source_count": direct_nowcoder_count,
                "site_search_candidates": site_search_phrases,
                "search_plan": site_search_plan,
                "candidate_access_grants": candidate_access_grants,
                "observed_search_paths": list(dict.fromkeys(observed_search_paths))[:20],
                "providers": list(dict.fromkeys(providers)),
                "results": [{
                    "title": item.title,
                    "url": item.url,
                    "platform": result_platforms.get(item.url, _interview_platform(item.url)),
                    "scope": result_scopes.get(item.url, "company_role"),
                    "published_at": _xiaohongshu_note_published_at(item.url),
                } for item in found],
                "grouped_results": grouped_results,
                "anonymous_public_mode": not account_session_used,
                "account_session_used": account_session_used,
                "public_access_stopped": public_access_stopped,
                "public_access_reason": public_access_reason,
                "public_access_detail": public_access_detail,
                "result_limit": None,
                "legacy_requested_limit": payload.max_results,
                "discovery_exhausted": not public_access_stopped and not public_access_reason and not nowcoder_continuations and not nowcoder_stop_reason,
                "primary_platform": PRIMARY_INTERVIEW_PLATFORM,
                "primary_source_count": xhs_count,
                "supplemental_source_count": supplemental_count,
                "rejected_irrelevant_count": rejected_irrelevant_count,
                "minimum_sufficient_sources": INTERVIEW_SOURCE_MINIMUM,
                "fallback": "继续扩展相邻岗位称谓；也可读取用户粘贴的公开分享链接" if not found else "",
            },
        )

    def capture_source(context: ToolContext, payload: CaptureInterviewSourceInput) -> PipelineToolResult:
        normalized_input = (
            _normalized_xiaohongshu_url(payload.url)
            if _is_xiaohongshu_url(payload.url)
            else _normalized(payload.url)
        )
        target = web.validate_url(normalized_input, preserve_fragment=True)
        platform = _interview_platform(target)
        if not _is_supported_interview_candidate(target):
            raise HarnessError(
                "interview_source_platform_invalid",
                "当前面试调研工具接收小红书公开笔记、牛客面经、知乎回答或 CSDN 面经文章链接",
            )
        is_xhs = platform == PRIMARY_INTERVIEW_PLATFORM
        job = context.session.get(Job, context.run.job_id) if context.run.job_id else None
        company = _normalized(payload.company) or (job.company if job else "")
        role = _normalized(payload.role) or (job.role if job else "")
        if not company or not role:
            raise HarnessError("interview_source_scope_missing", "保存面经前需要公司和岗位信息")

        submitted_url = web.redact_url(target)
        canonical = _canonical_interview_url(web, submitted_url)
        url_hash = sha256(canonical.encode("utf-8")).hexdigest()
        existing = context.session.scalar(select(InterviewSource).where(InterviewSource.candidate_id == context.run.candidate_id, InterviewSource.url_hash == url_hash))
        if existing is not None and existing.raw_text:
            if existing.platform == PRIMARY_INTERVIEW_PLATFORM:
                existing.published_at = existing.published_at or _xiaohongshu_note_published_at(existing.source_url)
            if not (existing.metadata_json or {}).get("coverage_scope"):
                existing.metadata_json = {
                    **(existing.metadata_json or {}),
                    "coverage_scope": _coverage_scope(
                        _normalized(payload.business_unit),
                        role,
                        existing.title,
                        existing.raw_text,
                    ),
                }
                context.session.flush()
            return _result(context, "该面经已存在于本地知识库，直接复用已有内容。", artifacts=[f"interview_source:{existing.id}", f"url:{existing.source_url}"], data={"source": _source_payload(existing, include_text=True), "duplicate": True})

        title = ""
        text = ""
        provider = ""
        metadata: dict[str, Any] = {
            "submitted_url": submitted_url,
            "anonymous_public_mode": True,
            "account_session_used": False,
        }
        browser_login_required = False

        # XHS has one shared admission boundary; do not bypass it with HTTP
        # or another crawler after a browser restriction.
        if is_xhs and not browser.configured:
            raise HarnessError("interview_source_public_access_stopped", "小红书读取需要受控浏览器；已停止该来源，可继续使用牛客与本地知识库。")
        if not is_xhs:
            try:
                page = web.read_page(target, max_chars=50000)
                canonical = _canonical_interview_url(web, page.final_url or target)
                carousel_counts = [int(item) for item in re.findall(r"\b\d+\s*/\s*(\d+)\b", page.text) if item.isdigit()]
                image_count = max([len(page.images), *carousel_counts], default=0)
                metadata.update({
                    "published_at": (page.site_metadata or {}).get("published_at", ""),
                    "extraction": (page.site_metadata or {}).get("extraction", ""),
                    "description": page.description,
                    "headings": page.headings,
                    "content_type": page.content_type,
                    "image_count": image_count,
                    "image_evidence_pending": image_count > 0,
                })
                if _is_supported_interview_candidate(canonical) and _usable_interview_content(page.title, page.text):
                    title, text, provider = page.title, page.text, "built-in-public"
            except HarnessError as exc:
                if platform == "nowcoder" and exc.details.get("status") in {401, 403, 429}:
                    raise HarnessError("interview_source_public_access_stopped", "牛客要求登录或限制访问，已停止读取该来源。", retryable=True) from exc

        if not _usable_interview_content(title, text) and firecrawl.configured and not is_xhs and platform != "nowcoder":
            try:
                crawled = firecrawl.scrape(target)
                crawled_url = _canonical_interview_url(web, str((crawled.metadata or {}).get("source_url") or target))
                if _is_supported_interview_candidate(crawled_url) and _usable_interview_content(crawled.title, crawled.text):
                    canonical = crawled_url
                    title, text, provider = crawled.title, crawled.text, "firecrawl-public"
                    metadata = {**metadata, **crawled.metadata}
            except HarnessError:
                pass

        # XHS reads only use the shared public browser guard and encrypted cache.
        # Other sites may use this browser as a fallback.
        if not _usable_interview_content(title, text) and browser.configured:
            try:
                state = browser.open(target)
                browser_login_required = bool(state.get("login_required"))
                account_session_used = bool(state.get("account_session"))
                rendered = str(state.get("text") or "").strip()
                rendered_title = str(state.get("title") or "").strip()
                canonical = _canonical_interview_url(web, str(state.get("url") or target))
                image_count = max(0, int(state.get("image_count") or 0))
                metadata.update({
                    "description": str(state.get("description") or "")[:1000],
                    "content_type": "text/html; rendered",
                    "ocr_status": str(state.get("ocr_status") or "not_attempted"),
                    "ocr_text": str(state.get("ocr_text") or "")[:12000],
                    "ocr_images_processed": int(state.get("ocr_images_processed") or 0),
                    "ocr_job_id": str(state.get("ocr_job_id") or ""),
                    "ocr_images_saved": int(state.get("ocr_images_saved") or 0),
                    "ocr_capture_method": str(state.get("ocr_capture_method") or ""),
                    "image_count": image_count,
                    "image_evidence_pending": image_count > 0,
                    "page_kind": str(state.get("page_kind") or ""),
                    "cache_hit": bool(state.get("cache_hit")),
                    "remaining_requests": state.get("remaining_requests"),
                    "published_at": str(state.get("published_at") or "")[:80],
                    "anonymous_public_mode": not account_session_used,
                    "account_session_used": account_session_used,
                })
                trusted = bool(state.get("note_ready")) if is_xhs else False
                if is_xhs and not browser_login_required and (len(metadata.get("ocr_text", "")) >= 80 or metadata.get("ocr_images_saved", 0) > 0):
                    title, text, provider = rendered_title, rendered, "xiaohongshu-browser-ocr-pending"
                if _is_supported_interview_candidate(canonical) and not browser_login_required and _usable_interview_content(rendered_title, rendered, trusted_note=trusted):
                    title = rendered_title
                    text = rendered
                    provider = (
                        "xiaohongshu-session-browser" if account_session_used
                        else "xiaohongshu-anonymous-browser" if is_xhs
                        else "isolated-browser"
                    )
            except HarnessError as exc:
                metadata["public_access_reason"] = exc.code
                if is_xhs:
                    raise HarnessError("interview_source_public_access_stopped", "小红书访问已暂停；请复用已保存正文并继续读取牛客来源。", details={"reason": exc.code, **exc.details}) from exc

        text = _normalized(text)[:50000]
        ocr_pending = not _usable_interview_content(title, text) and (len(metadata.get("ocr_text", "")) >= 80 or metadata.get("ocr_images_saved", 0) > 0)
        if not _usable_interview_content(title, text) and not ocr_pending:
            if browser_login_required:
                raise HarnessError(
                    "interview_source_public_access_stopped",
                    "页面要求登录或触发验证，FetchCV 已停止读取；可在面经页连接小红书并手动登录。验证码或限流冷却结束前不要重试。",
                    retryable=False,
                )
            raise HarnessError(
                "interview_source_unreadable",
                "未能读取这篇面经正文；已排除失效页、搜索页、导航页和无关长文本，该链接不会进入最终面试简报",
                retryable=True,
            )

        canonical = _canonical_interview_url(web, canonical or target)
        final_hash = sha256(canonical.encode("utf-8")).hexdigest()
        if final_hash != url_hash:
            canonical_existing = context.session.scalar(select(InterviewSource).where(InterviewSource.candidate_id == context.run.candidate_id, InterviewSource.url_hash == final_hash))
            if canonical_existing is not None and canonical_existing.raw_text:
                if canonical_existing.platform == PRIMARY_INTERVIEW_PLATFORM:
                    canonical_existing.published_at = canonical_existing.published_at or _xiaohongshu_note_published_at(canonical_existing.source_url)
                if not (canonical_existing.metadata_json or {}).get("coverage_scope"):
                    canonical_existing.metadata_json = {
                        **(canonical_existing.metadata_json or {}),
                        "coverage_scope": _coverage_scope(
                            _normalized(payload.business_unit),
                            role,
                            canonical_existing.title,
                            canonical_existing.raw_text,
                        ),
                    }
                    context.session.flush()
                return _result(context, "该面经已存在于本地知识库，直接复用已有内容。", artifacts=[f"interview_source:{canonical_existing.id}", f"url:{canonical_existing.source_url}"], data={"source": _source_payload(canonical_existing, include_text=True), "duplicate": True})
            url_hash = final_hash

        source = existing or InterviewSource(candidate_id=context.run.candidate_id, url_hash=url_hash)
        source.url_hash = url_hash
        source.job_id = context.run.job_id
        source.platform = platform
        source.company = company
        source.business_unit = _normalized(payload.business_unit) or None
        source.role = role
        source.title = _normalized(title)[:500] or f"{platform} 面试经验"
        source.source_url = canonical
        source.published_at = (
            _normalized(str(metadata.get("published_at") or ""))[:80]
            or source.published_at
            or (_xiaohongshu_note_published_at(canonical) if is_xhs else "")
            or None
        )
        source.raw_text = text
        source.content_hash = sha256(text.encode("utf-8")).hexdigest()
        source.status = "ocr_pending" if ocr_pending else "captured"
        source.metadata_json = {
            **metadata,
            "provider": provider,
            "link_status": "verified",
            "source_role": "primary" if is_xhs else "supplemental",
            "coverage_scope": _coverage_scope(
                _normalized(payload.business_unit),
                role,
                source.title,
                text,
            ),
        }
        if existing is None:
            context.session.add(source)
        context.session.flush()
        image_note = f"；另检测到 {metadata.get('image_count', 0)} 张图片，图片中的问题尚需 OCR 后才能作为引文" if metadata.get("image_count") else ""
        platform_label = {
            "xiaohongshu": "小红书",
            "nowcoder": "牛客",
            "zhihu": "知乎",
            "csdn": "CSDN",
        }.get(platform, platform)
        return _result(
            context,
            "已保存可见图片 OCR，需核对后才能作为面试问题证据。" if ocr_pending else f"已验证链接并保存一篇{platform_label}面试经验，等待提取具体问题{image_note}。",
            artifacts=[f"interview_source:{source.id}", f"url:{canonical}"],
            data={
                "source": _source_payload(source, include_text=True),
                "duplicate": False,
                "image_evidence_pending": bool(metadata.get("image_evidence_pending")),
                "image_count": int(metadata.get("image_count") or 0),
            },
        )

    def collect_ocr(context: ToolContext, payload: CollectInterviewOcrInput) -> PipelineToolResult:
        source = context.session.get(InterviewSource, payload.source_id)
        if source is None or source.candidate_id != context.run.candidate_id:
            raise HarnessError("interview_source_not_found", "面经来源不存在或不属于当前资料库")
        metadata = dict(source.metadata_json or {})
        job_id = str(metadata.get("ocr_job_id") or "")
        if not re.fullmatch(r"[a-f0-9]{64}", job_id):
            raise HarnessError("interview_ocr_unavailable", "该来源没有本地 OCR 任务")
        result = browser.command("ocr_result", job_id=job_id)
        pages = result.get("pages") or []
        metadata.update({"ocr_status": result.get("status", "unknown"), "ocr_pages": pages,
                         "ocr_images_processed": result.get("completed", 0),
                         "ocr_text": "\n\n".join(f"[图片 {page['index']}]\n{page.get('text', '')}" for page in pages if page and page.get("text"))[:50000]})
        source.metadata_json = metadata
        context.session.flush()
        return _result(context, "已读取本地 OCR 进度；识别文本仍需核对，未访问原站。", data={"source": _source_payload(source, include_text=True), "ocr_status": metadata["ocr_status"]})

    def analyze_source(context: ToolContext, payload: AnalyzeInterviewSourceInput) -> PipelineToolResult:
        source = context.session.get(InterviewSource, payload.source_id)
        if source is None or source.candidate_id != context.run.candidate_id:
            raise HarnessError("interview_source_not_found", "面经来源不存在或不属于当前资料库")
        if source.status == "ocr_pending":
            raise HarnessError("interview_source_ocr_pending", "图片 OCR 尚未核对，不能自动作为已验证问题证据")
        normalized_text = _normalized(source.raw_text)
        verified_questions = []
        rejected = 0
        for item in payload.questions:
            quote_text = _normalized(item.evidence_quote)
            if quote_text not in normalized_text:
                rejected += 1
                continue
            verified_questions.append({**item.model_dump(mode="json"), "evidence_valid": True})
        source.summary = _normalized(payload.summary)
        source.extracted_questions = verified_questions
        source.tags = list(dict.fromkeys(_normalized(item)[:120] for item in payload.tags if _normalized(item)))
        source.status = "analyzed"
        source.metadata_json = {**(source.metadata_json or {}), "rejected_unverified_questions": rejected}
        context.session.flush()
        return _result(context, f"已从面经中提取 {len(verified_questions)} 个有原文依据的问题；{rejected} 个无对应引文的条目未入库。", artifacts=[f"interview_source:{source.id}"], data={"source": _source_payload(source), "rejected_count": rejected})

    def build_brief(context: ToolContext, payload: BuildInterviewBriefInput) -> PipelineToolResult:
        unique_ids = list(dict.fromkeys(payload.source_ids))
        sources = list(context.session.scalars(select(InterviewSource).where(InterviewSource.id.in_(unique_ids), InterviewSource.candidate_id == context.run.candidate_id)).all())
        source_by_id = {item.id: item for item in sources}
        if len(source_by_id) != len(unique_ids):
            raise HarnessError("interview_brief_source_scope_invalid", "简报引用了不存在或不属于当前资料库的来源")
        if any(item.status != "analyzed" for item in sources):
            raise HarnessError(
                "interview_brief_source_not_analyzed",
                "生成简报前必须先读取面经正文并完成逐字引文校验",
            )
        available_verified = [
            item
            for item in context.session.scalars(
                select(InterviewSource).where(
                    InterviewSource.candidate_id == context.run.candidate_id,
                    InterviewSource.status == "analyzed",
                )
            ).all()
            if _normalized(item.company).casefold() == _normalized(payload.company).casefold()
        ]
        available_primary = [
            item for item in available_verified if item.platform == PRIMARY_INTERVIEW_PLATFORM
        ]
        selected_primary = [
            item for item in sources if item.platform == PRIMARY_INTERVIEW_PLATFORM
        ]
        if available_primary and not selected_primary:
            raise HarnessError(
                "interview_brief_primary_source_required",
                "当前知识库已有已核验的小红书面经，本次简报必须把它们作为主来源；牛客等来源只能补充交叉验证。",
                retryable=True,
            )
        coverage_counts = {"same_business_role": 0, "company_role": 0}
        for source in sources:
            source.published_at = source.published_at or _xiaohongshu_note_published_at(source.source_url)
            coverage_scope = _coverage_scope(
                _normalized(payload.business_unit),
                _normalized(payload.role),
                source.title,
                source.raw_text,
            )
            coverage_counts[coverage_scope] += 1
            source.metadata_json = {
                **(source.metadata_json or {}),
                "coverage_scope": coverage_scope,
            }
        available_coverage = {"same_business_role": 0, "company_role": 0}
        for source in available_verified:
            available_coverage[
                _coverage_scope(
                    _normalized(payload.business_unit),
                    _normalized(payload.role),
                    source.title,
                    source.raw_text,
                )
            ] += 1
        if (
            available_primary
            and all(available_coverage.values())
            and not all(coverage_counts.values())
        ):
            missing = "同事业部同岗" if coverage_counts["same_business_role"] == 0 else "公司同岗或未注明事业部"
            raise HarnessError(
                "interview_brief_coverage_incomplete",
                f"知识库同时存在两层可用来源，但本次简报缺少“{missing}”来源。请从 ready_source_ids 补入该层来源后重新生成。",
                retryable=True,
            )
        sources.sort(
            key=lambda item: (
                1 if item.platform == PRIMARY_INTERVIEW_PLATFORM else 0,
                _source_timestamp(item),
            ),
            reverse=True,
        )
        unique_ids = [item.id for item in sources]
        supplemental_sources = [
            item for item in sources if item.platform != PRIMARY_INTERVIEW_PLATFORM
        ]
        evidence_status = (
            "sufficient"
            if len(sources) >= INTERVIEW_SOURCE_MINIMUM and bool(selected_primary)
            else "limited"
        )
        questions = []
        for item in payload.common_questions:
            source_ids = [source_id for source_id in dict.fromkeys(item.source_ids) if source_id in source_by_id]
            if not source_ids:
                continue
            questions.append({
                **item.model_dump(mode="json", exclude={"source_ids"}),
                "source_ids": source_ids,
                "frequency": len(source_ids),
                "confidence": "recurring" if len(source_ids) >= 2 else "single_source",
            })
        brief = InterviewBrief(
            candidate_id=context.run.candidate_id,
            job_id=context.run.job_id,
            run_id=context.run.id,
            company=_normalized(payload.company),
            business_unit=_normalized(payload.business_unit) or None,
            role=_normalized(payload.role),
            summary=_normalized(payload.summary),
            common_questions=questions,
            recommendations=[item.model_dump(mode="json") for item in payload.recommendations],
            source_ids=unique_ids,
            query_terms=list(dict.fromkeys(_normalized(item)[:160] for item in payload.query_terms if _normalized(item))),
            metadata_json={
                "recurring_question_count": sum(1 for item in questions if item["frequency"] >= 2),
                "primary_platform": PRIMARY_INTERVIEW_PLATFORM,
                "primary_source_count": len(selected_primary),
                "supplemental_source_count": len(supplemental_sources),
                "source_count": len(sources),
                "minimum_sufficient_sources": INTERVIEW_SOURCE_MINIMUM,
                "evidence_status": evidence_status,
                "coverage_counts": coverage_counts,
            },
        )
        context.session.add(brief)
        context.session.flush()
        coverage = "证据充分" if evidence_status == "sufficient" else f"证据有限，尚未达到 {INTERVIEW_SOURCE_MINIMUM} 篇最低交叉验证数量"
        return _result(
            context,
            (
                f"已生成面试情报简报：{len(questions)} 个问题、"
                f"{len(selected_primary)} 篇小红书主来源、{len(supplemental_sources)} 篇牛客等补充来源；{coverage}。"
            ),
            artifacts=[f"interview_brief:{brief.id}", *[f"url:{item.source_url}" for item in sources]],
            data={
                "brief_id": brief.id,
                "common_questions": questions,
                "recommendations": brief.recommendations,
                "sources": [_source_payload(item) for item in sources],
                "primary_platform": PRIMARY_INTERVIEW_PLATFORM,
                "primary_source_count": len(selected_primary),
                "supplemental_source_count": len(supplemental_sources),
                "source_count": len(sources),
                "evidence_status": evidence_status,
                "coverage_counts": coverage_counts,
            },
        )

    specs = (
        ToolSpec(name="collect_interview_ocr", description="读取已下载面经图片的本地 OCR 结果并更新快照，不访问原站。先批量采集其他帖子，再收集结果；queued/running 不应忙轮询。OCR 未核对前不能当作原文问题证据。", input_model=CollectInterviewOcrInput, output_model=PipelineToolResult, permission=ToolPermission.DRAFT_WRITE, allowed_stages=stages, handler=collect_ocr, read_only=False, side_effect=True),
        ToolSpec(name="search_interview_knowledge", description="先检索当前用户的本地面试知识库，复用同公司、业务线或相近岗位的已读面经与问题。开始任何面试调研前优先调用。", input_model=SearchInterviewKnowledgeInput, output_model=PipelineToolResult, permission=ToolPermission.READ, allowed_stages=stages, handler=search_knowledge, read_only=True),
        ToolSpec(name="discover_interview_sources", description="围绕公司、业务线和岗位持续发现公开面经。默认检索小红书后补充牛客、知乎和 CSDN；platforms 可设为 [nowcoder] 独立检索牛客。牛客返回分页记录和续查位置，达到页数或时间预算不代表耗尽。只返回候选来源，必须继续读取后才能据此总结。", input_model=DiscoverInterviewSourcesInput, output_model=PipelineToolResult, permission=ToolPermission.NETWORK_READ, allowed_stages=stages, handler=discover_sources, read_only=True),
        ToolSpec(name="capture_interview_source", description="读取一个小红书、牛客、知乎或 CSDN 的公开面经链接并将原文保存到本地知识库。重复链接会去重；404、登录、验证码或不可读页面不会伪装成成功。", input_model=CaptureInterviewSourceInput, output_model=PipelineToolResult, permission=ToolPermission.NETWORK_READ, allowed_stages=stages, handler=capture_source, read_only=False, side_effect=True),
        ToolSpec(name="analyze_interview_source", description="把模型从已保存面经中识别的问题和原文引文写回知识库。没有逐字对应原文的条目会被拒绝。", input_model=AnalyzeInterviewSourceInput, output_model=PipelineToolResult, permission=ToolPermission.DRAFT_WRITE, allowed_stages=stages, handler=analyze_source, read_only=False, side_effect=True),
        ToolSpec(name="build_interview_brief", description="根据已分析的面经生成岗位简报，小红书作为主来源、牛客等作为补充。每个问题必须声明来源 ID；系统按真实来源数计算频次，单一来源必须明确标记。", input_model=BuildInterviewBriefInput, output_model=PipelineToolResult, permission=ToolPermission.DRAFT_WRITE, allowed_stages=stages, handler=build_brief, read_only=False, side_effect=True),
    )
    for spec in specs:
        gateway.register(spec)
    return gateway
