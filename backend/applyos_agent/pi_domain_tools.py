from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.models import Approval, Fact, JobProfile, MaterialAsset, ResumeVersion, RewriteProposal
from applyos_domain.enums import ProposalStatus, RiskLevel
from applyos_domain.job_context import current_analysis_marker
from applyos_harness.errors import HarnessError
from applyos_harness.gates import _visible_resume_text, rendered_resume_text
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.pipeline import MockPipeline
from applyos_harness.state_machine import PipelineStage
from applyos_harness.validation import Claim, EvidenceRef, FactValidator, normalized_excerpt, role_strength_risk
from applyos_harness.versioning import canonical_hash
from integrations.resume.editor_schema import resume_patch_anchors


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvidenceItemInput(DomainModel):
    text: str = Field(min_length=1, max_length=1200, description="Accurate summary of the job requirement. Use Simplified Chinese unless the user requests another language.")
    source_quote: str = Field(min_length=1, max_length=1200, description="A contiguous verbatim quotation from the original JD. Preserve its language and wording; do not paraphrase or translate it.")


class JobAnalysisInput(DomainModel):
    responsibilities: list[EvidenceItemInput] = Field(min_length=1, max_length=12)
    hard_requirements: list[EvidenceItemInput] = Field(default_factory=list, max_length=16)
    preferred_requirements: list[EvidenceItemInput] = Field(default_factory=list, max_length=12)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    competencies: list[str] = Field(default_factory=list, max_length=20)
    uncertain_items: list[str] = Field(default_factory=list, max_length=12)
    summary: str = Field(min_length=1, max_length=2400, description="User-facing explanation of the role in Simplified Chinese unless the user requests another language. Do not disclose internal chain-of-thought.")


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
        description="Use only fact_id values returned by inspect_application_workspace. Omitted facts remain available with low relevance.",
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
    before: str = Field(min_length=1, max_length=8000, description="Verbatim text from the CURRENT job/base resume visible_text, not an invented original or fact-only metadata.")
    after: str = Field(min_length=1, max_length=8000, description="Role-tailored replacement text. Do not add facts unsupported by fact_ids. Preserve the resume language unless the user requests another language.")
    reason: str = Field(min_length=1, max_length=1600)
    jd_evidence: list[str] = Field(min_length=1, max_length=8)
    fact_ids: list[str] = Field(default_factory=list, max_length=20, description="Compatibility only; derived from versioned evidence and never sufficient alone.")
    evidence: list[EvidenceRef] = Field(default_factory=list, max_length=20)
    action: str = ""
    object: str = ""
    metrics: list[str] = Field(default_factory=list)
    status: str = ""
    claim_type: Literal["personal_fact"] = "personal_fact"
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


class RevisedResumePatchInput(ResumePatchInput):
    proposal_id: str = Field(min_length=1, max_length=80)


class ReviseResumeReviewInput(DomainModel):
    request_id: str = Field(min_length=1, max_length=80)
    expected_revision: int = Field(ge=0, description="The current pending rework_request.revision returned by inspect_application_workspace.")
    patches: list[RevisedResumePatchInput] = Field(min_length=1, max_length=80)
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
        self.source_resume: ResumeVersion | None = None

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
    review = context.session.scalar(select(Approval).where(Approval.run_id == context.run.id,
        Approval.action_type == "apply_resume_changes").order_by(Approval.created_at.desc()))
    review_payload = (review.decision_payload or {}) if review else {}
    review_proposals = list(context.session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == context.run.id)).all()) if review else []
    return _result(
        context,
        "已读取当前岗位、原简历、候选人事实和材料索引。",
        artifacts=[item for item in [f"job:{job.id}", f"resume:{(job_resume or base_resume).id}" if (job_resume or base_resume) else None] if item],
        data={
            "fact_ids": [fact.id for fact in facts],
            "fact_summaries": [{"id": fact.id, "candidate_id": fact.candidate_id, "version": fact.version, "category": fact.category, "text": fact.content[:160], "verified": fact.verified} for fact in facts],
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
                    "candidate_id": fact.candidate_id,
                    "version": fact.version,
                    "evidence_type": "candidate_fact",
                    "subject_id": fact.subject_id,
                    "normalized_value": fact.normalized_value,
                }
                for fact in facts
            ],
            "materials": [{"id": item.id, "kind": item.kind, "name": item.name, "source_url": item.source_url} for item in materials],
            "base_resume": {"id": base_resume.id, "name": base_resume.name, "content_hash": canonical_hash(base_resume.content_json), "visible_text": rendered_resume_text(base_resume.content_json)} if base_resume else None,
            "job_resume": {"id": job_resume.id, "name": job_resume.name, "content_hash": canonical_hash(job_resume.content_json), "visible_text": rendered_resume_text(job_resume.content_json)} if job_resume else None,
            "resume_review": {"approval_id": review.id, "status": getattr(review.status, "value", review.status),
                "expected_revision": int((review_payload.get("draft") or {}).get("revision") or 0),
                "target_content_hash": review_payload.get("target_content_hash"),
                "rework_request": review_payload.get("rework_request"),
                "proposals": [{"proposal_id": item.id, "section": item.section, "before": item.before,
                    "after": item.after, "reason": item.reason, "jd_evidence": item.jd_evidence,
                    "fact_ids": item.fact_ids, "claim_contract": item.claim_contract,
                    "approval_status": getattr(item.approval_status, "value", item.approval_status)} for item in review_proposals],
            } if review else None,
            "memory": {
                "explicit": pinned_memory.get("explicit_memory") or {},
                "operational": pinned_memory.get("operational_memory") or {},
            },
        },
    )


def _evaluated_patch_specs(context: ToolContext, pipeline: PiDomainPipeline, source: ResumeVersion,
                           patches: list[ResumePatchInput]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    run = context.run
    allowed_ids = {fact.id for fact in pipeline._verified_facts(run)}
    invalid_ids = sorted({item for patch in patches for item in [*patch.fact_ids, *[ref.fact_id for ref in patch.evidence]] if item not in allowed_ids})
    if invalid_ids:
        raise HarnessError("fact_scope_mismatch", "简历补丁引用了未经本轮确认的事实", run_id=run.id, details={"fact_ids": invalid_ids})
    if not ((source.content_json or {}).get("editor_snapshot") or {}).get("sections"):
        raise HarnessError("resume_editable_source_required", "请先保存含完整正文结构的简历，再准备改写", run_id=run.id)
    anchors = resume_patch_anchors(source.content_json, [patch.model_dump(mode="json") for patch in patches])
    normalized_jd = _normalized(pipeline._job(run).jd_raw or "")
    invalid_jd_indices = [index for index, patch in enumerate(patches)
        if any(not _normalized(quote) or _normalized(quote) not in normalized_jd for quote in patch.jd_evidence)]
    claims = [Claim(text=patch.after, fact_ids=patch.fact_ids, evidence=patch.evidence, action=patch.action,
        object=patch.object, metrics=patch.metrics, status=patch.status) for patch in patches]
    factual = FactValidator(context.session).validate(candidate_id=run.candidate_id, asset_type="resume", claims=claims)
    role_escalations = [{"patch_index": index, "matches": matches} for index, patch in enumerate(patches)
        for risk, matches in [role_strength_risk(patch.before, patch.after)] if risk == "high"]
    if invalid_jd_indices or role_escalations:
        raise HarnessError("resume_patch_evaluation_failed", "部分改写未通过JD证据或角色强度校验，请只修正对应条目后重试", run_id=run.id, retryable=True,
            details={"patch_indices": sorted(set(invalid_jd_indices + [item["patch_index"] for item in role_escalations])),
                "invalid_jd_patch_indices": invalid_jd_indices, "role_escalations": role_escalations,
                "fact_issues": [item.model_dump(mode="json") for item in factual.issues[:20]]})
    issues = [issue.model_dump(mode="json") for issue in factual.issues]
    specs = [{**patch.model_dump(mode="json", exclude={"proposal_id"}),
        "fact_ids": list(dict.fromkeys(ref.fact_id for ref in claim.evidence)),
        "claim_contract": {"claims": [claim.model_dump(mode="json")], "source_resume_id": source.id,
            "source_resume_hash": canonical_hash(source.content_json), "patch_anchor": anchor,
            "needs_evidence": claim.verification_status != "verified",
            "issues": [issue for issue in issues if issue.get("claim_index") == index]}}
        for index, (patch, claim, anchor) in enumerate(zip(patches, claims, anchors))]
    return specs, issues


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
            **current_analysis_marker(job, profile.business_context),
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
        if context.session.scalar(select(RewriteProposal.id).where(RewriteProposal.run_id == run.id)) is not None:
            raise HarnessError("proposal_batch_exists", "本轮已有建议批次，请在待审阶段请求指定条目修订，或创建新一轮规划", run_id=run.id)
        pipeline.approvals.require(run_id=run.id, action_type="confirm_relevant_facts")
        facts = pipeline._verified_facts(run)
        if not facts:
            raise HarnessError("verified_fact_required", "请至少确认一条与岗位相关的真实经历", run_id=run.id)
        allowed_ids = {fact.id for fact in facts}
        selected_ids = list(dict.fromkeys(payload.strategy.selected_fact_ids or [fact.id for fact in facts]))
        invalid_strategy_ids = [item for item in selected_ids if item not in allowed_ids]
        invalid_patch_ids = sorted({item for patch in payload.patches for item in [*patch.fact_ids, *[ref.fact_id for ref in patch.evidence]] if item not in allowed_ids})
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
        source_resume = context.session.scalar(
            select(ResumeVersion).where(ResumeVersion.candidate_id == run.candidate_id, ResumeVersion.job_id == run.job_id)
            .order_by(ResumeVersion.updated_at.desc(), ResumeVersion.id.desc())
        ) or context.session.scalar(
            select(ResumeVersion).where(ResumeVersion.candidate_id == run.candidate_id, ResumeVersion.job_id.is_(None))
            .order_by(ResumeVersion.updated_at.desc(), ResumeVersion.id.desc())
        )
        if source_resume is None:
            raise HarnessError("resume_source_required", "请先保存当前简历；事实元数据不能替代要修改的简历原文", run_id=run.id)
        specs, evidence_issues = _evaluated_patch_specs(context, pipeline, source_resume, payload.patches)

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

        pipeline.proposal_specs = specs
        pipeline.source_resume = source_resume
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
            data={"approval_id": approval.id if approval else None, "proposal_count": len(proposals), "resume_id": resume.id,
                  "needs_evidence_count": sum(bool((item.claim_contract or {}).get("needs_evidence", True)) for item in proposals),
                  "evidence_issues": evidence_issues},
        )

    def revise_resume_review(context: ToolContext, payload: ReviseResumeReviewInput) -> DomainToolResult:
        run = context.run
        approval = context.session.scalar(select(Approval).where(Approval.run_id == run.id,
            Approval.action_type == "apply_resume_changes").order_by(Approval.created_at.desc()))
        if approval is None:
            raise HarnessError("approval_not_found", "当前没有待修订的审阅批次", run_id=run.id)
        approval = pipeline.approvals._pending_review(approval.id, expected_revision=payload.expected_revision)
        old = deepcopy(approval.decision_payload or {})
        request = old.get("rework_request") or {}
        if request.get("status") != "pending" or request.get("request_id") != payload.request_id or request.get("revision") != payload.expected_revision:
            raise HarnessError("proposal_rewrite_request_changed", "用户授权的局部改写请求已变化，请重新读取工作区", run_id=run.id)
        supplied_ids = [item.proposal_id for item in payload.patches]
        if len(set(supplied_ids)) != len(supplied_ids) or set(supplied_ids) != set(request.get("proposal_ids") or []):
            raise HarnessError("proposal_scope_mismatch", "只能完整修订用户本次明确指定的条目，不能改变其他建议", run_id=run.id,
                details={"proposal_ids": request.get("proposal_ids") or []})
        proposals = pipeline.approvals._review_proposals(approval)
        by_id = {item.id: item for item in proposals}
        if set(supplied_ids) - set(by_id) or any(item.approval_status != ProposalStatus.PENDING for item in proposals):
            raise HarnessError("proposal_scope_mismatch", "该批次已完成审批或指定条目已变化", run_id=run.id)
        for patch in payload.patches:
            if patch.before != by_id[patch.proposal_id].before or patch.section != by_id[patch.proposal_id].section:
                raise HarnessError("proposal_scope_mismatch", "局部改写必须保留该条原文和所属章节，只能修订建议及其证据", run_id=run.id,
                    details={"proposal_id": patch.proposal_id})
        contracts = [by_id[item].claim_contract or {} for item in supplied_ids]
        source_ids = {item.get("source_resume_id") for item in contracts}
        source = context.session.get(ResumeVersion, next(iter(source_ids))) if len(source_ids) == 1 and None not in source_ids else None
        if source is None or source.candidate_id != run.candidate_id or (source.job_id is not None and source.job_id != run.job_id):
            raise HarnessError("proposal_source_unverified", "建议的简历基线无效，请重新规划", run_id=run.id)
        if any(contract.get("source_resume_hash") != canonical_hash(source.content_json) for contract in contracts):
            raise HarnessError("proposal_source_changed", "建议的简历基线已变化，请重新规划", run_id=run.id)
        specs, evidence_issues = _evaluated_patch_specs(context, pipeline, source, payload.patches)
        resume_patch_anchors(source.content_json, [{"before": item.before} for item in proposals])
        pipeline.approvals.snapshot_review(approval, reason="before:revise selected proposals")
        draft = deepcopy(old.get("draft") or {})
        decisions = {key: value for key, value in (draft.get("decisions") or {}).items() if key not in supplied_ids}
        updated = {**old, "draft": {**draft, "revision": payload.expected_revision + 1, "decisions": decisions},
            "rework_request": {**request, "status": "completed", "completed_revision": payload.expected_revision + 1,
                "summary": payload.summary}}
        pipeline.approvals._cas_review(approval, old, updated)
        for patch, spec in zip(payload.patches, specs):
            proposal = by_id[patch.proposal_id]
            for key in ("before", "after", "section", "reason", "jd_evidence", "fact_ids", "claim_contract"):
                setattr(proposal, key, spec[key])
            proposal.risk_level = RiskLevel(spec["risk_level"])
            proposal.edited_after = None
        context.session.flush()
        pipeline.approvals.snapshot_review(approval, reason="after:revise selected proposals")
        return _result(context, payload.summary, artifacts=[f"proposal:{item}" for item in supplied_ids],
            approval_action="apply_resume_changes", data={"approval_id": approval.id,
                "proposal_ids": supplied_ids, "revision": payload.expected_revision + 1, "evidence_issues": evidence_issues})

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
            effect_scope="local_transactional",
            approval_action=approval_action,
        ))

    add(
        "inspect_application_workspace",
        "Read the current job's JD, full original resume structure, candidate facts, and material index. Call before analyzing the job or rewriting the resume. Provides on-demand context without modifying data.",
        ToolPermission.READ,
        all_stages,
        inspect_application_workspace,
        EmptyInput,
        read_only=True,
    )
    add(
        "prepare_job_review",
        "Save JD-evidenced job analysis and semantic experience rankings together, then create a user confirmation step. Supply the structured judgments directly; this tool does not call another model. Write user-facing analysis in Simplified Chinese unless the user requests another language, and preserve quotations verbatim.",
        ToolPermission.DRAFT_WRITE,
        {PipelineStage.CREATED, PipelineStage.INPUT_VALIDATING, PipelineStage.JD_ANALYZING, PipelineStage.FACTS_MATCHING},
        prepare_job_review,
        PrepareJobReviewInput,
    )
    add(
        "prepare_resume_review",
        "After the user confirms the facts, prepare a role-tailored strategy and individually reviewable patches based on the original resume. Preserve its template and overall structure. Do not add unsupported content. Keep the resume language unless the user requests another language; write review explanations in Simplified Chinese by default.",
        ToolPermission.DRAFT_WRITE,
        {PipelineStage.AWAITING_FACT_REVIEW, PipelineStage.STRATEGY_GENERATING, PipelineStage.DRAFT_GENERATING},
        prepare_resume_review,
        PrepareResumeReviewInput,
        approval_action="confirm_relevant_facts",
    )
    add(
        "revise_resume_review",
        "Revise ONLY the proposal IDs authorized by the current pending user rework_request. First inspect_application_workspace for its request_id, revision, instruction and proposal source contracts. Supply exactly those IDs, the unchanged before and section, and the current request revision. Never create your own authorization. Other proposals and decisions remain intact; successful revisions still require individual user review.",
        ToolPermission.DRAFT_WRITE,
        {PipelineStage.AWAITING_USER_REVIEW},
        revise_resume_review,
        ReviseResumeReviewInput,
    )
    add(
        "apply_and_verify_resume",
        "Apply only patches individually approved by the user, create a new version, and complete factual validation, consistency checks, and the preview gate.",
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
