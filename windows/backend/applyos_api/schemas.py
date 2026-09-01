from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from applyos_domain.enums import FactSourceType


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class CandidateCreate(ApiModel):
    name: str = Field(min_length=1, max_length=160)
    title: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None


class CandidateRead(CandidateCreate):
    id: str
    legacy_id: str | None = None
    created_at: datetime
    updated_at: datetime


class FactCreate(ApiModel):
    category: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1)
    subject_type: str = "candidate"
    subject_id: str | None = None
    normalized_value: dict[str, Any] = Field(default_factory=dict)
    source_type: FactSourceType = FactSourceType.USER_INPUT
    source_reference: str | None = None
    verified: bool = False
    allowed_outputs: list[str] = Field(default_factory=list)


class FactRead(FactCreate):
    id: str
    candidate_id: str
    legacy_source_key: str | None = None
    version: int
    created_at: datetime
    updated_at: datetime


class FactVerification(ApiModel):
    verified: bool = True
    allowed_outputs: list[str] = Field(default_factory=list)


class MaterialAssetCreate(ApiModel):
    kind: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=240)
    source_path: str | None = None
    source_url: str | None = None
    mime_type: str | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class ExperienceCreate(ApiModel):
    kind: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=320)
    source_asset_id: str | None = None
    organization: str | None = None
    role: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    location: str | None = None
    summary: str | None = None
    details_json: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class AgentMessageCreate(ApiModel):
    content: str = Field(min_length=1, max_length=12000)
    thinking_level: str = Field(default="balanced", pattern="^(fast|balanced|deep)$")
    task_kind: str | None = Field(default=None, max_length=80, pattern="^[a-z][a-z0-9_]*$")
    attachment_paths: list[str] = Field(default_factory=list, max_length=10)
    quoted_text: str | None = Field(default=None, max_length=4000)
    quoted_message_id: str | None = Field(default=None, max_length=80)


class JobCreate(ApiModel):
    candidate_id: str
    company: str = Field(min_length=1, max_length=240)
    role: str = Field(min_length=1, max_length=240)
    location: str | None = None
    jd_raw: str | None = None
    source_type: str = "manual"
    source_url: str | None = None
    status: str = "draft"


class JobRead(JobCreate):
    id: str
    legacy_id: str | None = None
    created_at: datetime
    updated_at: datetime


class JobUpdate(ApiModel):
    company: str | None = Field(default=None, min_length=1, max_length=240)
    role: str | None = Field(default=None, min_length=1, max_length=240)
    location: str | None = Field(default=None, max_length=240)
    jd_raw: str | None = Field(default=None, min_length=1)
    source_type: str | None = Field(default=None, max_length=80)
    source_url: str | None = Field(default=None, max_length=4096)


class WebSearchRequest(ApiModel):
    query: str = Field(min_length=2, max_length=500)
    max_results: int = Field(default=5, ge=1, le=8)


class WebPageReadRequest(ApiModel):
    url: str = Field(min_length=8, max_length=4096)
    max_chars: int = Field(default=20000, ge=1000, le=50000)


class JobPageImportRequest(ApiModel):
    url: str | None = Field(default=None, max_length=4096)
    overwrite: bool = False


class JobPostingPreviewRequest(ApiModel):
    url: str = Field(min_length=8, max_length=4096)


class PermissionSettingsRead(ApiModel):
    web_access: Literal["allow", "ask", "deny"] = "allow"
    workspace_read: Literal["allow", "ask", "deny"] = "allow"
    workspace_write: str = "ask"
    file_delete: str = "ask"
    browser_bridge: Literal["allow", "ask", "deny"] = "allow"


class PermissionSettingsUpdate(ApiModel):
    web_access: Literal["allow", "ask", "deny"] | None = None
    workspace_read: Literal["allow", "ask", "deny"] | None = None
    workspace_write: str | None = Field(default=None, pattern="^(ask|deny)$")
    file_delete: str | None = Field(default=None, pattern="^(ask|deny)$")
    browser_bridge: Literal["allow", "ask", "deny"] | None = None


class GeneralSettingsRead(ApiModel):
    accent: Literal["coral", "sage", "slate", "amber"] = "coral"
    density: Literal["comfortable", "compact"] = "comfortable"
    theme: Literal["system", "light", "dark"] = "system"


class GeneralSettingsUpdate(ApiModel):
    accent: Literal["coral", "sage", "slate", "amber"] | None = None
    density: Literal["comfortable", "compact"] | None = None
    theme: Literal["system", "light", "dark"] | None = None


class ResumeEditorUpdate(ApiModel):
    editor_snapshot: dict[str, Any]


class ResumeVersionRead(ApiModel):
    id: str
    legacy_id: str | None = None
    candidate_id: str
    job_id: str | None = None
    name: str
    status: str
    content_json: dict[str, Any]
    source_fact_ids: list[str]
    created_at: datetime
    updated_at: datetime


class PortfolioVersionRead(ApiModel):
    id: str
    candidate_id: str
    job_id: str | None
    resume_version_id: str | None
    status: str
    page_schema: dict[str, Any]
    source_fact_ids: list[str]
    preview_url: str | None
    published_url: str | None
    artifact_path: str | None
    frozen_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ApplicationRead(ApiModel):
    id: str
    candidate_id: str
    job_id: str
    resume_version_id: str | None
    portfolio_version_id: str | None
    status: str
    frozen_at: datetime | None
    created_at: datetime
    updated_at: datetime


class RuntimeStatusRead(ApiModel):
    runtime: str
    model: str
    configured: bool
    sdk_version: str
    provider_name: str = ""
    provider_protocol: str = ""
    provider_base_url: str = ""
    allow_mock_runtime: bool = False


class ProviderRuntimeConfig(ApiModel):
    provider_name: str
    protocol: str
    base_url: str
    api_key: str
    model: str


class RunBoundAction(ApiModel):
    run_id: str


class PortfolioCreate(ApiModel):
    run_id: str
    resume_version_id: str
    mode: str = "mock"


class PortfolioBuild(ApiModel):
    run_id: str
    mode: str | None = None


class ApplicationCreate(ApiModel):
    run_id: str
    resume_version_id: str
    portfolio_version_id: str | None = None
    status: str = "submitted"


class LegacyImportRequest(ApiModel):
    source_path: str


class LegacyImportResult(ApiModel):
    source_path: str
    source_sha256: str
    candidates_created: int = 0
    jobs_created: int = 0
    applications_created: int = 0
    resume_versions_created: int = 0
    facts_created: int = 0
    skipped_existing: int = 0
    warnings: list[str] = Field(default_factory=list)


class PdfResumePreviewRequest(ApiModel):
    source_path: str = Field(min_length=1)
    ai_enhanced: bool = False


class PdfResumeImportRequest(PdfResumePreviewRequest):
    candidate_id: str | None = None
    candidate_name: str | None = None
    candidate_title: str | None = None
    reviewed_preview: dict[str, Any] | None = None


class PdfResumePreviewRead(ApiModel):
    source_path: str
    filename: str
    source_sha256: str
    size_bytes: int
    page_count: int
    text_length: int
    profile: dict[str, str]
    sections: list[dict[str, Any]]
    experiences: list[dict[str, Any]] = Field(default_factory=list)
    facts: list[dict[str, Any]]
    text_preview: str
    outbound_preview: str = ""
    outbound_text_length: int = 0
    outbound_truncated: bool = False
    recognition_mode: str = "local"
    provider: str = ""
    model: str = ""
    redacted_fields: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PdfResumeImportRead(ApiModel):
    candidate_id: str
    resume_id: str
    facts_created: int
    duplicate: bool
    preview: PdfResumePreviewRead


class AgentRunCreate(ApiModel):
    candidate_id: str
    job_id: str
    auto_start: bool = True


class AgentTaskCreate(ApiModel):
    kind: str = Field(default="resume", pattern="^(start|resume|retry)$")
    priority: int = Field(default=100, ge=0, le=1000)
    payload: dict[str, Any] = Field(default_factory=dict)


class AgentTaskRead(ApiModel):
    id: str
    run_id: str
    kind: str
    status: str
    priority: int
    attempt: int
    max_attempts: int
    payload_json: dict[str, Any]
    result_json: dict[str, Any]
    pause_requested: bool
    cancel_requested: bool
    started_at: datetime | None
    completed_at: datetime | None
    error: str | None
    created_at: datetime
    updated_at: datetime


class QueuedMessageRead(ApiModel):
    id: str
    candidate_id: str
    job_id: str
    run_id: str | None
    content: str
    thinking_level: str
    status: str
    sequence: int
    result_message_id: str | None
    error: str | None
    created_at: datetime
    updated_at: datetime


class AgentSkillRead(ApiModel):
    id: str
    name: str
    description: str
    path: str
    content_hash: str
    enabled: bool
    metadata_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class SkillStateUpdate(ApiModel):
    enabled: bool


class McpServerCreate(ApiModel):
    name: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9_-]+$")
    transport: Literal["stdio", "streamable_http"] = "stdio"
    command: str = Field(min_length=1)
    args: list[str] = Field(default_factory=list, max_length=40)
    cwd: str | None = None
    env_keys: list[str] = Field(default_factory=list, max_length=40)


class McpServerUpdate(ApiModel):
    enabled: bool | None = None
    allowed_tools: list[str] | None = None


class McpWriteToolApproval(ApiModel):
    target_type: Literal["resume", "portfolio"]
    target_id_argument: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    confirmation: Literal["approve_write_tool"]


class McpServerRead(ApiModel):
    id: str
    name: str
    transport: str
    command: str
    args_json: list[str]
    cwd: str | None
    env_keys: list[str]
    enabled: bool
    approved: bool
    allowed_tools: list[str]
    tool_policies: dict[str, Any]
    discovered_tools: list[dict[str, Any]]
    status: str
    last_error: str | None
    last_checked_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AgentRunRead(ApiModel):
    id: str
    candidate_id: str
    job_id: str | None
    session_id: str | None
    run_type: str
    status: str
    current_stage: str | None
    resume_stage: str | None
    started_at: datetime | None
    completed_at: datetime | None
    error: str | None
    created_at: datetime
    updated_at: datetime


class AgentRunStepRead(ApiModel):
    id: str
    run_id: str
    stage: str
    agent_name: str
    event_type: str
    actor: str | None
    reason: str | None
    status: str
    sequence: int
    input_refs: list[str]
    output_refs: list[str]
    tool_calls: list[dict[str, Any]]
    usage: dict[str, Any]
    duration_ms: int | None
    error_code: str | None
    error: str | None
    created_at: datetime


class RewriteProposalRead(ApiModel):
    id: str
    resume_version_id: str
    run_id: str | None
    section: str
    before: str
    after: str
    edited_after: str | None
    reason: str
    jd_evidence: list[str]
    fact_ids: list[str]
    risk_level: str
    approval_status: str


class ProposalDecision(ApiModel):
    proposal_id: str
    decision: str
    edited_after: str | None = None


class ProposalReviewRequest(ApiModel):
    approval_id: str
    approved_by: str = "local_user"
    decisions: list[ProposalDecision]


class ApprovalDraftRequest(ApiModel):
    base_revision: int = Field(ge=0)
    decisions: dict[str, dict[str, Any]] = Field(default_factory=dict)
    edited_by: str = "local_user"


class FactSelectionRequest(ApiModel):
    approval_id: str
    fact_ids: list[str] = Field(min_length=1)
    approved_by: str = "local_user"


class ActionApprovalRequest(ApiModel):
    approval_id: str
    approved_by: str = "local_user"


class ActionDecisionRequest(ApiModel):
    decision: Literal["approved", "rejected"]
    decided_by: str = "local_user"


class ToolInvocationResolution(ApiModel):
    decision: Literal["completed", "not_executed", "keep_stopped"]
    decided_by: str = "local_user"


class ApprovalRead(ApiModel):
    id: str
    run_id: str
    action_type: str
    target_type: str
    target_id: str
    status: str
    decision_payload: dict[str, Any]
    approved_by: str | None
    approved_at: datetime | None
    created_at: datetime


class PipelineReportRead(ApiModel):
    run_id: str
    session_id: str | None
    status: str
    current_stage: str | None
    completed_stages: list[str]
    failures: list[dict[str, Any]]
    trace_events: int
    generated_at: str
