from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.enums import AssetStatus, QualityStatus
from applyos_domain.models import AgentRun, Application, Fact, Job, PortfolioVersion, QualityReport, ResumeVersion
from applyos_domain.paths import artifact_root
from integrations.portfolio.builder import FileProtocolPortfolioBuilder, MockPortfolioBuilder, PortfolioBuildResult

from .approval import ApprovalService
from .errors import HarnessError
from .state_machine import PipelineStage, RunStateMachine
from .validation import Claim, FactValidator
from .versioning import VersionService, canonical_hash


PORTFOLIO_ROOT = artifact_root() / "portfolios"


class AssetService:
    def __init__(self, session: Session):
        self.session = session
        self.approvals = ApprovalService(session)
        self.versions = VersionService(session)
        self.validator = FactValidator(session)

    def create_portfolio(self, *, run: AgentRun, resume: ResumeVersion, mode: str = "mock") -> PortfolioVersion:
        if resume.candidate_id != run.candidate_id or resume.job_id != run.job_id:
            raise HarnessError("asset_scope_mismatch", "简历与当前运行上下文不匹配", run_id=run.id)
        existing = self.session.scalar(select(PortfolioVersion).where(PortfolioVersion.resume_version_id == resume.id, PortfolioVersion.job_id == run.job_id))
        if existing is not None:
            return existing
        claims = resume.content_json.get("claims", [])
        job = self.session.get(Job, run.job_id)
        portfolio = PortfolioVersion(
            candidate_id=run.candidate_id,
            job_id=run.job_id,
            resume_version_id=resume.id,
            status=AssetStatus.DRAFT,
            page_schema={
                "title": f"{job.role if job else '岗位'} · 作品集",
                "subtitle": "所有内容均来自已确认候选人事实",
                "claims": claims,
                "builder_mode": mode,
            },
            source_fact_ids=resume.source_fact_ids,
        )
        portfolio.content_hash = canonical_hash(portfolio.page_schema)
        self.session.add(portfolio)
        self.session.flush()
        self.versions.snapshot_entity(portfolio, run_id=run.id, reason="create portfolio version")
        return portfolio

    def build_portfolio(self, portfolio: PortfolioVersion, *, run: AgentRun, mode: str | None = None) -> PortfolioBuildResult:
        self.versions.assert_mutable(portfolio)
        selected_mode = mode or str(portfolio.page_schema.get("builder_mode") or "mock")
        output_dir = (PORTFOLIO_ROOT / portfolio.id).resolve()
        if not output_dir.is_relative_to(PORTFOLIO_ROOT.resolve()):
            raise HarnessError("path_outside_workspace", "作品集产物路径越界", run_id=run.id)
        builder = FileProtocolPortfolioBuilder() if selected_mode == "file" else MockPortfolioBuilder()
        result = builder.build(version_id=portfolio.id, page_schema=portfolio.page_schema, output_dir=output_dir)
        self.versions.snapshot_entity(portfolio, run_id=run.id, reason="before:portfolio build result")
        portfolio.artifact_path = result.artifact_path
        if result.preview_path:
            portfolio.preview_url = f"/artifacts/portfolios/{portfolio.id}/index.html"
        self.session.flush()
        self.versions.snapshot_entity(portfolio, run_id=run.id, reason="after:portfolio build result")
        return result

    def validate_cross_asset(self, portfolio: PortfolioVersion, *, run: AgentRun) -> QualityReport:
        resume = self.session.get(ResumeVersion, portfolio.resume_version_id)
        if resume is None:
            raise HarnessError("resume_not_found", "作品集没有绑定简历")
        resume_claims = [Claim.model_validate(item) for item in resume.content_json.get("claims", [])]
        portfolio_claims = [Claim.model_validate(item) for item in portfolio.page_schema.get("claims", [])]
        resume_result = self.validator.validate(candidate_id=run.candidate_id, asset_type="resume", claims=resume_claims)
        portfolio_result = self.validator.validate(candidate_id=run.candidate_id, asset_type="portfolio", claims=portfolio_claims)
        errors = [item.message for item in resume_result.issues + portfolio_result.issues]
        if resume.source_fact_ids != portfolio.source_fact_ids:
            errors.append("简历与作品集引用的事实集合不一致")
        report = QualityReport(
            run_id=run.id,
            target_type="portfolio_version",
            target_id=portfolio.id,
            status=QualityStatus.PASSED if not errors else QualityStatus.BLOCKED,
            checks=[{"code": "cross_asset_fact_consistency", "passed": not errors}],
            warnings=[],
            errors=list(dict.fromkeys(errors)),
        )
        self.session.add(report)
        self.session.flush()
        return report

    def publish_portfolio(self, portfolio: PortfolioVersion, *, run: AgentRun) -> PortfolioVersion:
        self.versions.assert_mutable(portfolio)
        self.approvals.require(run_id=run.id, action_type="publish_assets")
        if not portfolio.preview_url or not portfolio.artifact_path:
            raise HarnessError("portfolio_not_built", "作品集尚未构建", run_id=run.id)
        report = self.validate_cross_asset(portfolio, run=run)
        if report.status != QualityStatus.PASSED:
            raise HarnessError("quality_cross_asset_conflict", "跨资产一致性检查未通过", run_id=run.id, details_ref=f"quality_report:{report.id}", details={"errors": report.errors})
        self.versions.snapshot_entity(portfolio, run_id=run.id, reason="before:publish portfolio")
        portfolio.status = AssetStatus.PUBLISHED
        portfolio.published_url = portfolio.preview_url
        self.session.flush()
        self.versions.snapshot_entity(portfolio, run_id=run.id, reason="after:publish portfolio")
        return portfolio

    def create_application_and_freeze(self, *, run: AgentRun, resume: ResumeVersion, portfolio: PortfolioVersion | None, status: str = "submitted") -> Application:
        """Record the submitted snapshot without making the working version immutable.

        The legacy method name is retained for API compatibility. A submission is
        an audit snapshot, not a workflow dead end; future revisions derive from
        the same working assets.
        """
        self.approvals.require(run_id=run.id, action_type="publish_assets")
        existing = self.session.scalar(select(Application).where(Application.job_id == run.job_id, Application.resume_version_id == resume.id))
        if existing is not None:
            return existing
        now = datetime.now(timezone.utc)
        self.versions.snapshot_entity(resume, run_id=run.id, reason="submitted resume snapshot")
        if portfolio is not None:
            self.versions.snapshot_entity(portfolio, run_id=run.id, reason="submitted portfolio snapshot")
        application = Application(
            candidate_id=run.candidate_id,
            job_id=run.job_id,
            resume_version_id=resume.id,
            portfolio_version_id=portfolio.id if portfolio else None,
            status=status,
            submitted_at=now if status == "submitted" else None,
            frozen_at=None,
        )
        self.session.add(application)
        self.session.flush()
        machine = RunStateMachine(self.session)
        current = PipelineStage(run.current_stage or PipelineStage.CREATED)
        if current == PipelineStage.READY_TO_PUBLISH:
            machine.transition(run, PipelineStage.PUBLISHED, actor="user", reason="record submitted application snapshot")
        return application
