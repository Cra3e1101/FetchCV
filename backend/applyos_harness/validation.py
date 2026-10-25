from __future__ import annotations

import re
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.models import Fact


class ValidationSeverity(StrEnum):
    WARNING = "warning"
    BLOCK = "block"


class EvidenceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidence_type: str = "candidate_fact"
    candidate_id: str
    fact_id: str
    fact_version: int = Field(ge=1)
    source_quote: str = Field(min_length=1)


class PersonalClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim_type: str = "personal_fact"
    text: str
    evidence: list[EvidenceRef] = Field(default_factory=list)
    action: str = ""
    object: str = ""
    metrics: list[str] = Field(default_factory=list)
    status: str = ""
    # A caller's assertion of verification is never trusted by the validator.
    verification_status: str = "unverified"
    fact_ids: list[str] = Field(default_factory=list)
    expected_names: list[str] = Field(default_factory=list)
    expected_skills: list[str] = Field(default_factory=list)
    expected_status: str | None = None


# Kept for persisted legacy documents; missing evidence remains unverified.
Claim = PersonalClaim


class ValidationIssue(BaseModel):
    code: str
    message: str
    severity: ValidationSeverity = ValidationSeverity.BLOCK
    claim_index: int | None = None
    fact_id: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class ValidationResult(BaseModel):
    passed: bool
    issues: list[ValidationIssue] = Field(default_factory=list)


NUMBER_PATTERN = re.compile(r"(?<![\d.])[-+]?\d+(?:,\d{3})*(?:\.\d+)*%?")
DATE_PATTERN = re.compile(r"(?<!\d)(?:19|20)\d{2}(?:[-/.年](?:0?[1-9]|1[0-2])(?:[-/.月](?:0?[1-9]|[12]\d|3[01])日?)?)?")


def extract_numbers(text: str) -> set[str]:
    return {match.group(0).replace(",", "") for match in NUMBER_PATTERN.finditer(text)}


def extract_dates(text: str) -> set[str]:
    return {match.group(0).replace("年", "-").replace("月", "-").replace("日", "").replace("/", "-").replace(".", "-").rstrip("-") for match in DATE_PATTERN.finditer(text)}


ROLE_ESCALATIONS: tuple[tuple[str, str], ...] = (
    ("参与", "负责"), ("参与", "主导"), ("协助", "独立完成"), ("了解", "熟练"), ("熟悉", "精通"),
    ("尝试", "落地"), ("原型", "已上线"), ("内部使用", "大规模应用"),
)


def normalized_excerpt(text: str) -> str:
    """Only layout whitespace, list bullets and terminal punctuation vary.

    Never remove words, negations, numbers, internal punctuation or qualifiers.
    In particular this is not a bag-of-words/substring semantic judge.
    """
    value = str(text or "").strip()
    value = re.sub(r"^(?:[•·]\s*|-\s+)", "", value)
    value = re.sub(r"\s+", " ", value)
    # Chinese layout wrapping may vary, but English word boundaries carry
    # meaning: 'not able' is not 'notable', 'now here' is not 'nowhere'.
    value = re.sub(r"(?<![A-Za-z0-9]) | (?![A-Za-z0-9])", "", value)
    return value.rstrip("。.!！?？；;")


def _complete_quote(content: str, quote: str) -> bool:
    if quote not in content:
        return False
    if normalized_excerpt(quote) == normalized_excerpt(content):
        return True
    # Only complete sentences qualify as conservative extraction. Clipping
    # '未使用 SQL' into '使用 SQL' must never pass because it is a substring.
    sentences = re.split(r"(?<=[。！？!?])\s*", content)
    return any(normalized_excerpt(quote) == normalized_excerpt(item) for item in sentences if item.strip())


def _proof_sentence(quote: str, text: str) -> str | None:
    if not normalized_excerpt(text):
        return None
    for sentence in [quote, *re.split(r"(?<=[。！？!?])\s*", quote)]:
        if sentence.strip() and normalized_excerpt(text) == normalized_excerpt(sentence):
            return sentence
    return None


def grounded_claim(fact: Fact, text: str | None = None) -> PersonalClaim:
    """Server-side contract for an unchanged fact, never for a new paraphrase."""
    value = fact.content if text is None else text
    return PersonalClaim(
        text=value,
        evidence=[EvidenceRef(candidate_id=fact.candidate_id, fact_id=fact.id, fact_version=fact.version, source_quote=fact.content)],
        action=value, object=value, metrics=sorted(extract_numbers(value)), status=value,
        fact_ids=[fact.id],
    )


def role_strength_risk(before: str, after: str) -> tuple[str, list[str]]:
    matches = [f"{weak}→{strong}" for weak, strong in ROLE_ESCALATIONS if weak in before and strong in after]
    return ("high" if matches else "low", matches)


class FactValidator:
    def __init__(self, session: Session):
        self.session = session

    def validate(self, *, candidate_id: str, asset_type: str, claims: list[Claim], require_contract: bool = True) -> ValidationResult:
        if not require_contract and asset_type not in {"resume", "interview_answer"}:
            return self._validate_legacy(candidate_id=candidate_id, asset_type=asset_type, claims=claims)
        issues: list[ValidationIssue] = []
        for index, claim in enumerate(claims):
            start = len(issues)
            claim.verification_status = "needs_evidence"
            if claim.claim_type != "personal_fact":
                issues.append(ValidationIssue(code="personal_claim_type_required", message="简历和个性化回答只能采用已核验个人事实；岗位要求、他人面经和建议不能写成本人经历", claim_index=index))
            if not claim.evidence:
                issues.append(ValidationIssue(code="claim_without_evidence", message="陈述缺少候选人、事实版本及支持原句，需补证", claim_index=index))
            fact_ids = list(dict.fromkeys([*claim.fact_ids, *[ref.fact_id for ref in claim.evidence]]))
            if not fact_ids:
                issues.append(ValidationIssue(code="claim_without_fact", message="关键陈述未绑定 fact_id", claim_index=index))
            facts = self.session.scalars(select(Fact).where(Fact.id.in_(fact_ids))).all() if fact_ids else []
            fact_map = {fact.id: fact for fact in facts}
            for fact_id in fact_ids:
                fact = fact_map.get(fact_id)
                if fact is None:
                    issues.append(ValidationIssue(code="fact_not_found", message="引用的事实不存在", claim_index=index, fact_id=fact_id))
                    continue
                if fact.candidate_id != candidate_id:
                    issues.append(ValidationIssue(code="fact_ownership_mismatch", message="fact_id 不属于当前候选人", claim_index=index, fact_id=fact_id))
                if not fact.verified:
                    issues.append(ValidationIssue(code="fact_unverified", message="引用了尚未确认的事实", claim_index=index, fact_id=fact_id))
                if fact.allowed_outputs and asset_type not in fact.allowed_outputs:
                    issues.append(ValidationIssue(code="fact_output_not_allowed", message=f"事实不允许用于 {asset_type}", claim_index=index, fact_id=fact_id))
            valid_quotes: list[str] = []
            for ref in claim.evidence:
                fact = fact_map.get(ref.fact_id)
                if ref.evidence_type != "candidate_fact":
                    issues.append(ValidationIssue(code="personal_evidence_type_invalid", message="JD 和他人面经只能支持岗位要求或练习建议", claim_index=index, fact_id=ref.fact_id))
                if ref.candidate_id != candidate_id or (fact and ref.candidate_id != fact.candidate_id):
                    issues.append(ValidationIssue(code="evidence_candidate_mismatch", message="证据候选人与当前候选人不一致", claim_index=index, fact_id=ref.fact_id))
                if fact and ref.fact_version != fact.version:
                    issues.append(ValidationIssue(code="fact_version_stale", message="事实版本已变化，请重新读取并审阅证据", claim_index=index, fact_id=ref.fact_id))
                if fact and not _complete_quote(fact.content, ref.source_quote):
                    issues.append(ValidationIssue(code="source_quote_not_supported", message="支持原句必须是事实中的完整原句；不能裁掉否定、角色、状态或范围", claim_index=index, fact_id=ref.fact_id))
                if (fact and fact.verified and fact.candidate_id == candidate_id and ref.candidate_id == candidate_id
                        and ref.fact_version == fact.version and ref.evidence_type == "candidate_fact"
                        and _complete_quote(fact.content, ref.source_quote)
                        and (not fact.allowed_outputs or asset_type in fact.allowed_outputs)):
                    valid_quotes.append(ref.source_quote)
            # Legacy fact_ids are diagnostics only. They never supply evidence,
            # and normalized_value cannot launder a number into source support.
            source_text = "\n".join(valid_quotes)
            unsupported_numbers = extract_numbers(claim.text) - extract_numbers(source_text)
            if unsupported_numbers:
                issues.append(ValidationIssue(code="number_conflict", message="陈述包含事实库未支持的数字", claim_index=index, details={"unsupported": sorted(unsupported_numbers)}))
            unsupported_dates = extract_dates(claim.text) - extract_dates(source_text)
            if unsupported_dates:
                issues.append(ValidationIssue(code="date_conflict", message="陈述包含事实库未支持的日期", claim_index=index, details={"unsupported": sorted(unsupported_dates)}))
            for name in claim.expected_names:
                if name and name not in source_text:
                    issues.append(ValidationIssue(code="name_conflict", message=f"名称“{name}”没有对应事实", claim_index=index, details={"name": name}))
            for skill in claim.expected_skills:
                if skill and skill.lower() not in source_text.lower():
                    issues.append(ValidationIssue(code="skill_without_fact", message=f"技能“{skill}”没有对应事实", claim_index=index, details={"skill": skill}))
            if claim.expected_status and claim.expected_status not in source_text:
                issues.append(ValidationIssue(code="status_conflict", message="项目状态与事实不一致", claim_index=index, details={"status": claim.expected_status}))
            if not claim.action.strip() or not claim.object.strip():
                issues.append(ValidationIssue(code="claim_semantics_missing", message="请逐条提供动作和对象；指标、状态存在时也必须说明", claim_index=index))
            proof = next((sentence for quote in valid_quotes for sentence in [_proof_sentence(quote, claim.text)] if sentence), None)
            if not proof:
                issues.append(ValidationIssue(code="claim_needs_evidence", message="当前只能自动核验完整原句或连续完整句摘录；新技能、职责、成果或改写需补充确认事实", claim_index=index, details={"follow_up": "请补充并确认能逐字支持该陈述的本人事实，或保留原句"}))
            status_terms = ("尚未上线", "未使用", "未完成", "未", "尚", "不", "没有", "预计", "计划", "目标", "原型", "上线", "完成", "约", "最多", "至少", "参与", "协助")
            if proof and not claim.status.strip():
                # Exact original wording already proves the qualifier. Derive
                # it locally instead of asking a model to repeat safe metadata.
                claim.status = proof.strip() if any(term in proof for term in status_terms) else ""
            if proof:
                qualifiers = ("尚未", "未", "不", "没有", "预计", "计划", "目标", "最多", "至少", "约", "参与", "协助")
                lost = [term for term in qualifiers if term in proof and term not in claim.status]
                if lost:
                    issues.append(ValidationIssue(code="claim_status_conflict", message="状态字段必须保留原句中的否定、角色和范围限定", claim_index=index, details={"missing_qualifiers": lost}))
            semantic_values = [claim.action, claim.object, *claim.metrics, claim.status]
            for value in semantic_values:
                supported = bool(proof) and normalized_excerpt(value) in normalized_excerpt(proof)
                if not supported and proof and value == claim.action:
                    # Limited qualifier+verb notation, e.g. 预计提升 in
                    # 预计转化率提升12%, describes the same complete sentence.
                    for qualifier in ("预计", "计划", "参与", "协助", "未", "尚未"):
                        rest = value[len(qualifier):] if value.startswith(qualifier) else ""
                        if rest and qualifier in proof and rest in proof and proof.index(qualifier) < proof.index(rest):
                            supported = True
                if value and not supported:
                    issues.append(ValidationIssue(code="claim_semantics_conflict", message="动作、对象、指标或状态未在同条陈述及支持原句中定位", claim_index=index, details={"value": value}))
            if extract_numbers(claim.text) - extract_numbers(" ".join(claim.metrics)):
                issues.append(ValidationIssue(code="claim_metrics_missing", message="陈述中的每个数字必须列入本条指标并保留原句对象关系", claim_index=index))
            if any(term in claim.text for term in status_terms) and not claim.status.strip():
                issues.append(ValidationIssue(code="claim_status_missing", message="陈述包含角色、范围或完成状态，必须保留本条状态证据", claim_index=index))
            if len(issues) == start:
                claim.verification_status = "verified"
                claim.fact_ids = list(dict.fromkeys(ref.fact_id for ref in claim.evidence))
        return ValidationResult(passed=not any(issue.severity == ValidationSeverity.BLOCK for issue in issues), issues=issues)

    def _validate_legacy(self, *, candidate_id: str, asset_type: str, claims: list[Claim]) -> ValidationResult:
        """Keep non-T1 assets on their prior guard without claiming verified.

        This compatibility branch is intentionally unavailable to resumes and
        personalized interview answers and never upgrades verification_status.
        """
        issues: list[ValidationIssue] = []
        for index, claim in enumerate(claims):
            claim.verification_status = "unverified"
            if not claim.fact_ids:
                issues.append(ValidationIssue(code="claim_without_fact", message="关键陈述未绑定 fact_id", claim_index=index))
            facts = list(self.session.scalars(select(Fact).where(Fact.id.in_(claim.fact_ids))).all()) if claim.fact_ids else []
            by_id = {fact.id: fact for fact in facts}
            for fact_id in claim.fact_ids:
                fact = by_id.get(fact_id)
                if not fact:
                    issues.append(ValidationIssue(code="fact_not_found", message="引用的事实不存在", claim_index=index, fact_id=fact_id))
                    continue
                if fact.candidate_id != candidate_id:
                    issues.append(ValidationIssue(code="fact_ownership_mismatch", message="fact_id 不属于当前候选人", claim_index=index, fact_id=fact_id))
                if not fact.verified:
                    issues.append(ValidationIssue(code="fact_unverified", message="引用了尚未确认的事实", claim_index=index, fact_id=fact_id))
                output_scope = "resume" if asset_type == "cover_letter" else asset_type
                if fact.allowed_outputs and output_scope not in fact.allowed_outputs:
                    issues.append(ValidationIssue(code="fact_output_not_allowed", message=f"事实不允许用于 {asset_type}", claim_index=index, fact_id=fact_id))
            source = "\n".join(fact.content + " " + self._normalized_text(fact.normalized_value) for fact in facts if fact.candidate_id == candidate_id)
            for code, values in (("number_conflict", extract_numbers(claim.text) - extract_numbers(source)), ("date_conflict", extract_dates(claim.text) - extract_dates(source))):
                if values:
                    issues.append(ValidationIssue(code=code, message="陈述包含事实库未支持的数字或日期", claim_index=index, details={"unsupported": sorted(values)}))
            for code, values in (("name_conflict", claim.expected_names), ("skill_without_fact", claim.expected_skills), ("status_conflict", [claim.expected_status] if claim.expected_status else [])):
                for value in values:
                    if value and value.lower() not in source.lower():
                        issues.append(ValidationIssue(code=code, message="陈述语义字段没有对应事实", claim_index=index, details={"value": value}))
        return ValidationResult(passed=not issues, issues=issues)

    @staticmethod
    def _normalized_text(value: dict[str, Any]) -> str:
        def flatten(item: Any) -> list[str]:
            if isinstance(item, dict):
                return [part for child in item.values() for part in flatten(child)]
            if isinstance(item, list):
                return [part for child in item for part in flatten(child)]
            return [str(item)] if item is not None else []

        return " ".join(flatten(value))
