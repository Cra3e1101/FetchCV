from __future__ import annotations

import json
import re
from copy import deepcopy
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.enums import ApprovalStatus, AssetStatus, ProposalStatus, QualityStatus, RiskLevel, RunStatus, StepStatus
from applyos_domain.models import (
    AgentRun,
    AgentRunStep,
    Approval,
    Candidate,
    Fact,
    Job,
    JobProfile,
    PortfolioVersion,
    QualityReport,
    ResumeVersion,
    RewriteProposal,
    VersionSnapshot,
)

from .approval import ApprovalService
from .errors import HarnessError
from .gates import PublishGate
from .state_machine import PipelineStage, RunStateMachine
from .trace import TraceService
from .validation import Claim, FactValidator, role_strength_risk
from .versioning import VersionService, canonical_hash
from integrations.resume.editor_schema import build_editor_snapshot


class MockPipeline:
    """Code-owned pipeline with deterministic local stages and approval gates."""

    def __init__(self, session: Session, execution_mode: str = "local_rule"):
        self.session = session
        self.execution_mode = execution_mode
        self.state = RunStateMachine(session)
        self.trace = TraceService(session)
        self.approvals = ApprovalService(session)
        self.versions = VersionService(session)
        self.validator = FactValidator(session)
        self.gate = PublishGate(session)

    def create_run(self, *, candidate_id: str, job_id: str, idempotency_key: str) -> AgentRun:
        if not idempotency_key.strip():
            raise HarnessError("idempotency_key_required", "创建 Agent Run 必须提供 Idempotency-Key")
        existing = self.session.scalar(select(AgentRun).where(AgentRun.idempotency_key == idempotency_key))
        if existing is not None:
            if existing.candidate_id != candidate_id or existing.job_id != job_id:
                raise HarnessError("idempotency_conflict", "同一幂等键对应了不同的运行参数", run_id=existing.id)
            return existing
        candidate = self.session.get(Candidate, candidate_id)
        job = self.session.get(Job, job_id)
        if candidate is None:
            raise HarnessError("candidate_not_found", "候选人不存在")
        if job is None or job.candidate_id != candidate_id:
            raise HarnessError("job_scope_mismatch", "岗位不存在或不属于当前候选人")
        run = AgentRun(
            candidate_id=candidate_id,
            job_id=job_id,
            idempotency_key=idempotency_key,
            run_type="model_assisted_job_asset_pipeline" if self.execution_mode == "model_assisted" else "local_rule_job_asset_pipeline",
            status=RunStatus.CREATED,
            current_stage=PipelineStage.CREATED.value,
        )
        self.session.add(run)
        self.session.flush()
        run.session_id = f"{self.execution_mode}-session:{run.id}"
        self.trace.record(
            run=run,
            stage=PipelineStage.CREATED.value,
            agent_name="model_pipeline" if self.execution_mode == "model_assisted" else "local_rule_pipeline",
            event_type="session_start",
            actor="user",
            reason="create model-assisted run" if self.execution_mode == "model_assisted" else "create deterministic local run",
            input_refs=[f"candidate:{candidate_id}", f"job:{job_id}"],
        )
        return run

    def drive(self, run: AgentRun) -> AgentRun:
        try:
            while True:
                stage = PipelineStage(run.current_stage or PipelineStage.CREATED)
                if stage == PipelineStage.CREATED:
                    self.state.transition(run, PipelineStage.INPUT_VALIDATING, reason="start preflight")
                elif stage == PipelineStage.INPUT_VALIDATING:
                    self._run_stage(run, stage, self._validate_input)
                    self.state.transition(run, PipelineStage.JD_ANALYZING)
                elif stage == PipelineStage.JD_ANALYZING:
                    self._run_stage(run, stage, self._analyze_job)
                    self.state.transition(run, PipelineStage.FACTS_MATCHING)
                elif stage == PipelineStage.FACTS_MATCHING:
                    self._run_stage(run, stage, self._match_facts)
                    self.state.transition(run, PipelineStage.AWAITING_FACT_REVIEW, reason="wait for relevant experience confirmation")
                    return run
                elif stage == PipelineStage.AWAITING_FACT_REVIEW:
                    if not self.approvals.is_approved(run_id=run.id, action_type="confirm_relevant_facts"):
                        return run
                    if not self._verified_facts(run):
                        raise HarnessError("verified_fact_required", "请至少确认一条与岗位相关的真实经历", run_id=run.id, stage=run.current_stage)
                    self.state.transition(run, PipelineStage.STRATEGY_GENERATING, actor="user", reason="relevant experiences confirmed")
                elif stage == PipelineStage.STRATEGY_GENERATING:
                    self._run_stage(run, stage, self._generate_strategy)
                    self.state.transition(run, PipelineStage.DRAFT_GENERATING)
                elif stage == PipelineStage.DRAFT_GENERATING:
                    self._run_stage(run, stage, self._generate_draft_and_proposals)
                    self.state.transition(run, PipelineStage.AWAITING_USER_REVIEW, reason="wait for proposal decisions")
                    return run
                elif stage == PipelineStage.AWAITING_USER_REVIEW:
                    if not self.approvals.is_approved(run_id=run.id, action_type="apply_resume_changes"):
                        return run
                    self.state.transition(run, PipelineStage.APPROVED_CHANGES_APPLYING, review_approved=True, actor="user", reason="proposal review complete")
                elif stage == PipelineStage.APPROVED_CHANGES_APPLYING:
                    self._run_stage(run, stage, self._apply_approved_changes)
                    self.state.transition(run, PipelineStage.FACT_VALIDATING)
                elif stage == PipelineStage.FACT_VALIDATING:
                    self._run_stage(run, stage, self._validate_resume_facts)
                    self.state.transition(run, PipelineStage.PORTFOLIO_BUILDING)
                elif stage == PipelineStage.PORTFOLIO_BUILDING:
                    self._run_stage(run, stage, self._build_mock_portfolio)
                    self.state.transition(run, PipelineStage.CONSISTENCY_CHECKING)
                elif stage == PipelineStage.CONSISTENCY_CHECKING:
                    self._run_stage(run, stage, self._run_consistency_and_gate)
                    self.state.transition(run, PipelineStage.AWAITING_PUBLISH_APPROVAL, reason="wait for publish approval")
                    self._ensure_publish_approval(run)
                    return run
                elif stage == PipelineStage.AWAITING_PUBLISH_APPROVAL:
                    if not self.approvals.is_approved(run_id=run.id, action_type="publish_assets"):
                        return run
                    self.state.transition(run, PipelineStage.READY_TO_PUBLISH, publish_approved=True, actor="user", reason="publish approval granted")
                    self._write_report(run)
                    return run
                elif stage in {PipelineStage.READY_TO_PUBLISH, PipelineStage.PUBLISHED, PipelineStage.FROZEN, PipelineStage.CANCELLED}:
                    return run
                elif stage in {PipelineStage.FAILED, PipelineStage.BLOCKED}:
                    return run
        except HarnessError as exc:
            run.error = json.dumps(exc.as_dict(), ensure_ascii=False)
            current = PipelineStage(run.current_stage or PipelineStage.CREATED)
            if current not in {PipelineStage.FAILED, PipelineStage.BLOCKED, PipelineStage.CANCELLED, PipelineStage.FROZEN}:
                target = PipelineStage.BLOCKED if exc.code.startswith("quality_") or exc.code.endswith("_conflict") else PipelineStage.FAILED
                self.state.transition(run, target, reason=exc.message)
            self.trace.record(
                run=run,
                stage=run.resume_stage or run.current_stage or "unknown",
                agent_name="model_pipeline" if self.execution_mode == "model_assisted" else "local_rule_pipeline",
                event_type="pipeline_error",
                status=StepStatus.FAILED,
                error_code=exc.code,
                error=exc.message,
            )
            return run

    def retry(self, run: AgentRun) -> AgentRun:
        self.state.recover(run)
        return self.drive(run)

    def cancel(self, run: AgentRun, *, actor: str = "user") -> AgentRun:
        return self.state.transition(run, PipelineStage.CANCELLED, actor=actor, reason="cancel requested")

    def _run_stage(self, run: AgentRun, stage: PipelineStage, handler) -> None:
        if self._stage_completed(run.id, stage):
            return
        output_refs = handler(run)
        self.trace.record(
            run=run,
            stage=stage.value,
            agent_name="model_pipeline" if self.execution_mode == "model_assisted" else "local_rule_pipeline",
            event_type="stage",
            status=StepStatus.COMPLETED,
            output_refs=output_refs or [],
            usage={"runtime": self.execution_mode, "llm_tokens": 0},
        )

    def _stage_completed(self, run_id: str, stage: PipelineStage) -> bool:
        return self.session.scalar(
            select(AgentRunStep.id).where(
                AgentRunStep.run_id == run_id,
                AgentRunStep.stage == stage.value,
                AgentRunStep.event_type == "stage",
                AgentRunStep.status == StepStatus.COMPLETED,
            )
        ) is not None

    def _validate_input(self, run: AgentRun) -> list[str]:
        job = self._job(run)
        if not (job.jd_raw or "").strip():
            raise HarnessError("jd_required", "岗位缺少 JD 原文", run_id=run.id, stage=run.current_stage)
        return [f"job:{job.id}"]

    def _analyze_job(self, run: AgentRun) -> list[str]:
        job = self._job(run)
        profile = self.session.scalar(select(JobProfile).where(JobProfile.job_id == job.id))
        words = list(dict.fromkeys(re.findall(r"[A-Za-z][A-Za-z0-9+#.-]{1,}|[\u4e00-\u9fff]{2,6}", job.jd_raw or "")))[:12]
        if profile is None:
            profile = JobProfile(job_id=job.id)
            self.session.add(profile)
        profile.responsibilities = [line.strip(" -•") for line in (job.jd_raw or "").splitlines() if line.strip()][:5] or [job.jd_raw or ""]
        profile.keywords = words
        profile.business_context = {"source": "mock_deterministic_parser", "inferred": False}
        self.session.flush()
        return [f"job_profile:{profile.id}"]

    def _match_facts(self, run: AgentRun) -> list[str]:
        facts = list(
            self.session.scalars(
                select(Fact)
                .where(Fact.candidate_id == run.candidate_id)
                .order_by(Fact.verified.desc(), Fact.updated_at.desc())
            ).all()
        )
        job_text = (self._job(run).jd_raw or "").lower()
        items = []
        for fact in facts:
            tokens = re.findall(r"[a-z][a-z0-9+#.-]{1,}|[\u4e00-\u9fff]{2,6}", fact.content.lower())
            matched_terms = sorted({token for token in tokens if token in job_text})
            score = len(matched_terms)
            items.append(
                {
                    "fact_id": fact.id,
                    "content": fact.content,
                    "category": fact.category,
                    "verified": fact.verified,
                    "score": score,
                    "recommended": score > 0,
                    "match_method": "local_keyword_overlap_v1",
                    "matched_terms": matched_terms[:6],
                    "match_reason": f"与 JD 共享关键词：{'、'.join(matched_terms[:6])}" if matched_terms else "未发现直接关键词重合",
                }
            )
        items.sort(key=lambda item: (item["recommended"], item["score"], item["verified"]), reverse=True)
        self.approvals.request(
            run_id=run.id,
            action_type="confirm_relevant_facts",
            target_type="job",
            target_id=run.job_id,
            items=items,
        )
        return [f"matched_fact:{fact.id}" for fact in facts]

    def _generate_strategy(self, run: AgentRun) -> list[str]:
        return ["strategy:select_verified_facts", "strategy:preserve_role_strength", "strategy:require_review"]

    def _proposal_specs(self, run: AgentRun, facts: list[Fact]) -> list[dict[str, Any]]:
        return [
            {
                "section": fact.category,
                "before": fact.content,
                "after": fact.content,
                "reason": "本地模式只组织结构和顺序，不擅自改写事实",
                "jd_evidence": [(self._job(run).jd_raw or "")[:240]],
                "fact_ids": [fact.id],
                "risk_level": "low",
            }
            for fact in facts
            if fact.category not in {"education", "profile", "profile.contact", "profile.identity"}
        ]

    def _generate_draft_and_proposals(self, run: AgentRun) -> list[str]:
        facts = self._verified_facts(run)
        resume = self._resume(run)
        if resume is None:
            candidate = self.session.get(Candidate, run.candidate_id)
            base_resume = self.session.scalar(
                select(ResumeVersion)
                .where(ResumeVersion.candidate_id == run.candidate_id, ResumeVersion.job_id.is_(None))
                .order_by(ResumeVersion.updated_at.desc())
            )
            snapshot, strategy = build_editor_snapshot(
                self.session,
                candidate=candidate,
                job=self._job(run),
                facts=facts,
                strategy_override=self._strategy_payload(run),
            )
            claims = [{"text": fact.content, "fact_ids": [fact.id]} for fact in facts]
            base_content = deepcopy(base_resume.content_json or {}) if base_resume else {}
            resume = ResumeVersion(
                legacy_id=f"mock-run:{run.id}:draft",
                candidate_id=run.candidate_id,
                job_id=run.job_id,
                parent_version_id=base_resume.id if base_resume else None,
                name=f"{self._job(run).role} · 定制简历",
                status=AssetStatus.DRAFT,
                content_json={**base_content, "claims": claims, "editor_snapshot": snapshot, "strategy": strategy, "page_count": 1, "generation_mode": self.execution_mode},
                source_fact_ids=[fact.id for fact in facts],
            )
            resume.content_hash = canonical_hash(resume.content_json)
            self.session.add(resume)
            self.session.flush()
            self.versions.snapshot_entity(resume, run_id=run.id, reason="create complete resume draft")
        proposals = self.session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id)).all()
        if not proposals:
            for index, item in enumerate(self._proposal_specs(run, facts), start=1):
                before = item["before"]
                after = item["after"]
                risk = RiskLevel(item.get("risk_level", "low"))
                detected, matches = role_strength_risk(before, after)
                if detected == "high":
                    risk = RiskLevel.HIGH
                self.session.add(
                    RewriteProposal(
                        resume_version_id=resume.id,
                        run_id=run.id,
                        section=item.get("section") or f"section_{index}",
                        before=before,
                        after=after,
                        reason=item.get("reason") or "提高与 JD 的信息对应度",
                        jd_evidence=item.get("jd_evidence") or [(self._job(run).jd_raw or "")[:240]],
                        fact_ids=item.get("fact_ids") or [],
                        risk_level=risk,
                    )
                )
            self.session.flush()
        proposals = self.session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id)).all()
        self.approvals.request(
            run_id=run.id,
            action_type="apply_resume_changes",
            target_type="resume_version",
            target_id=resume.id,
            items=[{"proposal_id": item.id, "risk_level": item.risk_level.value} for item in proposals],
        )
        return [f"resume:{resume.id}", *[f"proposal:{item.id}" for item in proposals]]

    def _apply_approved_changes(self, run: AgentRun) -> list[str]:
        resume = self._require_resume(run)
        proposals = self.session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id)).all()
        pending = [item.id for item in proposals if item.approval_status == ProposalStatus.PENDING]
        if pending:
            raise HarnessError("approval_required", "仍有未审批建议", run_id=run.id, details={"ids": pending})
        accepted = [item for item in proposals if item.approval_status in {ProposalStatus.ACCEPTED, ProposalStatus.EDITED_ACCEPTED}]
        facts = self._verified_facts(run)
        overrides = {fact_id: item.edited_after or item.after for item in accepted for fact_id in item.fact_ids}
        claims = [{"text": overrides.get(fact.id, fact.content), "fact_ids": [fact.id]} for fact in facts]
        fact_ids = [fact.id for fact in facts]
        candidate = self.session.get(Candidate, run.candidate_id)
        snapshot, strategy = build_editor_snapshot(
            self.session,
            candidate=candidate,
            job=self._job(run),
            facts=facts,
            text_overrides=overrides,
            strategy_override=self._strategy_payload(run),
        )
        content = {**resume.content_json, "claims": claims, "editor_snapshot": snapshot, "strategy": strategy, "page_count": 1}
        self.versions.update_resume(resume, content_json=content, source_fact_ids=fact_ids, run_id=run.id, reason="apply approved proposals")
        return [f"resume:{resume.id}"]

    def _validate_resume_facts(self, run: AgentRun) -> list[str]:
        resume = self._require_resume(run)
        claims = [Claim.model_validate(item) for item in resume.content_json.get("claims", [])]
        result = self.validator.validate(candidate_id=run.candidate_id, asset_type="resume", claims=claims)
        if not result.passed:
            first = result.issues[0]
            raise HarnessError(f"quality_{first.code}", first.message, run_id=run.id, stage=run.current_stage, details={"issues": [item.model_dump(mode="json") for item in result.issues]})
        return [f"validated_resume:{resume.id}"]

    def _build_mock_portfolio(self, run: AgentRun) -> list[str]:
        resume = self._require_resume(run)
        marker = f"mock://run/{run.id}"
        portfolio = self.session.scalar(select(PortfolioVersion).where(PortfolioVersion.artifact_path == marker))
        if portfolio is None:
            portfolio = PortfolioVersion(
                candidate_id=run.candidate_id,
                job_id=run.job_id,
                resume_version_id=resume.id,
                status=AssetStatus.DRAFT,
                page_schema={"claims": resume.content_json.get("claims", []), "mode": "mock_protocol_preview"},
                source_fact_ids=resume.source_fact_ids,
                preview_url=marker,
                artifact_path=marker,
            )
            portfolio.content_hash = canonical_hash(portfolio.page_schema)
            self.session.add(portfolio)
            self.session.flush()
            self.versions.snapshot_entity(portfolio, run_id=run.id, reason="create mock portfolio protocol preview")
        return [f"portfolio:{portfolio.id}"]

    def _run_consistency_and_gate(self, run: AgentRun) -> list[str]:
        resume = self._require_resume(run)
        existing = self.session.scalar(
            select(QualityReport).where(
                QualityReport.run_id == run.id,
                QualityReport.target_type == "resume_version",
                QualityReport.target_id == resume.id,
                QualityReport.status == QualityStatus.PASSED,
            )
        )
        report = existing or self.gate.evaluate_resume(run=run, resume=resume, pdf_generated=True, page_count=int(resume.content_json.get("page_count", 0)))
        if report.status != QualityStatus.PASSED:
            raise HarnessError("quality_publish_gate_blocked", "发布门禁未通过", run_id=run.id, stage=run.current_stage, details_ref=f"quality_report:{report.id}", details={"errors": report.errors})
        return [f"quality_report:{report.id}"]

    def _ensure_publish_approval(self, run: AgentRun) -> None:
        resume = self._require_resume(run)
        self.approvals.request(run_id=run.id, action_type="publish_assets", target_type="resume_version", target_id=resume.id)

    def _write_report(self, run: AgentRun) -> None:
        report = self.trace.pipeline_report(run)
        self.trace.record(
            run=run,
            stage=run.current_stage or "unknown",
            agent_name="mock_pipeline",
            event_type="pipeline_report",
            output_refs=[f"report:run:{run.id}"],
            usage=report,
        )

    def _verified_facts(self, run: AgentRun) -> list[Fact]:
        approval = self.session.scalar(
            select(Approval).where(
                Approval.run_id == run.id,
                Approval.action_type == "confirm_relevant_facts",
                Approval.status == ApprovalStatus.APPROVED,
            )
        )
        selected_ids = list((approval.decision_payload or {}).get("fact_ids", [])) if approval else []
        statement = select(Fact).where(Fact.candidate_id == run.candidate_id, Fact.verified.is_(True))
        if selected_ids:
            statement = statement.where(Fact.id.in_(selected_ids))
        return list(self.session.scalars(statement.order_by(Fact.created_at)).all())

    def _strategy_payload(self, run: AgentRun) -> dict[str, Any] | None:
        snapshot = self.session.scalar(
            select(VersionSnapshot)
            .where(
                VersionSnapshot.target_type == "job_resume_strategy",
                VersionSnapshot.target_id == run.job_id,
                VersionSnapshot.run_id == run.id,
            )
            .order_by(VersionSnapshot.sequence.desc())
        )
        return deepcopy(snapshot.payload) if snapshot else None

    def _job(self, run: AgentRun) -> Job:
        job = self.session.get(Job, run.job_id)
        if job is None or job.candidate_id != run.candidate_id:
            raise HarnessError("job_scope_mismatch", "运行绑定的岗位无效", run_id=run.id, stage=run.current_stage)
        return job

    def _resume(self, run: AgentRun) -> ResumeVersion | None:
        return self.session.scalar(select(ResumeVersion).where(ResumeVersion.legacy_id == f"mock-run:{run.id}:draft"))

    def _require_resume(self, run: AgentRun) -> ResumeVersion:
        resume = self._resume(run)
        if resume is None:
            raise HarnessError("resume_not_found", "运行没有可用的简历草稿", run_id=run.id, stage=run.current_stage)
        return resume
