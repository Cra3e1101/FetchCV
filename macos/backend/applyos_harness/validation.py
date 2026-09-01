from __future__ import annotations

import re
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.models import Fact


class ValidationSeverity(StrEnum):
    WARNING = "warning"
    BLOCK = "block"


class Claim(BaseModel):
    text: str
    fact_ids: list[str] = Field(default_factory=list)
    expected_names: list[str] = Field(default_factory=list)
    expected_skills: list[str] = Field(default_factory=list)
    expected_status: str | None = None


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


NUMBER_PATTERN = re.compile(r"(?<![\w.])\d+(?:,\d{3})*(?:\.\d+)?%?")
DATE_PATTERN = re.compile(r"(?<!\d)(?:19|20)\d{2}(?:[-/.年](?:0?[1-9]|1[0-2])(?:[-/.月](?:0?[1-9]|[12]\d|3[01])日?)?)?")


def extract_numbers(text: str) -> set[str]:
    return {match.group(0).replace(",", "") for match in NUMBER_PATTERN.finditer(text)}


def extract_dates(text: str) -> set[str]:
    return {match.group(0).replace("年", "-").replace("月", "-").replace("日", "").replace("/", "-").replace(".", "-").rstrip("-") for match in DATE_PATTERN.finditer(text)}


ROLE_ESCALATIONS: tuple[tuple[str, str], ...] = (
    ("参与", "负责"), ("参与", "主导"), ("协助", "独立完成"), ("了解", "熟练"), ("熟悉", "精通"),
    ("尝试", "落地"), ("原型", "已上线"), ("内部使用", "大规模应用"),
)


def role_strength_risk(before: str, after: str) -> tuple[str, list[str]]:
    matches = [f"{weak}→{strong}" for weak, strong in ROLE_ESCALATIONS if weak in before and strong in after]
    return ("high" if matches else "low", matches)


class FactValidator:
    def __init__(self, session: Session):
        self.session = session

    def validate(self, *, candidate_id: str, asset_type: str, claims: list[Claim]) -> ValidationResult:
        issues: list[ValidationIssue] = []
        for index, claim in enumerate(claims):
            if not claim.fact_ids:
                issues.append(ValidationIssue(code="claim_without_fact", message="关键陈述未绑定 fact_id", claim_index=index))
                continue
            facts = self.session.scalars(select(Fact).where(Fact.id.in_(claim.fact_ids))).all()
            fact_map = {fact.id: fact for fact in facts}
            for fact_id in claim.fact_ids:
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
            valid_facts = [fact for fact in facts if fact.candidate_id == candidate_id]
            source_text = "\n".join([fact.content + " " + self._normalized_text(fact.normalized_value) for fact in valid_facts])
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
        return ValidationResult(passed=not any(issue.severity == ValidationSeverity.BLOCK for issue in issues), issues=issues)

    @staticmethod
    def _normalized_text(value: dict[str, Any]) -> str:
        def flatten(item: Any) -> list[str]:
            if isinstance(item, dict):
                return [part for child in item.values() for part in flatten(child)]
            if isinstance(item, list):
                return [part for child in item for part in flatten(child)]
            return [str(item)] if item is not None else []

        return " ".join(flatten(value))
