from __future__ import annotations

import html
import re
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.enums import ProposalStatus, QualityStatus, RiskLevel
from applyos_domain.models import AgentRun, Candidate, QualityReport, ResumeVersion, RewriteProposal

from .errors import HarnessError
from .validation import Claim, FactValidator, ValidationIssue, normalized_excerpt, role_strength_risk
from .versioning import canonical_hash


PLACEHOLDERS = ("TODO", "TBD", "待补充", "Lorem ipsum", "请输入")


def _plain_text(value: Any) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", str(value or "")))


def resume_semantic_payload(content: dict[str, Any]) -> dict[str, Any]:
    """Project every text-bearing editor field used by PDF/Word rendering.

    Ignore only layout/style controls and image bytes. Hidden sections are
    included because alternate exporters can render them.
    """
    snapshot = content.get("editor_snapshot") or {}
    return {
        "profile": {key: value for key, value in (snapshot.get("profile") or {}).items() if key not in {"photo", "avatar", "image"}},
        "sections": [
            {
                **{key: section.get(key) for key in ("id", "title", "name", "tab", "visible")},
                "items": [{key: value for key, value in item.items() if key in {
                    "metaLeft", "metaRight", "body", "fields", "title", "subtitle", "timeRange", "date", "description", "summary",
                }} for item in section.get("items") or [] if isinstance(item, dict)],
            }
            for section in snapshot.get("sections") or [] if isinstance(section, dict)
        ],
    }


def rendered_resume_text(content: dict[str, Any]) -> str:
    """Source text for before checks; claims metadata is never visible proof."""
    values: list[str] = []

    def collect(value):
        if isinstance(value, dict):
            for item in value.values():
                collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, str):
            values.append(_plain_text(value))

    if content.get("editor_snapshot"):
        snapshot = content["editor_snapshot"]
        for key, value in (snapshot.get("profile") or {}).items():
            if key not in {"photo", "avatar", "image"}:
                collect(value)
        for section in snapshot.get("sections") or []:
            if not isinstance(section, dict) or section.get("visible") is False:
                continue
            for key in ("title", "name", "tab"):
                collect(section.get(key))
            for item in section.get("items") or []:
                if isinstance(item, dict):
                    for key in ("metaLeft", "metaRight", "body", "fields", "title", "subtitle", "timeRange", "date", "description", "summary"):
                        collect(item.get(key))
    else:
        # Imported legacy text can be reviewed, but does not become verified.
        for key in ("text", "raw_text", "original_text"):
            if isinstance(content.get(key), str):
                values.append(content[key])
    return "\n".join(values)


def proposal_claims(session: Session, proposal: RewriteProposal, *, text: str | None = None) -> list[Claim]:
    """Revalidate persisted evidence and before binding at approval AND apply."""
    contract = proposal.claim_contract or {}
    source = session.get(ResumeVersion, contract.get("source_resume_id")) if contract.get("source_resume_id") else None
    target = session.get(ResumeVersion, proposal.resume_version_id)
    if (source is None or target is None or source.candidate_id != target.candidate_id
            or (source.job_id is not None and source.job_id != target.job_id)):
        raise HarnessError("proposal_source_unverified", "建议缺少当前候选人简历原文绑定，请重新准备审阅")
    if canonical_hash(source.content_json) != contract.get("source_resume_hash"):
        raise HarnessError("proposal_source_changed", "建议对应的简历原文已变化，请重新准备审阅")
    if normalized_excerpt(proposal.before) not in normalized_excerpt(rendered_resume_text(source.content_json)):
        raise HarnessError("resume_before_not_found", "建议原文无法在绑定简历中定位")
    try:
        claims = [Claim.model_validate(item) for item in contract.get("claims") or []]
    except ValidationError:
        raise HarnessError("proposal_claim_invalid", "建议的事实证据合同无效，请补证后重试") from None
    actual = text if text is not None else (proposal.edited_after or proposal.after)
    if len(claims) != 1:
        raise HarnessError("proposal_claim_unverified", "每条建议必须绑定一条可核验个人陈述")
    claims[0].text = actual
    result = FactValidator(session).validate(candidate_id=target.candidate_id, asset_type="resume", claims=claims)
    risk, matches = role_strength_risk(proposal.before, actual)
    if not result.passed or risk == "high":
        raise HarnessError("proposal_needs_evidence", "改写或人工编辑仍需补证，不能直接采用", details={"issues": [issue.model_dump(mode="json") for issue in result.issues], "role_escalations": matches})
    return claims


def resume_evidence_issues(session: Session, resume: ResumeVersion) -> list[ValidationIssue]:
    content = resume.content_json or {}
    issues: list[ValidationIssue] = []
    try:
        claims = [Claim.model_validate(item) for item in content.get("claims") or []]
    except (ValidationError, TypeError):
        return [ValidationIssue(code="resume_claim_invalid", message="简历事实合同无效，需要重新核验")]
    if not claims:
        issues.append(ValidationIssue(code="resume_evidence_missing", message="该简历没有逐条版本化事实证据，当前为未核验草稿"))
    result = FactValidator(session).validate(candidate_id=resume.candidate_id, asset_type="resume", claims=claims)
    issues.extend(result.issues)
    if content.get("verification_status") == "unverified":
        issues.append(ValidationIssue(code="resume_editor_unverified", message="简历正文已人工修改，需重新核验后导出"))
    candidate = session.get(Candidate, resume.candidate_id)
    proofs = [normalized_excerpt(claim.text) for claim in claims if claim.verification_status == "verified"]

    def supported_body(value: Any) -> bool:
        value = normalized_excerpt(_plain_text(value))
        if not value:
            return True
        if value in proofs:
            return True
        # Concatenation of complete supported claims is safe; arbitrary clips
        # and reordered terms/numbers are not.
        remaining = value
        while remaining:
            remaining = remaining.lstrip(" 。.!！?？；;•·")
            if not remaining:
                return True
            matched = next((proof for proof in sorted(proofs, key=len, reverse=True) if remaining.startswith(proof)
                            and not (remaining[len(proof):] and proof[-1].isascii() and proof[-1].isalnum()
                                     and remaining[len(proof)].isascii() and remaining[len(proof)].isalnum())), None)
            if not matched:
                return False
            remaining = remaining[len(matched):]
        return True

    def check(value: Any, path: str, *, metadata: bool = False):
        if isinstance(value, dict):
            for key, child in value.items():
                check(child, f"{path}.{key}", metadata=metadata)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                check(child, f"{path}.{index}", metadata=metadata)
        elif isinstance(value, str) and value.strip():
            clean = normalized_excerpt(_plain_text(value))
            # A title/role/date is also a personal assertion. Substring support
            # would turn '不精通SQL' into a verified '精通SQL' metadata field.
            supported = bool(clean) and supported_body(value)
            if not supported:
                issues.append(ValidationIssue(code="rendered_text_unverified", message="实际渲染正文包含未核验内容", details={"path": path}))

    snapshot = content.get("editor_snapshot") or {}
    if not snapshot:
        issues.append(ValidationIssue(code="resume_snapshot_missing", message="缺少已核验的实际渲染正文"))
    identity = {"name": "name", "fullName": "name", "phone": "phone", "mobile": "phone", "email": "email", "location": "location", "city": "location"}
    for key, value in (snapshot.get("profile") or {}).items():
        if key in {"photo", "avatar", "image"} or not value:
            continue
        if key in identity and candidate and normalized_excerpt(str(value)) == normalized_excerpt(getattr(candidate, identity[key]) or ""):
            continue
        check(value, f"profile.{key}")
    headings = {"教育背景", "教育经历", "工作与实习", "工作经历", "实习经历", "项目经历", "专业技能", "技能", "校园经历", "荣誉奖项", "荣誉奖励", "个人概述", "自我评价", "教育", "经历", "项目", "Education", "Experience", "Projects", "Skills", "Awards", "Summary"}
    for si, section in enumerate(snapshot.get("sections") or []):
        for key in ("title", "name", "tab"):
            if section.get(key) and section[key] not in headings:
                check(section[key], f"sections.{si}.{key}")
        for ii, item in enumerate(section.get("items") or []):
            for key in ("body", "description", "summary"):
                check(item.get(key), f"sections.{si}.items.{ii}.{key}")
            for key in ("metaLeft", "metaRight", "fields", "title", "subtitle", "timeRange", "date"):
                check(item.get(key), f"sections.{si}.items.{ii}.{key}", metadata=True)
            if ((item.get("fields") or {}).get("timeRange") or {}).get("current") is True:
                check("至今", f"sections.{si}.items.{ii}.fields.timeRange.current")
    return issues


def require_resume_exportable(session: Session, resume: ResumeVersion) -> None:
    issues = resume_evidence_issues(session, resume)
    if issues:
        raise HarnessError("resume_export_unverified", "简历包含未核验或已失效内容，请完成事实核验后导出", details={"verification_status": "unverified", "issues": [issue.model_dump(mode="json") for issue in issues]})


def require_pdf_text_matches_resume(resume: ResumeVersion, text: str) -> None:
    """Fail closed for arbitrary client bytes, including image-only PDFs.

    A revision header proves which snapshot was requested, not what the PDF
    contains. Consume complete text fragments from that checked snapshot;
    never approve a PDF via a global number/word pool or a client attestation.
    """
    if not text or not text.strip():
        raise HarnessError("resume_pdf_text_unverified", "图片型 PDF 无法核验正文，请使用已核验的服务端渲染导出")
    snapshot = resume.content_json.get("editor_snapshot") or {}
    fragments: list[str] = []
    required_bodies: list[str] = []

    def collect(value):
        if isinstance(value, dict):
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)
        elif isinstance(value, str) and value.strip():
            plain = _plain_text(value)
            fragments.append(plain)

    for key, value in (snapshot.get("profile") or {}).items():
        if key not in {"photo", "avatar", "image"}:
            collect(value)
    for section in snapshot.get("sections") or []:
        for key in ("title", "name", "tab"):
            collect(section.get(key))
        for item in section.get("items") or []:
            for key in ("metaLeft", "metaRight", "body", "fields", "title", "subtitle", "timeRange", "date", "description", "summary"):
                collect(item.get(key))
            if section.get("visible") is not False:
                for key in ("body", "description", "summary"):
                    if isinstance(item.get(key), str) and item[key].strip():
                        required_bodies.append(normalized_excerpt(_plain_text(item[key])))
    fragments.append("个人概述")
    allowed = sorted({normalized_excerpt(fragment) for fragment in fragments if normalized_excerpt(fragment)}, key=len, reverse=True)
    # Keep signs and word boundaries. Decorative punctuation may separate
    # complete safe fragments; it may not alter the words inside a claim.
    # Renderers add list glyphs between wrapped paragraphs; ignore only those
    # decorative glyphs, never a hyphen/sign or any qualifying source words.
    remaining = normalized_excerpt(re.sub(r"[•·▪◦]", "", text.replace("\x00", "")))
    if any(body not in remaining for body in required_bodies):
        raise HarnessError("resume_pdf_text_unverified", "上传 PDF 未完整保留已核验正文及其限定词，请使用服务端渲染导出")
    separators = " \t\r\n•·▪◦|：:。.!！？?；;，,（）()~～—"
    while remaining:
        remaining = remaining.lstrip(separators)
        if not remaining:
            return
        matched = None
        for fragment in allowed:
            if not remaining.startswith(fragment):
                continue
            tail = remaining[len(fragment):]
            if tail and fragment[-1].isascii() and fragment[-1].isalnum() and tail[0].isascii() and tail[0].isalnum():
                continue
            matched = fragment
            break
        if matched is None:
            raise HarnessError("resume_pdf_text_unverified", "上传 PDF 的实际文字无法与已核验正文逐段对应，请使用服务端渲染导出")
        remaining = remaining[len(matched):]


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
        artifact_required: bool = True,
    ) -> QualityReport:
        checks: list[dict[str, Any]] = []
        errors: list[str] = []
        warnings: list[str] = []
        proposals = self.session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id)).all()
        pending = [proposal.id for proposal in proposals if proposal.approval_status == ProposalStatus.PENDING]
        pending_high = [proposal.id for proposal in proposals if proposal.risk_level == RiskLevel.HIGH and proposal.approval_status == ProposalStatus.PENDING]
        self._check(checks, errors, not pending, "proposal_review", "存在未确认建议", {"ids": pending})
        self._check(checks, errors, not pending_high, "high_risk_review", "存在未确认高风险建议", {"ids": pending_high})

        for issue in resume_evidence_issues(self.session, resume):
            errors.append(issue.message)
            checks.append({"code": issue.code, "passed": False, "details": issue.details})
        if artifact_required:
            self._check(checks, errors, pdf_generated, "pdf_generated", "PDF 尚未成功生成")
            self._check(checks, errors, page_count is not None and 0 < page_count <= max_pages, "page_count", "PDF 页数不符合配置", {"page_count": page_count, "max_pages": max_pages})
        else:
            checks.extend({"code": code, "passed": None, "status": "not_checked", "details": {"phase": "draft_content_only"}} for code in ("pdf_generated", "page_count"))
            warnings.append("本次仅校验草稿内容，PDF 生成与页数尚未验证")
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
