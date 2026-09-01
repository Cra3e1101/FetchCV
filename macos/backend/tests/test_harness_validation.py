from applyos_domain.enums import FactSourceType
from applyos_domain.models import Candidate, Fact
from applyos_harness.validation import Claim, FactValidator, role_strength_risk


def test_fact_validator_checks_numbers_dates_names_and_output_ownership(database):
    with database.session() as session:
        first = Candidate(name="甲")
        second = Candidate(name="乙")
        session.add_all([first, second])
        session.flush()
        fact = Fact(
            candidate_id=first.id,
            category="project_metric",
            content="2025年在甲公司复核3000条结果，使用 Python",
            normalized_value={"company": "甲公司", "skill": "Python"},
            source_type=FactSourceType.USER_INPUT,
            verified=True,
            allowed_outputs=["resume"],
        )
        foreign = Fact(candidate_id=second.id, category="metric", content="5000条", verified=True, allowed_outputs=["resume"])
        session.add_all([fact, foreign])
        session.flush()
        validator = FactValidator(session)

        passed = validator.validate(
            candidate_id=first.id,
            asset_type="resume",
            claims=[Claim(text="2025年在甲公司使用 Python 复核3000条结果", fact_ids=[fact.id], expected_names=["甲公司"], expected_skills=["Python"])],
        )
        assert passed.passed is True

        failed = validator.validate(
            candidate_id=first.id,
            asset_type="portfolio",
            claims=[Claim(text="2026年在乙公司复核5000条结果", fact_ids=[fact.id, foreign.id], expected_names=["乙公司"])],
        )
        codes = {issue.code for issue in failed.issues}
        assert {"fact_output_not_allowed", "fact_ownership_mismatch", "number_conflict", "date_conflict", "name_conflict"} <= codes


def test_role_strength_rule_detects_prd_escalations():
    risk, matches = role_strength_risk("参与原型设计，内部使用", "主导设计，已上线并大规模应用")
    assert risk == "high"
    assert "参与→主导" in matches
    assert "原型→已上线" in matches
    assert "内部使用→大规模应用" in matches
