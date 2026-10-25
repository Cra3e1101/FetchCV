from __future__ import annotations

from .startup_trace import mark_python_entry, mark_startup

mark_python_entry()

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from enum import Enum
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
from sqlalchemy import delete, func, select, update
from sqlalchemy.inspection import inspect
from sqlalchemy.orm import Session, object_session

from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_agent.schemas import JobPostingExtraction
from applyos_agent.model_protocol import strip_model_protocol
from applyos_agent.interview_source_hints import (
    current_source_hints, invalidate_source_hint_edges, read_source_hints, refresh_source_hints,
)
from applyos_domain.knowledge_search import search_knowledge, source_metadata
from applyos_domain.database import Database, get_database
from applyos_domain.enums import FactSourceType, QualityStatus
from applyos_domain.models import AgentMessage, AgentRun, AgentRunStep, AgentSkill, AgentTask, Application, Approval, Candidate, Experience, Fact, InterviewBrief, InterviewSource, Job, JobProfile, MaterialAsset, McpServerConfig, PortfolioVersion, QualityReport, QueuedAgentMessage, ResumeVersion, RewriteProposal, ToolInvocation, VersionSnapshot
from applyos_domain.paths import artifact_root
from applyos_domain.repositories import CandidateRepository, FactRepository, JobRepository, ResumeVersionRepository
from applyos_harness.approval import ApprovalService
from applyos_harness.assets import AssetService
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolPermission
from applyos_harness.policy import general_settings, permission_settings, save_general_settings, save_permission_settings, granted_permissions
from applyos_harness.state_machine import PipelineStage, RunStateMachine
from applyos_harness.trace import TraceService
from applyos_harness.versioning import VersionService, canonical_hash
from applyos_harness.gates import require_resume_exportable, require_pdf_text_matches_resume, resume_semantic_payload

from .evidence_review import EvidenceReviewInput, review_source, refresh_briefs
from .deps import get_session
from .pi_bridge import router as pi_agent_router
from .conversations import router as conversations_router
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
    ApprovalDraftRequest,
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
    ProposalRewriteRequest,
    ProposalRewriteCancelRequest,
    ResumeVersionRead,
    ResumeEditorUpdate,
    RunBoundAction,
    RuntimeStatusRead,
    StartupReadyRequest,
    QueuedMessageRead,
    AgentSkillRead,
    SkillStateUpdate,
    ToolInvocationResolution,
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

# Endpoint capabilities are intentionally imported on first use. Importing the
# complete Agent/PDF/MCP graph before /health is available added several seconds
# to every desktop launch even when the user only opened the workspace.
def _browser_bridge():
    from applyos_agent.browser_tools import BrowserBridgeClient

    return BrowserBridgeClient()


def _context_manager(session: Session):
    from applyos_agent.context import ContextManager

    return ContextManager(session)


def _agent_service(session: Session):
    from applyos_agent.service import AgentService

    return AgentService(session)


def _task_queue(session: Session):
    from applyos_agent.task_queue import TaskQueue

    return TaskQueue(session)




def _agent_run_evaluator(session: Session):
    from applyos_agent.evaluation import AgentRunEvaluator

    return AgentRunEvaluator(session)


def _ats_readiness_evaluator(session: Session):
    from applyos_agent.ats import AtsReadinessEvaluator

    return AtsReadinessEvaluator(session)


def _mcp_manager(session: Session):
    from applyos_agent.mcp_tools import McpManager

    return McpManager(session)


def _skill_loader(session: Session, project_root):
    from applyos_agent.skills import SkillLoader

    return SkillLoader(session, project_root=project_root)


def _pdf_importer(database: Database):
    from integrations.resume_pdf.importer import PdfResumeImporter

    return PdfResumeImporter(database)


def _web_client():
    from integrations.web import WebClient

    return WebClient()


def _job_posting_importer(session: Session):
    from integrations.web import FirecrawlClient, JobPostingImporter

    web = _web_client()
    return JobPostingImporter(session, web_client=web, firecrawl_client=FirecrawlClient(web_client=web), browser_client=_browser_bridge())


def _looks_like_job_content(text: str) -> bool:
    from integrations.web.job_posting import looks_like_job_content

    return looks_like_job_content(text)


def create_app(database: Database | None = None) -> FastAPI:
    db = database or get_database()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        db.create_schema(on_stage=mark_startup)
        # Legacy snapshot repair is maintenance, not a prerequisite for serving
        # the workspace. Run it after the API is available so pypdf does not
        # block every cold launch.
        def repair_imported_snapshots() -> None:
            try:
                _pdf_importer(db).repair_imported_snapshots()
            except Exception:
                # A failed repair is retried on the next launch and must never
                # make the local API unavailable.
                return

        repair_timer = threading.Timer(5.0, repair_imported_snapshots)
        repair_timer.name = "fetchcv-resume-repair"
        repair_timer.daemon = True
        repair_timer.start()
        try:
            mark_startup("python.lifespan_ready")
            yield
        finally:
            repair_timer.cancel()

    app = FastAPI(title="FetchCV Local API", version="0.4.1", lifespan=lifespan)
    app.include_router(pi_agent_router)
    app.include_router(conversations_router)
    app.state.database = db
    control_token = os.getenv("FETCHCV_CONTROL_TOKEN", "").strip()
    instance_nonce = os.getenv("FETCHCV_INSTANCE_NONCE", "")
    app.state.agent_ready = os.getenv("FETCHCV_DESKTOP_STARTUP_GATE", "") != "1"
    startup_routes = {"/api/runtime/configure", "/api/pi/hosts/reconcile", "/api/runtime/startup-ready"}
    configured_origins = [item.strip() for item in os.getenv("FETCHCV_ALLOWED_ORIGINS", "null,http://127.0.0.1:4173").split(",") if item.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Idempotency-Key", "X-FetchCV-Control-Token", "X-FetchCV-Page-Count", "X-FetchCV-Resume-Hash"],
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    @app.middleware("http")
    async def require_desktop_session(request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path == "/health":
            return await call_next(request)
        if not control_token and database is None:
            return JSONResponse(status_code=503, content={"detail": "desktop_control_token_required"})
        if control_token:
            provided = request.headers.get("x-fetchcv-control-token") or request.query_params.get("fetchcv_token") or ""
            if not hmac.compare_digest(control_token, provided):
                return JSONResponse(status_code=403, content={"detail": "desktop_session_forbidden"})
        if request.url.path.startswith("/artifacts/"):
            # Static files otherwise bypass every resume PDF/DOCX gate. Use
            # resolved Windows paths, including case/backslash aliases.
            try:
                artifact_path = (artifact_root() / request.url.path[len("/artifacts/"):]).resolve()
                is_resume_artifact = artifact_path.is_relative_to((artifact_root() / "resumes").resolve())
            except (ValueError, OSError):
                is_resume_artifact = True
            if is_resume_artifact:
                return JSONResponse(status_code=403, content={"detail": "resume_artifact_requires_verified_api", "message": "简历产物请通过已核验的 PDF 或 DOCX 接口读取"})
        if not app.state.agent_ready:
            is_startup_request = request.method == "POST" and request.url.path in startup_routes
            is_export = bool(re.fullmatch(r"/api/resumes/[^/]+/docx/?", request.url.path))
            if is_export or (request.method not in {"GET", "HEAD"} and not is_startup_request):
                return JSONResponse(status_code=503, content={"detail": "agent_startup_pending"}, headers={"Retry-After": "1"})
        return await call_next(request)

    artifacts = artifact_root()
    app.mount("/artifacts", StaticFiles(directory=artifacts, html=True), name="artifacts")

    @app.exception_handler(HarnessError)
    async def harness_error_handler(_: Request, exc: HarnessError):
        if exc.code.endswith("_not_found"):
            code = 404
        elif "permission" in exc.code or "approval_required" in exc.code:
            code = 403
        elif exc.code in {"illegal_state_transition", "terminal_state", "idempotency_conflict", "approval_revision_conflict",
                          "approval_target_changed", "approval_already_decided", "proposal_rewrite_pending", "proposal_rewrite_request_changed"}:
            code = 409
        else:
            code = 422
        return JSONResponse(status_code=code, content=exc.as_dict())

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "fetchcv-api", "database": "ready", "instance_nonce": os.getenv("FETCHCV_INSTANCE_NONCE", "")}

    @app.post("/api/runtime/startup-ready")
    def startup_ready(payload: StartupReadyRequest, x_fetchcv_control_token: Annotated[str | None, Header()] = None):
        if not control_token or not x_fetchcv_control_token or not hmac.compare_digest(control_token, x_fetchcv_control_token):
            raise HTTPException(status_code=403, detail="runtime_configuration_forbidden")
        if not instance_nonce or not hmac.compare_digest(instance_nonce.encode(), payload.instance_nonce.encode()):
            raise HTTPException(status_code=403, detail="startup_instance_mismatch")
        app.state.agent_ready = True
        return {"agent_ready": True}

    @app.get("/api/runtime/status", response_model=RuntimeStatusRead)
    def runtime_status():
        settings = AgentSettings.from_env()
        return {
            "runtime": settings.runtime.value,
            "model": settings.model,
            "configured": settings.runtime.value != "mock" and settings.api_key_configured,
            "sdk_version": "pi-agent-core@0.80.10",
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
        from applyos_agent.provider_options import validate_request_options
        try:
            request_options = validate_request_options(payload.request_options, protocol)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        os.environ.update(
            {
                "FETCHCV_AGENT_RUNTIME": "compatible",
                "FETCHCV_PROVIDER_NAME": payload.provider_name.strip() or "Custom provider",
                "FETCHCV_PROVIDER_PROTOCOL": protocol,
                "FETCHCV_PROVIDER_BASE_URL": base_url,
                "FETCHCV_PROVIDER_API_KEY": payload.api_key.strip(),
                "FETCHCV_PROVIDER_MODEL": payload.model.strip(),
                "FETCHCV_PROVIDER_REQUEST_OPTIONS": json.dumps(request_options),
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
            "FETCHCV_PROVIDER_REQUEST_OPTIONS",
        ):
            os.environ.pop(key, None)
        os.environ["FETCHCV_AGENT_RUNTIME"] = "mock"
        return runtime_status()

    @app.get("/api/skills", response_model=list[AgentSkillRead])
    def list_skills(session: SessionDep):
        if not app.state.agent_ready:
            return _skill_loader(session, AgentSettings.from_env().workspace_root).visible()
        loader = _skill_loader(session, AgentSettings.from_env().workspace_root)
        return loader.sync()

    @app.post("/api/skills/reload", response_model=list[AgentSkillRead])
    def reload_skills(session: SessionDep):
        return _skill_loader(session, AgentSettings.from_env().workspace_root).sync()

    @app.get("/api/browser/status")
    def browser_status():
        return _browser_bridge().status()

    @app.post("/api/browser/close")
    def browser_close():
        return _browser_bridge().close()

    @app.patch("/api/skills/{skill_id}", response_model=AgentSkillRead)
    def update_skill(skill_id: str, payload: SkillStateUpdate, session: SessionDep):
        skill = session.get(AgentSkill, skill_id)
        if skill is None:
            raise HTTPException(status_code=404, detail="skill_not_found")
        if payload.enabled:
            expected_hash = payload.content_hash or skill.content_hash
            _skill_loader(session, AgentSettings.from_env().workspace_root).sync()
            if (skill.metadata_json or {}).get("shadowed_by"):
                raise HTTPException(status_code=409, detail="skill_shadowed")
            if skill.content_hash != expected_hash:
                raise HTTPException(status_code=409, detail="skill_content_changed")
        if not (skill.metadata_json or {}).get("available", True) and payload.enabled:
            raise HTTPException(status_code=409, detail="skill_file_unavailable")
        skill.enabled = payload.enabled
        skill.metadata_json = {
            **(skill.metadata_json or {}),
            "trusted_hash": skill.content_hash if payload.enabled else (skill.metadata_json or {}).get("trusted_hash"),
            "trust_pending": False if payload.enabled else (skill.metadata_json or {}).get("trust_pending", False),
            "change_reason": None if payload.enabled else (skill.metadata_json or {}).get("change_reason"),
        }
        session.flush()
        return skill

    @app.post("/api/mcp/servers", response_model=McpServerRead, status_code=status.HTTP_201_CREATED)
    def create_mcp_server(payload: McpServerCreate, session: SessionDep):
        if session.scalar(select(McpServerConfig).where(McpServerConfig.name == payload.name)):
            raise HTTPException(status_code=409, detail="mcp_server_name_exists")
        server = McpServerConfig(name=payload.name, transport=payload.transport, command=payload.command, args_json=payload.args, cwd=payload.cwd, env_keys=payload.env_keys)
        _mcp_manager(session).validate(server)
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
        _mcp_manager(session).validate(server)
        server.approved = True
        server.status = "approved"
        session.flush()
        return server

    @app.post("/api/mcp/servers/{server_id}/probe", response_model=McpServerRead)
    def probe_mcp_server(server_id: str, session: SessionDep):
        server = require_mcp(session, server_id)
        _mcp_manager(session).probe(server)
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
        from applyos_domain.job_context import normalize_context, normalize_provenance
        from integrations.web import WebClient
        values = payload.model_dump()
        values["jd_raw"] = str(values.get("jd_raw") or "").strip() or None
        values["source_url"] = WebClient.redact_url(values["source_url"]) if values.get("source_url") else None
        values["context_json"] = normalize_context(values["context_json"], values["jd_raw"] or "")
        values["jd_provenance"] = normalize_provenance(values["jd_provenance"], values["jd_raw"] or "", values["source_url"])
        return JobRepository(session).add(Job(**values))

    @app.patch("/api/jobs/{job_id}", response_model=JobRead)
    def update_job(job_id: str, payload: JobUpdate, session: SessionDep):
        from applyos_domain.job_context import normalize_context, normalize_provenance, job_input_signature, mark_job_analyses_stale
        from integrations.web import WebClient
        job = _require_job(session, job_id)
        previous = job_input_signature(job)
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
            job.source_url = WebClient.redact_url(payload.source_url.strip()) or None
        job.context_json = normalize_context(payload.context_json.model_dump() if payload.context_json is not None else job.context_json, job.jd_raw or "")
        job.jd_provenance = normalize_provenance(payload.jd_provenance if payload.jd_provenance is not None else job.jd_provenance,
                                               job.jd_raw or "", job.source_url)
        if previous != job_input_signature(job):
            mark_job_analyses_stale(session, job, reason="job_input_changed")
        session.flush()
        if payload.jd_raw is not None:
            refresh_briefs(session, job.candidate_id)
        return job

    @app.post("/api/web/search")
    def search_public_web(payload: WebSearchRequest, session: SessionDep):
        if permission_settings(session).get("web_access") == "deny":
            raise HTTPException(status_code=403, detail="web_access_disabled")
        results = _web_client().search(payload.query, max_results=payload.max_results)
        return {"query": payload.query, "results": [item.__dict__ for item in results]}

    @app.post("/api/web/read")
    def read_public_web(payload: WebPageReadRequest, session: SessionDep):
        if permission_settings(session).get("web_access") == "deny":
            raise HTTPException(status_code=403, detail="web_access_disabled")
        page = _web_client().read_page(payload.url, max_chars=payload.max_chars)
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
        posting = _job_posting_importer(session).preview(payload.url, allow_insufficient=True)
        return posting.as_dict()

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
        job = _require_job(session, job_id)
        result = _job_posting_importer(session).import_into_job(
            job,
            url=payload.url,
            overwrite=payload.overwrite,
        )
        refresh_briefs(session, job.candidate_id)
        return result

    @app.delete("/api/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_job(job_id: str, session: SessionDep):
        job = _require_job(session, job_id)
        run_ids = list(session.scalars(select(AgentRun.id).where(AgentRun.job_id == job.id)).all())
        resume_ids = list(session.scalars(select(ResumeVersion.id).where(ResumeVersion.job_id == job.id)).all())
        if run_ids:
            from applyos_domain.models import ToolResultArchive
            session.execute(delete(ToolResultArchive).where(ToolResultArchive.scope.in_(["run:" + ident for ident in run_ids])))
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
        if app.state.agent_ready:
            _backfill_candidate_experiences(session, candidate_id)
        facts = list(session.scalars(select(Fact).where(Fact.candidate_id == candidate_id).order_by(Fact.updated_at.desc())).all())
        experiences = list(session.scalars(select(Experience).where(Experience.candidate_id == candidate_id).order_by(Experience.sort_order, Experience.updated_at.desc())).all())
        materials = list(session.scalars(select(MaterialAsset).where(MaterialAsset.candidate_id == candidate_id).order_by(MaterialAsset.updated_at.desc())).all())
        resumes = list(session.scalars(select(ResumeVersion).where(ResumeVersion.candidate_id == candidate_id, ResumeVersion.job_id.is_(None)).order_by(ResumeVersion.updated_at.desc())).all())
        interview_sources = list(session.scalars(select(InterviewSource).where(InterviewSource.candidate_id == candidate_id).order_by(InterviewSource.updated_at.desc())).all())
        interview_briefs = list(session.scalars(select(InterviewBrief).where(InterviewBrief.candidate_id == candidate_id).order_by(InterviewBrief.updated_at.desc())).all())
        return {"candidate": _row(candidate), "facts": [_row(item) for item in facts], "experiences": [_row(item) for item in experiences], "materials": [_row(item) for item in materials], "resumes": [_row(item) for item in resumes], "interview_sources": [_interview_source_row(item) for item in interview_sources], "interview_briefs": [_row(item) for item in interview_briefs]}

    @app.get("/api/interview-knowledge")
    def all_interview_knowledge(session: SessionDep, q: str = Query(default="", max_length=500)):
        sources = search_knowledge(session, query=q, limit=None)
        briefs = search_knowledge(session, query=q, kind="brief", limit=None)
        return {"sources": [_interview_hit_metadata(hit) for hit in sources], "briefs": [_row(hit.item) for hit in briefs]}

    @app.get("/api/candidates/{candidate_id}/interview-knowledge")
    def get_interview_knowledge(candidate_id: str, session: SessionDep, q: str = Query(default="", max_length=500)):
        if CandidateRepository(session).get(candidate_id) is None:
            raise HTTPException(status_code=404, detail="candidate_not_found")
        sources = search_knowledge(session, query=q, candidate_id=candidate_id, limit=None)
        briefs = search_knowledge(session, query=q, candidate_id=candidate_id, kind="brief", limit=None)
        return {"sources": [_interview_hit_metadata(hit) for hit in sources], "briefs": [_row(hit.item) for hit in briefs], "query": q}

    @app.get("/api/interview-sources/{source_id}")
    def get_interview_source(source_id: str, session: SessionDep):
        source = session.get(InterviewSource, source_id)
        if source is None:
            raise HTTPException(status_code=404, detail="interview_source_not_found")
        return _interview_source_detail(source, session)

    @app.post("/api/interview-sources/{source_id}/review")
    def review_interview_source(source_id: str, payload: EvidenceReviewInput, session: SessionDep):
        source = session.get(InterviewSource, source_id)
        if source is None:
            raise HTTPException(status_code=404, detail="interview_source_not_found")
        review_source(session, source, payload)
        return _interview_source_detail(source, session)

    @app.post("/api/interview-sources/{source_id}/confirm-ocr")
    def confirm_interview_ocr(source_id: str, payload: dict, session: SessionDep):
        from hashlib import sha256
        source = session.get(InterviewSource, source_id)
        if source is None:
            raise HTTPException(status_code=404, detail="interview_source_not_found")
        metadata = dict(source.metadata_json or {})
        text = str(metadata.get("ocr_text") or "")
        if source.status != "ocr_pending" or metadata.get("ocr_status") != "completed" or not text.strip():
            raise HarnessError("ocr_not_ready", "OCR 尚未完成或已确认")
        if payload.get("confirmed") is not True or payload.get("reviewed_text") != text:
            raise HarnessError("ocr_review_changed", "请核对当前 OCR 文本后再确认")
        source.raw_text = ((source.raw_text or "") + "\n\n" + text).strip()
        source.content_hash = sha256(source.raw_text.encode()).hexdigest()
        source.status = "captured"
        source.metadata_json = {**metadata, "ocr_reviewed": True, "ocr_reviewed_hash": sha256(text.encode()).hexdigest(), "ocr_reviewed_at": datetime.now(timezone.utc).isoformat()}
        session.flush()
        refresh_source_hints(session, source)
        refresh_briefs(session, source.candidate_id)
        return _interview_source_detail(source, session)

    @app.delete("/api/interview-sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_interview_source(source_id: str, session: SessionDep):
        from applyos_agent.interview_evidence import evidence_summary, evidence_status
        source = session.get(InterviewSource, source_id)
        if source is None:
            raise HTTPException(status_code=404, detail="interview_source_not_found")
        candidate_id = source.candidate_id
        invalidate_source_hint_edges(session, candidate_id, source.id)
        briefs = list(session.scalars(select(InterviewBrief).where(InterviewBrief.candidate_id == candidate_id)))
        for brief in briefs:
            if source_id in (brief.source_ids or []):
                brief.source_ids = [i for i in brief.source_ids if i != source_id]
                brief.common_questions = [{**q, "source_ids":[i for i in q.get("source_ids", []) if i != source_id]}
                    for q in brief.common_questions or [] if any(i != source_id for i in q.get("source_ids", []))]
        session.delete(source)
        session.flush()
        refresh_briefs(session, candidate_id)

    @app.delete("/api/interview-briefs/{brief_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_interview_brief(brief_id: str, session: SessionDep):
        brief = session.get(InterviewBrief, brief_id)
        if brief is None:
            raise HTTPException(status_code=404, detail="interview_brief_not_found")
        session.delete(brief)

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
        from applyos_agent.ats import AtsReadinessInputs
        from applyos_agent.context import PinnedContextInputs
        from applyos_agent.evaluation import RunEvaluationInputs

        job = _require_job(session, job_id)
        candidate = session.get(Candidate, job.candidate_id)
        run = session.scalar(select(AgentRun).where(AgentRun.job_id == job.id).order_by(AgentRun.created_at.desc()).limit(1))
        steps = [] if run is None else list(session.scalars(select(AgentRunStep).where(AgentRunStep.run_id == run.id).order_by(AgentRunStep.sequence)).all())
        proposals = [] if run is None else list(session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id).order_by(RewriteProposal.created_at)).all())
        approvals = [] if run is None else list(session.scalars(select(Approval).where(Approval.run_id == run.id).order_by(Approval.created_at)).all())
        resumes = list(session.scalars(select(ResumeVersion).where(ResumeVersion.job_id == job.id).order_by(ResumeVersion.updated_at.desc(), ResumeVersion.id.desc())).all())
        base_resumes = list(
            session.scalars(
                select(ResumeVersion)
                .where(
                    ResumeVersion.candidate_id == job.candidate_id,
                    ResumeVersion.job_id.is_(None),
                )
                .order_by(ResumeVersion.updated_at.desc())
            ).all()
        )
        portfolios = list(session.scalars(select(PortfolioVersion).where(PortfolioVersion.job_id == job.id).order_by(PortfolioVersion.updated_at.desc())).all())
        applications = list(session.scalars(select(Application).where(Application.job_id == job.id).order_by(Application.updated_at.desc())).all())
        quality = [] if run is None else list(session.scalars(select(QualityReport).where(QualityReport.run_id == run.id).order_by(QualityReport.created_at.desc())).all())
        materials = list(
            session.scalars(
                select(MaterialAsset)
                .where(MaterialAsset.candidate_id == job.candidate_id)
                .order_by(MaterialAsset.updated_at.desc())
            ).all()
        )
        messages = list(session.scalars(select(AgentMessage).where(AgentMessage.job_id == job.id).order_by(AgentMessage.created_at)).all())
        tasks = [] if run is None else list(session.scalars(select(AgentTask).where(AgentTask.run_id == run.id).order_by(AgentTask.created_at)).all())
        tool_invocations = [] if run is None else list(
            session.scalars(
                select(ToolInvocation)
                .where(ToolInvocation.run_id == run.id)
                .order_by(ToolInvocation.created_at.desc())
            ).all()
        )
        queued_messages = list(session.scalars(select(QueuedAgentMessage).where(QueuedAgentMessage.job_id == job.id).order_by(QueuedAgentMessage.sequence)).all())
        interview_sources = _job_interview_source_summaries(session, job.id)
        interview_briefs = list(session.scalars(select(InterviewBrief).where(InterviewBrief.job_id == job.id).order_by(InterviewBrief.updated_at.desc())).all())
        profile = session.scalar(select(JobProfile).where(JobProfile.job_id == job.id))
        if app.state.agent_ready:
            _backfill_candidate_experiences(session, job.candidate_id)
        facts = list(session.scalars(select(Fact).where(Fact.candidate_id == job.candidate_id).order_by(Fact.verified.desc(), Fact.updated_at.desc())).all())
        experiences = list(session.scalars(select(Experience).where(Experience.candidate_id == job.candidate_id).order_by(Experience.sort_order, Experience.updated_at.desc())).all())
        from applyos_domain.job_context import artifact_job_relevance
        return {
            "job": _row(job), "candidate": _row(candidate), "profile": _row(profile), "facts": [_row(item) for item in facts], "experiences": [_row(item) for item in experiences],
            "run": _row(run), "steps": [_row(item) for item in steps], "proposals": [{**_row(item), "job_relevance": artifact_job_relevance(profile, item.id, "proposal", job.input_revision)} for item in proposals],
            "approvals": [_row(item) for item in approvals], "resumes": [{**_row(item), "job_relevance": artifact_job_relevance(profile, item.id, "resume", job.input_revision)} for item in resumes],
            "base_resumes": [_row(item) for item in base_resumes],
            "portfolios": [_row(item) for item in portfolios], "applications": [_row(item) for item in applications],
            "quality_reports": [_row(item) for item in quality],
            "materials": [_row(item) for item in materials],
            "messages": [_row(item) for item in messages],
            "tasks": [_row(item) for item in tasks],
            "tool_invocations": [_row(item) for item in tool_invocations],
            "queued_messages": [_row(item) for item in queued_messages],
            "interview_sources": interview_sources,
            "interview_briefs": [_row(item) for item in interview_briefs],
            "run_evaluation": _agent_run_evaluator(session).evaluate(
                job=job,
                run=run,
                inputs=RunEvaluationInputs(
                    steps=steps, tasks=tasks, approvals=approvals, reports=quality,
                    profile=profile, resume=resumes[0] if resumes else None, messages=messages,
                    pinned_inputs=PinnedContextInputs(
                        job_id=job.id, candidate_id=job.candidate_id,
                        base_resumes=base_resumes, job_resumes=resumes, facts=facts,
                        materials=materials, messages=messages,
                    ),
                ),
            ),
            "ats_readiness": _ats_readiness_evaluator(session).evaluate(
                job=job,
                run=run,
                resume=resumes[0] if resumes else (base_resumes[0] if base_resumes else None),
                inputs=AtsReadinessInputs(profile=profile, reports=quality),
            ),
        }

    @app.post("/api/jobs/{job_id}/messages", status_code=status.HTTP_201_CREATED)
    def create_job_message(job_id: str, payload: AgentMessageCreate, session: SessionDep):
        raise HTTPException(status_code=409, detail="desktop_agent_required")

    @app.post("/api/jobs/{job_id}/messages/stream")
    async def stream_job_message(job_id: str, payload: AgentMessageCreate, request: Request):
        raise HTTPException(status_code=409, detail="desktop_agent_required")

    @app.post("/api/jobs/{job_id}/analyze")
    def analyze_job(job_id: str, payload: RunBoundAction | None, session: SessionDep):
        raise HTTPException(status_code=410, detail="use_pi_domain_tools")

    @app.post("/api/jobs/{job_id}/resume-strategy")
    def create_resume_strategy(job_id: str, payload: RunBoundAction | None, session: SessionDep):
        raise HTTPException(status_code=410, detail="use_pi_domain_tools")

    @app.post("/api/imports/legacy-resume", response_model=LegacyImportResult)
    def import_legacy(payload: LegacyImportRequest, request: Request):
        from integrations.legacy_resume.importer import LegacyWorkspaceImporter

        return LegacyWorkspaceImporter(request.app.state.database).import_file(payload.source_path)

    @app.post("/api/imports/resume-pdf/preview", response_model=PdfResumePreviewRead)
    def preview_pdf_resume(payload: PdfResumePreviewRequest, request: Request):
        try:
            return _pdf_importer(request.app.state.database).preview(
                payload.source_path,
                ai_enhanced=payload.ai_enhanced,
            )
        except (ValueError, OSError) as exc:
            raise HarnessError("pdf_import_invalid", str(exc)) from exc

    @app.post("/api/imports/resume-pdf", response_model=PdfResumeImportRead)
    def import_pdf_resume(payload: PdfResumeImportRequest, request: Request):
        try:
            return _pdf_importer(request.app.state.database).import_file(
                payload.source_path,
                candidate_id=payload.candidate_id,
                candidate_name=payload.candidate_name,
                candidate_title=payload.candidate_title,
                ai_enhanced=payload.ai_enhanced,
                reviewed_preview=payload.reviewed_preview,
            )
        except (ValueError, OSError) as exc:
            raise HarnessError("pdf_import_invalid", str(exc)) from exc

    @app.post("/api/agent-runs", response_model=AgentRunRead, status_code=status.HTTP_201_CREATED)
    def create_agent_run(payload: AgentRunCreate, session: SessionDep, idempotency_key: Annotated[str, Header(alias="Idempotency-Key")]):
        if payload.auto_start:
            raise HTTPException(status_code=409, detail="desktop_agent_required")
        from applyos_agent.pi_domain_tools import PiDomainPipeline

        return PiDomainPipeline(session).create_run(candidate_id=payload.candidate_id, job_id=payload.job_id, idempotency_key=idempotency_key)

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
        raise HTTPException(status_code=409, detail="desktop_agent_required")

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
        return _task_queue(session).request_pause(require_task(session, task_id))

    @app.post("/api/agent-tasks/{task_id}/resume", response_model=AgentTaskRead)
    def resume_agent_task(task_id: str, session: SessionDep):
        raise HTTPException(status_code=409, detail="desktop_agent_required")

    @app.post("/api/agent-tasks/{task_id}/retry", response_model=AgentTaskRead)
    def retry_agent_task(task_id: str, session: SessionDep):
        raise HTTPException(status_code=409, detail="desktop_agent_required")

    @app.post("/api/agent-tasks/{task_id}/cancel", response_model=AgentTaskRead)
    def cancel_agent_task(task_id: str, session: SessionDep):
        return _task_queue(session).request_cancel(require_task(session, task_id))

    @app.post("/api/jobs/{job_id}/messages/queue", response_model=QueuedMessageRead, status_code=status.HTTP_202_ACCEPTED)
    def queue_job_message(job_id: str, payload: AgentMessageCreate, session: SessionDep):
        raise HTTPException(status_code=409, detail="desktop_agent_required")

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
        raise HTTPException(status_code=409, detail="desktop_agent_required")

    @app.post("/api/agent-runs/{run_id}/retry", response_model=AgentRunRead)
    def retry_agent_run(run_id: str, session: SessionDep):
        raise HTTPException(status_code=409, detail="desktop_agent_required")

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
            payload={"fact_ids": fact_ids, "fact_snapshots": [
                {"fact_id": fact.id, "fact_version": fact.version,
                 "content_hash": canonical_hash(fact.content)} for fact in facts
            ]},
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
            expected_revision=payload.expected_revision,
            expected_target_content_hash=payload.expected_target_content_hash,
        )

    def require_pending_proposal_review(session: Session, run_id: str, approval_id: str):
        run = _require_run(session, run_id)
        approval = session.get(Approval, approval_id)
        if run.current_stage != "awaiting_user_review":
            raise HarnessError("illegal_state_transition", "当前阶段不能修订待审建议", run_id=run.id, stage=run.current_stage)
        if approval is None or approval.run_id != run.id or approval.action_type != "apply_resume_changes":
            raise HarnessError("approval_not_found", "修改建议审批不存在", run_id=run.id)
        return run, approval

    @app.post("/api/agent-runs/{run_id}/proposals/rewrite", response_model=ApprovalRead)
    def request_proposal_rewrite(run_id: str, payload: ProposalRewriteRequest, session: SessionDep):
        require_pending_proposal_review(session, run_id, payload.approval_id)
        return ApprovalService(session).request_rewrite(**payload.model_dump())

    @app.post("/api/agent-runs/{run_id}/proposals/rewrite/cancel", response_model=ApprovalRead)
    def cancel_proposal_rewrite(run_id: str, payload: ProposalRewriteCancelRequest, session: SessionDep):
        require_pending_proposal_review(session, run_id, payload.approval_id)
        return ApprovalService(session).cancel_rewrite(**payload.model_dump())

    @app.patch("/api/agent-runs/{run_id}/approvals/{approval_id}/draft", response_model=ApprovalRead)
    def save_approval_draft(run_id: str, approval_id: str, payload: ApprovalDraftRequest, session: SessionDep):
        run = _require_run(session, run_id)
        approval = session.get(Approval, approval_id)
        if approval is None or approval.run_id != run.id or approval.action_type != "apply_resume_changes":
            raise HarnessError("approval_not_found", "修改建议审批不存在", run_id=run.id)
        if getattr(approval.status, "value", approval.status) != "pending":
            raise HarnessError("approval_already_decided", "审批已经完成，不能再修改草稿", run_id=run.id)
        return ApprovalService(session).save_review_draft(approval_id=approval.id, **payload.model_dump())

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
        session.execute(update(AgentRun).where(AgentRun.id == run_id).values(current_stage=AgentRun.current_stage))
        run = _require_run(session, run_id)
        approval = session.get(Approval, approval_id)
        if approval is None or approval.run_id != run.id:
            raise HarnessError("approval_not_found", "操作审批不存在", run_id=run.id)
        if not (
            approval.action_type.startswith("workspace_")
            or approval.action_type.startswith("mcp_write:")
            or approval.action_type.startswith("permission:")
            or approval.action_type == "rollback_version_snapshot"
        ):
            raise HarnessError("approval_scope_mismatch", "该审批必须在对应业务流程中处理", run_id=run.id)
        decision_payload = {**(approval.decision_payload or {}), "approved": payload.decision == "approved"}
        service = ApprovalService(session)
        if payload.decision == "approved":
            item = (approval.decision_payload or {}).get("items", [{}])[0]
            tool_name = str(item.get("tool_name") or "")
            arguments = item.get("arguments") or {}
            from applyos_agent.capabilities import CapabilityMode, build_capability_gateway
            gateway = build_capability_gateway(session, settings=AgentSettings.from_env(), mode=CapabilityMode.CONVERSATION)
            if tool_name not in gateway.registry:
                raise HarnessError("approval_revision_conflict", "工具已移除或权限改变，请重新发起操作审批")
            current_operation, _ = gateway._operation_identity(
                run=run, stage=PipelineStage(run.current_stage or PipelineStage.CREATED),
                tool_name=tool_name, arguments=arguments,
            )
            if item.get("operation_id") != current_operation:
                raise HarnessError("approval_revision_conflict", "阶段、目标或工具定义已改变，请重新发起审批")
            approved = service.approve_action(approval_id=approval.id, approved_by=payload.decided_by, payload=decision_payload)
            if approval.action_type.startswith("workspace_") or approval.action_type.startswith("permission:") or approval.action_type == "rollback_version_snapshot":
                from applyos_agent.capabilities import CapabilityMode, build_capability_gateway

                result = gateway.execute(
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

    @app.post("/api/tool-invocations/{operation_id}/resolve")
    def resolve_tool_invocation(operation_id: str, payload: ToolInvocationResolution, session: SessionDep):
        invocation = session.scalar(select(ToolInvocation).where(ToolInvocation.operation_id == operation_id))
        if invocation is None:
            raise HarnessError("tool_invocation_not_found", "工具操作记录不存在")
        if invocation.status != "outcome_unknown":
            raise HarnessError(
                "tool_invocation_not_resolvable",
                "当前工具操作不需要人工核对",
                run_id=invocation.run_id,
                details={"operation_id": operation_id, "status": invocation.status},
            )
        if payload.decision == "completed":
            invocation.status = "completed_verified"
            invocation.result_json = {
                **(invocation.result_json or {}),
                "verified_by_user": True,
                "resolution": "completed",
                "decided_by": payload.decided_by,
            }
        elif payload.decision == "not_executed":
            invocation.status = "retry_authorized"
            invocation.error_json = {
                **(invocation.error_json or {}),
                "resolution": "not_executed",
                "decided_by": payload.decided_by,
            }
        else:
            invocation.status = "outcome_unknown"
        session.flush()
        return _row(invocation)

    @app.get("/api/agent-runs/{run_id}/report", response_model=PipelineReportRead)
    def get_run_report(run_id: str, session: SessionDep):
        return TraceService(session).pipeline_report(_require_run(session, run_id))

    @app.post("/api/resumes/{resume_id}/render")
    def render_resume(resume_id: str, payload: RunBoundAction, session: SessionDep):
        run = _require_run(session, payload.run_id)
        resume = _require_resume(session, resume_id)
        _assert_run_asset_scope(run, resume.candidate_id, resume.job_id)
        require_resume_exportable(session, resume)
        from integrations.resume.renderer import ResumeRenderer

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
        previous_semantics = canonical_hash(resume_semantic_payload(content))
        content["editor_snapshot"] = payload.editor_snapshot
        if canonical_hash(resume_semantic_payload(content)) != previous_semantics:
            content["verification_status"] = "unverified"
            content["verification_issues"] = [{"code": "manual_content_changed", "message": "人工正文修改尚未绑定当前事实版本，需重新核验"}]
        content["editor_source"] = "resume-editor-prototype"
        content.pop("source_pdf_fidelity", None)
        content.pop("page_count", None)
        content.pop("pdf_semantic_hash", None)
        content.pop("pdf_sha256", None)
        resume.content_json = content
        resume.pdf_path = None
        resume.content_hash = canonical_hash(content)
        for report in session.scalars(select(QualityReport).where(
            QualityReport.target_type == "resume_version", QualityReport.target_id == resume.id
        )):
            report.status = QualityStatus.PENDING
            report.checks = [*report.checks, {"code": "content_changed", "passed": False, "status": "stale"}]
            report.warnings = [*report.warnings, "简历已编辑，旧检查已失效，请重新验证"]
        VersionService(session).snapshot_entity(resume, run_id=None, reason="save from embedded resume editor")
        session.flush()
        return resume

    @app.get("/api/resumes/{resume_id}/pdf")
    def get_resume_pdf(resume_id: str, session: SessionDep):
        resume = _require_resume(session, resume_id)
        require_resume_exportable(session, resume)
        pdf_path = Path(resume.pdf_path).resolve() if resume.pdf_path else None
        resume_root = (artifact_root() / "resumes").resolve()
        if pdf_path is None or not pdf_path.is_relative_to(resume_root) or not pdf_path.is_file():
            raise HarnessError("resume_pdf_not_found", "简历 PDF 尚未生成")
        if (resume.content_json.get("pdf_semantic_hash") != canonical_hash(resume_semantic_payload(resume.content_json))
                or resume.content_json.get("pdf_sha256") != hashlib.sha256(pdf_path.read_bytes()).hexdigest()):
            raise HarnessError("resume_pdf_unverified", "PDF 未绑定当前已核验正文，请重新生成")
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename=f"{resume.name}.pdf",
            content_disposition_type="inline",
        )

    @app.get("/api/resumes/{resume_id}/docx")
    def get_resume_docx(resume_id: str, session: SessionDep):
        """Export a parser-friendly Word copy without replacing the canonical PDF."""
        resume = _require_resume(session, resume_id)
        require_resume_exportable(session, resume)
        from integrations.resume.docx_export import DOCX_MIME, render_resume_docx

        target = (artifact_root() / "resumes" / resume.id / "resume-ats.docx").resolve()
        resume_root = (artifact_root() / "resumes").resolve()
        if not target.is_relative_to(resume_root):
            raise HarnessError("path_outside_workspace", "简历产物路径越界")
        render_resume_docx(resume, target)
        return FileResponse(
            target,
            media_type=DOCX_MIME,
            filename=f"{resume.name}-ATS.docx",
            content_disposition_type="attachment",
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
        require_resume_exportable(session, resume)
        expected_hash = request.headers.get("X-FetchCV-Resume-Hash")
        if not expected_hash or expected_hash != canonical_hash(resume.content_json):
            raise HarnessError("resume_pdf_revision_mismatch", "PDF 对应的简历正文版本已变化或未提供，请重新生成")
        payload = await request.body()
        if not payload.startswith(b"%PDF"):
            raise HarnessError("resume_pdf_invalid", "上传内容不是有效的 PDF")
        if len(payload) > 25 * 1024 * 1024:
            raise HarnessError("resume_pdf_too_large", "简历 PDF 不能超过 25MB")
        from io import BytesIO
        from pypdf import PdfReader
        try:
            reader = PdfReader(BytesIO(payload), strict=True)
            if reader.is_encrypted:
                raise ValueError("encrypted")
            page_count = len(reader.pages)
            if page_count < 1:
                raise ValueError("empty")
            extracted_text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception:
            raise HarnessError("resume_pdf_invalid", "无法解析 PDF 的实际页数，请重新导出") from None
        # request.body() yields to concurrent editor saves. Re-read the exact
        # revision before attaching bytes so a stale render cannot win the race.
        session.expire_all()
        session.refresh(resume)
        require_resume_exportable(session, resume)
        if expected_hash != canonical_hash(resume.content_json):
            raise HarnessError("resume_pdf_revision_mismatch", "PDF 渲染期间正文已变化，请重新生成")
        require_pdf_text_matches_resume(resume, extracted_text)
        target = (artifact_root() / "resumes" / resume.id).resolve()
        resume_root = (artifact_root() / "resumes").resolve()
        if not target.is_relative_to(resume_root):
            raise HarnessError("path_outside_workspace", "简历产物路径越界")
        target.mkdir(parents=True, exist_ok=True)
        pdf_path = target / "resume.pdf"
        pending_path = target / "resume.pdf.pending"
        pending_path.write_bytes(payload)
        pending_path.replace(pdf_path)
        versions = VersionService(session)
        versions.snapshot_entity(resume, run_id=None, reason="before:attach canonical editor pdf")
        content = dict(resume.content_json or {})
        content["page_count"] = page_count
        content["pdf_renderer"] = "resume-editor-prototype"
        content["pdf_semantic_hash"] = canonical_hash(resume_semantic_payload(content))
        content["pdf_sha256"] = hashlib.sha256(payload).hexdigest()
        content["pdf_renderer_version"] = 2
        resume.content_json = content
        resume.content_hash = canonical_hash(content)
        resume.pdf_path = str(pdf_path)
        from applyos_harness.gates import PublishGate
        run = session.scalar(select(AgentRun).where(
            AgentRun.candidate_id == resume.candidate_id, AgentRun.job_id == resume.job_id
        ).order_by(AgentRun.created_at.desc()))
        if run is None:
            run = AgentRun(candidate_id=resume.candidate_id, job_id=resume.job_id, run_type="artifact_validation")
            session.add(run)
            session.flush()
        quality = PublishGate(session).evaluate_resume(
            run=run, resume=resume, pdf_generated=pdf_path.is_file(), page_count=page_count, artifact_required=True,
        )
        quality.checks = [*quality.checks, {"code": "artifact_revision", "passed": True, "details": {
            "content_hash": canonical_hash(resume.content_json), "pdf_sha256": hashlib.sha256(payload).hexdigest(),
        }}]
        versions.snapshot_entity(resume, run_id=None, reason="after:attach canonical editor pdf")
        session.flush()
        return {"resume": _row(resume), "pdf_url": f"/api/resumes/{resume.id}/pdf", "page_count": page_count,
                "quality_report": _row(quality)}

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
    if isinstance(entity, MaterialAsset) and entity.kind == "interview_answer":
        from applyos_agent.application_tools import refresh_interview_answer_evidence
        bound_session = object_session(entity)
        if bound_session is not None:
            refresh_interview_answer_evidence(bound_session, entity)
    output = {}
    for column in inspect(entity).mapper.column_attrs:
        value = getattr(entity, column.key)
        if isinstance(value, Enum):
            value = value.value
        elif isinstance(value, datetime):
            value = value.isoformat()
        elif isinstance(entity, AgentMessage) and column.key == "content" and entity.role == "assistant":
            value = strip_model_protocol(value)
        elif isinstance(entity, InterviewSource) and column.key == "metadata_json":
            value = _public_interview_metadata(value)
        output[column.key] = value
    return output


def _public_interview_metadata(metadata) -> dict:
    output = dict(metadata or {})
    output.pop("classification_v1", None)
    output.pop("similarity_v1", None)
    return output


def _interview_hit_metadata(hit) -> dict:
    # Library projections intentionally avoid loading every complete body.
    output = source_metadata(hit)
    output["metadata_json"] = _public_interview_metadata(output.get("metadata_json"))
    return output


def _interview_source_detail(source: InterviewSource, session: Session) -> dict:
    return {**_row(source), "review_content_hash": hashlib.sha256((source.raw_text or "").encode()).hexdigest(),
            "source_hints": read_source_hints(session, source)}


def _interview_source_row(source: InterviewSource, *, session=None) -> dict:
    """Return list-safe source metadata; full captured text is opt-in by ID."""
    output = _row(source)
    raw_text = output.pop("raw_text", "")
    output.pop("content_hash", None)
    output.pop("url_hash", None)
    output["text_preview"] = raw_text[:800]
    output["source_hints"] = read_source_hints(session, source) if session is not None else current_source_hints(source, None)
    return output


def _job_interview_source_summaries(session: Session, job_id: str) -> list[dict]:
    # A workspace needs the preview, not every captured article's full body.
    # Project in SQL so long sources are never materialized in Python here.
    columns = [
        column for column in InterviewSource.__table__.columns
        if column.name not in {"raw_text", "content_hash", "url_hash"}
    ]
    rows = session.execute(
        select(*columns, func.substr(InterviewSource.raw_text, 1, 800).label("text_preview"))
        .where(InterviewSource.job_id == job_id)
        .order_by(InterviewSource.updated_at.desc())
    ).mappings()
    output = []
    for row in rows:
        item = {key: value.isoformat() if isinstance(value, datetime) else value for key, value in row.items()}
        item["metadata_json"] = _public_interview_metadata(item.get("metadata_json"))
        output.append(item)
    return output


app = create_app()
mark_startup("python.imports_complete")
