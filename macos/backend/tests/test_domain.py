from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from applyos_domain.base import Base
from applyos_domain.enums import AssetStatus, RunStatus, StepStatus
from applyos_domain.models import AgentRun, AgentRunStep, Candidate, ResumeVersion


def test_stage_two_schema_contains_all_prd_entities(database):
    expected = {
        "candidates", "facts", "jobs", "job_profiles", "resume_versions", "rewrite_proposals",
        "portfolio_versions", "applications", "agent_runs", "agent_run_steps", "approvals",
        "version_snapshots", "quality_reports", "material_assets", "experiences", "agent_messages",
        "agent_tasks", "queued_agent_messages", "agent_context_snapshots", "agent_skills", "mcp_server_configs", "workspace_settings",
        "interview_sources", "interview_briefs", "tool_invocations",
    }
    assert expected == set(Base.metadata.tables)


def test_frozen_resume_requires_timestamp(database):
    with pytest.raises(IntegrityError):
        with database.session() as session:
            candidate = Candidate(name="候选人")
            session.add(candidate)
            session.flush()
            session.add(ResumeVersion(candidate_id=candidate.id, name="冻结版本", status=AssetStatus.FROZEN))

    with database.session() as session:
        candidate = Candidate(name="另一候选人")
        session.add(candidate)
        session.flush()
        session.add(
            ResumeVersion(
                candidate_id=candidate.id,
                name="合法冻结版本",
                status=AssetStatus.FROZEN,
                frozen_at=datetime.now(timezone.utc),
            )
        )


def test_agent_run_records_ordered_recoverable_steps(database):
    with database.session() as session:
        candidate = Candidate(name="候选人")
        session.add(candidate)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, run_type="resume_tailoring", status=RunStatus.RUNNING, current_stage="fact_lock")
        session.add(run)
        session.flush()
        session.add(
            AgentRunStep(
                run_id=run.id,
                stage="fact_lock",
                agent_name="fact-agent",
                status=StepStatus.COMPLETED,
                sequence=1,
                output_refs=["fact:verified:3"],
            )
        )

    with database.session() as session:
        stored = session.get(AgentRun, run.id)
        assert stored is not None
        assert stored.steps[0].stage == "fact_lock"
        assert stored.steps[0].output_refs == ["fact:verified:3"]
