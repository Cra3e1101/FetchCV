from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from enum import Enum
from importlib.metadata import PackageNotFoundError, version
import hmac
import hashlib
import json
import os
from pathlib import Path
import re
import time
import threading
from typing import Annotated
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, select
from sqlalchemy.inspection import inspect
from sqlalchemy.orm import Session

from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_agent.context import ContextManager
from applyos_agent.browser_tools import BrowserBridgeClient
from applyos_agent.cancellation import provider_requests
from applyos_agent.conversation_tools import ConversationToolAgent, build_conversation_gateway
from applyos_agent.agents import AgentSuite
from applyos_agent.schemas import JobPostingExtraction
from applyos_agent.engine import build_agent_engine
from applyos_agent.mcp_tools import McpManager
from applyos_agent.service import AgentService
from applyos_agent.skills import SkillLoader
from applyos_agent.task_queue import AgentTaskWorker, TaskQueue
from applyos_domain.database import Database, get_database
from applyos_domain.enums import FactSourceType
from applyos_domain.models import AgentMessage, AgentRun, AgentRunStep, AgentSkill, AgentTask, Application, Approval, Candidate, Experience, Fact, Job, JobProfile, MaterialAsset, McpServerConfig, PortfolioVersion, QualityReport, QueuedAgentMessage, ResumeVersion, RewriteProposal, VersionSnapshot
from applyos_domain.paths import artifact_root
from applyos_domain.repositories import CandidateRepository, FactRepository, JobRepository, ResumeVersionRepository
from applyos_harness.approval import ApprovalService
from applyos_harness.assets import AssetService
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolPermission
from applyos_harness.policy import general_settings, permission_settings, save_general_settings, save_permission_settings, granted_permissions
from applyos_harness.state_machine import PipelineStage, RunStateMachine
from applyos_harness.trace import TraceService
from applyos_harness.versioning import VersionService
from integrations.legacy_resume.importer import LegacyWorkspaceImporter
from integrations.resume_pdf.importer import PdfResumeImporter
from integrations.resume.renderer import ResumeRenderer
from integrations.web import FirecrawlClient, JobPostingImporter, WebClient
from integrations.web.job_posting import looks_like_job_content

from .deps import get_session
from .schemas import (
    ActionApprovalRequest,
    ActionDecisionRequest,
    AgentMessageCreate,
    AgentTaskCreate,
    AgentTaskRead,
    ApplicationCreate,
    ApplicationRead,
    AgentRunCreate,
    AgentRunRead,
    AgentRunStepRead,
    ApprovalRead,
    CandidateCreate,
    CandidateRead,
    FactCreate,
    FactRead,
    FactSelectionRequest,
    FactVerification,
    JobCreate,
    JobPageImportRequest,
    JobRead,
    JobUpdate,
    McpServerCreate,
    McpServerRead,
    McpServerUpdate,
    McpWriteToolApproval,
    LegacyImportRequest,
    LegacyImportResult,
    MaterialAssetCreate,
    ExperienceCreate,
    PdfResumeImportRead,
    PdfResumeImportRequest,
    PdfResumePreviewRead,
    PdfResumePreviewRequest,
    PipelineReportRead,
    PortfolioBuild,
    PortfolioCreate,
    PortfolioVersionRead,
    ProviderRuntimeConfig,
    ProposalReviewRequest,
    ResumeVersionRead,
    ResumeEditorUpdate,
    RunBoundAction,
    RuntimeStatusRead,
    QueuedMessageRead,
    AgentSkillRead,
    SkillStateUpdate,
    WebPageReadRequest,
    WebSearchRequest,
    JobPostingPreviewRequest,
    PermissionSettingsRead,
    PermissionSettingsUpdate,
    GeneralSettingsRead,
    GeneralSettingsUpdate,
    RewriteProposalRead,
)

SessionDep = Annotated[Session, Depends(get_session)]


def create_app(database: Database | None = None) -> FastAPI:
    db = database or get_database()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        db.create_schema()
        PdfResumeImporter(db).repair_imported_snapshots()
        worker = AgentTaskWorker(db)
        worker_thread = None
        if os.getenv("FETCHCV_DISABLE_TASK_WORKER", "").strip() != "1":
            worker_thread = threading.Thread(target=worker.run_forever, name="fetchcv-agent-worker", daemon=True)
            worker_thread.start()
        application.state.agent_worker = worker
        try:
            yield
        finally:
            worker.stop()
            if worker_thread:
                worker_thread.join(timeout=3)

    app = FastAPI(title="FetchCV Local API", version="0.3.0", lifespan=lifespan)
    app.state.database = db
    control_token = os.getenv("FETCHCV_CONTROL_TOKEN", "").strip()
    configured_origins = [item.strip() for item in os.getenv("FETCHCV_ALLOWED_ORIGINS", "null,http://127.0.0.1:4173").split(",") if item.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Idempotency-Key", "X-FetchCV-Control-Token", "X-FetchCV-Page-Count"],
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    @app.middleware("http")
    async def require_desktop_session(request: Request, call_next):
        if not control_token or request.method == "OPTIONS" or request.url.path == "/health":
            return await call_next(request)
        provided = request.headers.get("x-fetchcv-control-token") or request.query_params.get("fetchcv_token") or ""
        if not hmac.compare_digest(control_token, provided):
            return JSONResponse(status_code=403, content={"detail": "desktop_session_forbidden"})
        return await call_next(request)

    artifacts = artifact_root()
    app.mount("/artifacts", StaticFiles(directory=artifacts, html=True), name="artifacts")

    @app.exception_handler(HarnessError)
    async def harness_error_handler(_: Request, exc: HarnessError):
        if exc.code.endswith("_not_found"):
            code = 404
        elif "permission" in exc.code or "approval_required" in exc.code:
            code = 403
        elif exc.code in {"illegal_state_transition", "terminal_state", "idempotency_conflict"}:
            code = 409
        else:
            code = 422
        return JSONResponse(status_code=code, content=exc.as_dict())

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "fetchcv-api", "database": "ready"}

    @app.get("/api/runtime/status", response_model=RuntimeStatusRead)
    def runtime_status():
        settings = AgentSettings.from_env()
        try:
            sdk_version = version("claude-agent-sdk")
        except PackageNotFoundError:
            sdk_version = "not-installed"
        return {
            "runtime": settings.runtime.value,
            "model": settings.model,
            "configured": settings.runtime.value != "mock" and settings.api_key_configured,
            "sdk_version": sdk_version,
            "provider_name": settings.provider_name,
            "provider_protocol": settings.provider_protocol if settings.runtime.value == "compatible" else "",
            "provider_base_url": settings.provider_base_url if settings.runtime.value == "compatible" else "",
            "allow_mock_runtime": settings.allow_mock_runtime,
        }

    @app.post("/api/runtime/configure", response_model=RuntimeStatusRead)
    def configure_runtime(payload: ProviderRuntimeConfig, x_fetchcv_control_token: Annotated[str | None, Header()] = None):
        expected = os.getenv("FETCHCV_CONTROL_TOKEN", "")
        if not expected or not x_fetchcv_control_token or not hmac.compare_digest(expected, x_fetchcv_control_token):
            raise HTTPException(status_code=403, detail="runtime_configuration_forbidden")
        protocol = payload.protocol.strip().lower()
        if protocol not in {"openai", "anthropic"}:
            raise HTTPException(status_code=422, detail="unsupported_provider_protocol")
        base_url = payload.base_url.strip().rstrip("/")
        parsed_base_url = urlparse(base_url)
        local_http = parsed_base_url.scheme == "http" and parsed_base_url.hostname in {"127.0.0.1", "localhost", "::1"}
        if parsed_base_url.username or parsed_base_url.password or (parsed_base_url.scheme != "https" and not local_http):
            raise HTTPException(status_code=422, detail="provider_base_url_must_use_https")
        if not payload.api_key.strip() or not payload.model.strip():
            raise HTTPException(status_code=422, detail="provider_credentials_incomplete")
        os.environ.update(
            {
                "FETCHCV_AGENT_RUNTIME": "compatible",
                "FETCHCV_PROVIDER_NAME": payload.provider_name.strip() or "Custom provider",
                "FETCHCV_PROVIDER_PROTOCOL": protocol,
                "FETCHCV_PROVIDER_BASE_URL": base_url,
                "FETCHCV_PROVIDER_API_KEY": payload.api_key.strip(),
                "FETCHCV_PROVIDER_MODEL": payload.model.strip(),
            }
        )
        return runtime_status()

    @app.post("/api/runtime/disconnect", response_model=RuntimeStatusRead)
    def disconnect_runtime(x_fetchcv_control_token: Annotated[str | None, Header()] = None):
        expected = os.getenv("FETCHCV_CONTROL_TOKEN", "")
        if not expected or not x_fetchcv_control_token or not hmac.compare_digest(expected, x_fetchcv_control_token):
            raise HTTPException(status_code=403, detail="runtime_configuration_forbidden")
        for key in (
            "FETCHCV_PROVIDER_NAME",
            "FETCHCV_PROVIDER_PROTOCOL",
            "FETCHCV_PROVIDER_BASE_URL",
            "FETCHCV_PROVIDER_API_KEY",
            "FETCHCV_PROVIDER_MODEL",
        ):
            os.environ.pop(key, None)
        os.environ["FETCHCV_AGENT_RUNTIME"] = "mock"
        return runtime_status()

    @app.get("/api/skills", response_model=list[AgentSkillRead])
    def list_skills(session: SessionDep):
        loader = SkillLoader(session, project_root=AgentSettings.from_env().workspace_root)
        return loader.sync()

    @app.post("/api/skills/reload", response_model=list[AgentSkillRead])
    def reload_skills(session: SessionDep):
        return SkillLoader(session, project_root=AgentSettings.from_env().workspace_root).sync()

    @app.get("/api/browser/status")
    def browser_status():
        return BrowserBridgeClient().status()

    @app.post("/api/browser/close")
    def browser_close():
        return BrowserBridgeClient().close()

    @app.patch("/api/skills/{skill_id}", response_model=AgentSkillRead)
    def update_skill(skill_id: str, payload: SkillStateUpdate, session: SessionDep):
        skill = session.get(AgentSkill, skill_id)
        if skill is None:
            raise HTTPException(status_code=404, detail="skill_not_found")
        if not (skill.metadata_json or {}).get("available", True) and payload.enabled:
            raise HTTPException(status_code=409, detail="skill_file_unavailable")
        skill.enabled = payload.enabled
        session.flush()
        return skill

    @app.post("/api/mcp/servers", response_model=McpServerRead, status_code=status.HTTP_201_CREATED)
    def create_mcp_server(payload: McpServerCreate, session: SessionDep):
        if session.scalar(select(McpServerConfig).where(McpServerConfig.name == payload.name)):
            raise HTTPException(status_code=409, detail="mcp_server_name_exists")
        server = McpServerConfig(name=payload.name, transport=payload.transport, command=payload.command, args_json=payload.args, cwd=payload.cwd, env_keys=payload.env_keys)
        McpManager(session).validate(server)
        session.add(server)
        session.flush()
        return server

    @app.get("/api/mcp/servers", response_model=list[McpServerRead])
    def list_mcp_servers(session: SessionDep):
        return list(session.scalars(select(McpServerConfig).order_by(McpServerConfig.name)).all())

    def require_mcp(session: Session, server_id: str) -> McpServerConfig:
        server = session.get(McpServerConfig, server_id)
        if server is None:
            raise HTTPException(status_code=404, detail="mcp_server_not_found")
        return server

    @app.post("/api/mcp/servers/{server_id}/approve", response_model=McpServerRead)
    def approve_mcp_server(server_id: str, session: SessionDep):
        server = require_mcp(session, server_id)
        McpManager(session).validate(server)
        server.approved = True
        server.status = "approved"
        session.flush()
        return server

    @app.post("/api/mcp/servers/{server_id}/probe", response_model=McpServerRead)
    def probe_mcp_server(server_id: str, session: SessionDep):
        server = require_mcp(session, server_id)
        McpManager(session).probe(server)
        return server

    @app.patch("/api/mcp/servers/{server_id}", response_model=McpServerRead)
    def update_mcp_server(server_id: str, payload: McpServerUpdate, session: SessionDep):
        server = require_mcp(session, server_id)
        discovered = {item.get("name"): item for item in (server.discovered_tools or [])}
        if payload.allowed_tools is not None:
            invalid = [name for name in payload.allowed_tools if name not in discovered or not discovered[name].get("read_only")]
            if invalid:
                raise HarnessError("mcp_tool_not_read_only", "只能允许已发现且明确标记为只读的 MCP 工具", details={"tools": invalid})
            server.allowed_tools = list(dict.fromkeys(payload.allowed_tools))
        if payload.enabled is not None:
            if payload.enabled and (not server.approved or server.status != "ready"):
                raise HarnessError("mcp_server_not_ready", "MCP Server 必须先批准并通过连接检查")
            server.enabled = payload.enabled
        session.flush()
        return server

    @app.post("/api/mcp/servers/{server_id}/tools/{tool_name}/approve-write", response_model=McpServerRead)
    def approve_mcp_write_tool(server_id: str, tool_name: str, payload: McpWriteToolApproval, session: SessionDep):
        server = require_mcp(session, server_id)
        if not server.approved or server.status != "ready":
            raise HarnessError("mcp_server_not_ready", "MCP Server 必须先批准并通过连接检查")
        discovered = next((item for item in (server.discovered_tools or []) if item.get("name") == tool_name), None)
        if discovered is None:
            raise HarnessError("mcp_tool_not_found", "MCP 工具未在最近一次发现结果中")
        if discovered.get("read_only"):
            raise HarnessError("mcp_tool_is_read_only", "只读工具不需要写入批准")
        annotations = discovered.get("annotations") or {}
        if annotations.get("destructiveHint") is not False or annotations.get("openWorldHint") is not False:
            raise HarnessError("mcp_write_scope_unverifiable", "只允许 MCP Server 明确声明为非破坏性且封闭作用域的写工具")
        properties = ((discovered.get("input_schema") or {}).get("properties") or {})
        if payload.target_id_argument not in properties:
            raise HarnessError("mcp_write_scope_invalid", "写工具 Schema 不包含声明的目标版本参数", details={"target_id_argument": payload.target_id_argument})
        policies = dict(server.tool_policies or {})
        policies[tool_name] = {
            "mode": "write",
            "approved": True,
            "target_type": payload.target_type,
            "target_id_argument": payload.target_id_argument,
            "scope": "fetchcv_version",
        }
        server.tool_policies = policies
        session.flush()
        return server

    @app.delete("/api/mcp/servers/{server_id}/tools/{tool_name}/approve-write", response_model=McpServerRead)
    def revoke_mcp_write_tool(server_id: str, tool_name: str, session: SessionDep):
        server = require_mcp(session, server_id)
        policies = dict(server.tool_policies or {})
        policies.pop(tool_name, None)
        server.tool_policies = policies
        session.flush()
        return server

    @app.delete("/api/mcp/servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_mcp_server(server_id: str, session: SessionDep):
        session.delete(require_mcp(session, server_id))
        return None

    @app.post("/api/candidates", response_model=CandidateRead, status_code=status.HTTP_201_CREATED)
    def create_candidate(payload: CandidateCreate, session: SessionDep) -> Candidate:
        return CandidateRepository(session).add(Candidate(**payload.model_dump()))

    @app.get("/api/candidates", response_model=list[CandidateRead])
    def list_candidates(session: SessionDep, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
        return CandidateRepository(session).list(limit=limit, offset=offset)

    @app.get("/api/candidates/{candidate_id}", response_model=CandidateRead)
    def get_candidate(candidate_id: str, session: SessionDep):
        candidate = CandidateRepository(session).get(candidate_id)
        if candidate is None:
            raise HTTPException(status_code=404, detail="candidate_not_found")
        return candidate

    @app.post("/api/candidates/{candidate_id}/facts", response_model=FactRead, status_code=status.HTTP_201_CREATED)
    def create_fact(candidate_id: str, payload: FactCreate, session: SessionDep) -> Fact:
        if CandidateRepository(session).get(candidate_id) is None:
            raise HTTPException(status_code=404, detail="candidate_not_found")
        return FactRepository(session).add(Fact(candidate_id=candidate_id, **payload.model_dump()))

    @app.get("/api/candidates/{candidate_id}/facts", response_model=list[FactRead])
    def list_facts(candidate_id: str, session: SessionDep, verified: bool | None = None):
        if CandidateRepository(session).get(candidate_id) is None:
            raise HTTPException(status_code=404, detail="candidate_not_found")
        return FactRepository(session).for_candidate(candidate_id, verified=verified)

    @app.patch("/api/facts/{fact_id}/verification", response_model=FactRead)
    def verify_fact(fact_id: str, payload: FactVerification, session: SessionDep):
        fact = FactRepository(session).get(fact_id)
        if fact is None:
            raise HTTPException(status_code=404, detail="fact_not_found")
        fact.verified = payload.verified
        fact.allowed_outputs = payload.allowed_outputs
        fact.version += 1
        session.flush()
        return fact

    @app.post("/api/candidates/{candidate_id}/materials", status_code=status.HTTP_201_CREATED)
    def create_material(candidate_id: str, payload: MaterialAssetCreate, session: SessionDep):
        if CandidateRepository(session).get(candidate_id) is None:
            raise HTTPException(status_code=404, detail="candidate_not_found")
        material = MaterialAsset(candidate_id=candidate_id, **payload.model_dump())
        session.add(material)
        session.flush()
        return _row(material)

    @app.post("/api/candidates/{candidate_id}/experiences", status_code=status.HTTP_201_CREATED)
    def create_experience(candidate_id: str, payload: ExperienceCreate, session: SessionDep):
        if CandidateRepository(session).get(candidate_id) is None:
            raise HTTPException(status_code=404, detail="candidate_not_found")
        experience = Experience(candidate_id=candidate_id, **payload.model_dump())
        session.add(experience)
        session.flush()
        fact = Fact(
            candidate_id=candidate_id,
            subject_type="experience",
            subject_id=experience.id,
            category=experience.kind,
            content=" ".join(part for part in [experience.title, experience.organization, experience.role, experience.summary] if part),
            normalized_value={"experience_id": experience.id},
            source_type=FactSourceType.USER_INPUT,
            verified=True,
            allowed_outputs=["resume", "portfolio"],
        )
        session.add(fact)
        session.flush()
        experience.fact_ids = [fact.id]
        return _row(experience)

    @app.post("/api/jobs", response_model=JobRead, status_code=status.HTTP_201_CREATED)
    def create_job(payload: JobCreate, session: SessionDep) -> Job:
        if CandidateRepository(session).get(payload.candidate_id) is None:
            raise HTTPException(status_code=404, detail="candidate_not_found")
        return JobRepository(session).add(Job(**payload.model_dump()))

    @app.patch("/api/jobs/{job_id}", response_model=JobRead)
    def update_job(job_id: str, payload: JobUpdate, session: SessionDep):
        job = _require_job(session, job_id)
        if payload.company is not None:
            job.company = payload.company.strip()
        if payload.role is not None:
            job.role = payload.role.strip()
        if payload.location is not None:
            job.location = payload.location.strip() or None
        if payload.jd_raw is not None:
            job.jd_raw = payload.jd_raw.strip()
        if payload.source_type is not None:
            job.source_type = payload.source_type.strip() or "manual"
        if payload.source_url is not None:
            job.source_url = payload.source_url.strip() or None
        session.flush()
        return job

    @app.post("/api/web/search")
    def search_public_web(payload: WebSearchRequest, session: SessionDep):
        if permission_settings(session).get("web_access") == "deny":
            raise HTTPException(status_code=403, detail="web_access_disabled")
        results = WebClient().search(payload.query, max_results=payload.max_results)
        return {"query": payload.query, "results": [item.__dict__ for item in results]}

    @app.post("/api/web/read")
    def read_public_web(payload: WebPageReadRequest, session: SessionDep):
        if permission_settings(session).get("web_access") == "deny":
            raise HTTPException(status_code=403, detail="web_access_disabled")
        page = WebClient().read_page(payload.url, max_chars=payload.max_chars)
        return {
            "url": page.final_url,
            "title": page.title,
            "description": page.description,
            "text": page.text,
            "headings": page.headings,
            "content_type": page.content_type,
            "content_sha256": page.content_sha256,
            "truncated": page.truncated,
        }

    @app.post("/api/web/job-posting/preview")
    def preview_job_posting(payload: JobPostingPreviewRequest, session: SessionDep):
        if permission_settings(session).get("web_access") == "deny":
            raise HTTPException(status_code=403, detail="web_access_disabled")
        posting = JobPostingImporter(session).preview(payload.url, allow_insufficient=True)
        firecrawl = FirecrawlClient()
        browser_warning = ""
        if firecrawl.configured and not looks_like_job_content(posting.description):
            try:
                crawled = firecrawl.scrape(payload.url)
                if looks_like_job_content(crawled.text):
                    posting = {
                        **posting.as_dict(),
                        "source_url": crawled.source_url or posting.source_url,
                        "title": crawled.title or posting.title,
                        "description": crawled.text[:40000],
                        "structured_data": False,
                        "content_sha256": hashlib.sha256(crawled.text.encode("utf-8")).hexdigest(),
                        "page_title": crawled.title or posting.page_title,
                    }
                else:
                    browser_warning = "Firecrawl 已返回页面，但内容仍不像岗位正文。"
            except HarnessError:
                browser_warning = "Firecrawl 抓取未完成，已继续使用本地网页读取。"
        # Some recruitment sites return only a JavaScript shell to the HTTP
        # reader. In the desktop app, use the already-isolated hidden browser
        # bridge as a second pass; it never opens a user-facing window.
        bridge = BrowserBridgeClient()
        posting_text = posting.get("description", "") if isinstance(posting, dict) else posting.description
        if bridge.configured and (len(posting_text) < 1200 or not looks_like_job_content(posting_text)):
            try:
                state = bridge.open(payload.url)
                if state.get("login_required"):
                    raise HTTPException(status_code=409, detail="job_page_requires_user_login")
                text = str(state.get("text") or "").strip()
                if looks_like_job_content(text) and (len(text) > len(posting_text) or not looks_like_job_content(posting_text)):
                    posting = {
                        **posting.as_dict(),
                        # Keep SPA route fragments (the job id lives after #)
                        # while removing sensitive query/fragment values before
                        # persisting the source URL.
                        "source_url": WebClient.redact_url(str(state.get("url") or posting.source_url)),
                        "title": str(state.get("title") or posting.title)[:240],
                        "description": text[:40000],
                        "structured_data": False,
                        "content_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                        "page_title": str(state.get("title") or posting.page_title)[:500],
                    }
                elif not looks_like_job_content(text):
                    browser_warning = "页面已打开，但只返回招聘网站导航或宣传文案，未得到可用岗位正文。"
            except HTTPException:
                raise
            except HarnessError:
                # The static reader still produced a bounded, sanitized
                # response. Keep it usable and make the limitation explicit;
                # a transient browser/resource failure must not block import.
                browser_warning = "动态网页增强读取未完成，已保留静态正文；可稍后重试或手动修正。"
        raw_text = posting["description"] if isinstance(posting, dict) else posting.description
        page_title = posting.get("page_title", "") if isinstance(posting, dict) else posting.page_title
        source_url = posting.get("source_url", "") if isinstance(posting, dict) else posting.source_url
        # A static request cannot observe a SPA fragment, but the fragment is
        # still the user's canonical job route. Keep it in the form response
        # so the next retry does not silently fall back to the site homepage.
        if "#" in payload.url and "#" not in source_url:
            source_url = WebClient.redact_url(payload.url)
        extraction_settings = AgentSettings.from_env()
        model_structured = extraction_settings.runtime != RuntimeMode.MOCK and extraction_settings.api_key_configured
        used_model = False
        try:
            if not model_structured:
                raise HarnessError("model_required", "当前未连接模型，暂不进行模型语义清洗")
            extracted, _ = AgentSuite(settings=extraction_settings).extract_job_posting(raw_text, page_title=page_title)
            used_model = True
        except Exception as error:
            extracted = JobPostingExtraction(
                title=posting.get("title", "") if isinstance(posting, dict) else posting.title,
                company=posting.get("company", "") if isinstance(posting, dict) else posting.company,
                location=posting.get("location", "") if isinstance(posting, dict) else posting.location,
                description=raw_text,
                confidence=0.2,
                warnings=["当前未连接模型，已保留网页正文；连接模型后可再次读取并进行语义清洗。"] if isinstance(error, HarnessError) and error.code == "model_required" else [f"模型结构化暂不可用，已保留网页正文（{type(error).__name__}）。"],
            )
        result = extracted.model_dump(mode="json")
        if browser_warning and browser_warning not in result["warnings"]:
            result["warnings"].append(browser_warning)
        result.update({
            "source_url": source_url,
            "page_title": page_title,
            "structured_data": used_model,
            "raw_chars": len(raw_text),
            "content_sha256": posting.get("content_sha256", "") if isinstance(posting, dict) else posting.content_sha256,
        })
        return result

    @app.get("/api/settings/permissions", response_model=PermissionSettingsRead)
    def get_permission_settings(session: SessionDep):
        return permission_settings(session)

    @app.patch("/api/settings/permissions", response_model=PermissionSettingsRead)
    def update_permission_settings(payload: PermissionSettingsUpdate, session: SessionDep):
        return save_permission_settings(session, payload.model_dump(exclude_none=True))

    @app.get("/api/settings/general", response_model=GeneralSettingsRead)
    def get_general_settings(session: SessionDep):
        return general_settings(session)

    @app.patch("/api/settings/general", response_model=GeneralSettingsRead)
    def update_general_settings(payload: GeneralSettingsUpdate, session: SessionDep):
        return save_general_settings(session, payload.model_dump(exclude_none=True))

    @app.post("/api/jobs/{job_id}/import-web")
    def import_job_from_web(job_id: str, payload: JobPageImportRequest, session: SessionDep):
        if permission_settings(session).get("web_access") == "deny":
            raise HTTPException(status_code=403, detail="web_access_disabled")
        return JobPostingImporter(session).import_into_job(
            _require_job(session, job_id),
            url=payload.url,
            overwrite=payload.overwrite,
        )

    @app.delete("/api/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_job(job_id: str, session: SessionDep):
        job = _require_job(session, job_id)
        run_ids = list(session.scalars(select(AgentRun.id).where(AgentRun.job_id == job.id)).all())
        resume_ids = list(session.scalars(select(ResumeVersion.id).where(ResumeVersion.job_id == job.id)).all())
        if run_ids:
            session.execute(delete(QualityReport).where(QualityReport.run_id.in_(run_ids)))
            session.execute(delete(VersionSnapshot).where(VersionSnapshot.run_id.in_(run_ids)))
        if resume_ids:
            session.execute(delete(VersionSnapshot).where(VersionSnapshot.target_type == "resume_versions", VersionSnapshot.target_id.in_(resume_ids)))
        session.execute(delete(AgentMessage).where(AgentMessage.job_id == job.id))
        session.execute(delete(Application).where(Application.job_id == job.id))
        session.execute(delete(PortfolioVersion).where(PortfolioVersion.job_id == job.id))
        session.execute(delete(ResumeVersion).where(ResumeVersion.job_id == job.id))
        session.execute(delete(AgentRun).where(AgentRun.job_id == job.id))
        session.delete(job)
        session.flush()
        return None

    @app.get("/api/candidates/{candidate_id}/jobs", response_model=list[JobRead])
    def list_jobs(candidate_id: str, session: SessionDep):
        return JobRepository(session).for_candidate(candidate_id)

    @app.get("/api/jobs", response_model=list[JobRead])
    def list_all_jobs(session: SessionDep):
        return list(session.scalars(select(Job).order_by(Job.updated_at.desc())).all())

    @app.get("/api/candidates/{candidate_id}/resumes", response_model=list[ResumeVersionRead])
    def list_resumes(candidate_id: str, session: SessionDep):
        return ResumeVersionRepository(session).for_candidate(candidate_id)

    @app.get("/api/candidates/{candidate_id}/library")
    def get_candidate_library(candidate_id: str, session: SessionDep):
        candidate = CandidateRepository(session).get(candidate_id)
        if candidate is None:
            raise HTTPException(status_code=404, detail="candidate_not_found")
        _backfill_candidate_experiences(session, candidate_id)
        facts = list(session.scalars(select(Fact).where(Fact.candidate_id == candidate_id).order_by(Fact.updated_at.desc())).all())
        experiences = list(session.scalars(select(Experience).where(Experience.candidate_id == candidate_id).order_by(Experience.sort_order, Experience.updated_at.desc())).all())
        materials = list(session.scalars(select(MaterialAsset).where(MaterialAsset.candidate_id == candidate_id).order_by(MaterialAsset.updated_at.desc())).all())
        resumes = list(session.scalars(select(ResumeVersion).where(ResumeVersion.candidate_id == candidate_id, ResumeVersion.job_id.is_(None)).order_by(ResumeVersion.updated_at.desc())).all())
        return {"candidate": _row(candidate), "facts": [_row(item) for item in facts], "experiences": [_row(item) for item in experiences], "materials": [_row(item) for item in materials], "resumes": [_row(item) for item in resumes]}

    @app.get("/api/workspace")
    def get_workspace(session: SessionDep):
        candidates = list(session.scalars(select(Candidate).order_by(Candidate.updated_at.desc())).all())
        jobs = list(session.scalars(select(Job).order_by(Job.updated_at.desc())).all())
        latest_by_job: dict[str, AgentRun] = {}
        for run in session.scalars(select(AgentRun).order_by(AgentRun.created_at.desc())).all():
            if run.job_id and run.job_id not in latest_by_job:
                latest_by_job[run.job_id] = run
        return {
            "candidates": [
                {
                    **_row(item),
                    "fact_count": len(session.scalars(select(Fact.id).where(Fact.candidate_id == item.id)).all()),
                    "experience_count": len(session.scalars(select(Experience.id).where(Experience.candidate_id == item.id)).all()),
                    "material_count": len(session.scalars(select(MaterialAsset.id).where(MaterialAsset.candidate_id == item.id)).all()),
                    "resume_count": len(session.scalars(select(ResumeVersion.id).where(ResumeVersion.candidate_id == item.id, ResumeVersion.job_id.is_(None))).all()),
                }
                for item in candidates
            ],
            "jobs": [{**_row(item), "latest_run": _row(latest_by_job[item.id]) if item.id in latest_by_job else None} for item in jobs],
        }

    @app.get("/api/jobs/{job_id}/workspace")
    def get_job_workspace(job_id: str, session: SessionDep):
        job = _require_job(session, job_id)
        candidate = session.get(Candidate, job.candidate_id)
        run = session.scalar(select(AgentRun).where(AgentRun.job_id == job.id).order_by(AgentRun.created_at.desc()))
        steps = [] if run is None else list(session.scalars(select(AgentRunStep).where(AgentRunStep.run_id == run.id).order_by(AgentRunStep.sequence)).all())
        proposals = [] if run is None else list(session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id).order_by(RewriteProposal.created_at)).all())
        approvals = [] if run is None else list(session.scalars(select(Approval).where(Approval.run_id == run.id).order_by(Approval.created_at)).all())
        resumes = list(session.scalars(select(ResumeVersion).where(ResumeVersion.job_id == job.id).order_by(ResumeVersion.updated_at.desc())).all())
        portfolios = list(session.scalars(select(PortfolioVersion).where(PortfolioVersion.job_id == job.id).order_by(PortfolioVersion.updated_at.desc())).all())
        applications = list(session.scalars(select(Application).where(Application.job_id == job.id).order_by(Application.updated_at.desc())).all())
        quality = [] if run is None else list(session.scalars(select(QualityReport).where(QualityReport.run_id == run.id).order_by(QualityReport.created_at.desc())).all())
        messages = list(session.scalars(select(AgentMessage).where(AgentMessage.job_id == job.id).order_by(AgentMessage.created_at)).all())
        tasks = [] if run is None else list(session.scalars(select(AgentTask).where(AgentTask.run_id == run.id).order_by(AgentTask.created_at)).all())
        queued_messages = list(session.scalars(select(QueuedAgentMessage).where(QueuedAgentMessage.job_id == job.id).order_by(QueuedAgentMessage.sequence)).all())
        profile = session.scalar(select(JobProfile).where(JobProfile.job_id == job.id))
        _backfill_candidate_experiences(session, job.candidate_id)
        facts = list(session.scalars(select(Fact).where(Fact.candidate_id == job.candidate_id).order_by(Fact.verified.desc(), Fact.updated_at.desc())).all())
        experiences = list(session.scalars(select(Experience).where(Experience.candidate_id == job.candidate_id).order_by(Experience.sort_order, Experience.updated_at.desc())).all())
        return {
            "job": _row(job), "candidate": _row(candidate), "profile": _row(profile), "facts": [_row(item) for item in facts], "experiences": [_row(item) for item in experiences],
            "run": _row(run), "steps": [_row(item) for item in steps], "proposals": [_row(item) for item in proposals],
            "approvals": [_row(item) for item in approvals], "resumes": [_row(item) for item in resumes],
            "portfolios": [_row(item) for item in portfolios], "applications": [_row(item) for item in applications],
            "quality_reports": [_row(item) for item in quality],
            "messages": [_row(item) for item in messages],
            "tasks": [_row(item) for item in tasks],
            "queued_messages": [_row(item) for item in queued_messages],
        }

    @app.post("/api/jobs/{job_id}/messages", status_code=status.HTTP_201_CREATED)
    def create_job_message(job_id: str, payload: AgentMessageCreate, session: SessionDep):
        job = _require_job(session, job_id)
        run = session.scalar(select(AgentRun).where(AgentRun.job_id == job.id).order_by(AgentRun.created_at.desc()))
        if run is None:
            run = AgentRun(candidate_id=job.candidate_id, job_id=job.id, run_type="conversation_tools", current_stage=PipelineStage.CREATED.value)
            session.add(run)
            session.flush()
        previous_messages = list(
            session.scalars(
                select(AgentMessage)
                .where(AgentMessage.job_id == job.id)
                .order_by(AgentMessage.created_at.desc())
                .limit(12)
            ).all()
        )
        user_message = AgentMessage(candidate_id=job.candidate_id, job_id=job.id, run_id=run.id, role="user", content=payload.content.strip(), metadata_json={"thinking_level": payload.thinking_level, "context_scope": "agent", "attachment_paths": payload.attachment_paths})
        session.add(user_message)
        session.flush()
        latest_resume = session.scalar(select(ResumeVersion).where(ResumeVersion.job_id == job.id).order_by(ResumeVersion.updated_at.desc()))
        strategy = (latest_resume.content_json or {}).get("strategy", {}) if latest_resume else {}
        resume_snapshot = (latest_resume.content_json or {}).get("editor_snapshot", {}) if latest_resume else {}
        conversation_context = ContextManager(session).conversation_context(job=job, run=run, include_job_context=False)
        if payload.attachment_paths:
            conversation_context += "\n<attached_workspace_files>\n" + "\n".join(payload.attachment_paths) + "\n</attached_workspace_files>"
        result = AgentService(session).converse(job, payload.content.strip(), run=run, context=conversation_context, thinking_level=payload.thinking_level)
        assistant_message = AgentMessage(
            candidate_id=job.candidate_id,
            job_id=job.id,
            run_id=run.id if run else None,
            role="assistant",
            content=result["message"],
            metadata_json={"intent": result["intent"], "suggested_actions": result["suggested_actions"], "runtime": result["runtime"], "thinking_level": payload.thinking_level},
        )
        session.add(assistant_message)
        session.flush()
        return {"user": _row(user_message), "assistant": _row(assistant_message)}

    @app.post("/api/jobs/{job_id}/messages/stream")
    async def stream_job_message(job_id: str, payload: AgentMessageCreate, request: Request):
        database = request.app.state.database

        def event(name: str, value: dict) -> str:
            return f"event: {name}\ndata: {json.dumps(value, ensure_ascii=False)}\n\n"

        def mark_user(message_id: str | None, delivery_status: str) -> None:
            if not message_id:
                return
            with database.session() as update_session:
                stored = update_session.get(AgentMessage, message_id)
                if stored:
                    stored.metadata_json = {**(stored.metadata_json or {}), "delivery_status": delivery_status}

        async def event_stream():
            user_message_id: str | None = None
            completed = False
            processing_started = time.monotonic()
            processing_trace: list[dict] = []

            def update_processing(event_id: str, label: str, detail: str, status_value: str) -> dict:
                item = {"id": event_id, "label": label, "detail": detail, "status": status_value}
                for index, existing in enumerate(processing_trace):
                    if existing.get("id") == event_id:
                        processing_trace[index] = {**existing, **item}
                        break
                else:
                    processing_trace.append(item)
                return item

            try:
                scope_detail = "正在根据完整语义判断是直接回答，还是读取岗位、网页、附件或本地工作区。"
                yield event("reasoning", {"event": update_processing("scope", "理解问题", scope_detail, "completed")})
                yield event("status", {
                    "label": "正在理解你的问题",
                    "context_scope": "agent",
                })
                with database.session() as message_session:
                    job = _require_job(message_session, job_id)
                    run = message_session.scalar(select(AgentRun).where(AgentRun.job_id == job.id).order_by(AgentRun.created_at.desc()))
                    if run is None:
                        run = AgentRun(candidate_id=job.candidate_id, job_id=job.id, run_type="conversation_tools", current_stage=PipelineStage.CREATED.value)
                        message_session.add(run)
                        message_session.flush()
                    previous_messages = list(
                        message_session.scalars(
                            select(AgentMessage)
                            .where(AgentMessage.job_id == job.id)
                            .order_by(AgentMessage.created_at.desc())
                            .limit(12)
                        ).all()
                    )
                    latest_resume = message_session.scalar(select(ResumeVersion).where(ResumeVersion.job_id == job.id).order_by(ResumeVersion.updated_at.desc()))
                    resume_content = latest_resume.content_json or {} if latest_resume else {}
                    conversation_context = ContextManager(message_session).conversation_context(job=job, run=run, include_job_context=False)
                    if payload.attachment_paths:
                        conversation_context += "\n<attached_workspace_files>\n" + "\n".join(payload.attachment_paths) + "\n</attached_workspace_files>"
                    user_message = AgentMessage(
                        candidate_id=job.candidate_id,
                        job_id=job.id,
                        run_id=run.id if run else None,
                        role="user",
                        content=payload.content.strip(),
                        metadata_json={"thinking_level": payload.thinking_level, "context_scope": "agent", "delivery_status": "streaming", "attachment_paths": payload.attachment_paths},
                    )
                    message_session.add(user_message)
                    message_session.flush()
                    user_message_id = user_message.id
                    user_payload = _row(user_message)
                    detached_job = job
                    run_id = run.id if run else None
                    session_id = run.session_id if run else None
                    context_detail = f"已载入最近 {len(previous_messages)} 条对话；更详细的岗位和材料上下文由模型按需读取。"
                yield event("reasoning", {"event": update_processing("context", "准备上下文", context_detail, "completed")})
                yield event("user", {"message": user_payload})

                settings = AgentSettings.from_env()
                if settings.runtime == RuntimeMode.MOCK:
                    raise HarnessError("model_required", "请先连接并启用一个模型；Agent 对话不会使用本地规则冒充模型回答。")
                thinking_label = {"fast": "快速", "balanced": "平衡", "deep": "深度"}.get(payload.thinking_level, payload.thinking_level)
                provider_label = settings.provider_name or ("Claude" if settings.runtime == RuntimeMode.CLAUDE else "自定义模型")
                model_detail = f"正在使用 {provider_label} / {settings.model}，推理强度为{thinking_label}。"
                yield event("reasoning", {"event": update_processing("model", "调用模型", model_detail, "active")})
                yield event("status", {"label": "正在等待模型响应"})
                text_parts: list[str] = []
                runtime_usage: dict = {}
                final_session_id = session_id
                first_delta = True
                if run_id:
                    progress_queue: asyncio.Queue = asyncio.Queue()
                    active_loop = asyncio.get_running_loop()

                    def progress(item: dict) -> None:
                        active_loop.call_soon_threadsafe(progress_queue.put_nowait, item)

                    def execute_tool_conversation():
                        with database.session() as tool_session:
                            tool_job = _require_job(tool_session, job_id)
                            tool_run = tool_session.get(AgentRun, run_id)
                            if tool_run is None:
                                raise HarnessError("agent_run_not_found", "岗位 Agent 运行不存在")
                            return ConversationToolAgent(tool_session, settings=settings).run(
                                job=tool_job,
                                run=tool_run,
                                message=payload.content.strip(),
                                context=conversation_context,
                                thinking_level=payload.thinking_level,
                                request_id=user_message_id,
                                on_event=progress,
                            )

                    agent_task = asyncio.create_task(asyncio.to_thread(execute_tool_conversation))
                    while not agent_task.done():
                        try:
                            progress_item = await asyncio.wait_for(progress_queue.get(), timeout=0.2)
                        except TimeoutError:
                            if await request.is_disconnected():
                                provider_requests.cancel(user_message_id, signal="cancel")
                                raise asyncio.CancelledError
                            continue
                        trace_id = str(progress_item.get("id") or progress_item.get("type") or "tool")
                        yield event("reasoning", {"event": update_processing(
                            trace_id,
                            str(progress_item.get("label") or "使用工具"),
                            str(progress_item.get("detail") or ""),
                            str(progress_item.get("status") or "active"),
                        )})
                        yield event("status", {"label": str(progress_item.get("label") or "正在使用工具")})
                    outcome = await agent_task
                    while not progress_queue.empty():
                        progress_item = progress_queue.get_nowait()
                        trace_id = str(progress_item.get("id") or progress_item.get("type") or "tool")
                        yield event("reasoning", {"event": update_processing(
                            trace_id,
                            str(progress_item.get("label") or "使用工具"),
                            str(progress_item.get("detail") or ""),
                            str(progress_item.get("status") or "completed"),
                        )})
                    runtime_usage = outcome.usage
                    final_session_id = outcome.session_id or final_session_id
                    chunk = outcome.text.strip()
                    if chunk:
                        first_delta = False
                        yield event("reasoning", {"event": update_processing("model", "调用模型", f"{provider_label} / {settings.model} 已完成工具调用与回答。", "completed")})
                        yield event("reasoning", {"event": update_processing("answer", "组织回答", "已根据本轮语义判断和真实工具结果整理回答。", "completed")})
                        yield event("status", {"label": "正在生成回答"})
                        text_parts.append(chunk)
                        yield event("delta", {"text": chunk})
                full_text = "".join(text_parts).strip()
                if not full_text:
                    raise HarnessError("empty_model_response", "模型没有返回可显示的内容", retryable=True)
                yield event("reasoning", {"event": update_processing("answer", "组织回答", "回答内容已生成并完成流式输出。", "completed")})
                processing_duration_ms = max(1, round((time.monotonic() - processing_started) * 1000))

                with database.session() as result_session:
                    stored_user = result_session.get(AgentMessage, user_message_id)
                    if stored_user:
                        stored_user.metadata_json = {**(stored_user.metadata_json or {}), "delivery_status": "completed"}
                    stored_run = result_session.get(AgentRun, run_id) if run_id else None
                    if stored_run:
                        stored_run.session_id = final_session_id or stored_run.session_id
                        TraceService(result_session).record(
                            run=stored_run,
                            stage=stored_run.current_stage or "conversation",
                            agent_name="job_workspace_conversation",
                            event_type="conversation",
                            usage=runtime_usage,
                        )
                    assistant_message = AgentMessage(
                        candidate_id=detached_job.candidate_id,
                        job_id=detached_job.id,
                        run_id=run_id,
                        role="assistant",
                        content=full_text,
                        metadata_json={
                            "runtime": runtime_usage,
                            "thinking_level": payload.thinking_level,
                            "delivery_status": "completed",
                            "processing_trace": processing_trace,
                            "processing_duration_ms": processing_duration_ms,
                        },
                    )
                    result_session.add(assistant_message)
                    result_session.flush()
                    assistant_payload = _row(assistant_message)
                completed = True
                yield event("done", {"assistant": assistant_payload})
            except asyncio.CancelledError:
                if user_message_id:
                    provider_requests.cancel(user_message_id, signal="cancel")
                mark_user(user_message_id, "cancelled")
                raise
            except HarnessError as exc:
                mark_user(user_message_id, "failed")
                yield event("error", exc.as_dict())
            except Exception:
                mark_user(user_message_id, "failed")
                yield event("error", {"code": "conversation_failed", "message": "Agent 对话中断，请重试。", "retryable": True})
            finally:
                if user_message_id and not completed and await request.is_disconnected():
                    mark_user(user_message_id, "cancelled")

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/jobs/{job_id}/analyze")
    def analyze_job(job_id: str, payload: RunBoundAction | None, session: SessionDep):
        run = _require_run(session, payload.run_id) if payload else None
        return _row(AgentService(session).analyze_job(_require_job(session, job_id), run=run))

    @app.post("/api/jobs/{job_id}/resume-strategy")
    def create_resume_strategy(job_id: str, payload: RunBoundAction | None, session: SessionDep):
        run = _require_run(session, payload.run_id) if payload else None
        return AgentService(session).resume_strategy(_require_job(session, job_id), run=run)

    @app.post("/api/imports/legacy-resume", response_model=LegacyImportResult)
    def import_legacy(payload: LegacyImportRequest, request: Request):
        return LegacyWorkspaceImporter(request.app.state.database).import_file(payload.source_path)

    @app.post("/api/imports/resume-pdf/preview", response_model=PdfResumePreviewRead)
    def preview_pdf_resume(payload: PdfResumePreviewRequest, request: Request):
        try:
            return PdfResumeImporter(request.app.state.database).preview(
                payload.source_path,
                ai_enhanced=payload.ai_enhanced,
            )
        except (ValueError, OSError) as exc:
            raise HarnessError("pdf_import_invalid", str(exc)) from exc

    @app.post("/api/imports/resume-pdf", response_model=PdfResumeImportRead)
    def import_pdf_resume(payload: PdfResumeImportRequest, request: Request):
        try:
            return PdfResumeImporter(request.app.state.database).import_file(
                payload.source_path,
                candidate_id=payload.candidate_id,
                candidate_name=payload.candidate_name,
                candidate_title=payload.candidate_title,
                ai_enhanced=payload.ai_enhanced,
            )
        except (ValueError, OSError) as exc:
            raise HarnessError("pdf_import_invalid", str(exc)) from exc

    @app.post("/api/agent-runs", response_model=AgentRunRead, status_code=status.HTTP_201_CREATED)
    def create_agent_run(payload: AgentRunCreate, session: SessionDep, idempotency_key: Annotated[str, Header(alias="Idempotency-Key")]):
        engine = build_agent_engine(session)
        run = engine.create_run(candidate_id=payload.candidate_id, job_id=payload.job_id, idempotency_key=idempotency_key)
        return engine.run(run).run if payload.auto_start else run

    @app.get("/api/agent-runs/{run_id}", response_model=AgentRunRead)
    def get_agent_run(run_id: str, session: SessionDep):
        return _require_run(session, run_id)

    @app.get("/api/agent-runs/{run_id}/steps", response_model=list[AgentRunStepRead])
    def get_agent_run_steps(run_id: str, session: SessionDep):
        _require_run(session, run_id)
        return session.scalars(select(AgentRunStep).where(AgentRunStep.run_id == run_id).order_by(AgentRunStep.sequence)).all()

    @app.get("/api/agent-runs/{run_id}/events")
    def get_agent_run_events(
        run_id: str,
        request: Request,
        session: SessionDep,
        after_sequence: int = Query(0, ge=0),
        follow: bool = Query(False),
    ):
        _require_run(session, run_id)
        database = request.app.state.database

        async def event_stream():
            cursor = after_sequence
            quiet_polls = 0
            heartbeat_at = time.monotonic()
            while True:
                with database.session() as event_session:
                    steps = list(event_session.scalars(
                        select(AgentRunStep)
                        .where(AgentRunStep.run_id == run_id, AgentRunStep.sequence > cursor)
                        .order_by(AgentRunStep.sequence)
                    ).all())
                    task = event_session.scalar(select(AgentTask).where(AgentTask.run_id == run_id).order_by(AgentTask.created_at.desc()))
                for step in steps:
                    payload = AgentRunStepRead.model_validate(step).model_dump(mode="json")
                    cursor = max(cursor, step.sequence)
                    yield f"event: trace\nid: {step.sequence}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                if not follow:
                    yield f"event: end\ndata: {json.dumps({'after_sequence': cursor})}\n\n"
                    return
                quiet_polls = 0 if steps else quiet_polls + 1
                terminal = task is None or task.status in {"completed", "failed", "cancelled", "paused"}
                if terminal and quiet_polls >= 2:
                    yield f"event: end\ndata: {json.dumps({'after_sequence': cursor, 'task_status': task.status if task else None})}\n\n"
                    return
                if time.monotonic() - heartbeat_at >= 5:
                    heartbeat_at = time.monotonic()
                    yield f"event: heartbeat\ndata: {json.dumps({'after_sequence': cursor})}\n\n"
                if await request.is_disconnected():
                    return
                await asyncio.sleep(0.2)

        return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})

    @app.post("/api/agent-runs/{run_id}/tasks", response_model=AgentTaskRead, status_code=status.HTTP_202_ACCEPTED)
    def enqueue_agent_task(run_id: str, payload: AgentTaskCreate, session: SessionDep):
        return TaskQueue(session).enqueue(_require_run(session, run_id), kind=payload.kind, priority=payload.priority, payload=payload.payload)

    @app.get("/api/agent-runs/{run_id}/tasks", response_model=list[AgentTaskRead])
    def list_agent_tasks(run_id: str, session: SessionDep):
        _require_run(session, run_id)
        return list(session.scalars(select(AgentTask).where(AgentTask.run_id == run_id).order_by(AgentTask.created_at)).all())

    def require_task(session: Session, task_id: str) -> AgentTask:
        task = session.get(AgentTask, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="agent_task_not_found")
        return task

    @app.post("/api/agent-tasks/{task_id}/pause", response_model=AgentTaskRead)
    def pause_agent_task(task_id: str, session: SessionDep):
        return TaskQueue(session).request_pause(require_task(session, task_id))

    @app.post("/api/agent-tasks/{task_id}/resume", response_model=AgentTaskRead)
    def resume_agent_task(task_id: str, session: SessionDep):
        return TaskQueue(session).resume(require_task(session, task_id))

    @app.post("/api/agent-tasks/{task_id}/retry", response_model=AgentTaskRead)
    def retry_agent_task(task_id: str, session: SessionDep):
        return TaskQueue(session).resume(require_task(session, task_id), retry=True)

    @app.post("/api/agent-tasks/{task_id}/cancel", response_model=AgentTaskRead)
    def cancel_agent_task(task_id: str, session: SessionDep):
        return TaskQueue(session).request_cancel(require_task(session, task_id))

    @app.post("/api/jobs/{job_id}/messages/queue", response_model=QueuedMessageRead, status_code=status.HTTP_202_ACCEPTED)
    def queue_job_message(job_id: str, payload: AgentMessageCreate, session: SessionDep):
        job = _require_job(session, job_id)
        run = session.scalar(select(AgentRun).where(AgentRun.job_id == job.id).order_by(AgentRun.created_at.desc()))
        if run is None:
            run = AgentRun(candidate_id=job.candidate_id, job_id=job.id, run_type="conversation_tools", current_stage=PipelineStage.CREATED.value)
            session.add(run)
            session.flush()
        return TaskQueue(session).enqueue_message(job=job, run=run, content=payload.content, thinking_level=payload.thinking_level)

    @app.get("/api/jobs/{job_id}/messages/queue", response_model=list[QueuedMessageRead])
    def list_queued_messages(job_id: str, session: SessionDep):
        _require_job(session, job_id)
        return list(session.scalars(select(QueuedAgentMessage).where(QueuedAgentMessage.job_id == job_id).order_by(QueuedAgentMessage.sequence)).all())

    @app.delete("/api/queued-messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
    def cancel_queued_message(message_id: str, session: SessionDep):
        message = session.get(QueuedAgentMessage, message_id)
        if message is None:
            raise HTTPException(status_code=404, detail="queued_message_not_found")
        if message.status not in {"queued", "failed"}:
            raise HTTPException(status_code=409, detail="queued_message_not_cancellable")
        message.status = "cancelled"
        return None

    @app.post("/api/agent-runs/{run_id}/resume", response_model=AgentRunRead)
    def resume_agent_run(run_id: str, session: SessionDep):
        return build_agent_engine(session).run(_require_run(session, run_id)).run

    @app.post("/api/agent-runs/{run_id}/retry", response_model=AgentRunRead)
    def retry_agent_run(run_id: str, session: SessionDep):
        return build_agent_engine(session).retry(_require_run(session, run_id)).run

    @app.post("/api/agent-runs/{run_id}/cancel", response_model=AgentRunRead)
    def cancel_agent_run(run_id: str, session: SessionDep):
        return RunStateMachine(session).transition(
            _require_run(session, run_id),
            PipelineStage.CANCELLED,
            actor="user",
            reason="cancel requested",
        )

    @app.get("/api/agent-runs/{run_id}/proposals", response_model=list[RewriteProposalRead])
    def get_run_proposals(run_id: str, session: SessionDep):
        _require_run(session, run_id)
        return session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run_id).order_by(RewriteProposal.created_at)).all()

    @app.get("/api/agent-runs/{run_id}/approvals", response_model=list[ApprovalRead])
    def get_run_approvals(run_id: str, session: SessionDep):
        _require_run(session, run_id)
        return session.scalars(select(Approval).where(Approval.run_id == run_id).order_by(Approval.created_at)).all()

    @app.post("/api/agent-runs/{run_id}/facts/review", response_model=ApprovalRead)
    def review_run_facts(run_id: str, payload: FactSelectionRequest, session: SessionDep):
        run = _require_run(session, run_id)
        if run.current_stage != "awaiting_fact_review":
            raise HarnessError("illegal_state_transition", "当前阶段不接受经历确认", run_id=run.id, stage=run.current_stage)
        approval = session.get(Approval, payload.approval_id)
        if approval is None or approval.run_id != run.id or approval.action_type != "confirm_relevant_facts":
            raise HarnessError("approval_not_found", "经历确认请求不存在", run_id=run.id)
        fact_ids = list(dict.fromkeys(payload.fact_ids))
        facts = list(session.scalars(select(Fact).where(Fact.id.in_(fact_ids), Fact.candidate_id == run.candidate_id)).all())
        if len(facts) != len(fact_ids):
            raise HarnessError("fact_scope_mismatch", "所选经历不属于当前候选人", run_id=run.id)
        for fact in facts:
            if not fact.verified or not {"resume", "portfolio"}.issubset(set(fact.allowed_outputs or [])):
                fact.verified = True
                fact.allowed_outputs = list(dict.fromkeys([*(fact.allowed_outputs or []), "resume", "portfolio"]))
                fact.version += 1
        return ApprovalService(session).approve_action(
            approval_id=approval.id,
            approved_by=payload.approved_by,
            payload={"fact_ids": fact_ids},
        )

    @app.post("/api/agent-runs/{run_id}/proposals/review", response_model=ApprovalRead)
    def review_run_proposals(run_id: str, payload: ProposalReviewRequest, session: SessionDep):
        run = _require_run(session, run_id)
        if run.current_stage != "awaiting_user_review":
            raise HarnessError("illegal_state_transition", "当前阶段不接受修改建议审批", run_id=run.id, stage=run.current_stage)
        approval = session.get(Approval, payload.approval_id)
        if approval is None or approval.run_id != run.id or approval.action_type != "apply_resume_changes":
            raise HarnessError("approval_not_found", "修改建议审批不存在", run_id=run.id)
        return ApprovalService(session).review_proposals(
            approval_id=approval.id,
            decisions=[item.model_dump() for item in payload.decisions],
            approved_by=payload.approved_by,
        )

    @app.post("/api/agent-runs/{run_id}/publish-approval", response_model=ApprovalRead)
    def approve_run_publish(run_id: str, payload: ActionApprovalRequest, session: SessionDep):
        run = _require_run(session, run_id)
        if run.current_stage != "awaiting_publish_approval":
            raise HarnessError("illegal_state_transition", "当前阶段不接受发布审批", run_id=run.id, stage=run.current_stage)
        approval = session.get(Approval, payload.approval_id)
        if approval is None or approval.run_id != run.id or approval.action_type != "publish_assets":
            raise HarnessError("approval_not_found", "发布审批不存在", run_id=run.id)
        return ApprovalService(session).approve_action(approval_id=approval.id, approved_by=payload.approved_by)

    @app.post("/api/agent-runs/{run_id}/job-import-approval", response_model=ApprovalRead)
    def approve_job_import(run_id: str, payload: ActionApprovalRequest, session: SessionDep):
        run = _require_run(session, run_id)
        approval = session.get(Approval, payload.approval_id)
        if approval is None or approval.run_id != run.id or approval.action_type != "replace_job_description" or approval.target_id != run.job_id:
            raise HarnessError("approval_not_found", "招聘页面替换审批不存在", run_id=run.id)
        return ApprovalService(session).approve_action(approval_id=approval.id, approved_by=payload.approved_by)

    @app.post("/api/agent-runs/{run_id}/approvals/{approval_id}/decision", response_model=ApprovalRead)
    def decide_tool_approval(run_id: str, approval_id: str, payload: ActionDecisionRequest, session: SessionDep):
        run = _require_run(session, run_id)
        approval = session.get(Approval, approval_id)
        if approval is None or approval.run_id != run.id:
            raise HarnessError("approval_not_found", "操作审批不存在", run_id=run.id)
        if not (
            approval.action_type.startswith("workspace_")
            or approval.action_type.startswith("mcp_write:")
            or approval.action_type.startswith("permission:")
        ):
            raise HarnessError("approval_scope_mismatch", "该审批必须在对应业务流程中处理", run_id=run.id)
        decision_payload = {**(approval.decision_payload or {}), "approved": payload.decision == "approved"}
        service = ApprovalService(session)
        if payload.decision == "approved":
            item = (approval.decision_payload or {}).get("items", [{}])[0]
            tool_name = str(item.get("tool_name") or "")
            arguments = item.get("arguments") or {}
            approved = service.approve_action(approval_id=approval.id, approved_by=payload.decided_by, payload=decision_payload)
            if approval.action_type.startswith("workspace_") or approval.action_type.startswith("permission:"):
                result = build_conversation_gateway(session, AgentSettings.from_env()).execute(
                    tool_name=tool_name,
                    run=run,
                    arguments=arguments,
                    granted_permissions=granted_permissions(permission_settings(session)),
                    idempotency_key=f"approved:{approval.id}",
                )
                approved.decision_payload = {**decision_payload, "result": result}
                session.flush()
            return approved
        return service.reject_action(approval_id=approval.id, approved_by=payload.decided_by, payload=decision_payload)

    @app.get("/api/agent-runs/{run_id}/report", response_model=PipelineReportRead)
    def get_run_report(run_id: str, session: SessionDep):
        return TraceService(session).pipeline_report(_require_run(session, run_id))

    @app.post("/api/resumes/{resume_id}/render")
    def render_resume(resume_id: str, payload: RunBoundAction, session: SessionDep):
        run = _require_run(session, payload.run_id)
        resume = _require_resume(session, resume_id)
        _assert_run_asset_scope(run, resume.candidate_id, resume.job_id)
        result = ResumeRenderer(session).render(resume, run_id=run.id)
        return {"resume": _row(resume), "pdf_url": f"/api/resumes/{resume.id}/pdf", "bridge_payload_path": str(result.bridge_payload_path), "page_count": result.page_count}

    @app.get("/api/resumes/{resume_id}", response_model=ResumeVersionRead)
    def get_resume(resume_id: str, session: SessionDep):
        resume = session.get(ResumeVersion, resume_id)
        if resume is None:
            raise HTTPException(status_code=404, detail="resume not found")
        return resume

    @app.patch("/api/resumes/{resume_id}/editor", response_model=ResumeVersionRead)
    def update_resume_editor(resume_id: str, payload: ResumeEditorUpdate, session: SessionDep):
        resume = _require_resume(session, resume_id)
        if str(resume.status) == "frozen":
            raise HarnessError("asset_frozen", "已冻结的历史快照不能编辑")
        content = dict(resume.content_json or {})
        content["editor_snapshot"] = payload.editor_snapshot
        content["editor_source"] = "resume-editor-prototype"
        content.pop("source_pdf_fidelity", None)
        resume.content_json = content
        resume.pdf_path = None
        resume.content_hash = None
        VersionService(session).snapshot_entity(resume, run_id=None, reason="save from embedded resume editor")
        session.flush()
        return resume

    @app.get("/api/resumes/{resume_id}/pdf")
    def get_resume_pdf(resume_id: str, session: SessionDep):
        resume = _require_resume(session, resume_id)
        pdf_path = Path(resume.pdf_path).resolve() if resume.pdf_path else None
        resume_root = (artifact_root() / "resumes").resolve()
        if pdf_path is None or not pdf_path.is_relative_to(resume_root) or not pdf_path.is_file():
            raise HarnessError("resume_pdf_not_found", "简历 PDF 尚未生成")
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename=f"{resume.name}.pdf",
            content_disposition_type="inline",
        )

    @app.put("/api/resumes/{resume_id}/pdf")
    async def upload_resume_pdf(resume_id: str, request: Request, session: SessionDep):
        """Store the PDF produced by the embedded resume-editor renderer.

        The editor preview and the downloadable artifact must be the same bytes;
        this endpoint replaces the older server-side approximation after a real
        editor export.
        """
        resume = _require_resume(session, resume_id)
        if str(resume.status) == "frozen":
            raise HarnessError("asset_frozen", "已冻结的历史快照不能覆盖")
        payload = await request.body()
        if not payload.startswith(b"%PDF"):
            raise HarnessError("resume_pdf_invalid", "上传内容不是有效的 PDF")
        if len(payload) > 25 * 1024 * 1024:
            raise HarnessError("resume_pdf_too_large", "简历 PDF 不能超过 25MB")
        target = (artifact_root() / "resumes" / resume.id).resolve()
        resume_root = (artifact_root() / "resumes").resolve()
        if not target.is_relative_to(resume_root):
            raise HarnessError("path_outside_workspace", "简历产物路径越界")
        target.mkdir(parents=True, exist_ok=True)
        pdf_path = target / "resume.pdf"
        pending_path = target / "resume.pdf.pending"
        pending_path.write_bytes(payload)
        pending_path.replace(pdf_path)
        try:
            page_count = max(1, int(request.headers.get("x-fetchcv-page-count", "1")))
        except ValueError:
            page_count = 1
        versions = VersionService(session)
        versions.snapshot_entity(resume, run_id=None, reason="before:attach canonical editor pdf")
        content = dict(resume.content_json or {})
        content["page_count"] = page_count
        content["pdf_renderer"] = "resume-editor-prototype"
        content["pdf_renderer_version"] = 2
        resume.content_json = content
        resume.pdf_path = str(pdf_path)
        versions.snapshot_entity(resume, run_id=None, reason="after:attach canonical editor pdf")
        session.flush()
        return {"resume": _row(resume), "pdf_url": f"/api/resumes/{resume.id}/pdf", "page_count": page_count}

    @app.post("/api/resumes/{resume_id}/freeze", response_model=ResumeVersionRead)
    def freeze_resume(resume_id: str, payload: RunBoundAction, session: SessionDep):
        run = _require_run(session, payload.run_id)
        resume = _require_resume(session, resume_id)
        _assert_run_asset_scope(run, resume.candidate_id, resume.job_id)
        ApprovalService(session).require(run_id=run.id, action_type="publish_assets")
        VersionService(session).freeze(resume, run_id=run.id, reason="user approved resume freeze")
        return resume

    @app.post("/api/jobs/{job_id}/portfolios", response_model=PortfolioVersionRead)
    def create_portfolio(job_id: str, payload: PortfolioCreate, session: SessionDep):
        run = _require_run(session, payload.run_id)
        if run.job_id != job_id:
            raise HarnessError("asset_scope_mismatch", "运行与岗位上下文不匹配", run_id=run.id)
        resume = _require_resume(session, payload.resume_version_id)
        return AssetService(session).create_portfolio(run=run, resume=resume, mode=payload.mode)

    @app.post("/api/portfolios/{portfolio_id}/build")
    def build_portfolio(portfolio_id: str, payload: PortfolioBuild, session: SessionDep):
        run = _require_run(session, payload.run_id)
        portfolio = _require_portfolio(session, portfolio_id)
        _assert_run_asset_scope(run, portfolio.candidate_id, portfolio.job_id)
        result = AssetService(session).build_portfolio(portfolio, run=run, mode=payload.mode)
        return {"portfolio": _row(portfolio), "build": result.model_dump(mode="json")}

    @app.post("/api/portfolios/{portfolio_id}/publish", response_model=PortfolioVersionRead)
    def publish_portfolio(portfolio_id: str, payload: RunBoundAction, session: SessionDep):
        run = _require_run(session, payload.run_id)
        portfolio = _require_portfolio(session, portfolio_id)
        _assert_run_asset_scope(run, portfolio.candidate_id, portfolio.job_id)
        return AssetService(session).publish_portfolio(portfolio, run=run)

    @app.get("/api/portfolios/{portfolio_id}", response_model=PortfolioVersionRead)
    def get_portfolio(portfolio_id: str, session: SessionDep):
        return _require_portfolio(session, portfolio_id)

    @app.post("/api/applications", response_model=ApplicationRead, status_code=status.HTTP_201_CREATED)
    def create_application(payload: ApplicationCreate, session: SessionDep):
        run = _require_run(session, payload.run_id)
        resume = _require_resume(session, payload.resume_version_id)
        portfolio = _require_portfolio(session, payload.portfolio_version_id) if payload.portfolio_version_id else None
        _assert_run_asset_scope(run, resume.candidate_id, resume.job_id)
        return AssetService(session).create_application_and_freeze(run=run, resume=resume, portfolio=portfolio, status=payload.status)

    @app.get("/api/jobs/{job_id}/applications", response_model=list[ApplicationRead])
    def list_applications(job_id: str, session: SessionDep):
        _require_job(session, job_id)
        return list(session.scalars(select(Application).where(Application.job_id == job_id).order_by(Application.created_at.desc())).all())

    return app


def _require_run(session: Session, run_id: str) -> AgentRun:
    run = session.get(AgentRun, run_id)
    if run is None:
        raise HarnessError("run_not_found", "Agent Run 不存在", run_id=run_id)
    return run


def _require_job(session: Session, job_id: str) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise HarnessError("job_not_found", "岗位不存在")
    return job


def _require_resume(session: Session, resume_id: str) -> ResumeVersion:
    resume = session.get(ResumeVersion, resume_id)
    if resume is None:
        raise HarnessError("resume_not_found", "简历版本不存在")
    return resume


def _require_portfolio(session: Session, portfolio_id: str | None) -> PortfolioVersion:
    portfolio = session.get(PortfolioVersion, portfolio_id) if portfolio_id else None
    if portfolio is None:
        raise HarnessError("portfolio_not_found", "作品集版本不存在")
    return portfolio


def _assert_run_asset_scope(run: AgentRun, candidate_id: str, job_id: str | None) -> None:
    if run.candidate_id != candidate_id or run.job_id != job_id:
        raise HarnessError("asset_scope_mismatch", "资产与当前运行上下文不匹配", run_id=run.id)


def _backfill_candidate_experiences(session: Session, candidate_id: str) -> None:
    """Upgrade existing imported facts into complete entities without losing data."""
    if session.scalar(select(Experience.id).where(Experience.candidate_id == candidate_id).limit(1)):
        return
    facts = list(
        session.scalars(
            select(Fact)
            .where(Fact.candidate_id == candidate_id)
            .order_by(Fact.created_at, Fact.id)
        ).all()
    )
    groups: list[dict] = []
    current: dict | None = None
    for fact in facts:
        if fact.category.startswith("profile."):
            continue
        begins_dated_entity = bool(re.match(r"^(?:19|20)\d{2}\s*[-/.年]", fact.content.strip()))
        if current is None or current["kind"] != fact.category or begins_dated_entity:
            current = {"kind": fact.category, "facts": [fact], "content": [fact.content]}
            groups.append(current)
        else:
            current["facts"].append(fact)
            current["content"].append(fact.content)
    for index, group in enumerate(groups):
        text = "\n".join(group["content"])
        headline = group["content"][0].splitlines()[0][:160]
        experience = Experience(
            candidate_id=candidate_id,
            kind=group["kind"],
            title=headline,
            summary=text,
            details_json={"raw_text": text, "migrated_from_facts": True},
            fact_ids=[fact.id for fact in group["facts"]],
            sort_order=index,
        )
        session.add(experience)
        session.flush()
        for fact in group["facts"]:
            fact.subject_type = "experience"
            fact.subject_id = experience.id
            fact.normalized_value = {**(fact.normalized_value or {}), "experience_id": experience.id}


def _row(entity):
    if entity is None:
        return None
    output = {}
    for column in inspect(entity).mapper.column_attrs:
        value = getattr(entity, column.key)
        if isinstance(value, Enum):
            value = value.value
        elif isinstance(value, datetime):
            value = value.isoformat()
        output[column.key] = value
    return output


app = create_app()
