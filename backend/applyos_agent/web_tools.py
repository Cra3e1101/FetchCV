from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from applyos_domain.models import Job
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.state_machine import PipelineStage
from integrations.web import FirecrawlClient, JobPostingImporter, WebClient

from .browser_tools import BrowserBridgeClient
from .tools import PipelineToolResult


class WebToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SearchWebInput(WebToolInput):
    query: str = Field(min_length=2, max_length=500)
    max_results: int = Field(default=5, ge=1, le=8)


class ReadWebPageInput(WebToolInput):
    url: str = Field(min_length=8, max_length=4096)
    max_chars: int = Field(default=20000, ge=1000, le=50000)


class ImportJobPostingInput(WebToolInput):
    url: str | None = Field(default=None, max_length=4096)


def _result(context: ToolContext, summary: str, *, artifacts: list[str] | None = None, requires_user_action: bool = False, approval_action: str | None = None, data: dict[str, Any] | None = None) -> PipelineToolResult:
    return PipelineToolResult(
        stage=context.run.current_stage or PipelineStage.CREATED.value,
        status=context.run.status.value,
        summary=summary,
        artifacts=artifacts or [],
        requires_user_action=requires_user_action,
        approval_action=approval_action,
        data=data or {},
    )


def register_web_tools(
    gateway: ToolGateway,
    *,
    web_client: WebClient | None = None,
    firecrawl_client: FirecrawlClient | None = None,
    browser_client: BrowserBridgeClient | None = None,
) -> ToolGateway:
    web = web_client or WebClient()
    firecrawl = firecrawl_client or FirecrawlClient(web_client=web)
    browser = browser_client or BrowserBridgeClient(web_client=web)
    available_stages = set(PipelineStage) - {
        PipelineStage.FROZEN,
        PipelineStage.CANCELLED,
        PipelineStage.FAILED,
        PipelineStage.BLOCKED,
    }

    def search_web(context: ToolContext, payload: SearchWebInput) -> PipelineToolResult:
        provider = "built-in"
        results = []
        if firecrawl.configured:
            try:
                results = firecrawl.search(payload.query, max_results=payload.max_results)
                provider = "firecrawl"
            except HarnessError:
                results = []
        if not results:
            results = web.search(payload.query, max_results=payload.max_results)
            provider = "built-in"
        return _result(
            context,
            f"已搜索公开网页，返回 {len(results)} 个可核对来源。",
            artifacts=[f"url:{item.url}" for item in results],
            data={"query": payload.query, "provider": provider, "results": [item.__dict__ for item in results]},
        )

    def read_web_page(context: ToolContext, payload: ReadWebPageInput) -> PipelineToolResult:
        page = None
        native_error: HarnessError | None = None
        try:
            page = web.read_page(payload.url, max_chars=payload.max_chars)
        except HarnessError as exc:
            native_error = exc
        sparse = page is None or len(page.text.strip()) < 600
        if firecrawl.configured and sparse:
            try:
                crawled = firecrawl.scrape(payload.url)
                return _result(
                    context,
                    f"已通过 Firecrawl 读取网页：{crawled.title or crawled.source_url}",
                    artifacts=[f"url:{crawled.source_url}"],
                    data={"url": crawled.source_url, "title": crawled.title, "description": str(crawled.metadata.get("description") or ""), "text": crawled.text[:payload.max_chars], "headings": [], "content_type": "text/markdown", "content_sha256": "", "truncated": len(crawled.text) > payload.max_chars, "provider": "firecrawl"},
                )
            except HarnessError:
                pass
        if browser.configured and sparse:
            try:
                rendered = browser.open(payload.url)
                rendered_url = web.redact_url(str(rendered.get("url") or payload.url))
                rendered_text = str(rendered.get("text") or "").strip()
                login_required = bool(rendered.get("login_required"))
                if rendered_text or login_required:
                    return _result(
                        context,
                        "页面需要你完成登录或验证码。" if login_required else f"已在 Agent 内渲染网页：{rendered.get('title') or rendered_url}",
                        artifacts=[f"url:{rendered_url}"],
                        requires_user_action=login_required,
                        approval_action="complete_browser_login" if login_required else None,
                        data={
                            "url": rendered_url,
                            "title": str(rendered.get("title") or "")[:500],
                            "description": "",
                            "text": rendered_text[:payload.max_chars],
                            "links": [item for item in (rendered.get("links") or [])[:120] if isinstance(item, dict)],
                            "headings": [],
                            "content_type": "text/rendered",
                            "content_sha256": "",
                            "truncated": len(rendered_text) > payload.max_chars or bool(rendered.get("truncated")),
                            "provider": "controlled-browser",
                            "login_required": login_required,
                            "user_action": str(rendered.get("user_action") or "") if login_required else "",
                        },
                    )
            except HarnessError:
                pass
        if page is None:
            raise native_error or HarnessError("web_content_empty", "网页没有返回可读内容", retryable=True)
        return _result(
            context,
            f"已读取网页：{page.title or page.final_url}",
            artifacts=[f"url:{page.final_url}", f"sha256:{page.content_sha256}"],
            data={
                "url": page.final_url,
                "title": page.title,
                "description": page.description,
                "text": page.text,
                "links": page.links,
                "headings": page.headings,
                "content_type": page.content_type,
                "content_sha256": page.content_sha256,
                "truncated": page.truncated,
                "provider": "built-in",
            },
        )

    def import_job_posting(context: ToolContext, payload: ImportJobPostingInput) -> PipelineToolResult:
        job = context.session.get(Job, context.run.job_id)
        if job is None or job.candidate_id != context.run.candidate_id:
            raise HarnessError("job_scope_mismatch", "运行绑定的岗位无效", run_id=context.run.id, stage=context.run.current_stage)
        replace_approved = gateway.approvals.is_approved(run_id=context.run.id, action_type="replace_job_description", target_id=job.id)
        imported = JobPostingImporter(context.session, web_client=web, firecrawl_client=firecrawl,
                                      browser_client=browser).import_into_job(job, url=payload.url, overwrite=replace_approved)
        posting = imported["posting"]
        if not imported["imported"] and not imported["conflict"]:
            needs_login = posting["status"] == "requires_user_action"
            return _result(context, "页面需要登录或验证码，岗位正文尚未导入。" if needs_login else "没有取得可用岗位正文，岗位保持原样。",
                           requires_user_action=needs_login, approval_action="complete_browser_login" if needs_login else None,
                           data=imported)
        if imported["conflict"]:
            approval = gateway.approvals.request(
                run_id=context.run.id,
                action_type="replace_job_description",
                target_type="job",
                target_id=job.id,
                items=[{
                    "source_url": posting["source_url"],
                    "title": posting["title"],
                    "company": posting["company"],
                    "description_preview": posting["description"][:12000],
                    "content_sha256": posting["content_sha256"],
                }],
            )
            imported["approval_id"] = approval.id
            return _result(
                context,
                "招聘页面已读取，但当前岗位已有 JD，未自动覆盖。需要用户确认后再替换。",
                artifacts=[f"url:{posting['source_url']}", f"sha256:{posting['content_sha256']}"],
                requires_user_action=True,
                approval_action="replace_job_description",
                data=imported,
            )
        return _result(
            context,
            "已从招聘页面导入岗位正文和可用的结构化信息。",
            artifacts=[f"job:{job.id}", f"material:{imported['material_id']}", f"url:{posting['source_url']}"],
            data=imported,
        )

    gateway.register(ToolSpec(
        name="search_web",
        description="Search current public web pages and return titles and source URLs. Use for weather, news, markets, companies, jobs, and other questions requiring live external information. Results identify candidate sources; read the original pages before treating them as evidence.",
        input_model=SearchWebInput,
        output_model=PipelineToolResult,
        permission=ToolPermission.NETWORK_READ,
        allowed_stages=available_stages,
        handler=search_web,
        read_only=True,
        side_effect=False,
    ))
    gateway.register(ToolSpec(
        name="read_web_page",
        description="Read the body of a public HTTPS page. When static reading fails or returns a JavaScript shell, configured Firecrawl and controlled-browser readers provide automatic fallback. Local hosts, private networks, nonstandard ports, and oversized responses are blocked.",
        input_model=ReadWebPageInput,
        output_model=PipelineToolResult,
        permission=ToolPermission.NETWORK_READ,
        allowed_stages=available_stages,
        handler=read_web_page,
        read_only=True,
        side_effect=False,
    ))
    gateway.register(ToolSpec(
        name="import_job_posting",
        description="Import the JD from the current job's source_url or a specified recruitment page. Fill an empty JD; if one already exists, return a conflict and wait for user approval before replacing it.",
        input_model=ImportJobPostingInput,
        output_model=PipelineToolResult,
        permission=ToolPermission.DRAFT_WRITE,
        allowed_stages={PipelineStage.CREATED, PipelineStage.INPUT_VALIDATING},
        handler=import_job_posting,
        read_only=False,
        side_effect=True,
    ))
    return gateway
