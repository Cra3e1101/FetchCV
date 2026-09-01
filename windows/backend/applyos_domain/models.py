from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, new_id, utc_now
from .enums import ApprovalStatus, AssetStatus, FactSourceType, ProposalStatus, QualityStatus, RiskLevel, RunStatus, StepStatus


def enum_type(value: type) -> Enum:
    return Enum(value, native_enum=False, length=40, values_callable=lambda items: [item.value for item in items])


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class Candidate(TimestampMixin, Base):
    __tablename__ = "candidates"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("cand"))
    legacy_id: Mapped[str | None] = mapped_column(String(160), unique=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    title: Mapped[str | None] = mapped_column(String(240))
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(80))
    location: Mapped[str | None] = mapped_column(String(240))

    facts: Mapped[list["Fact"]] = relationship(back_populates="candidate", cascade="all, delete-orphan")
    materials: Mapped[list["MaterialAsset"]] = relationship(back_populates="candidate", cascade="all, delete-orphan")
    experiences: Mapped[list["Experience"]] = relationship(back_populates="candidate", cascade="all, delete-orphan")
    jobs: Mapped[list["Job"]] = relationship(back_populates="candidate", cascade="all, delete-orphan")


class MaterialAsset(TimestampMixin, Base):
    """A source item in the candidate library, not just a parsed resume."""

    __tablename__ = "material_assets"
    __table_args__ = (Index("ix_material_candidate_kind", "candidate_id", "kind"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("material"))
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(240), nullable=False)
    source_path: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    mime_type: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(80), default="ready", nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    candidate: Mapped[Candidate] = relationship(back_populates="materials")


class Experience(TimestampMixin, Base):
    """A complete education, work, project or portfolio entity.

    Atomic facts remain the verification layer; the product UI and resume planner
    operate on these complete entities instead of detached text fragments.
    """

    __tablename__ = "experiences"
    __table_args__ = (
        Index("ix_experience_candidate_kind", "candidate_id", "kind"),
        Index("ix_experience_source", "source_asset_id"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("exp"))
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    source_asset_id: Mapped[str | None] = mapped_column(ForeignKey("material_assets.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(320), nullable=False)
    organization: Mapped[str | None] = mapped_column(String(320))
    role: Mapped[str | None] = mapped_column(String(240))
    start_date: Mapped[str | None] = mapped_column(String(32))
    end_date: Mapped[str | None] = mapped_column(String(32))
    location: Mapped[str | None] = mapped_column(String(240))
    summary: Mapped[str | None] = mapped_column(Text)
    details_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    fact_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    candidate: Mapped[Candidate] = relationship(back_populates="experiences")


class Fact(TimestampMixin, Base):
    __tablename__ = "facts"
    __table_args__ = (Index("ix_facts_candidate_category", "candidate_id", "category"), Index("ix_facts_subject", "subject_type", "subject_id"))

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("fact"))
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    subject_type: Mapped[str] = mapped_column(String(80), default="candidate", nullable=False)
    subject_id: Mapped[str | None] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_value: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    source_type: Mapped[FactSourceType] = mapped_column(enum_type(FactSourceType), default=FactSourceType.LEGACY_IMPORT, nullable=False)
    source_reference: Mapped[str | None] = mapped_column(Text)
    legacy_source_key: Mapped[str | None] = mapped_column(String(255), unique=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allowed_outputs: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    candidate: Mapped[Candidate] = relationship(back_populates="facts")


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_candidate_status", "candidate_id", "status"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("job"))
    legacy_id: Mapped[str | None] = mapped_column(String(160), unique=True)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    company: Mapped[str] = mapped_column(String(240), nullable=False)
    role: Mapped[str] = mapped_column(String(240), nullable=False)
    location: Mapped[str | None] = mapped_column(String(240))
    jd_raw: Mapped[str | None] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String(80), default="manual", nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(80), default="draft", nullable=False)

    candidate: Mapped[Candidate] = relationship(back_populates="jobs")
    profile: Mapped["JobProfile | None"] = relationship(back_populates="job", cascade="all, delete-orphan", uselist=False)


class JobProfile(TimestampMixin, Base):
    __tablename__ = "job_profiles"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("jprof"))
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), unique=True, nullable=False)
    responsibilities: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    hard_requirements: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    preferred_requirements: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    keywords: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    competencies: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    business_context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    uncertain_items: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    source_run_id: Mapped[str | None] = mapped_column(String(40))

    job: Mapped[Job] = relationship(back_populates="profile")


class InterviewSource(TimestampMixin, Base):
    """A captured public interview-experience post with traceable extraction."""

    __tablename__ = "interview_sources"
    __table_args__ = (
        UniqueConstraint("candidate_id", "url_hash", name="uq_interview_source_candidate_url"),
        Index("ix_interview_source_candidate_company", "candidate_id", "company"),
        Index("ix_interview_source_job", "job_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("isrc"))
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"))
    platform: Mapped[str] = mapped_column(String(80), default="xiaohongshu", nullable=False)
    company: Mapped[str] = mapped_column(String(240), nullable=False)
    business_unit: Mapped[str | None] = mapped_column(String(240))
    role: Mapped[str] = mapped_column(String(240), nullable=False)
    title: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    url_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    author: Mapped[str | None] = mapped_column(String(240))
    published_at: Mapped[str | None] = mapped_column(String(80))
    raw_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    extracted_questions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="captured", nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class InterviewBrief(TimestampMixin, Base):
    """A job-level synthesis whose claims point back to captured sources."""

    __tablename__ = "interview_briefs"
    __table_args__ = (
        Index("ix_interview_brief_candidate_company", "candidate_id", "company"),
        Index("ix_interview_brief_job", "job_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ibrief"))
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"))
    run_id: Mapped[str | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"))
    company: Mapped[str] = mapped_column(String(240), nullable=False)
    business_unit: Mapped[str | None] = mapped_column(String(240))
    role: Mapped[str] = mapped_column(String(240), nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    common_questions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    recommendations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    source_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    query_terms: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class ResumeVersion(TimestampMixin, Base):
    __tablename__ = "resume_versions"
    __table_args__ = (CheckConstraint("status != 'frozen' OR frozen_at IS NOT NULL", name="ck_resume_frozen_has_time"), Index("ix_resume_candidate_job", "candidate_id", "job_id"))

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("resume"))
    legacy_id: Mapped[str | None] = mapped_column(String(160), unique=True)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"))
    parent_version_id: Mapped[str | None] = mapped_column(ForeignKey("resume_versions.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(240), nullable=False)
    status: Mapped[AssetStatus] = mapped_column(enum_type(AssetStatus), default=AssetStatus.DRAFT, nullable=False)
    content_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    source_fact_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    pdf_path: Mapped[str | None] = mapped_column(Text)
    content_hash: Mapped[str | None] = mapped_column(String(128))
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PortfolioVersion(TimestampMixin, Base):
    __tablename__ = "portfolio_versions"
    __table_args__ = (CheckConstraint("status != 'frozen' OR frozen_at IS NOT NULL", name="ck_portfolio_frozen_has_time"), Index("ix_portfolio_candidate_job", "candidate_id", "job_id"))

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("portfolio"))
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"))
    resume_version_id: Mapped[str | None] = mapped_column(ForeignKey("resume_versions.id", ondelete="SET NULL"))
    status: Mapped[AssetStatus] = mapped_column(enum_type(AssetStatus), default=AssetStatus.DRAFT, nullable=False)
    page_schema: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    source_fact_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    preview_url: Mapped[str | None] = mapped_column(Text)
    published_url: Mapped[str | None] = mapped_column(Text)
    artifact_path: Mapped[str | None] = mapped_column(Text)
    content_hash: Mapped[str | None] = mapped_column(String(128))
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Application(TimestampMixin, Base):
    __tablename__ = "applications"
    __table_args__ = (Index("ix_application_candidate_status", "candidate_id", "status"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("app"))
    legacy_id: Mapped[str | None] = mapped_column(String(160), unique=True)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    resume_version_id: Mapped[str | None] = mapped_column(ForeignKey("resume_versions.id", ondelete="SET NULL"))
    portfolio_version_id: Mapped[str | None] = mapped_column(ForeignKey("portfolio_versions.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(80), default="planned", nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_action: Mapped[str | None] = mapped_column(Text)
    next_action_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentRun(TimestampMixin, Base):
    __tablename__ = "agent_runs"
    __table_args__ = (Index("ix_agent_run_job_status", "job_id", "status"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("run"))
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"))
    session_id: Mapped[str | None] = mapped_column(String(160))
    idempotency_key: Mapped[str | None] = mapped_column(String(160), unique=True)
    run_type: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[RunStatus] = mapped_column(enum_type(RunStatus), default=RunStatus.CREATED, nullable=False)
    current_stage: Mapped[str | None] = mapped_column(String(160))
    resume_stage: Mapped[str | None] = mapped_column(String(160))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)

    steps: Mapped[list["AgentRunStep"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class AgentMessage(TimestampMixin, Base):
    __tablename__ = "agent_messages"
    __table_args__ = (Index("ix_agent_message_job_created", "job_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("msg"))
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    run_id: Mapped[str | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"))
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class AgentRunStep(TimestampMixin, Base):
    __tablename__ = "agent_run_steps"
    __table_args__ = (UniqueConstraint("run_id", "sequence", "attempt", name="uq_agent_step_run_sequence_attempt"), Index("ix_agent_step_run_status", "run_id", "status"))

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("step"))
    run_id: Mapped[str] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False)
    stage: Mapped[str] = mapped_column(String(160), nullable=False)
    agent_name: Mapped[str] = mapped_column(String(160), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), default="stage", nullable=False)
    actor: Mapped[str | None] = mapped_column(String(160))
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[StepStatus] = mapped_column(enum_type(StepStatus), default=StepStatus.PENDING, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    input_refs: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    output_refs: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    tool_calls: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    usage: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    error_code: Mapped[str | None] = mapped_column(String(120))
    error: Mapped[str | None] = mapped_column(Text)

    run: Mapped[AgentRun] = relationship(back_populates="steps")


class AgentTask(TimestampMixin, Base):
    __tablename__ = "agent_tasks"
    __table_args__ = (Index("ix_agent_task_run_status", "run_id", "status"), Index("ix_agent_task_queue", "status", "priority", "created_at"))

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("task"))
    run_id: Mapped[str] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), default="resume", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="queued", nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    result_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    pause_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    locked_by: Mapped[str | None] = mapped_column(String(120))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)


class QueuedAgentMessage(TimestampMixin, Base):
    __tablename__ = "queued_agent_messages"
    __table_args__ = (Index("ix_queued_message_job_status", "job_id", "status", "created_at"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("qmsg"))
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    run_id: Mapped[str | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    thinking_level: Mapped[str] = mapped_column(String(40), default="balanced", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="queued", nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    result_message_id: Mapped[str | None] = mapped_column(ForeignKey("agent_messages.id", ondelete="SET NULL"))
    error: Mapped[str | None] = mapped_column(Text)


class AgentContextSnapshot(TimestampMixin, Base):
    __tablename__ = "agent_context_snapshots"
    __table_args__ = (Index("ix_context_run_version", "run_id", "version"), Index("ix_context_job_updated", "job_id", "updated_at"))

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("context"))
    run_id: Mapped[str | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"))
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    pinned_context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    compacted_message_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    recent_message_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    token_estimate: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class AgentSkill(TimestampMixin, Base):
    __tablename__ = "agent_skills"
    __table_args__ = (UniqueConstraint("path", name="uq_agent_skill_path"), Index("ix_agent_skill_enabled", "enabled", "name"))

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("skill"))
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class McpServerConfig(TimestampMixin, Base):
    __tablename__ = "mcp_server_configs"
    __table_args__ = (UniqueConstraint("name", name="uq_mcp_server_name"), Index("ix_mcp_server_enabled", "enabled", "approved"))

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("mcp"))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    transport: Mapped[str] = mapped_column(String(40), default="stdio", nullable=False)
    command: Mapped[str] = mapped_column(Text, nullable=False)
    args_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    cwd: Mapped[str | None] = mapped_column(Text)
    env_keys: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allowed_tools: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    tool_policies: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    discovered_tools: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="unconfigured", nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkspaceSetting(TimestampMixin, Base):
    """Small, local-only settings that affect the ToolGateway policy."""

    __tablename__ = "workspace_settings"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    values_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class RewriteProposal(TimestampMixin, Base):
    __tablename__ = "rewrite_proposals"
    __table_args__ = (Index("ix_proposal_resume_status", "resume_version_id", "approval_status"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("proposal"))
    resume_version_id: Mapped[str] = mapped_column(ForeignKey("resume_versions.id", ondelete="CASCADE"), nullable=False)
    run_id: Mapped[str | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"))
    section: Mapped[str] = mapped_column(String(160), nullable=False)
    before: Mapped[str] = mapped_column(Text, nullable=False)
    after: Mapped[str] = mapped_column(Text, nullable=False)
    edited_after: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    jd_evidence: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    fact_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    risk_level: Mapped[RiskLevel] = mapped_column(enum_type(RiskLevel), default=RiskLevel.MEDIUM, nullable=False)
    approval_status: Mapped[ProposalStatus] = mapped_column(enum_type(ProposalStatus), default=ProposalStatus.PENDING, nullable=False)


class Approval(TimestampMixin, Base):
    __tablename__ = "approvals"
    __table_args__ = (Index("ix_approval_run_status", "run_id", "status"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("approval"))
    run_id: Mapped[str] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False)
    action_type: Mapped[str] = mapped_column(String(120), nullable=False)
    target_type: Mapped[str] = mapped_column(String(100), nullable=False)
    target_id: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[ApprovalStatus] = mapped_column(enum_type(ApprovalStatus), default=ApprovalStatus.PENDING, nullable=False)
    decision_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    approved_by: Mapped[str | None] = mapped_column(String(160))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ToolInvocation(TimestampMixin, Base):
    """Durable outbox record for one normalized side-effecting operation.

    A prepared/running row is committed before the handler is entered. If the
    process disappears after the external effect but before its receipt is
    saved, recovery stops with an unknown outcome instead of replaying it.
    """

    __tablename__ = "tool_invocations"
    __table_args__ = (
        UniqueConstraint("operation_id", name="uq_tool_invocation_operation"),
        Index("ix_tool_invocation_run_status", "run_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("toolinv"))
    operation_id: Mapped[str] = mapped_column(String(80), nullable=False)
    run_id: Mapped[str] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(180), nullable=False)
    stage: Mapped[str] = mapped_column(String(160), nullable=False)
    arguments_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    arguments_summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    provider_call_id: Mapped[str | None] = mapped_column(String(240))
    status: Mapped[str] = mapped_column(String(40), default="prepared", nullable=False)
    result_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    error_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class VersionSnapshot(Base):
    __tablename__ = "version_snapshots"
    __table_args__ = (UniqueConstraint("target_type", "target_id", "sequence", name="uq_snapshot_target_sequence"), Index("ix_snapshot_target", "target_type", "target_id"))

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("snapshot"))
    target_type: Mapped[str] = mapped_column(String(100), nullable=False)
    target_id: Mapped[str] = mapped_column(String(80), nullable=False)
    run_id: Mapped[str | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"))
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class QualityReport(Base):
    __tablename__ = "quality_reports"
    __table_args__ = (Index("ix_quality_target", "target_type", "target_id"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("quality"))
    run_id: Mapped[str | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"))
    target_type: Mapped[str] = mapped_column(String(100), nullable=False)
    target_id: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[QualityStatus] = mapped_column(enum_type(QualityStatus), default=QualityStatus.PENDING, nullable=False)
    checks: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    errors: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
