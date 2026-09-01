from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from applyos_domain.models import Approval, Fact, JobProfile, MaterialAsset, ResumeVersion, RewriteProposal
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.pipeline import MockPipeline
from applyos_harness.state_machine import PipelineStage


class PipelineToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PipelineToolResult(BaseModel):
    stage: str
    status: str
    summary: str
    artifacts: list[str] = Field(default_factory=list)
    requires_user_action: bool = False
    approval_action: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


def _result(context: ToolContext, summary: str, *, artifacts: list[str] | None = None, approval_action: str | None = None, data: dict[str, Any] | None = None) -> PipelineToolResult:
    return PipelineToolResult(
        stage=context.run.current_stage or PipelineStage.CREATED.value,
        status=context.run.status.value,
        summary=summary,
        artifacts=artifacts or [],
        requires_user_action=approval_action is not None,
        approval_action=approval_action,
        data=data or {},
    )


def register_pipeline_tools(gateway: ToolGateway, pipeline: MockPipeline) -> ToolGateway:
    all_stages = set(PipelineStage) - {PipelineStage.FROZEN, PipelineStage.CANCELLED}

    def inspect_job_context(context: ToolContext, _: PipelineToolInput) -> PipelineToolResult:
        job = pipeline._job(context.run)
        profile = context.session.scalar(select(JobProfile).where(JobProfile.job_id == job.id))
        facts = list(context.session.scalars(select(Fact).where(Fact.candidate_id == context.run.candidate_id).order_by(Fact.updated_at.desc()).limit(24)).all())
        materials = list(context.session.scalars(select(MaterialAsset).where(MaterialAsset.candidate_id == context.run.candidate_id).order_by(MaterialAsset.updated_at.desc()).limit(12)).all())
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
        return _result(
            context,
            "已读取岗位、候选人事实、材料和当前简历版本。",
            artifacts=[item for item in [f"job:{job.id}", f"job_profile:{profile.id}" if profile else None, f"resume:{(job_resume or base_resume).id}" if (job_resume or base_resume) else None] if item],
            data={
                "job": {"company": job.company, "role": job.role, "jd": job.jd_raw or ""},
                "profile": {
                    "responsibilities": profile.responsibilities,
                    "hard_requirements": profile.hard_requirements,
                    "competencies": profile.competencies,
                } if profile else None,
                "facts": [{"id": fact.id, "category": fact.category, "content": fact.content, "verified": fact.verified} for fact in facts],
                "materials": [{"id": item.id, "kind": item.kind, "name": item.name} for item in materials],
                "base_resume": {"id": base_resume.id, "name": base_resume.name} if base_resume else None,
                "job_resume": {"id": job_resume.id, "name": job_resume.name} if job_resume else None,
            },
        )

    def validate_run_input(context: ToolContext, _: PipelineToolInput) -> PipelineToolResult:
        if PipelineStage(context.run.current_stage or PipelineStage.CREATED) == PipelineStage.CREATED:
            pipeline.state.transition(context.run, PipelineStage.INPUT_VALIDATING, reason="agent requested input validation")
        try:
            pipeline._run_stage(context.run, PipelineStage.INPUT_VALIDATING, pipeline._validate_input)
        except HarnessError as exc:
            job = pipeline._job(context.run)
            if exc.code == "jd_required" and (job.source_url or "").strip():
                raise HarnessError(
                    "job_page_import_required",
                    "岗位 JD 为空，但存在招聘页面 URL；请先调用 import_job_posting。",
                    retryable=True,
                    run_id=context.run.id,
                    stage=context.run.current_stage,
                    details={"source_url": job.source_url},
                ) from exc
            raise
        pipeline.state.transition(context.run, PipelineStage.JD_ANALYZING, reason="validated candidate and JD scope")
        return _result(context, "候选人、岗位归属和 JD 输入已通过校验。", artifacts=[f"job:{context.run.job_id}"])

    def analyze_job(context: ToolContext, _: PipelineToolInput) -> PipelineToolResult:
        pipeline._run_stage(context.run, PipelineStage.JD_ANALYZING, pipeline._analyze_job)
        profile = context.session.scalar(select(JobProfile).where(JobProfile.job_id == context.run.job_id))
        pipeline.state.transition(context.run, PipelineStage.FACTS_MATCHING, reason="job analysis completed")
        return _result(
            context,
            "已依据 JD 原文形成岗位职责、要求和能力维度。",
            artifacts=[f"job_profile:{profile.id}"] if profile else [],
            data={"responsibilities": (profile.responsibilities if profile else []), "requirements": (profile.hard_requirements if profile else []), "competencies": (profile.competencies if profile else [])},
        )

    def match_candidate_experiences(context: ToolContext, _: PipelineToolInput) -> PipelineToolResult:
        pipeline._run_stage(context.run, PipelineStage.FACTS_MATCHING, pipeline._match_facts)
        pipeline.state.transition(context.run, PipelineStage.AWAITING_FACT_REVIEW, reason="wait for user to confirm relevant experiences")
        approval = context.session.scalar(select(Approval).where(Approval.run_id == context.run.id, Approval.action_type == "confirm_relevant_facts"))
        fact_ids = [str(item.get("fact_id")) for item in ((approval.decision_payload or {}).get("items", []) if approval else []) if item.get("fact_id")]
        return _result(
            context,
            "已完成经历语义匹配，需要用户确认本次简历使用的真实经历。",
            artifacts=[f"matched_fact:{fact_id}" for fact_id in fact_ids],
            approval_action="confirm_relevant_facts",
            data={"approval_id": approval.id if approval else None, "items": len((approval.decision_payload or {}).get("items", [])) if approval else 0},
        )

    def generate_resume_strategy(context: ToolContext, _: PipelineToolInput) -> PipelineToolResult:
        if not pipeline.approvals.is_approved(run_id=context.run.id, action_type="confirm_relevant_facts"):
            raise HarnessError("approval_required", "需要先确认本次使用的真实经历", run_id=context.run.id, stage=context.run.current_stage)
        if not pipeline._verified_facts(context.run):
            raise HarnessError("verified_fact_required", "请至少确认一条与岗位相关的真实经历", run_id=context.run.id, stage=context.run.current_stage)
        pipeline.state.transition(context.run, PipelineStage.STRATEGY_GENERATING, actor="user", reason="relevant experiences confirmed")
        pipeline._run_stage(context.run, PipelineStage.STRATEGY_GENERATING, pipeline._generate_strategy)
        pipeline.state.transition(context.run, PipelineStage.DRAFT_GENERATING, reason="resume strategy generated")
        return _result(context, "已根据岗位目标和确认经历形成简历定位与内容策略。")

    def propose_resume_rewrites(context: ToolContext, _: PipelineToolInput) -> PipelineToolResult:
        pipeline._run_stage(context.run, PipelineStage.DRAFT_GENERATING, pipeline._generate_draft_and_proposals)
        pipeline.state.transition(context.run, PipelineStage.AWAITING_USER_REVIEW, reason="wait for rewrite proposal decisions")
        proposals = list(context.session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == context.run.id)).all())
        approval = context.session.scalar(select(Approval).where(Approval.run_id == context.run.id, Approval.action_type == "apply_resume_changes"))
        resume = pipeline._resume(context.run)
        return _result(
            context,
            f"已在原简历基础上生成 {len(proposals)} 条可审核改写建议。",
            artifacts=([f"resume:{resume.id}"] if resume else []) + [f"proposal:{item.id}" for item in proposals],
            approval_action="apply_resume_changes",
            data={"approval_id": approval.id if approval else None, "proposal_count": len(proposals), "resume_id": resume.id if resume else None},
        )

    def apply_approved_resume_changes(context: ToolContext, _: PipelineToolInput) -> PipelineToolResult:
        pipeline.approvals.require(run_id=context.run.id, action_type="apply_resume_changes")
        pipeline.state.transition(context.run, PipelineStage.APPROVED_CHANGES_APPLYING, review_approved=True, actor="user", reason="rewrite proposals approved")
        pipeline._run_stage(context.run, PipelineStage.APPROVED_CHANGES_APPLYING, pipeline._apply_approved_changes)
        pipeline.state.transition(context.run, PipelineStage.FACT_VALIDATING, reason="approved changes applied")
        resume = pipeline._require_resume(context.run)
        return _result(context, "已将用户批准的改写应用到新的岗位简历版本。", artifacts=[f"resume:{resume.id}"], data={"resume_id": resume.id})

    def validate_resume(context: ToolContext, _: PipelineToolInput) -> PipelineToolResult:
        pipeline._run_stage(context.run, PipelineStage.FACT_VALIDATING, pipeline._validate_resume_facts)
        pipeline.state.transition(context.run, PipelineStage.PORTFOLIO_BUILDING, reason="resume facts validated")
        resume = pipeline._require_resume(context.run)
        return _result(context, "简历事实来源、角色强度和候选人范围校验通过。", artifacts=[f"validated_resume:{resume.id}"])

    def build_portfolio_preview(context: ToolContext, _: PipelineToolInput) -> PipelineToolResult:
        pipeline._run_stage(context.run, PipelineStage.PORTFOLIO_BUILDING, pipeline._build_mock_portfolio)
        pipeline.state.transition(context.run, PipelineStage.CONSISTENCY_CHECKING, reason="portfolio preview prepared")
        return _result(context, "已准备与当前简历版本绑定的作品材料预览。")

    def run_consistency_checks(context: ToolContext, _: PipelineToolInput) -> PipelineToolResult:
        pipeline._run_stage(context.run, PipelineStage.CONSISTENCY_CHECKING, pipeline._run_consistency_and_gate)
        pipeline.state.transition(context.run, PipelineStage.AWAITING_PUBLISH_APPROVAL, reason="wait for final export approval")
        pipeline._ensure_publish_approval(context.run)
        approval = context.session.scalar(select(Approval).where(Approval.run_id == context.run.id, Approval.action_type == "publish_assets"))
        return _result(
            context,
            "简历与作品材料一致性检查通过，等待用户最终确认导出。",
            approval_action="publish_assets",
            data={"approval_id": approval.id if approval else None},
        )

    def finalize_publish_ready(context: ToolContext, _: PipelineToolInput) -> PipelineToolResult:
        pipeline.approvals.require(run_id=context.run.id, action_type="publish_assets")
        pipeline.state.transition(context.run, PipelineStage.READY_TO_PUBLISH, publish_approved=True, actor="user", reason="final export approved")
        pipeline._write_report(context.run)
        resume = pipeline._require_resume(context.run)
        return _result(context, "最终材料已通过门禁，可以预览并导出。", artifacts=[f"resume:{resume.id}"], data={"resume_id": resume.id})

    def add(name: str, description: str, permission: ToolPermission, stages: set[PipelineStage], handler, *, read_only: bool = False, approval_action: str | None = None) -> None:
        gateway.register(ToolSpec(
            name=name,
            description=description,
            input_model=PipelineToolInput,
            output_model=PipelineToolResult,
            permission=permission,
            allowed_stages=stages,
            handler=handler,
            read_only=read_only,
            side_effect=not read_only,
            approval_action=approval_action,
        ))

    add("validate_run_input", "校验当前候选人、岗位归属和 JD 是否足以开始任务。", ToolPermission.DRAFT_WRITE, {PipelineStage.CREATED, PipelineStage.INPUT_VALIDATING}, validate_run_input)
    add("analyze_job", "调用岗位分析能力，从 JD 原文提取职责、硬要求、加分项和能力维度。", ToolPermission.DRAFT_WRITE, {PipelineStage.JD_ANALYZING}, analyze_job)
    add("match_candidate_experiences", "根据岗位语义匹配候选人的完整经历并创建用户确认请求。", ToolPermission.DRAFT_WRITE, {PipelineStage.FACTS_MATCHING}, match_candidate_experiences)
    add("generate_resume_strategy", "在用户确认真实经历后生成岗位化简历定位和内容策略。", ToolPermission.DRAFT_WRITE, {PipelineStage.AWAITING_FACT_REVIEW}, generate_resume_strategy, approval_action="confirm_relevant_facts")
    add("propose_resume_rewrites", "以原简历为底稿生成逐条改写建议和新的岗位简历草稿。", ToolPermission.DRAFT_WRITE, {PipelineStage.DRAFT_GENERATING}, propose_resume_rewrites)
    add("apply_approved_resume_changes", "只应用用户逐条批准的简历改写建议。", ToolPermission.CONFIRMED_WRITE, {PipelineStage.AWAITING_USER_REVIEW}, apply_approved_resume_changes, approval_action="apply_resume_changes")
    add("validate_resume", "核验简历事实来源、角色强度和候选人范围。", ToolPermission.READ, {PipelineStage.FACT_VALIDATING}, validate_resume)
    add("build_portfolio_preview", "基于当前简历版本准备作品材料预览。", ToolPermission.DRAFT_WRITE, {PipelineStage.PORTFOLIO_BUILDING}, build_portfolio_preview)
    add("run_consistency_checks", "执行简历、作品材料和发布门禁的一致性检查。", ToolPermission.READ, {PipelineStage.CONSISTENCY_CHECKING}, run_consistency_checks)
    add("finalize_publish_ready", "在用户最终批准后将材料标记为可预览和导出。", ToolPermission.EXPORT, {PipelineStage.AWAITING_PUBLISH_APPROVAL}, finalize_publish_ready, approval_action="publish_assets")
    add("inspect_job_context", "只读检查当前岗位、事实、材料、基础简历和岗位简历，不修改任何内容。", ToolPermission.READ, all_stages, inspect_job_context, read_only=True)
    return gateway
