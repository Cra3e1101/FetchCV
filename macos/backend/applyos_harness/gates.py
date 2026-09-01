from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.enums import ProposalStatus, QualityStatus, RiskLevel
from applyos_domain.models import AgentRun, QualityReport, ResumeVersion, RewriteProposal

from .validation import Claim, FactValidator, ValidationIssue


PLACEHOLDERS = ("TODO", "TBD", "待补充", "Lorem ipsum", "请输入")


def _visible_resume_text(content: dict[str, Any]) -> str:
    """Return only text that can appear in the rendered resume.

    Imported portraits are stored as base64 data URIs. Searching the complete
    JSON can randomly match strings such as "TODO" inside binary data and block
    an otherwise valid resume.
    """
    values: list[str] = []
    for claim in content.get("claims") or []:
        if isinstance(claim, dict) and claim.get("text"):
            values.append(str(claim["text"]))
    snapshot = content.get("editor_snapshot") or {}
    for key, value in (snapshot.get("profile") or {}).items():
        if key not in {"photo", "avatar", "image"} and isinstance(value, str):
            values.append(value)
    for section in snapshot.get("sections") or []:
        if not isinstance(section, dict) or section.get("visible") is False:
            continue
        values.extend(str(section.get(key) or "") for key in ("title", "tab"))
        for item in section.get("items") or []:
            if not isinstance(item, dict):
                continue
            values.extend(str(item.get(key) or "") for key in ("metaLeft", "metaRight", "body"))
            values.extend(str(value) for value in (item.get("fields") or {}).values() if isinstance(value, str))
    return "\n".join(values)


class PublishGate:
    def __init__(self, session: Session):
        self.session = session
        self.validator = FactValidator(session)

    def evaluate_resume(
        self,
        *,
        run: AgentRun,
        resume: ResumeVersion,
        pdf_generated: bool,
        page_count: int | None,
        max_pages: int = 2,
    ) -> QualityReport:
        checks: list[dict[str, Any]] = []
        errors: list[str] = []
        warnings: list[str] = []
        proposals = self.session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id)).all()
        pending = [proposal.id for proposal in proposals if proposal.approval_status == ProposalStatus.PENDING]
        pending_high = [proposal.id for proposal in proposals if proposal.risk_level == RiskLevel.HIGH and proposal.approval_status == ProposalStatus.PENDING]
        self._check(checks, errors, not pending, "proposal_review", "存在未确认建议", {"ids": pending})
        self._check(checks, errors, not pending_high, "high_risk_review", "存在未确认高风险建议", {"ids": pending_high})

        claims = [Claim.model_validate(item) for item in resume.content_json.get("claims", [])]
        validation = self.validator.validate(candidate_id=run.candidate_id, asset_type="resume", claims=claims)
        for issue in validation.issues:
            errors.append(issue.message)
            checks.append({"code": issue.code, "passed": False, "details": issue.details})
        self._check(checks, errors, pdf_generated, "pdf_generated", "PDF 尚未成功生成")
        self._check(checks, errors, page_count is not None and 0 < page_count <= max_pages, "page_count", "PDF 页数不符合配置", {"page_count": page_count, "max_pages": max_pages})
        visible_text = _visible_resume_text(resume.content_json)
        found_placeholders = [placeholder for placeholder in PLACEHOLDERS if placeholder.lower() in visible_text.lower()]
        self._check(checks, errors, not found_placeholders, "placeholder", "材料包含占位符", {"values": found_placeholders})

        status = QualityStatus.PASSED if not errors else QualityStatus.BLOCKED
        report = QualityReport(
            run_id=run.id,
            target_type="resume_version",
            target_id=resume.id,
            status=status,
            checks=checks,
            warnings=warnings,
            errors=list(dict.fromkeys(errors)),
        )
        self.session.add(report)
        self.session.flush()
        return report

    @staticmethod
    def _check(checks: list[dict[str, Any]], errors: list[str], passed: bool, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        checks.append({"code": code, "passed": passed, "details": details or {}})
        if not passed:
            errors.append(message)
