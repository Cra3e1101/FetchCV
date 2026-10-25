"""Workspace reuse must preserve the pinned payload and its exact fingerprint."""

from contextlib import contextmanager
from dataclasses import replace
from datetime import datetime, timedelta

import pytest
from sqlalchemy import event

from applyos_agent.context import ContextManager, PinnedContextInputs
from applyos_agent.evaluation import AgentRunEvaluator, RunEvaluationInputs
from applyos_domain.enums import StepStatus
from applyos_domain.models import (
    AgentContextSnapshot, AgentMessage, AgentRun, AgentRunStep, Approval,
    Candidate, Fact, Job, MaterialAsset, ResumeVersion,
)


@contextmanager
def reads(database):
    queries = []
    def capture(_connection, cursor, sql, _parameters, _context, _many):
        if sql.lstrip().upper().startswith("SELECT"):
            queries.append((sql, [column[0] for column in cursor.description or []]))
    event.listen(database.engine, "after_cursor_execute", capture)
    try:
        yield queries
    finally:
        event.remove(database.engine, "after_cursor_execute", capture)


def seed(session, *, tied_messages=False):
    start = datetime(2026, 1, 1)
    stamp = lambda i=0: {"created_at": start + timedelta(seconds=i), "updated_at": start + timedelta(seconds=i)}
    candidate, other = Candidate(id="candidate-a", name="A"), Candidate(id="candidate-b", name="B")
    session.add_all([candidate, other])
    session.flush()
    job = Job(id="job-a", candidate_id=candidate.id, company="A", role="Role", jd_raw="保留完整校验")
    other_job = Job(id="job-b", candidate_id=other.id, company="B", role="Other")
    session.add_all([job, other_job])
    session.flush()
    run = AgentRun(id="run-new", job_id=job.id, candidate_id=candidate.id, run_type="resume", **stamp(2))
    old_run = AgentRun(id="run-old", job_id=job.id, candidate_id=candidate.id, run_type="resume", **stamp(1))
    session.add_all([run, old_run])
    session.flush()
    base_resumes = [ResumeVersion(id=f"base-{i}", candidate_id=candidate.id, name=f"Base {i}", **stamp(4)) for i in range(3)]
    job_resumes = [ResumeVersion(id=f"tailored-{i}", candidate_id=candidate.id, job_id=job.id,
                                name=f"Tailored {i}", content_json={"editor_snapshot": {"sections": []}}, **stamp(5)) for i in range(3)]
    facts = [Fact(id=f"fact-{i:03d}", candidate_id=candidate.id, category="experience", content=f"事实 {i}",
                  verified=i % 3 != 0, **stamp(i // 2)) for i in range(90)]
    materials = [MaterialAsset(id=f"material-{i:03d}", candidate_id=candidate.id, kind="attachment", name=f"材料 {i}",
                               **stamp(i // 2)) for i in range(30)]
    messages = [AgentMessage(id=f"message-{i:03d}", candidate_id=candidate.id, job_id=job.id, role="user",
                             content=f"补充 {i}", metadata_json={"quoted_text": f"引用 {i}"} if i % 4 == 0 else {},
                             **stamp(i // 2 if tied_messages else i)) for i in range(75)]
    # Mixed rows must be excluded exactly as the corresponding SQL WHERE clauses.
    base_resumes.append(ResumeVersion(id="other-base", candidate_id=other.id, name="Other", **stamp(1000)))
    job_resumes.append(ResumeVersion(id="other-job-resume", candidate_id=other.id, job_id=other_job.id, name="Other", **stamp(1000)))
    facts.append(Fact(id="other-fact", candidate_id=other.id, category="experience", content="Other", verified=True, **stamp(1000)))
    materials.append(MaterialAsset(id="other-material", candidate_id=other.id, kind="attachment", name="Other", **stamp(1000)))
    messages.append(AgentMessage(id="other-message", candidate_id=other.id, job_id=other_job.id, role="user", content="Other",
                                 metadata_json={"quoted_text": "Other"}, **stamp(1000)))
    session.add_all([*base_resumes, *job_resumes, *facts, *materials, *messages,
                     Approval(id="historical-approval", run_id=old_run.id, action_type="apply_resume_changes",
                              target_type="resume", target_id="tailored-0", **stamp(3)),
                     AgentRunStep(id="historical-failure", run_id=old_run.id, stage="import", agent_name="fixture",
                                  sequence=1, status=StepStatus.FAILED, error_code="source_unreachable", **stamp(3))])
    session.flush()
    inputs = PinnedContextInputs(job.id, candidate.id, base_resumes[::-1], job_resumes[::-1], facts[::-1], materials[::-1], messages[::-1])
    return job, run, inputs


@pytest.mark.parametrize("tied_messages", [False, True])
def test_preloaded_pinned_payload_and_fingerprint_match_full_reads(database, tied_messages):
    with database.session() as session:
        job, _run, inputs = seed(session, tied_messages=tied_messages)
        manager = ContextManager(session)
        with reads(database) as original_reads:
            expected = manager.pinned(job)
        with reads(database) as reused_reads:
            actual = manager.pinned(job, inputs=inputs)
        assert actual == expected
        assert len(original_reads) == 7
        assert len(reused_reads) == (3 if tied_messages else 2)
        assert actual["base_resume"]["id"] == "base-2"
        assert actual["job_resume"]["id"] == "tailored-2"
        assert len(actual["verified_facts"]) == 40
        assert len(actual["materials"]) == 20
        assert actual["explicit_memory"]["approvals"][0]["id"] == "historical-approval"
        assert actual["operational_memory"]["verified_failures"][0]["step_id"] == "historical-failure"
        assert "Other" not in str(actual)


def test_preloaded_projection_treats_empty_collections_as_known_empty(database):
    with database.session() as session:
        job, _run, _ = seed(session)
        empty = PinnedContextInputs(job.id, job.candidate_id, [], [], [], [], [])
        with reads(database) as queries:
            result = ContextManager(session).pinned(job, sections=["resume", "facts", "materials"], inputs=empty)
        assert queries == []
        assert result["base_resume"] is None and result["job_resume"] is None
        assert result["verified_facts"] == result["materials"] == []


@pytest.mark.parametrize("change", [{"job_id": "other"}, {"candidate_id": "other"}])
def test_preloaded_context_rejects_wrong_workspace_scope_before_reads(database, change):
    with database.session() as session:
        job, _run, inputs = seed(session)
        with reads(database) as queries, pytest.raises(ValueError, match="workspace scope"):
            ContextManager(session).pinned(job, inputs=replace(inputs, **change))
        assert queries == []


def test_preloaded_fingerprint_tracks_changes_without_cross_request_cache(database):
    with database.session() as session:
        job, _run, inputs = seed(session)
        manager = ContextManager(session)
        before = manager.pinned(job, inputs=inputs)
        fact = next(item for item in inputs.facts if item.id == before["verified_facts"][0]["id"])
        fact.content = "已核对并修改的事实"
        session.flush()
        after = manager.pinned(job, inputs=inputs)
        assert before["source_fingerprint"] != after["source_fingerprint"]
        assert after == manager.pinned(job)


@pytest.mark.parametrize("stored", [None, {}, {"source_fingerprint": None}, {"source_fingerprint": "outdated"}, "current"])
def test_evaluation_projects_snapshot_but_preserves_fingerprint_validation(database, stored):
    with database.session() as session:
        job, run, pinned_inputs = seed(session)
        current = ContextManager(session).pinned(job, inputs=pinned_inputs)["source_fingerprint"]
        if stored is not None:
            pinned = {"source_fingerprint": current} if stored == "current" else stored
            session.add(AgentContextSnapshot(id="snapshot", job_id=job.id, run_id=run.id, version=1,
                                             summary="完整历史" * 10000,
                                             pinned_context={**pinned, "large_unused_field": "完整材料" * 10000}))
            session.flush()
        inputs = RunEvaluationInputs([], [], [], [], None, None, [], pinned_inputs=pinned_inputs)
        with reads(database) as queries:
            result = AgentRunEvaluator(session).evaluate(job=job, run=run, inputs=inputs)
        check = next(item for item in result["checks"] if item["code"] == "context_current")
        assert check["status"] == ("passed" if stored is None or stored == "current" else "warning")
        assert check["evidence"] == ([] if stored is None else ["context:snapshot"])
        assert queries[0][1] == ["id", "source_fingerprint"]
        assert len(queries) == (1 if stored is None else 3)
