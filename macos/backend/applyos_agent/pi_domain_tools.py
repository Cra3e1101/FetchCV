from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.models import Approval, Fact, JobProfile, MaterialAsset, ResumeVersion, RewriteProposal
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.pipeline import MockPipeline
from applyos_harness.state_machine import PipelineStage
from applyos_harness.validation import Claim, FactValidator, role_strength_risk


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvidenceItemInput(DomainModel):
    text: str = Field(min_length=1, max_length=1200, description="对岗位要求的准确概括")
    source_quote: str = Field(min_length=1, max_length=1200, description="JD 原文中的连续引文，不得改写")


class JobAnalysisInput(DomainModel):
    responsibilities: list[EvidenceItemInput] = Field(min_length=1, max_length=12)
    hard_requirements: list[EvidenceItemInput] = Field(default_factory=list, max_length=16)
    preferred_requirements: list[EvidenceItemInput] = Field(default_factory=list, max_length=12)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    competencies: list[str] = Field(default_factory=list, max_length=20)
    uncertain_items: list[str] = Field(default_factory=list, max_length=12)
    summary: str = Field(min_length=1, max_length=2400, description="面向用户的岗位理解，不要复述内部思维链")


class RankedFactInput(DomainModel):
    fact_id: str = Field(min_length=1, max_length=80)
    recommended: bool
    relevance: Literal["high", "medium", "low"]
    rationale: str = Field(min_length=1, max_length=1000)
    matched_jd_requirements: list[str] = Field(default_factory=list, max_length=10)


class PrepareJobReviewInput(DomainModel):
    analysis: JobAnalysisInput
    fact_ranking: list[RankedFactInput] = Field(
        default_factory=list,
        max_length=120,
        description="只引用 inspect_application_workspace 返回的 fact_id；遗漏项会作为低相关保留",
    )


class FactMatchInput(DomainModel):
    fact_id: str = Field(min_length=1, max_length=80)
    jd_requirement: str = Field(default="", max_length=1200)
    relevance: Literal["high", "medium", "low"] = "low"
    rationale: str = Field(default="", max_length=1000)


class ResumeStrategyInput(DomainModel):
    positioning: str = Field(min_length=1, max_length=2000)
    selected_fact_ids: list[str] = Field(default_factory=list, max_length=120)
    matches: list[FactMatchInput] = Field(default_factory=list, max_length=120)
    section_order: list[str] = Field(default_factory=list, max_length=30)
    warnings: list[str] = Field(default_factory=list, max_length=20)


class ResumePatchInput(DomainModel):
    section: str = Field(min_length=1, max_length=160)
    before: str = Field(min_length=1, max_length=8000, description="原简历或事实中的原文")
    after: str = Field(min_length=1, max_length=8000, description="岗位化改写后的文本，不得新增无法由 fact_ids 支撑的事实")
    reason: str = Field(min_length=1, max_length=1600)
    jd_evidence: list[str] = Field(min_length=1, max_length=8)
    fact_ids: list[str] = Field(min_length=1, max_length=20)
    experience_id: str | None = Field(default=None, max_length=80)
    risk_level: Literal["low", "medium", "high"] = "medium"

    @model_validator(mode="after")
    def changed_text(self):
        if self.before.strip() == self.after.strip():
            raise ValueError("简历补丁必须包含实际改写；无需修改的内容不要创建补丁")
        return self


class PrepareResumeReviewInput(DomainModel):
    strategy: ResumeStrategyInput
    patches: list[ResumePatchInput] = Field(min_length=1, max_length=80)
    summary: str = Field(min_length=1, max_length=2400)


class EmptyInput(DomainModel):
    pass


class DomainToolResult(DomainModel):
    stage: str
    status: str
    summary: str
    artifacts: list[str] = Field(default_factory=list)
    requires_user_action: bool = False
    approval_action: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class PiDomainPipeline(MockPipeline):
    """Deterministic state, approval and rendering services behind Pi tools.

    This class never owns an LLM and never starts another agent loop. Semantic
    decisions arrive as validated Pi tool arguments; this class only persists,
    validates and versions them.
    """

    def __init__(self, session: Session):
        super().__init__(session, execution_mode="pi_native")
        self.proposal_specs: list[dict[str, Any]] = []

    def _proposal_specs(self, run, facts):
        return list(self.proposal_specs)


def _result(
    context: ToolContext,
    summary: str,
    *,
    artifacts: list[str] | None = None,
    approval_action: str | None = None,
    data: dict[str, Any] | None = None,
) -> DomainToolResult:
    return DomainToolResult(
        stage=context.run.current_stage or PipelineStage.CREATED.value,
        status=getattr(context.run.status, "value", context.run.status),
        summary=summary,
        artifacts=artifacts or [],
        requires_user_action=approval_action is not None,
        approval_action=approval_action,
        data=data or {},
    )


def _normalized(value: str) -> str:
    return re.sub(r"\s+", "", value or "").lower()


def _validate_job_evidence(jd: str, analysis: JobAnalysisInput) -> None:
    source = _normalized(jd)
    invalid: list[str] = []
    for item in [*analysis.responsibilities, *analysis.hard_requirements, *analysis.preferred_requirements]:
        quote = _normalized(item.source_quote)
        if not quote or quote not in source:
            invalid.append(item.source_quote)
    if invalid:
        raise HarnessError(
            "jd_evidence_not_found",
            "岗位分析包含无法在 JD 原文中定位的证据，请重新读取原文并提供连续引文",
            details={"invalid_quotes": invalid[:8]},
            retryable=True,
        )


def _facts_for_candidate(session: Session, candidate_id: str) -> list[Fact]:
    return list(
        session.scalars(
            select(Fact)
            .where(Fact.candidate_id == candidate_id)
            .order_by(Fact.verified.desc(), Fact.updated_at.desc())
        ).all()
    )


def _inspect_workspace(context: ToolContext, pipeline: PiDomainPipeline) -> DomainToolResult:
    from .context import ContextManager

    job = pipeline._job(context.run)
    profile = context.session.scalar(select(JobProfile).where(JobProfile.job_id == job.id))
    facts = _facts_for_candidate(context.session, context.run.candidate_id)
    materials = list(
        context.session.scalars(
            select(MaterialAsset)
            .where(MaterialAsset.candidate_id == context.run.candidate_id)
            .order_by(MaterialAsset.updated_at.desc())
            .limit(30)
        ).all()
    )
    base_resume = context.session.scalar(
        select(ResumeVersion)
        .where(ResumeVersion.candidate_id == context.run.candidate_id, ResumeVersion.job_id.is_(None))
        .order_by(ResumeVersion.updated_at.desc())
    )
    job_resume = context.session.scalar(
        select(ResumeVersion)
        .where(ResumeVersion.candidate_id == context.run.candidate_id, ResumeVersion.job_id == job.id)
        .order_by(ResumeVersion.updated_at.desc())
    )
    pinned_memory = ContextManager(context.session).pinned(job)
    return _result(
        context,
        "已读取当前岗位、原简历、候选人事实和材料索引。",
        artifacts=[item for item in [f"job:{job.id}", f"resume:{(job_resume or base_resume).id}" if (job_resume or base_resume) else None] if item],
        data={
            "job": {"id": job.id, "company": job.company, "role": job.role, "location": job.location, "jd": job.jd_raw or "", "source_url": job.source_url},
            "profile": {
                "responsibilities": profile.responsibilities,
                "hard_requirements": profile.hard_requirements,
                "preferred_requirements": profile.preferred_requirements,
                "keywords": profile.keywords,
                "competencies": profile.competencies,
                "uncertain_items": profile.uncertain_items,
            } if profile else None,
            "facts": [
                {
                    "id": fact.id,
                    "category": fact.category,
                    "content": fact.content,
                    "verified": fact.verified,
                    "subject_id": fact.subject_id,
                    "normalized_value": fact.normalized_value,
                }
                for fact in facts
            ],
            "materials": [{"id": item.id, "kind": item.kind, "name": item.name, "source_url": item.source_url} for item in materials],
            "base_resume": {"id": base_resume.id, "name": base_resume.name, "content": base_resume.content_json} if base_resume else None,
            "job_resume": {"id": job_resume.id, "name": job_resume.name, "content": job_resume.content_json} if job_resume else None,
            "memory": {
                "explicit": pinned_memory.get("explicit_memory") or {},
                "operational": pinned_memory.get("operational_memory") or {},
            },
        },
    )


def register_pi_domain_tools(gateway: ToolGateway, pipeline: PiDomainPipeline) -> ToolGateway:
    all_stages = set(PipelineStage) - {PipelineStage.FROZEN, PipelineStage.CANCELLED}

    def inspect_application_workspace(context: ToolContext, _: EmptyInput) -> DomainToolResult:
        return _inspect_workspace(context, pipeline)

    def prepare_job_review(context: ToolContext, payload: PrepareJobReviewInput) -> DomainToolResult:
        run = context.run
        job = pipeline._job(run)
        if not (job.jd_raw or "").strip():
            raise HarnessError("jd_required", "岗位缺少 JD 原文；如果已有网页 URL，请先调用 import_job_posting", run_id=run.id)
        _validate_job_evidence(job.jd_raw or "", payload.analysis)

        stage = PipelineStage(run.current_stage or PipelineStage.CREATED)
        if stage == PipelineStage.CREATED:
            pipeline.state.transition(run, PipelineStage.INPUT_VALIDATING, reason="Pi requested job review preparation")
            stage = PipelineStage.INPUT_VALIDATING
        if stage == PipelineStage.INPUT_VALIDATING:
            pipeline._validate_input(run)
            pipeline.state.transition(run, PipelineStage.JD_ANALYZING, reason="candidate, resume and JD inputs validated")
            stage = PipelineStage.JD_ANALYZING

        profile = context.session.scalar(select(JobProfile).where(JobProfile.job_id == job.id))
        if profile is None:
            profile = JobProfile(job_id=job.id)
            context.session.add(profile)
        profile.responsibilities = [item.text for item in payload.analysis.responsibilities]
        profile.hard_requirements = [item.text for item in payload.analysis.hard_requirements]
        profile.preferred_requirements = [item.text for item in payload.analysis.preferred_requirements]
        profile.keywords = list(dict.fromkeys(payload.analysis.keywords))
        profile.competencies = list(dict.fromkeys(payload.analysis.competencies))
        profile.uncertain_items = payload.analysis.uncertain_items
        profile.business_context = {
            "summary": payload.analysis.summary,
            "evidence": [item.source_quote for item in [*payload.analysis.responsibilities, *payload.analysis.hard_requirements, *payload.analysis.preferred_requirements]],
            "runtime": "pi_native",
        }
        profile.source_run_id = run.id
        context.session.flush()
        if stage == PipelineStage.JD_ANALYZING:
            pipeline.state.transition(run, PipelineStage.FACTS_MATCHING, reason="Pi job analysis persisted with JD evidence")
            stage = PipelineStage.FACTS_MATCHING

        facts = _facts_for_candidate(context.session, run.candidate_id)
        by_id = {fact.id: fact for fact in facts}
        supplied: dict[str, RankedFactInput] = {}
        invalid_ids: list[str] = []
        for item in payload.fact_ranking:
            if item.fact_id not in by_id:
                invalid_ids.append(item.fact_id)
            else:
                supplied[item.fact_id] = item
        if invalid_ids:
            raise HarnessError("fact_scope_mismatch", "经历排序引用了当前候选人之外的 fact_id", run_id=run.id, details={"fact_ids": invalid_ids})

        items: list[dict[str, Any]] = []
        for fact in facts:
            ranked = supplied.get(fact.id)
            immutable = fact.category in {"education", "profile", "profile.contact", "profile.identity"}
            relevance = ranked.relevance if ranked else "low"
            items.append({
                "fact_id": fact.id,
                "content": fact.content,
                "category": fact.category,
                "verified": fact.verified,
                "score": {"high": 3, "medium": 2, "low": 1}[relevance],
                "recommended": True if immutable else bool(ranked.recommended if ranked else False),
                "preserve_automatically": immutable,
                "match_method": "pi_semantic_evidence_v1",
                "match_source": "pi_agent_core",
                "matched_terms": ranked.matched_jd_requirements if ranked else [],
                "match_reason": ranked.rationale if ranked else "模型未选择该条经历，保留给用户手动决定",
            })
        items.sort(key=lambda item: (item["preserve_automatically"], item["recommended"], item["score"], item["verified"]), reverse=True)
        approval = pipeline.approvals.request(
            run_id=run.id,
            action_type="confirm_relevant_facts",
            target_type="job",
            target_id=run.job_id,
            items=items,
        )
        if stage == PipelineStage.FACTS_MATCHING:
            pipeline.state.transition(run, PipelineStage.AWAITING_FACT_REVIEW, reason="wait for user to confirm Pi semantic ranking")
        return _result(
            context,
            payload.analysis.summary,
            artifacts=[f"job_profile:{profile.id}", *[f"matched_fact:{fact.id}" for fact in facts]],
            approval_action="confirm_relevant_facts",
            data={"approval_id": approval.id, "ranked_fact_count": len(items), "profile_id": profile.id},
        )

    def prepare_resume_review(context: ToolContext, payload: PrepareResumeReviewInput) -> DomainToolResult:
        run = context.run
        pipeline.approvals.require(run_id=run.id, action_type="confirm_relevant_facts")
        facts = pipeline._verified_facts(run)
        if not facts:
            raise HarnessError("verified_fact_required", "请至少确认一条与岗位相关的真实经历", run_id=run.id)
        allowed_ids = {fact.id for fact in facts}
        selected_ids = list(dict.fromkeys(payload.strategy.selected_fact_ids or [fact.id for fact in facts]))
        invalid_strategy_ids = [item for item in selected_ids if item not in allowed_ids]
        invalid_patch_ids = sorted({item for patch in payload.patches for item in patch.fact_ids if item not in allowed_ids})
        if invalid_strategy_ids or invalid_patch_ids:
            raise HarnessError(
                "fact_scope_mismatch",
                "简历策略或补丁引用了未经用户确认的事实",
                run_id=run.id,
                details={"strategy_fact_ids": invalid_strategy_ids, "patch_fact_ids": invalid_patch_ids},
            )

        # Deterministic evaluator pass before any proposal reaches the user.
        # Pi remains the only semantic loop: structured validation errors are
        # returned to that same loop so it can repair the tool arguments.
        job = pipeline._job(run)
        normalized_jd = _normalized(job.jd_raw or "")
        invalid_quotes = [
            quote
            for patch in payload.patches
            for quote in patch.jd_evidence
            if not _normalized(quote) or _normalized(quote) not in normalized_jd
        ]
        factual = FactValidator(context.session).validate(
            candidate_id=run.candidate_id,
            asset_type="resume",
            claims=[Claim(text=patch.after, fact_ids=patch.fact_ids) for patch in payload.patches],
        )
        role_escalations = [
            {"patch_index": index, "matches": matches}
            for index, patch in enumerate(payload.patches)
            for risk, matches in [role_strength_risk(patch.before, patch.after)]
            if risk == "high"
        ]
        if invalid_quotes or not factual.passed or role_escalations:
            raise HarnessError(
                "resume_patch_evaluation_failed",
                "部分简历改写没有通过证据与事实校验，请修正后重新提交审批草稿",
                run_id=run.id,
                retryable=True,
                details={
                    "invalid_jd_evidence": invalid_quotes[:12],
                    "fact_issues": [item.model_dump(mode="json") for item in factual.issues[:20]],
                    "role_escalations": role_escalations[:12],
                },
            )

        stage = PipelineStage(run.current_stage or PipelineStage.AWAITING_FACT_REVIEW)
        if stage == PipelineStage.AWAITING_FACT_REVIEW:
            pipeline.state.transition(run, PipelineStage.STRATEGY_GENERATING, actor="user", reason="confirmed facts available for Pi resume planning")
            stage = PipelineStage.STRATEGY_GENERATING
        strategy_payload = payload.strategy.model_dump(mode="json")
        strategy_payload["selected_fact_ids"] = selected_ids
        snapshot = pipeline.versions.snapshot(
            target_type="job_resume_strategy",
            target_id=run.job_id,
            payload=strategy_payload,
            run_id=run.id,
            reason="Pi-native structured resume strategy",
        )
        if stage == PipelineStage.STRATEGY_GENERATING:
            pipeline.state.transition(run, PipelineStage.DRAFT_GENERATING, reason="Pi resume strategy persisted")
            stage = PipelineStage.DRAFT_GENERATING

        pipeline.proposal_specs = [patch.model_dump(mode="json") for patch in payload.patches]
        if stage == PipelineStage.DRAFT_GENERATING:
            pipeline._generate_draft_and_proposals(run)
            pipeline.state.transition(run, PipelineStage.AWAITING_USER_REVIEW, reason="wait for user to review Pi resume patches")
        proposals = list(context.session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id)).all())
        approval = context.session.scalar(
            select(Approval).where(Approval.run_id == run.id, Approval.action_type == "apply_resume_changes")
        )
        resume = pipeline._require_resume(run)
        return _result(
            context,
            payload.summary,
            artifacts=[f"strategy_snapshot:{snapshot.id}", f"resume:{resume.id}", *[f"proposal:{item.id}" for item in proposals]],
            approval_action="apply_resume_changes",
            data={"approval_id": approval.id if approval else None, "proposal_count": len(proposals), "resume_id": resume.id},
        )

    def apply_and_verify_resume(context: ToolContext, _: EmptyInput) -> DomainToolResult:
        run = context.run
        pipeline.approvals.require(run_id=run.id, action_type="apply_resume_changes")
        stage = PipelineStage(run.current_stage or PipelineStage.AWAITING_USER_REVIEW)
        if stage == PipelineStage.AWAITING_USER_REVIEW:
            pipeline.state.transition(run, PipelineStage.APPROVED_CHANGES_APPLYING, review_approved=True, actor="user", reason="user approved Pi resume patches")
            stage = PipelineStage.APPROVED_CHANGES_APPLYING
        if stage == PipelineStage.APPROVED_CHANGES_APPLYING:
            pipeline._apply_approved_changes(run)
            pipeline.state.transition(run, PipelineStage.FACT_VALIDATING, reason="approved patches applied to a new resume version")
            stage = PipelineStage.FACT_VALIDATING
        if stage == PipelineStage.FACT_VALIDATING:
            pipeline._validate_resume_facts(run)
            pipeline.state.transition(run, PipelineStage.CONSISTENCY_CHECKING, reason="resume claims validated against confirmed facts")
            stage = PipelineStage.CONSISTENCY_CHECKING
        if stage == PipelineStage.PORTFOLIO_BUILDING:
            # Legacy runs may resume from this stage. Do not create a mock
            # portfolio; continue directly to the real resume quality gate.
            pipeline.state.transition(run, PipelineStage.CONSISTENCY_CHECKING, reason="optional portfolio step skipped")
            stage = PipelineStage.CONSISTENCY_CHECKING
        if stage == PipelineStage.CONSISTENCY_CHECKING:
            pipeline._run_consistency_and_gate(run)
            pipeline.state.transition(run, PipelineStage.READY_TO_PUBLISH, reason="verified local draft is ready to edit and export")
            pipeline._write_report(run)
        resume = pipeline._require_resume(run)
        return _result(
            context,
            "已把批准的改写应用到新版本，并完成事实与一致性检查。版本现在可以编辑和导出。",
            artifacts=[f"validated_resume:{resume.id}"],
            data={"resume_id": resume.id, "ready_to_edit": True},
        )

    def finalize_resume_version(context: ToolContext, _: EmptyInput) -> DomainToolResult:
        run = context.run
        pipeline.approvals.require(run_id=run.id, action_type="publish_assets")
        if PipelineStage(run.current_stage or PipelineStage.AWAITING_PUBLISH_APPROVAL) == PipelineStage.AWAITING_PUBLISH_APPROVAL:
            pipeline.state.transition(run, PipelineStage.READY_TO_PUBLISH, publish_approved=True, actor="user", reason="user approved final export")
        pipeline._write_report(run)
        resume = pipeline._require_resume(run)
        return _result(
            context,
            "最终简历版本已通过门禁，可以在编辑器中预览、微调和导出。",
            artifacts=[f"resume:{resume.id}"],
            data={"resume_id": resume.id},
        )

    def add(name: str, description: str, permission: ToolPermission, stages: set[PipelineStage], handler, input_model, *, read_only: bool = False, approval_action: str | None = None) -> None:
        gateway.register(ToolSpec(
            name=name,
            description=description,
            input_model=input_model,
            output_model=DomainToolResult,
            permission=permission,
            allowed_stages=stages,
            handler=handler,
            read_only=read_only,
            side_effect=not read_only,
            approval_action=approval_action,
        ))

    add(
        "inspect_application_workspace",
        "读取当前岗位 JD、原简历完整结构、候选人事实和材料索引。开始岗位分析或简历改写前先调用；这是按需上下文，不修改数据。",
        ToolPermission.READ,
        all_stages,
        inspect_application_workspace,
        EmptyInput,
        read_only=True,
    )
    add(
        "prepare_job_review",
        "一次性保存有 JD 原文证据的岗位分析和语义经历排序，并创建用户确认节点。模型直接提供结构化判断；工具不会再次调用其他模型。",
        ToolPermission.DRAFT_WRITE,
        {PipelineStage.CREATED, PipelineStage.INPUT_VALIDATING, PipelineStage.JD_ANALYZING, PipelineStage.FACTS_MATCHING},
        prepare_job_review,
        PrepareJobReviewInput,
    )
    add(
        "prepare_resume_review",
        "在用户确认事实后，根据原简历生成岗位化策略和逐条可审阅补丁；必须保持原模板与整体结构，未经事实支持不得新增内容。",
        ToolPermission.DRAFT_WRITE,
        {PipelineStage.AWAITING_FACT_REVIEW, PipelineStage.STRATEGY_GENERATING, PipelineStage.DRAFT_GENERATING},
        prepare_resume_review,
        PrepareResumeReviewInput,
        approval_action="confirm_relevant_facts",
    )
    add(
        "apply_and_verify_resume",
        "应用用户逐条批准的补丁，生成新版本并完成事实校验、一致性检查和预览门禁。",
        ToolPermission.CONFIRMED_WRITE,
        {
            PipelineStage.AWAITING_USER_REVIEW,
            PipelineStage.APPROVED_CHANGES_APPLYING,
            PipelineStage.FACT_VALIDATING,
            PipelineStage.PORTFOLIO_BUILDING,
            PipelineStage.CONSISTENCY_CHECKING,
        },
        apply_and_verify_resume,
        EmptyInput,
        approval_action="apply_resume_changes",
    )
    return gateway


def build_pi_task_gateway(session: Session, *, settings) -> ToolGateway:
    """Build the Pi-native task capability surface.

    General web, workspace, Skill and MCP capabilities still share the same
    ToolGateway policy, while resume semantics are provided by four coarse
    domain tools instead of the legacy stage-by-stage pipeline tool set.
    """

    from applyos_harness.policy import apply_gateway_policy, permission_settings

    from .capabilities import CapabilityMode, build_capability_gateway

    gateway = build_capability_gateway(session, settings=settings, mode=CapabilityMode.CONVERSATION)
    register_pi_domain_tools(gateway, PiDomainPipeline(session))
    apply_gateway_policy(gateway, permission_settings(session))
    return gateway
